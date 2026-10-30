#!/usr/bin/env node
/**
 * Jev prompt and Python regex regression on a dedicated packaged-app test DB.
 * Creates synthetic configuration, publishes/activates it, and edits details in isolated versions.
 * Requires explicit loopback DASHBOARD_URL; never run against a shared demo DB.
 */
import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

assert(process.env.DASHBOARD_URL, "Set DASHBOARD_URL to an isolated loopback test server.");
const target = new URL(process.env.DASHBOARD_URL);
assert(
  ["http:", "https:"].includes(target.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
    !target.username && !target.password && target.pathname === "/" &&
    !target.search && !target.hash,
  "DASHBOARD_URL must be an explicit loopback HTTP(S) origin.",
);
const baseUrl = target.origin;
const dashboardDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = resolve(process.env.BROWSER_REPORT || resolve(dashboardDir, "validation/jev-browser.json"));
const reviewDir = resolve(dashboardDir, ".impeccable/review");
const screenshotPrefix = process.env.BROWSER_SCREENSHOT_PREFIX || "jev";
assert(/^[A-Za-z0-9_-]+$/.test(screenshotPrefix), "BROWSER_SCREENSHOT_PREFIX must be a simple filename prefix.");
const fallbackRoot = "/tmp/dashboard-browser-tools/node_modules";
async function moduleLocation(variable, fallbackFile, packageName) {
  if (process.env[variable]) return pathToFileURL(resolve(process.env[variable])).href;
  try {
    await access(fallbackFile);
    return pathToFileURL(fallbackFile).href;
  } catch {
    return packageName;
  }
}
const { chromium } = await import(await moduleLocation("PLAYWRIGHT_MODULE", fallbackRoot + "/playwright/index.mjs", "playwright"));
let AxeBuilder;
try {
  ({ default: AxeBuilder } = await import(await moduleLocation("AXE_MODULE", fallbackRoot + "/@axe-core/playwright/dist/index.mjs", "@axe-core/playwright")));
} catch (error) {
  if (process.env.AXE_MODULE) throw error;
}

const report = {
  status: "RUNNING",
  checkedAt: new Date().toISOString(),
  baseUrl,
  scope: "Synthetic configuration only on an isolated test DB. Publishes and activates one version; no people or events created. Automated axe and overflow checks do not establish full WCAG conformance.",
  fixtures: {},
  checks: [],
  screenshots: [],
  responsive: [],
  axe: [],
  uncaughtErrors: [],
};
async function api(method, path, payload, expected = 200) {
  const response = await fetch(baseUrl + "/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : null;
  assert.equal(response.status, expected, `${method} ${path}: ${raw}`);
  return body;
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", error => report.uncaughtErrors.push(error.message));
page.on("dialog", dialog => dialog.accept());
const promptField = () => page.getByRole("textbox", { name: "Jev 판단 프롬프트", exact: true });
const regexField = () => page.getByRole("textbox", { name: "Python 정규식", exact: true });
async function settled() {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function openVersion(id) {
  await page.goto(baseUrl + "/settings/metrics?versionId=" + encodeURIComponent(id));
  await page.getByRole("heading", { name: "메트릭 설정", exact: true }).waitFor();
  await promptField().waitFor();
  await regexField().waitFor();
  await page.waitForFunction(() => !document.querySelector(".loading-state"));
  await settled();
}
async function selectTag(name) {
  await page.getByRole("group", { name: "메트릭 태그 트리", exact: true })
    .getByRole("button", { name, exact: true }).click();
}
async function captureState(state) {
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    await settled();
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: innerWidth,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1,
    }));
    report.responsive.push({ state, width, ...dimensions });
    if (width === 390 || width === 1440) {
      const path = resolve(reviewDir, `${screenshotPrefix}-${state}-${width === 390 ? "mobile" : "desktop"}.png`);
      await page.screenshot({ path, fullPage: true });
      report.screenshots.push({ state, width, path });
      if (AxeBuilder) {
        const result = await new AxeBuilder({ page })
          .include(".version-workbar")
          .include(".metric-editor")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        report.axe.push({
          state, width,
          violations: result.violations.map(item => ({
            id: item.id, impact: item.impact,
            nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
          })),
          incomplete: result.incomplete.map(item => ({ id: item.id, nodes: item.nodes.length })),
          passes: result.passes.length,
        });
      }
    }
  }
}

