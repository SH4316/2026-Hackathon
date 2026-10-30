// Real INT8 model in a real MV3 offscreen Worker. First run downloads ~266 MB.
// QOAMO_TEST_PROFILE may point to a reusable *test-only* Chromium profile.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const EXT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(import.meta.dirname, "ai-shots");
await fs.mkdir(OUT, { recursive: true });
const profile = process.env.QOAMO_TEST_PROFILE || await fs.mkdtemp(path.join(os.tmpdir(), "pg-ai-e2e-"));
let serverDecision = "allow";
let serverCalls = 0;
const server = http.createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(await fs.readFile(path.join(EXT, "test-page/index.html")));
    return;
  }
  if (req.url === "/v1/auth/enroll") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ client_id: "synthetic-client", label: "테스트 클라이언트", token: "synthetic-test-token" }));
    return;
  }
  if (req.url === "/v1/auth/logout") { res.writeHead(204); res.end(); return; }
  if (req.url === "/v1/inspect") {
    serverCalls++;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ request_id: body.request_id, input_version: body.input_version,
      status: "complete", decision: serverDecision, signal: serverDecision === "block" ? "red" : "green",
      findings: [], notices: [], detector_versions: { test_server: "1" }, policy_version: "test" }));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let ctx;
const launch = () => chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, reducedMotion: "reduce", viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const errors = [];
const check = (label, condition) => { assert.ok(condition, label); console.log(`PASS ${label}`); };
async function openPopup() {
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("../popup.html", sw.url()).href);
  return page;
}
let popup;
const message = (data) => popup.evaluate((d) => chrome.runtime.sendMessage(d), data);
const settings = (data) => popup.evaluate((d) => chrome.storage.local.set(d), data);
let version = 0;
const inspect = (text) => message({ type: "inspect", text, inputVersion: ++version });

