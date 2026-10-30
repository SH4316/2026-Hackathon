// 서비스 워커: 검사 서버 호출을 전담한다.
// content script 는 페이지 CORS 의 영향을 받으므로 서버 요청은 모두 여기서 보낸다.
// 원문은 로그·저장소에 남기지 않는다.

const DEFAULTS = {
  serverUrl: "http://127.0.0.1:8000",
  apiKey: "",
  enabled: true,
  timeoutMs: 15000,
  // 내용을 검사할 수 없는 파일(이미지·음성 등) 첨부를 막을지
  blockUnscannableFiles: false,
};

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

async function callServer(method, path, body) {
  const s = await getSettings();
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
    return { ok: true, data: await res.json() };
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

async function handle(msg) {
  switch (msg?.type) {
    case "inspect":
      return callServer("POST", "/v1/inspect", checkRequest(msg));
    case "sanitize":
      return callServer("POST", "/v1/sanitize", checkRequest(msg));
    case "health":
      return callServer("GET", "/readyz");
    case "settings":
      return { ok: true, data: await getSettings() };
    case "stat":
      return bumpStat(msg.name);
    default:
      return { ok: false, error: "unknown_message" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse);
  return true; // 비동기 응답
});
