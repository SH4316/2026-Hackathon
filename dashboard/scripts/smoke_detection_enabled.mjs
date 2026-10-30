#!/usr/bin/env node
/** Version-scoped detection participation on an explicit, isolated loopback test DB. */
import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

assert(process.env.DASHBOARD_URL, "Set DASHBOARD_URL to an isolated loopback test server.");
const target = new URL(process.env.DASHBOARD_URL);
assert(["http:", "https:"].includes(target.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) && !target.username && !target.password && target.pathname === "/" && !target.search && !target.hash, "DASHBOARD_URL must be an explicit loopback HTTP(S) origin.");
const baseUrl = target.origin;
const dashboardDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = resolve(process.env.BROWSER_REPORT || resolve(dashboardDir, "validation/detection-enabled-browser.json"));
const reviewDir = resolve(dashboardDir, ".impeccable/review");
const prefix = process.env.BROWSER_SCREENSHOT_PREFIX || "detection-enabled";
assert(/^[A-Za-z0-9_-]+$/.test(prefix), "BROWSER_SCREENSHOT_PREFIX must be a simple filename prefix.");
const fallbackRoot = "/tmp/dashboard-browser-tools/node_modules";
async function moduleLocation(variable, fallbackFile, packageName) {
  if (process.env[variable]) return pathToFileURL(resolve(process.env[variable])).href;
  try { await access(fallbackFile); return pathToFileURL(fallbackFile).href; } catch { return packageName; }
}
const { chromium } = await import(await moduleLocation("PLAYWRIGHT_MODULE", fallbackRoot + "/playwright/index.mjs", "playwright"));
const { default: AxeBuilder } = await import(await moduleLocation("AXE_MODULE", fallbackRoot + "/@axe-core/playwright/dist/index.mjs", "@axe-core/playwright"));
const report = { status: "RUNNING", checkedAt: new Date().toISOString(), baseUrl, scope: "Synthetic configuration, person, event and saved search on an isolated test DB. No external detector/server integration. Focused changed settings are asserted; broad shell axe results are reported separately. Automated checks do not establish full WCAG conformance.", fixtures: {}, checks: [], screenshots: [], responsive: [], axe: [], broadAxe: [], uncaughtErrors: [] };
async function api(method, path, payload, expected = 200) {
  const response = await fetch(baseUrl + "/api/v1" + path, { method, headers: { "Content-Type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
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
const tagSwitch = () => page.getByRole("switch", { name: "태그 사용", exact: true });
const jevSwitch = () => page.getByRole("switch", { name: "Jev 판단 사용", exact: true });
const promptText = () => page.getByRole("textbox", { name: "Jev 판단 프롬프트", exact: true });
const threshold = name => page.getByRole("spinbutton", { name: `${name} 임계값`, exact: true });
const output = name => page.getByRole("checkbox", { name: `${name} 결과 태그`, exact: true });
async function settled() {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function openSettings(kind, id, tagId) {
  const query = new URLSearchParams({ versionId: id, ...(tagId ? { tagId } : {}) });
  await page.goto(baseUrl + `/settings/${kind}?` + query);
  await page.getByRole("heading", { name: kind === "metrics" ? "메트릭 설정" : "Jev 설정", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".loading-state"));
  await (kind === "metrics" ? tagSwitch() : jevSwitch()).waitFor();
  await settled();
}
async function saveWith(button, method, path, expected = 200, assertPendingSwitch) {
  let release;
  const pending = new Promise(done => { release = done; });
  const matcher = url => url.pathname === "/api/v1" + path;
  if (assertPendingSwitch) await page.route(matcher, async route => { await pending; await route.continue(); }, { times: 1 });
  const received = page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === "/api/v1" + path);
  await page.getByRole("button", { name: button, exact: true }).click();
  if (assertPendingSwitch) {
    assert(await assertPendingSwitch().isDisabled(), "Switch must be locked while its save is pending");
    release();
  }
  const response = await received;
  assert.equal(response.status(), expected);
  if (assertPendingSwitch) await page.unroute(matcher);
  await settled();
  return response.json();
}
function summarizeAxe(result) {
  return { violations: result.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })), incomplete: result.incomplete.map(item => ({ id: item.id, nodes: item.nodes.length })), passes: result.passes.length };
}
async function capture(state) {
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo({ top: 0, left: 0, behavior: "instant" }); });
    await settled();
    report.responsive.push({ state, width, ...await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, viewportWidth: innerWidth, overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1 })) });
    if (width === 390 || width === 1440) {
      const path = resolve(reviewDir, `${prefix}-${state}-${width === 390 ? "mobile" : "desktop"}.png`);
      await page.screenshot({ path, fullPage: true });
      report.screenshots.push({ state, width, path });
      report.axe.push({ state, width, ...summarizeAxe(await new AxeBuilder({ page }).include(".configuration-page").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()) });
      report.broadAxe.push({ state, width, ...summarizeAxe(await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()) });
    }
  }
}