try {
  await mkdir(reviewDir, { recursive: true });
  const suffix = Date.now().toString(36);
  const parentName = "합성 고객 정보";
  const childName = "합성 이메일";
  const siblingName = "중간 합성 분류";
  const originalPrompt = "  상위 태그 전용 합성 판단 기준\n😀 연락처 문맥을 확인합니다.\n  ";
  const editedPrompt = "  고객 정보가 포함되어 있는지 문맥으로 판단하세요.\n\n조건: 연락처가 실제 업무 맥락에서 등장한 경우 포함합니다.\n제외: 공개된 예시나 가상 데이터는 제외합니다. 😀\n판단한 근거와 해당 구간을 함께 확인하세요.\n  ";
  const originalRegex = String.raw`(?i)\b(?:internal|confidential)\b`;
  const editedRegex = String.raw`(?imx)^\b(?P<label>internal|confidential)\b[ \t]*$` + "\n# 합성 검증 😀\n  ";
  const tag = (id, name, parentId, jevPrompt, pythonRegex) => ({
    id, name, parentId, jevPrompt, pythonRegex, order: 0,
    description: "브라우저 검증용 합성 분류입니다.",
    examples: ["sample@example.invalid", "가상 고객 자료"],
    guidance: "예시와 주변 문맥을 함께 확인합니다.",
    color: "#5776C6",
  });
  let version = await api("POST", "/config-versions", { name: "Jev·정규식 합성 검증 " + suffix }, 201);
  report.fixtures.versionId = version.id;
  const parentId = "jev-parent-" + suffix;
  const childId = "jev-child-" + suffix;
  const siblingId = "jev-sibling-" + suffix;
  Object.assign(report.fixtures, { parentId, childId, siblingId });
  version = await api("PUT", "/config-versions/" + version.id, {
    revision: version.revision, name: version.name,
    tags: [tag(parentId, parentName, null, originalPrompt, originalRegex), tag(childId, childName, parentId, "", ""), tag(siblingId, siblingName, null, "", "")],
    policyStates: [],
  });
  assert.equal(version.tags.find(item => item.id === parentId).jevPrompt, originalPrompt);
  assert.equal(version.tags.find(item => item.id === childId).jevPrompt, "");
  assert.equal(version.tags.find(item => item.id === parentId).pythonRegex, originalRegex);
  assert.equal(version.tags.find(item => item.id === childId).pythonRegex, "");

  await openVersion(version.id);
  assert.deepEqual(await page.locator(".editor-node").allTextContents(), [parentName, childName, siblingName]);
  assert.equal(await promptField().inputValue(), originalPrompt);
  assert.equal(await regexField().inputValue(), originalRegex);
  await selectTag(childName);
  assert.equal(await promptField().inputValue(), "");
  assert.equal(await regexField().inputValue(), "");
  await selectTag(parentName);
  assert.equal(await promptField().inputValue(), originalPrompt);
  assert.equal(await regexField().inputValue(), originalRegex);
  await promptField().fill(editedPrompt);
  assert.equal(await promptField().inputValue(), editedPrompt);
  assert.equal(await regexField().inputValue(), originalRegex);
  assert.equal(await page.getByRole("textbox", { name: "판단 참고사항", exact: true }).inputValue(), version.tags.find(item => item.id === parentId).guidance);
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await page.getByText("초안을 저장했습니다.", { exact: true }).waitFor();
  version = await api("GET", "/config-versions/" + version.id);
  assert.equal(version.tags.find(item => item.id === parentId).jevPrompt, editedPrompt);
  assert.equal(version.tags.find(item => item.id === childId).jevPrompt, "");
  assert.equal(version.tags.find(item => item.id === parentId).pythonRegex, originalRegex);

  await regexField().fill(editedRegex);
  assert.equal(await regexField().inputValue(), editedRegex);
  assert.equal(await promptField().inputValue(), editedPrompt);
  assert.equal(await regexField().getAttribute("aria-invalid"), "false");
  assert.equal((await page.locator("#python-regex-count").innerText()).trim(), Array.from(editedRegex).length.toLocaleString("ko-KR") + " / 4,000자");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await page.getByText("초안을 저장했습니다.", { exact: true }).waitFor();
  version = await api("GET", "/config-versions/" + version.id);
  assert.equal(version.tags.find(item => item.id === parentId).pythonRegex, editedRegex);
  assert.equal(version.tags.find(item => item.id === parentId).jevPrompt, editedPrompt);
  assert.equal(version.tags.find(item => item.id === childId).pythonRegex, "");
  await page.reload();
  await promptField().waitFor();
  assert.equal(await promptField().inputValue(), editedPrompt);
  assert.equal(await regexField().inputValue(), editedRegex);
  report.checks.push("Parent and child values are independent; empty child does not inherit either field; UI save and reload preserve Jev Korean text, emoji, newlines and leading/trailing whitespace exactly; guidance stays separate.");
  report.checks.push("Editing Jev leaves Python regex unchanged and editing regex leaves Jev unchanged; Python inline flags, named groups, backslashes and multiline source survive exactly, and the counter uses Unicode code points.");
  await captureState("draft");

  await page.getByRole("button", { name: "발행", exact: true }).click();
  await page.getByText("버전을 발행했습니다. 활성화하면 분류기에 제공됩니다.", { exact: true }).waitFor();
  assert(await promptField().isEnabled());
  assert(await regexField().isEnabled());
  assert(await page.getByRole("combobox", { name: "상위 태그", exact: true }).isDisabled());
  assert(await page.getByRole("button", { name: "최상위 태그 추가", exact: true }).isDisabled());
  assert.equal(await promptField().inputValue(), editedPrompt);
  assert.equal(await regexField().inputValue(), editedRegex);
  assert.equal(await page.getByRole("button", { name: "초안 저장", exact: true }).count(), 0);
  await page.getByRole("button", { name: "활성화", exact: true }).click();
  await page.getByText("활성 버전을 변경했습니다. 분류기는 새 설정을 읽어야 합니다.", { exact: true }).waitFor();
  let active = await api("GET", "/classifier-config");
  assert.equal(active.id, version.id);
  assert.equal(active.tags.find(item => item.id === parentId).jevPrompt, editedPrompt);
  assert.equal(active.tags.find(item => item.id === childId).jevPrompt, "");
  assert.equal(active.tags.find(item => item.id === parentId).pythonRegex, editedRegex);
  assert.equal(active.tags.find(item => item.id === childId).pythonRegex, "");
  const previousActive = active;
  const earlierClone = await api("POST", "/config-versions", { name: "게시 편집 격리 검증 " + suffix, baseVersionId: version.id }, 201);
  report.fixtures.earlierCloneId = earlierClone.id;
  const livePrompt = "  활성 게시 버전에서 수정한 기준 😀\n두 번째 줄\n  ";
  const liveRegex = String.raw`(?im)^\b(?P<label>restricted)\b[ \t]*$` + "\n# 활성 수정 😀\n  ";
  const liveParentName = "수정한 합성 고객 정보";
  await page.getByRole("textbox", { name: "태그 이름", exact: true }).fill(liveParentName);
  await page.getByLabel("태그 색상", { exact: true }).evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "#315a89");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("textbox", { name: "태그 설명", exact: true }).fill("게시 후 수정한 합성 설명");
  await page.getByRole("textbox", { name: "태그 예시", exact: true }).fill("게시 후 예시\n가상 자료 😀");
  await page.getByRole("textbox", { name: "판단 참고사항", exact: true }).fill("게시 후에도 별도로 유지하는 판단 맥락");
  await promptField().fill(livePrompt);
  await regexField().fill(liveRegex);
  const detailResponse = page.waitForResponse(response =>
    response.request().method() === "PUT" &&
    new URL(response.url()).pathname === `/api/v1/config-versions/${version.id}/tags/${parentId}`,
  );
  await page.getByRole("button", { name: "세부 정보 저장", exact: true }).click();
  const response = await detailResponse;
  assert.equal(response.status(), 200);
  const updated = await response.json();
  assert.equal(updated.id, previousActive.id);
  assert.equal(updated.revision, previousActive.revision + 1);
  assert.equal(updated.status, "PUBLISHED");
  assert.equal(updated.isActive, true);
  assert.deepEqual(updated.tags.map(({ id, parentId, order }) => ({ id, parentId, order })), previousActive.tags.map(({ id, parentId, order }) => ({ id, parentId, order })));
  assert.deepEqual(updated.policyStates, previousActive.policyStates);
  assert.deepEqual(updated.tags.find(item => item.id === childId), previousActive.tags.find(item => item.id === childId));
  const updatedParent = updated.tags.find(item => item.id === parentId);
  assert.equal(updatedParent.name, liveParentName);
  assert.equal(updatedParent.color.toLowerCase(), "#315a89");
  assert.equal(updatedParent.description, "게시 후 수정한 합성 설명");
  assert.deepEqual(updatedParent.examples, ["게시 후 예시", "가상 자료 😀"]);
  assert.equal(updatedParent.guidance, "게시 후에도 별도로 유지하는 판단 맥락");
  assert.equal(updatedParent.jevPrompt, livePrompt);
  assert.equal(updatedParent.pythonRegex, liveRegex);
  active = await api("GET", "/classifier-config");
  assert.deepEqual(active, updated);
  assert.deepEqual(await api("GET", "/config-versions/" + earlierClone.id), earlierClone);
  await page.reload();
  await promptField().waitFor();
  assert.equal(await promptField().inputValue(), livePrompt);
  assert.equal(await regexField().inputValue(), liveRegex);
  assert(await page.getByRole("combobox", { name: "상위 태그", exact: true }).isDisabled());
  assert.deepEqual(await page.locator(".editor-node").allTextContents(), [liveParentName, childName, siblingName]);
  report.checks.push("Published tag details remain editable while parent/add controls stay locked. Saving all mutable fields preserves version identity, active status, policies and tree, increments its revision and immediately appears in classifier config; an earlier clone with the same tag IDs remains unchanged.");
  report.checks.push("Equal-order root siblings stay in stable ASCII ID order after a published name change that reverses their lexical label order; child placement remains unchanged.");
  await captureState("published");

  await page.getByRole("button", { name: "복제", exact: true }).click();
  await page.getByText("초안을 만들었습니다. 태그와 정책 상태를 편집한 뒤 저장하세요.", { exact: true }).waitFor();
  await page.waitForURL(url => url.searchParams.get("versionId") !== version.id);
  const cloneId = new URL(page.url()).searchParams.get("versionId");
  report.fixtures.cloneId = cloneId;
  const clone = await api("GET", "/config-versions/" + cloneId);
  assert.deepEqual(clone.tags, active.tags);
  await selectTag(childName);
  assert.equal(await promptField().inputValue(), "");
  assert.equal(await regexField().inputValue(), "");
  const childPrompt = "복제본의 하위 태그 전용 판단 기준 😀\n원본과 독립적입니다.";
  await promptField().fill(childPrompt);
  const childRegex = String.raw`(?i)\b(?P<child>private)\b`;
  await regexField().fill(childRegex);
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await page.getByText("초안을 저장했습니다.", { exact: true }).waitFor();
  const savedClone = await api("GET", "/config-versions/" + cloneId);
  assert.equal(savedClone.tags.find(item => item.id === childId).jevPrompt, childPrompt);
  assert.equal(savedClone.tags.find(item => item.id === childId).pythonRegex, childRegex);
  const original = await api("GET", "/config-versions/" + version.id);
  assert.deepEqual(original.tags, active.tags);
  assert.deepEqual((await api("GET", "/classifier-config")).tags, active.tags);
  report.checks.push("Clone preserves tag IDs, prompts and regexes; editing its child leaves the published original and active configuration unchanged.");

  assert.deepEqual(report.uncaughtErrors, [], "Uncaught browser JavaScript errors");
  assert.equal(report.responsive.filter(item => item.overflow).length, 0, "Document horizontal overflow");
  assert.equal(report.axe.flatMap(item => item.violations).length, 0, "Focused automated axe violations");
  report.axeStatus = AxeBuilder ? "PASS" : "SKIPPED: optional @axe-core/playwright unavailable";
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