try {
  ctx = await launch();
  popup = await openPopup();
  await settings({ enabled: true, localAiEnabled: false, serverEnabled: false, testMode: false, personalRules: [] });
  await popup.reload();
  await popup.locator("#localAiEnabled").check();
  check("AI switch persists immediately", (await popup.evaluate(() => chrome.storage.local.get("localAiEnabled"))).localAiEnabled);
  const started = performance.now();
  const prepared = await message({ type: "ai:prepare" });
  assert.ok(prepared.ok, JSON.stringify(prepared));
  console.log(`Model ready in ${Math.round(performance.now() - started)} ms`);
  check("real ONNX model is ready", (await message({ type: "ai:status" })).data.phase === "ready");

  for (const [label, text, decision] of [
    ["clean Korean", "이번 주말에 비 오는지 알려 줘", "allow"],
    ["Korean name without a regex match", "김민수 팀장님께 오늘 회의록 보내 드려", "warn"],
    ["strong identifier", "내 주민번호 901023-1234567 로 등록", "block"],
    ["English contact", "Send the signed contract to david.kim@acme.io", "warn"],
  ]) {
    const t = performance.now();
    const r = await inspect(text);
    assert.ok(r.ok, JSON.stringify(r));
    check(label, r.data.ai_assessment?.decision === decision && r.data.status === "complete");
    console.log(`  ${Math.round(performance.now() - t)} ms`);
    if (label.includes("without")) check("document warning has no invented offsets", r.data.findings.length === 0 && r.data.decision === "warn");
  }

  await settings({ serverEnabled: true, serverUrl: origin });
  serverDecision = "block";
  let r = await inspect("이번 주말에 비 오는지 알려 줘");
  if (r.data?.inspection_source !== "server_and_local_ai") console.log("Combined check diagnostics", { response: r, serverCalls, origin });
  check("server block survives local AI allow", r.data.decision === "block" && r.data.inspection_source === "server_and_local_ai" && serverCalls > 0);
  serverDecision = "allow";
  r = await inspect("내 주민번호 901023-1234567 로 등록");
  check("local AI block survives server allow", r.data.decision === "block");
  check("dashboard enrollment survives the merge", (await message({ type: "enroll", code: "TEST-CODE" })).ok);
  check("dashboard unlink accepts HTTP 204", (await message({ type: "unlink" })).ok);
  check("unlink clears stored credentials", (await popup.evaluate(() => chrome.storage.local.get("apiKey"))).apiKey === "");
  await settings({ serverUrl: "http://127.0.0.1:1" });
  r = await inspect("이번 주말에 비 오는지 알려 줘");
  check("disconnected server uses completed local check", r.data.decision === "allow" && r.data.notices.includes("server_unavailable_local_check"));

  await settings({ serverEnabled: false, personalRules: [{ id: "my_emp", label: "사번", pattern: "EMP-\\d{6}",
    action: "mask", token: "MY_EMP_ID", case_sensitive: true, enabled: true }] });
  r = await inspect("사번 EMP-123456");
  check("offline AI retains personal regex rules", r.data.decision === "block" && r.data.findings.some((f) => f.rule_id === "personal:my_emp"));
  const sanitized = await message({ type: "sanitize", text: "사번 EMP-123456", inputVersion: ++version });
  check("offline sanitize keeps personal tokens and AI assessment", sanitized.data.sanitized_text === "사번 [MY_EMP_ID_1]" && !!sanitized.data.ai_assessment);
  await settings({ personalRules: [] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.locator("#ta").fill("김민수 팀장님께 오늘 회의록 보내 드려");
  await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge")?.dataset.state === "yellow", { timeout: 30000 });
  await page.locator("#ta").press("Enter");
  await page.locator(".overlay").waitFor({ timeout: 30000 });
  check("AI-only warning prevents immediate send", await page.locator("#log li").count() === 0);
  check("warning explains missing positions", (await page.locator(".overlay").innerText()).includes("정확한 위치"));
  await page.screenshot({ path: path.join(OUT, "ai-warning.png") });
  await page.getByRole("button", { name: "돌아가서 수정", exact: true }).click();

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({ name: "synthetic-name.txt", mimeType: "text/plain", buffer: Buffer.from("김민수 팀장님께 오늘 회의록 보내 드려") });
  await page.locator(".overlay").waitFor({ timeout: 30000 });
  check("AI-only file finding requires review", (await page.locator(".overlay").innerText()).includes("위치 미제공"));
  await page.getByRole("button", { name: "첨부 취소", exact: true }).click();

  await ctx.setOffline(true);
  r = await inspect("이번 주말에 비 오는지 알려 줘");
  check("inspection works with network offline", r.data.status === "complete" && r.data.decision === "allow");
  await page.locator("#ta").fill("이번 주말에 비 오는지 알려 줘");
  await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge")?.dataset.state === "green", { timeout: 30000 });
  await popup.locator("#localAiEnabled").uncheck();
  await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge")?.dataset.state === "gray");
  await page.locator("#ta").press("Enter");
  await page.locator(".overlay").waitFor();
  check("switching off invalidates an earlier green result", await page.locator("#log li").count() === 0);
  check("no inspectors holds sending", (await inspect("안녕하세요")).error === "no_inspector");

  await popup.locator("#localAiEnabled").check();
  check("cached model reloads without network", (await message({ type: "ai:prepare" })).ok);
  await popup.setViewportSize({ width: 320, height: 900 });
  for (const theme of ["dark", "light"]) {
    await popup.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await popup.screenshot({ path: path.join(OUT, `popup-${theme}.png`), fullPage: true });
    check(`popup fits width (${theme})`, await popup.evaluate(() => document.documentElement.scrollWidth <= 320));
  }
  const options = await ctx.newPage();
  options.on("pageerror", (e) => errors.push(e.message));
  await options.goto(new URL("options.html", popup.url()).href);
  await options.setViewportSize({ width: 540, height: 1000 });
  await options.screenshot({ path: path.join(OUT, "options.png"), fullPage: true });
  check("settings contain both independent switches", await options.locator("#localAiEnabled").isChecked() && !(await options.locator("#serverEnabled").isChecked()));

  check("settings keep dashboard linking and personal rules", await options.locator("#linkBtn").isVisible() && await options.locator("#ruleForm").isVisible());

  // Terminate the browser too: persistent cache must survive, not just the live session.
  await ctx.close();
  ctx = await launch();
  await ctx.setOffline(true);
  popup = await openPopup();
  check("browser restart offline reloads cached weights", (await message({ type: "ai:prepare" })).ok);
  r = await inspect("이번 주말에 비 오는지 알려 줘");
  check("offline restart still runs real inference", r.data.ai_assessment?.decision === "allow");
  check("no page JavaScript errors", errors.length === 0);
} finally {
  await ctx?.close();
  server.close();
  if (!process.env.QOAMO_TEST_PROFILE) await fs.rm(profile, { recursive: true, force: true });
}
