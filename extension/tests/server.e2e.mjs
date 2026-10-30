// Real extension + synthetic HTTP API; no external AI service or real prompt is used.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGuard } from "../vendor/prompt-guard-rules/src/index.js";
import vendor from "../vendor/prompt-guard-rules/data/policy.js";

const ext = path.resolve(import.meta.dirname, ".."), guard = createGuard(), requests = [];
let orgAvailable = true, delay = 0;
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>검사 연결 시험</title>
<style>body{margin:40px}textarea{width:500px;height:100px}</style>
<form><textarea id="prompt"></textarea><button data-testid="send-button" type="submit">전송</button></form>
<script>window.sent=0;const form=document.querySelector('form'),ta=document.querySelector('textarea');
form.addEventListener('submit',e=>{e.preventDefault();window.sent++;ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}));});
ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});</script></html>`;
const api = createServer(async (req, res) => {
  if (req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fixture); return; }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/readyz") {
    res.end(JSON.stringify({ policy_version: "fixture", model_mode: "required", model_ready: true, org: { managed: true } }));
    return;
  }
  if (req.headers["x-api-key"] !== "synthetic-key") { res.writeHead(401).end("{}"); return; }
  if (req.url === "/v1/rules/bundle") {
    res.end(JSON.stringify({ ...vendor.ruleset, ruleset_version: 1,
      org_rules: orgAvailable ? { version_id: "fixture", regex: [], revision: 1 } : null }));
    return;
  }
  if (req.url !== "/v1/inspect") { res.writeHead(404).end("{}"); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw);
  requests.push(input);
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  res.end(JSON.stringify({ ...guard.inspectRequest(input), report_status: "skipped" }));
});
await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const profile = mkdtempSync(path.join(tmpdir(), "pg-server-"));
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    ...(process.env.PG_CHROMIUM_PATH ? { executablePath: process.env.PG_CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const popup = await ctx.newPage();
  await popup.goto(new URL("../popup.html", sw.url()).href);
  await popup.evaluate(serverUrl => chrome.storage.local.set({ enabled: true, serverEnabled: true,
    localAiEnabled: false, linkedClient: null, serverUrl, apiKey: "" }), `http://127.0.0.1:${api.address().port}`);
  const health = () => popup.evaluate(() => chrome.runtime.sendMessage({ type: "health" }));
  assert.equal((await health()).error, "http_401", "a public readiness endpoint cannot validate the API key");
  await popup.waitForFunction(() => document.querySelector("#status").textContent === "인증 실패");
  assert.match(await popup.locator("#detail").innerText(), /API 키/);
  console.log("PASS missing credentials are shown as authentication failure");

  await popup.evaluate(() => chrome.storage.local.set({ apiKey: "synthetic-key" }));
  orgAvailable = false;
  assert.equal((await health()).error, "org_config_unavailable");
  await popup.reload();
  await popup.waitForFunction(() => document.querySelector("#status").textContent === "준비 안 됨");
  assert.match(await popup.locator("#detail").innerText(), /게시·활성화/);
  console.log("PASS missing organization rules are shown as not ready");

  orgAvailable = true;
  assert.equal((await health()).ok, true);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${api.address().port}/`);
  await page.waitForTimeout(500); // document_idle content scripts install before the first input.
  await page.fill("#prompt", "합성 회의 안건을 정리해 주세요.");
  await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge[data-state=green]"));
  await popup.close();

  // Exceeds both the old 15s request timeout and the worker's 30s idle interval.
  delay = 35_000;
  await page.fill("#prompt", "합성 느린 CPU 판정 후 전송 시험");
  await page.press("#prompt", "Enter");
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.sent), 0, "sending waits for inspection");
  await page.waitForFunction(() => window.sent === 1, undefined, { timeout: 45_000 });
  assert.equal(requests.at(-1).context.stage, "submit");
  assert.equal(requests.at(-1).text, "합성 느린 CPU 판정 후 전송 시험");
  assert.equal(await page.locator("#prompt").inputValue(), "");
  console.log("PASS a 35-second inspection completes and sends the approved text");

  // A real request timeout still holds the text; it never becomes approval.
  const settingsPage = await ctx.newPage();
  await settingsPage.goto(new URL("../popup.html", sw.url()).href);
  await settingsPage.evaluate(() => chrome.storage.local.set({ inspectionTimeoutMs: 100 }));
  await settingsPage.close();
  delay = 2000;
  await page.fill("#prompt", "합성 시간 초과 보류 시험");
  await page.press("#prompt", "Enter");
  await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge[data-state=gray]"));
  assert.equal(await page.evaluate(() => window.sent), 1);
  assert.equal(await page.locator("#prompt").inputValue(), "합성 시간 초과 보류 시험");
  console.log("PASS an actual timeout holds sending");
} finally {
  await ctx?.close();
  await new Promise(resolve => api.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
