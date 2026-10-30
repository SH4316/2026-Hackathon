#!/usr/bin/env node
/**
 * Independent Jev prompts, result-tag mappings and shared thresholds on an isolated test DB.
 * Creates synthetic configuration, publishes/activates it, and checks draft/published/clone isolation.
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
const reportPath = resolve(process.env.BROWSER_REPORT || resolve(dashboardDir, "validation/jev-settings-browser.json"));
const reviewDir = resolve(dashboardDir, ".impeccable/review");
const screenshotPrefix = process.env.BROWSER_SCREENSHOT_PREFIX || "jev-settings";
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
const nameField = () => page.getByRole("textbox", { name: "Jev 판단 이름", exact: true });
const promptField = () => page.getByRole("textbox", { name: "Jev 판단 프롬프트", exact: true });
const outputField = name => page.getByRole("checkbox", { name: `${name} 결과 태그`, exact: true });
const thresholdField = name => page.getByRole("spinbutton", { name: `${name} 임계값`, exact: true });
async function settled() {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function openJev(id) {
  await page.goto(baseUrl + "/settings/jev?versionId=" + encodeURIComponent(id));
  await page.getByRole("heading", { name: "Jev 설정", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".loading-state"));
  await settled();
}
async function savePrompt(versionId, method) {
  const saved = page.waitForResponse(response =>
    response.request().method() === method &&
    new URL(response.url()).pathname.startsWith(`/api/v1/config-versions/${versionId}/jev-prompts`),
  );
  await page.getByRole("button", { name: "판단 저장", exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), method === "POST" ? 201 : 200);
  await settled();
  return response.json();
}
async function captureState(state) {
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
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
          .include("#main")
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
  const siblingName = "합성 업무 자료";
  const parentId = "jev-parent-" + suffix;
  const childId = "jev-child-" + suffix;
  const siblingId = "jev-sibling-" + suffix;
  const originalPrompt = "  연락처 여부를 문맥으로 판단하세요.\n예시 😀: sample@example.invalid\n  ";
  const editedPrompt = "  게시 후 수정한 독립 판단 기준 😀\n두 번째 줄\n  ";
  const originalRegex = String.raw`(?i)\b(?:internal|confidential)\b`;
  const tag = (id, name, parentId, order = 0) => ({
    id, name, parentId, order, jevThreshold: null, pythonRegex: originalRegex,
    description: "브라우저 검증용 합성 분류입니다.",
    examples: ["sample@example.invalid"], guidance: "판단 맥락은 별도로 유지합니다.", color: "#5776C6",
  });
  let version = await api("POST", "/config-versions", { name: "독립 Jev 합성 검증 " + suffix }, 201);
  Object.assign(report.fixtures, { versionId: version.id, parentId, childId, siblingId });
  version = await api("PUT", "/config-versions/" + version.id, {
    revision: version.revision, name: version.name,
    tags: [tag(parentId, parentName, null), tag(childId, childName, parentId), tag(siblingId, siblingName, null, 1)], policyStates: [],
  });
  assert.deepEqual(version.jevPrompts, []);
  assert(version.tags.every(item => item.jevThreshold === null && !Object.hasOwn(item, "jevPrompt")));
  await openJev(version.id);
  await page.getByRole("button", { name: "새 Jev 판단", exact: true }).first().click();
  await nameField().fill("연락처 검사");
  await promptField().fill(originalPrompt);
  await outputField(parentName).check();
  await thresholdField(parentName).fill("0");
  await outputField(childName).check();
  await thresholdField(childName).fill("0.123456");
  version = await savePrompt(version.id, "POST");
  const firstPromptId = version.jevPrompts.find(item => item.name === "연락처 검사").id;
  report.fixtures.firstPromptId = firstPromptId;
  assert.equal(version.jevPrompts[0].prompt, originalPrompt);
  assert.deepEqual(new Set(version.jevPrompts[0].tagIds), new Set([parentId, childId]));
  assert.equal(version.tags.find(item => item.id === parentId).jevThreshold, 0);
  assert.equal(version.tags.find(item => item.id === childId).jevThreshold, 0.123456);
  assert.equal(version.tags.find(item => item.id === siblingId).jevThreshold, null);
  await page.reload();
  await promptField().waitFor();
  assert.equal(await promptField().inputValue(), originalPrompt);
  assert.equal(await thresholdField(parentName).inputValue(), "0");
  assert.equal(await thresholdField(childName).inputValue(), "0.123456");
  report.checks.push("A standalone prompt maps to parent and child result tags; zero, a six-place fraction and an unset sibling remain distinct. Korean text, emoji, whitespace and newlines survive save and reload exactly.");
  await captureState("draft");

  await page.getByRole("button", { name: "새 Jev 판단", exact: true }).first().click();
  await nameField().fill("두 번째 이메일 검사");
  await promptField().fill("같은 태그를 출력하는 별도 판단입니다.");
  await outputField(childName).check();
  assert.equal(await thresholdField(childName).inputValue(), "0.123456");
  await thresholdField(childName).fill("0.65");
  version = await savePrompt(version.id, "POST");
  const secondPromptId = version.jevPrompts.find(item => item.name === "두 번째 이메일 검사").id;
  report.fixtures.secondPromptId = secondPromptId;
  assert.equal(version.tags.find(item => item.id === childId).jevThreshold, 0.65);
  assert(version.jevPrompts.find(item => item.id === firstPromptId).tagIds.includes(childId));
  await page.locator(".jev-prompt-list button").filter({ hasText: "연락처 검사" }).click();
  assert.equal(await thresholdField(childName).inputValue(), "0.65");
  await outputField(childName).uncheck();
  version = await savePrompt(version.id, "PUT");
  assert.deepEqual(version.jevPrompts.find(item => item.id === firstPromptId).tagIds, [parentId]);
  assert.equal(version.tags.find(item => item.id === childId).jevThreshold, 0.65);
  assert(version.jevPrompts.find(item => item.id === secondPromptId).tagIds.includes(childId));
  report.checks.push("Prompts share a tag's current threshold. Unselecting an output preserves its tag, threshold and bindings from other prompts.");

  version = await api("POST", "/config-versions/" + version.id + "/publish", { revision: version.revision });
  version = await api("POST", "/config-versions/" + version.id + "/activate");
  const earlierClone = await api("POST", "/config-versions", { name: "Jev 복제 격리 " + suffix, baseVersionId: version.id }, 201);
  report.fixtures.cloneId = earlierClone.id;
  assert.deepEqual(earlierClone.tags, version.tags);
  assert.deepEqual(earlierClone.jevPrompts, version.jevPrompts);
  await openJev(version.id);
  await page.locator(".jev-prompt-list button").filter({ hasText: "연락처 검사" }).click();
  assert(await promptField().isEnabled());
  await promptField().fill(editedPrompt);
  await thresholdField(parentName).fill("");
  const previousRevision = version.revision;
  version = await savePrompt(version.id, "PUT");
  assert.equal(version.revision, previousRevision + 1);
  assert.equal(version.status, "PUBLISHED");
  assert.equal(version.isActive, true);
  assert.equal(version.tags.find(item => item.id === parentId).jevThreshold, null);
  assert.equal(version.jevPrompts.find(item => item.id === firstPromptId).prompt, editedPrompt);
  assert.deepEqual(await api("GET", "/classifier-config"), version);
  assert.deepEqual(await api("GET", "/config-versions/" + earlierClone.id), earlierClone);
  report.checks.push("Published Jev settings stay editable; saving atomically increments the active version revision and classifier config while preserving an earlier clone. Clearing a threshold stores null without a default.");
  await captureState("published");

  const deleteResponse = page.waitForResponse(response =>
    response.request().method() === "DELETE" &&
    new URL(response.url()).pathname === `/api/v1/config-versions/${version.id}/jev-prompts/${firstPromptId}`,
  );
  await page.getByRole("button", { name: "판단 삭제", exact: true }).click();
  const deleted = await deleteResponse;
  assert.equal(deleted.status(), 200);
  const afterDelete = await deleted.json();
  assert.deepEqual(afterDelete.tags, version.tags);
  assert.equal(afterDelete.jevPrompts.length, 1);
  assert.equal(afterDelete.jevPrompts[0].id, secondPromptId);
  version = afterDelete;
  report.checks.push("Deleting a published prompt removes only that prompt and its output bindings; tags, shared thresholds and other prompts remain intact.");

  await page.getByRole("link", { name: `${childName} 태그 설정`, exact: true }).click();
  await page.waitForURL(url => url.pathname === "/settings/metrics" && url.searchParams.get("versionId") === version.id && url.searchParams.get("tagId") === childId);
  const metricThreshold = page.getByRole("spinbutton", { name: "Jev 임계값", exact: true });
  await metricThreshold.waitFor();
  assert.equal(await page.getByRole("textbox", { name: "태그 이름", exact: true }).inputValue(), childName);
  assert.equal(await metricThreshold.inputValue(), "0.65");
  assert.equal(await promptField().count(), 0);
  assert(await page.getByRole("combobox", { name: "상위 태그", exact: true }).isDisabled());
  await metricThreshold.fill("0.5");
  const detailResponse = page.waitForResponse(response =>
    response.request().method() === "PUT" &&
    new URL(response.url()).pathname === `/api/v1/config-versions/${version.id}/tags/${childId}`,
  );
  await page.getByRole("button", { name: "세부 정보 저장", exact: true }).click();
  const detail = await detailResponse;
  assert.equal(detail.status(), 200);
  const afterDetail = await detail.json();
  assert.equal(afterDetail.tags.find(item => item.id === childId).jevThreshold, 0.5);
  assert.equal(afterDetail.tags.find(item => item.id === childId).pythonRegex, originalRegex);
  assert.deepEqual(afterDetail.jevPrompts, version.jevPrompts);
  await captureState("metric-threshold");
  report.checks.push("A version/tag deep link selects the output tag in metric settings. Its shared threshold is editable after publication; Jev prompt text stays on the dedicated page and Python regex remains independent.");

  const prunedClone = await api("PUT", "/config-versions/" + earlierClone.id, {
    revision: earlierClone.revision, name: earlierClone.name,
    tags: earlierClone.tags.filter(item => item.id !== childId), policyStates: earlierClone.policyStates,
  });
  assert.equal(prunedClone.jevPrompts.length, earlierClone.jevPrompts.length);
  assert(prunedClone.jevPrompts.every(item => !item.tagIds.includes(childId)));
  assert(prunedClone.jevPrompts.find(item => item.id === firstPromptId).tagIds.includes(parentId));
  assert.deepEqual(await api("GET", "/classifier-config"), afterDetail);
  report.checks.push("Removing an output tag through a full clone draft save prunes only that tag's bindings; standalone prompts and remaining output mappings survive and the active original stays unchanged.");

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
