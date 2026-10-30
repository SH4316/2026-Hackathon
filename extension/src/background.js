import { runInspection } from "./inspection.js";
import { BUNDLE_KEY, BUNDLE_ALARM, createBundleCache } from "./rules-cache.js";
import { fileReportRequest } from "./file-report.js";

// 서비스 워커: 서버 검사와 독립적인 기기 내 AI 검사를 조합한다.
// content script 는 페이지 CORS 의 영향을 받으므로 서버 요청은 모두 여기서 보낸다.
// 원문은 로그·저장소에 남기지 않는다.
// 개인 정규식 규칙(설정 화면)은 서버가 모르므로 여기서 서버 판정에 더한다(강화만, src/personal.js).
import { STORAGE_KEY as PERSONAL_KEY, localGuard as buildGuard } from "./personal.js";

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
  // 대시보드 등록 코드로 연결한 정보 { clientId, label, personId, managed }
  linkedClient: null,
};

// 조직 관리: 대시보드와 연결된 조직 서버에 등록 코드로 연결된 상태.
// 서버 검사(대시보드 규칙)는 끌 수 없고, 기기 내 AI·개인 규칙(자체 판단)은 그 위에 더해진다.
async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const s = { ...DEFAULTS, ...stored };
  s.orgManaged = !!s.linkedClient?.managed;
  if (s.orgManaged) { s.serverEnabled = true; s.enabled = true; }
  return s;
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
    try { return { ok: true, data: res.status === 204 ? null : await res.json() }; }
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
  // draft: 입력 중 검사(조직 대시보드에 기록하지 않음) / submit: 전송·첨부 직전 검사
  if (msg.stage === "draft" || msg.stage === "submit") context.stage = msg.stage;
  if (["normal", "confirmed", "forced"].includes(msg.sendAction)) context.send_action = msg.sendAction;
  if (Array.isArray(msg.files)) context.files = msg.files.slice(0, 100).map(({ name }) => ({ name }));
  return {
    request_id: crypto.randomUUID(),
    input_version: msg.inputVersion,
    text: msg.text,
    context,
  };
}

// 대시보드 연결: 등록 코드 → 개인 토큰. 토큰은 apiKey 자리에 저장해 이후 모든 검사 요청에 쓴다.
async function enroll(code) {
  const res = await callServer("POST", "/v1/auth/enroll", {
    code, client_type: "browser_extension", device_name: navigator.userAgentData?.platform || null,
  });
  if (!res.ok) return res;
  const { client_id: clientId, label, token, person_id: personId = null, managed = false } = res.data;
  const linkedClient = { clientId, label, personId, managed };
  await chrome.storage.local.set({ apiKey: token, linkedClient, ...(managed ? { serverEnabled: true } : {}) });
  return { ok: true, data: linkedClient };
}

async function unlink() {
  const res = await callServer("POST", "/v1/auth/logout");
  // 서버에서 이미 해지됐어도(401) 이 브라우저의 연결 정보는 지운다.
  if (res.ok || res.error === "http_401") await chrome.storage.local.set({ apiKey: "", linkedClient: null });
  return res.error === "http_401" ? { ok: true } : res;
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

async function personalRules() {
  const { [PERSONAL_KEY]: rules = [] } = await chrome.storage.local.get(PERSONAL_KEY);
  return rules;
}

const bundles = createBundleCache({
  read: async () => (await chrome.storage.local.get(BUNDLE_KEY))[BUNDLE_KEY],
  write: value => chrome.storage.local.set({ [BUNDLE_KEY]: value }),
});
let guardBundle = null, localGuard = buildGuard([]);
async function refreshBundle() {
  try { await bundles.refresh(await getSettings()); } catch { /* 이전 캐시로 표시하고 최종 검사는 서버에 맡긴다. */ }
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === BUNDLE_ALARM) void refreshBundle(); });
void chrome.alarms.create(BUNDLE_ALARM, { periodInMinutes: 5 });
void refreshBundle();
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
  const rules = await personalRules();
  const cached = await bundles.current(s);
  if (guardBundle !== (cached?.bundle || null)) {
    guardBundle = cached?.bundle || null;
    localGuard = buildGuard([], guardBundle);
  }
  const res = await runInspection({ kind: msg.type, request: checkRequest(msg), settings: s, personalRules: rules,
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
  if (["serverUrl", "apiKey", "linkedClient"].some(key => changes[key])) bundles.invalidate();
  if (["serverEnabled", "serverUrl", "apiKey", "linkedClient"].some(key => changes[key])) void refreshBundle();
  if (["enabled", "serverEnabled", "localAiEnabled", "serverUrl", "apiKey", "linkedClient", PERSONAL_KEY, BUNDLE_KEY]
    .some((key) => changes[key])) {
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
    case "rules:bundle": {
      const s = await getSettings();
      let cached = await bundles.current(s);
      if (!cached && s.serverEnabled) {
        try { cached = await bundles.refresh(s); } catch { /* vendor 정책으로 안내 */ }
      }
      return { ok: true, data: cached?.bundle || null };
    }
    case "files:report": {
      const s = await getSettings();
      if (!s.orgManaged) return { ok: true, data: { recorded: false, reason: "not_managed" } };
      return callServer("POST", "/v1/files/report", fileReportRequest(msg), s);
    }
    case "stat":
      return bumpStat(msg.name);
    case "enroll":
      return enroll(String(msg.code || ""));
    case "unlink":
      return unlink();
    case "me":
      return callServer("GET", "/v1/auth/me");
    default:
      return { ok: false, error: "unknown_message" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "qoamo-offscreen" || sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: "inspection_failed" }));
  return true; // 비동기 응답
});