try {
  await mkdir(reviewDir, { recursive: true });
  const suffix = Date.now().toString(36);
  const parentId = "enabled-parent-" + suffix;
  const childId = "enabled-child-" + suffix;
  const siblingId = "enabled-sibling-" + suffix;
  const parentName = "합성 고객 정보";
  const childName = "합성 이메일";
  const siblingName = "합성 업무 자료";
  const regex = String.raw`(?im)^\b(?P<label>private)\b$` + "\n# 보존 😀\n  ";
  const initialPrompt = "  연락처 여부를 문맥으로 판단하세요. 😀\n두 번째 줄\n  ";
  const tag = (id, name, parentId, order = 0) => ({ id, name, parentId, order, description: "사용 여부 검증 합성 태그", examples: ["sample@example.invalid"], guidance: "보존할 판단 참고사항", jevThreshold: null, pythonRegex: regex, color: "#5776C6" });
  let version = await api("POST", "/config-versions", { name: "탐지 사용 여부 합성 검증 " + suffix }, 201);
  version = await api("PUT", "/config-versions/" + version.id, { revision: version.revision, name: version.name, tags: [tag(parentId, parentName, null), tag(childId, childName, parentId), { ...tag(siblingId, siblingName, null, 1), enabled: false }], policyStates: [] });
  assert.equal(version.tags.find(item => item.id === parentId).enabled, true);
  assert.equal(version.tags.find(item => item.id === childId).enabled, true);
  assert.equal(version.tags.find(item => item.id === siblingId).enabled, false);
  version = await api("POST", `/config-versions/${version.id}/jev-prompts`, { revision: version.revision, name: "연락처 검사", prompt: initialPrompt, outputs: [{ tagId: parentId, threshold: 0 }, { tagId: childId, threshold: 0.5 }] }, 201);
  const promptId = version.jevPrompts[0].id;
  assert.equal(version.jevPrompts[0].enabled, true);
  version = await api("POST", `/config-versions/${version.id}/jev-prompts`, { revision: version.revision, name: "사용하지 않는 별도 판단", enabled: false, prompt: "보존할 독립 기준", outputs: [{ tagId: siblingId, threshold: null }] }, 201);
  version = await api("POST", `/config-versions/${version.id}/publish`, { revision: version.revision });
  version = await api("POST", `/config-versions/${version.id}/activate`);
  const earlierClone = await api("POST", "/config-versions", { name: "사용 여부 복제 격리 " + suffix, baseVersionId: version.id }, 201);
  assert.deepEqual(earlierClone.tags, version.tags);
  assert.deepEqual(earlierClone.jevPrompts, version.jevPrompts);
  Object.assign(report.fixtures, { versionId: version.id, cloneId: earlierClone.id, parentId, childId, siblingId, promptId });
  const original = structuredClone(version);
  const personId = "enabled-browser-" + suffix;
  await api("POST", "/people", { id: personId, name: "합성 사용 설정 검증" }, 201);
  const eventBody = { sourceId: personId, eventId: "historical", personId, versionId: version.id, prompt: "private 😀 sample@example.invalid", service: "chatgpt", detections: [{ start: 0, end: 7, text: "private", tagIds: [parentId, childId, siblingId] }] };
  const event = await api("POST", "/events", eventBody, 201);
  const saved = await api("POST", "/saved-searches", { name: "사용 여부 이전 기록 " + suffix, filters: { versionId: version.id, personId } }, 201);
  const metricsQuery = new URLSearchParams({ versionId: version.id, personId });
  const initialMetrics = await api("GET", "/metrics?" + metricsQuery);
  const savedEvents = await api("GET", `/saved-searches/${saved.id}/events`);
  const savedMetrics = await api("GET", `/saved-searches/${saved.id}/metrics`);
  Object.assign(report.fixtures, { personId, eventId: event.id, savedId: saved.id });
  report.checks.push("Legacy-compatible omitted flags create enabled tags/prompts; explicit false survives publication, activation and cloning. Disabled output tags remain valid ingestion targets.");

  await openSettings("metrics", version.id, parentId);
  assert(await tagSwitch().isChecked());
  assert(await tagSwitch().isEnabled());
  await tagSwitch().focus();
  await page.keyboard.press("Space");
  assert(!(await tagSwitch().isChecked()));
  assert.equal((await api("GET", `/config-versions/${version.id}`)).tags.find(item => item.id === parentId).enabled, true, "Changing a local switch must wait for explicit save");
  version = await saveWith("세부 정보 저장", "PUT", `/config-versions/${version.id}/tags/${parentId}`, 200, tagSwitch);
  assert.deepEqual(version.tags.find(item => item.id === parentId), { ...original.tags.find(item => item.id === parentId), enabled: false });
  assert.deepEqual(version.tags.find(item => item.id === childId), original.tags.find(item => item.id === childId));
  assert.deepEqual(version.jevPrompts, original.jevPrompts);
  assert.equal(version.revision, original.revision + 1);
  assert.equal(version.status, "PUBLISHED");
  assert.equal(version.isActive, true);
  assert.equal(version.publishedAt, original.publishedAt);
  assert.equal(await page.getByRole("button", { name: new RegExp(parentName + ".*사용 안 함") }).count(), 1);
  await capture("tag-off");
  await page.reload();
  await tagSwitch().waitFor();
  assert(!(await tagSwitch().isChecked()));
  await page.getByRole("button", { name: childName, exact: true }).click();
  assert(await tagSwitch().isChecked(), "Disabling a parent must not cascade to its child");
  assert.deepEqual(await api("GET", "/classifier-config"), version);
  assert.deepEqual(await api("GET", `/config-versions/${earlierClone.id}`), earlierClone);
  report.checks.push("The published tag switch supports keyboard Space, stays local until explicit save, locks during save, persists after reload, increments only that version's revision and preserves its enabled child, regex, thresholds and prompt bindings.");

  await openSettings("jev", version.id);
  assert(await jevSwitch().isChecked());
  assert.equal(await page.getByRole("switch").count(), 1);
  assert(await output(parentName).isChecked());
  assert(await output(parentName).isEnabled());
  assert(await threshold(parentName).isEnabled());
  assert.equal(await threshold(parentName).inputValue(), "0");
  assert.equal(await page.locator(".jev-output-tag").filter({ hasText: parentName }).getByText("사용 안 함", { exact: true }).count(), 1);
  await output(parentName).uncheck();
  await output(parentName).check();
  await jevSwitch().focus();
  await page.keyboard.press("Space");
  const beforeJev = structuredClone(version);
  version = await saveWith("판단 저장", "PUT", `/config-versions/${version.id}/jev-prompts/${promptId}`, 200, jevSwitch);
  assert.equal(version.jevPrompts.find(item => item.id === promptId).enabled, false);
  assert.deepEqual(version.tags, beforeJev.tags);
  assert.deepEqual({ ...version.jevPrompts.find(item => item.id === promptId), tagIds: [...version.jevPrompts.find(item => item.id === promptId).tagIds].sort() }, { ...beforeJev.jevPrompts.find(item => item.id === promptId), enabled: false, tagIds: [...beforeJev.jevPrompts.find(item => item.id === promptId).tagIds].sort() });
  await capture("jev-off");
  await page.reload();
  await jevSwitch().waitFor();
  assert(!(await jevSwitch().isChecked()));
  assert(await promptText().isEnabled());
  assert(await threshold(parentName).isEnabled());
  await promptText().fill(initialPrompt + "비활성 중에도 편집합니다.");
  await threshold(parentName).fill("0.25");
  version = await saveWith("판단 저장", "PUT", `/config-versions/${version.id}/jev-prompts/${promptId}`);
  assert.equal(version.jevPrompts.find(item => item.id === promptId).enabled, false);
  assert.equal(version.tags.find(item => item.id === parentId).enabled, false);
  assert.equal(version.tags.find(item => item.id === parentId).jevThreshold, 0.25);
  assert.equal(version.tags.find(item => item.id === parentId).pythonRegex, regex);
  report.checks.push("The independent published Jev switch persists without touching tags. Disabled output bindings remain selectable and their threshold/deep link editable; disabled judgments retain editable prompt text and shared thresholds. List and output badges state 사용 안 함 without extra switches.");

  assert.deepEqual(await api("GET", `/events/${event.id}`), event);
  assert.deepEqual(await api("GET", "/metrics?" + metricsQuery), initialMetrics);
  assert.deepEqual(await api("GET", `/saved-searches/${saved.id}/events`), savedEvents);
  assert.deepEqual(await api("GET", `/saved-searches/${saved.id}/metrics`), savedMetrics);
  assert.deepEqual(await api("GET", `/config-versions/${earlierClone.id}`), earlierClone);
  assert.deepEqual(await api("GET", "/classifier-config"), version);
  assert(version.tags.some(item => !item.enabled) && version.tags.some(item => item.enabled));
  assert(version.jevPrompts.every(item => typeof item.enabled === "boolean"));
  report.checks.push("Classifier configuration includes every enabled and disabled tag/judgment. Earlier clone state, historical event labels, metrics, saved-search membership and saved counts remain unchanged after flags and thresholds change.");

  const selectedPrompt = version.jevPrompts.find(item => item.id === promptId);
  const serverNewer = await api("PUT", `/config-versions/${version.id}/jev-prompts/${promptId}`, { revision: version.revision, name: selectedPrompt.name, prompt: selectedPrompt.prompt, outputs: selectedPrompt.tagIds.map(tagId => ({ tagId, threshold: version.tags.find(item => item.id === tagId).jevThreshold })) });
  assert.equal(serverNewer.jevPrompts.find(item => item.id === promptId).enabled, false, "Omitted enabled must preserve stored false on update");
  await jevSwitch().check();
  await promptText().fill("409 뒤에도 보존할 미저장 판단 😀");
  await threshold(childName).fill("0.625");
  await saveWith("판단 저장", "PUT", `/config-versions/${version.id}/jev-prompts/${promptId}`, 409);
  await page.getByRole("alert").waitFor();
  assert(await jevSwitch().isChecked());
  assert.equal(await promptText().inputValue(), "409 뒤에도 보존할 미저장 판단 😀");
  assert.equal(await threshold(childName).inputValue(), "0.625");
  assert(await page.getByRole("button", { name: "판단 저장", exact: true }).isEnabled());
  assert.deepEqual(await api("GET", "/classifier-config"), serverNewer);
  await page.reload();
  await jevSwitch().waitFor();
  assert(!(await jevSwitch().isChecked()));
  await jevSwitch().check();
  version = await saveWith("판단 저장", "PUT", `/config-versions/${version.id}/jev-prompts/${promptId}`);
  assert.equal(version.jevPrompts.find(item => item.id === promptId).enabled, true);
  await openSettings("metrics", version.id, parentId);
  await tagSwitch().check();
  version = await saveWith("세부 정보 저장", "PUT", `/config-versions/${version.id}/tags/${parentId}`);
  assert.equal(version.tags.find(item => item.id === parentId).enabled, true);
  assert.deepEqual(await api("GET", "/classifier-config"), version);
  report.checks.push("A real concurrent update returns 409 without discarding local Jev switch, text or threshold changes. Reloading resolves to persisted state, and both published switches can be enabled again with revision-checked saves.");

  const oldQuery = `versionId=${version.id}&tagId=${childId}&q=%20literal_%25%20`;
  await page.goto(baseUrl + "/settings/monitoring?" + oldQuery);
  await page.waitForURL(url => url.pathname === "/settings/metrics");
  assert.equal(new URL(page.url()).search, "?" + oldQuery);
  await tagSwitch().waitFor();
  assert.equal(await page.getByRole("textbox", { name: "태그 이름", exact: true }).inputValue(), childName);
  assert.equal(await page.getByRole("link", { name: "감시 연동", exact: true }).count(), 0);
  report.checks.push("The removed monitoring route redirects to metric settings with version, tag and literal-search query preserved; its navigation item is absent.");

  await openSettings("metrics", earlierClone.id, parentId);
  await page.getByRole("button", { name: "하위 태그", exact: true }).click();
  assert(await tagSwitch().isChecked());
  const cloneSaved = await saveWith("초안 저장", "PUT", `/config-versions/${earlierClone.id}`);
  assert.equal(cloneSaved.tags.find(item => !earlierClone.tags.some(previous => previous.id === item.id)).enabled, true);
  await openSettings("jev", earlierClone.id);
  await page.getByRole("button", { name: "새 Jev 판단", exact: true }).click();
  assert(await jevSwitch().isChecked());
  const withNewPrompt = await saveWith("판단 저장", "POST", `/config-versions/${earlierClone.id}/jev-prompts`, 201);
  assert.equal(withNewPrompt.jevPrompts.find(item => !earlierClone.jevPrompts.some(previous => previous.id === item.id)).enabled, true);
  assert.deepEqual(await api("GET", "/classifier-config"), version);
  report.checks.push("New child tags and Jev judgments start enabled in the UI. Saving an inactive clone leaves the active published configuration unchanged.");

  assert.deepEqual(report.uncaughtErrors, [], "Uncaught browser JavaScript errors");
  assert.equal(report.responsive.filter(item => item.overflow).length, 0, "Document horizontal overflow");
  assert.equal(report.axe.flatMap(item => item.violations).length, 0, "Focused changed-configuration axe violations");
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
