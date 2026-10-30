import { createGuard } from "../vendor/prompt-guard-rules/src/index.js";
import { runInspection } from "./inspection.js";

// 서비스 워커: 서버 검사와 독립적인 기기 내 AI 검사를 조합한다.
// content script 는 페이지 CORS 의 영향을 받으므로 서버 요청은 모두 여기서 보낸다.
// 원문은 로그·저장소에 남기지 않는다.

const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8000",
  apiKey: "",
  enabled: true,
  serverEnabled: true,
  localAiEnabled: false,
  testMode: false, // 실제 사이트 점검용: 어떤 경우에도 전송하지 않음
  timeoutMs: 15000,
  // 내용을 검사할 수 없는 파일(이미지·음성 등) 첨부를 막을지
  blockUnscannableFiles: false,
};

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function callServer(method, path, body, settings) {
  const s = settings || await getSettings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), s.timeoutMs);
  try {
    const headers = { "Content-Type": "application/json" };
    if (s.apiKey) headers["X-API-Key"] = s.apiKey;
    const res = await fetch(s.serverUrl.replace(/\/+$/, "") + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    try { return { ok: true, data: await res.json() }; }
    catch { return { ok: false, error: "invalid_inspection" }; }
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

function checkRequest(msg) {
  const context = { client_type: "browser_extension" };
  if (msg.destination) context.destination = msg.destination;
  return {
    request_id: crypto.randomUUID(),
    input_version: msg.inputVersion,
    text: msg.text,
    context,
  };
}

// 이 브라우저에만 쌓는 횟수 통계. 원문은 포함하지 않으며 어디로도 전송하지 않는다.
const STAT_NAMES = ["blocked", "sanitized", "forced"];
async function bumpStat(name) {
  if (!STAT_NAMES.includes(name)) return { ok: false, error: "unknown_stat" };
  const { stats = {} } = await chrome.storage.local.get("stats");
  stats[name] = (stats[name] || 0) + 1;
  await chrome.storage.local.set({ stats });
  return { ok: true };
}

const localGuard = createGuard();
let settingsGeneration = 0;
let lifecycle = Promise.resolve();

function serializeLifecycle(action) {
  const next = lifecycle.then(action);
  lifecycle = next.catch(() => {});
  return next;
}

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")] })).length > 0;
}
async function ensureOffscreen() {
  return serializeLifecycle(async () => {
    const s = await getSettings();
    if (!s.localAiEnabled || !s.enabled) throw new Error("local_ai_disabled");
    if (await hasOffscreen()) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html", reasons: ["WORKERS"],
      justification: "Run the on-device PII model in a dedicated worker without blocking page input.",
    });
  });
}
async function aiMessage(type, extra = {}) {
  try {
    await ensureOffscreen();
    return await chrome.runtime.sendMessage({ target: "qoamo-offscreen", type, ...extra });
  } catch { return { ok: false, error: "local_ai_load_failed" }; }
}
async function prepareAI() {
  const s = await getSettings();
  if (!s.localAiEnabled || !s.enabled) return { ok: false, error: "local_ai_disabled" };
  return aiMessage("prepare");
}
async function inspect(msg, sender) {
  const s = await getSettings();
  const generation = settingsGeneration;
  const owner = `${sender.tab?.id ?? "extension"}:${sender.frameId ?? 0}:${String(msg.inputVersion).startsWith("file:") ? "file" : "prompt"}`;
  const res = await runInspection({ kind: msg.type, request: checkRequest(msg), settings: s,
    server: (kind, req) => callServer("POST", `/v1/${kind}`, req, s),
    ai: async (text) => {
      const status = await aiMessage("status");
      if (status?.data?.phase !== "ready") {
        if (status?.data?.phase === "idle") void prepareAI();
        return { ok: false, error: status?.data?.error || "local_ai_not_ready" };
      }
      return aiMessage("inspect", { text, owner });
    }, guard: localGuard,
  });
  return generation === settingsGeneration ? res : { ok: false, error: "settings_changed" };
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (["enabled", "serverEnabled", "localAiEnabled", "serverUrl", "apiKey"].some((key) => changes[key])) {
    settingsGeneration++;
    // Release model memory and cancel in-flight work when the user turns AI off.
    serializeLifecycle(async () => {
      const s = await getSettings();
      if (!s.localAiEnabled || !s.enabled) {
        if (await hasOffscreen()) await chrome.offscreen.closeDocument();
        await chrome.storage.local.set({ aiState: { phase: "off" } });
        return false;
      }
      return true;
    }).then((enabled) => { if (enabled) void prepareAI(); }).catch(() => {});
  }
});

async function handle(msg, sender) {
  switch (msg?.type) {
    case "inspect":
      return inspect(msg, sender);
    case "sanitize":
      return inspect(msg, sender);
    case "health": {
      const s = await getSettings();
      return s.serverEnabled ? callServer("GET", "/readyz", undefined, s) : { ok: false, error: "server_disabled" };
    }
    case "ai:prepare":
      return prepareAI();
    case "ai:status": {
      const s = await getSettings();
      if (!s.localAiEnabled || !s.enabled) return { ok: true, data: { phase: "off" } };
      const r = await aiMessage("status");
      if (r?.data?.phase === "idle") void prepareAI();
      return r;
    }
    case "ai:state":
      if (sender.url !== chrome.runtime.getURL("offscreen.html")) return { ok: false };
      const settings = await getSettings();
      if (!settings.localAiEnabled || !settings.enabled) return { ok: false };
      await chrome.storage.local.set({ aiState: msg.state });
      return { ok: true };
    case "settings":
      return { ok: true, data: await getSettings() };
    case "stat":
      return bumpStat(msg.name);
    default:
      return { ok: false, error: "unknown_message" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "qoamo-offscreen" || sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: "inspection_failed" }));
  return true; // 비동기 응답
});
