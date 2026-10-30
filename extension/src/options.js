import { initAIControls } from "./ai-controls.js";
void initAIControls();
const $ = (id) => document.getElementById(id);
const msg = $("msg");

chrome.storage.local
  .get({ serverUrl: "http://127.0.0.1:8000", apiKey: "", enabled: true, testMode: false, blockUnscannableFiles: false })
  .then((s) => {
    $("serverUrl").value = s.serverUrl;
    $("apiKey").value = s.apiKey;
    $("enabled").checked = s.enabled;
    $("blockUnscannableFiles").checked = s.blockUnscannableFiles;
    $("testMode").checked = s.testMode;
  });

// 기본 권한(127.0.0.1, localhost) 밖의 서버는 저장할 때 접근 권한을 요청한다.
async function ensurePermission(url) {
  const origin = new URL(url).origin + "/*";
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const serverUrl = $("serverUrl").value.trim().replace(/\/+$/, "");
  if ($("serverEnabled").checked && !(await ensurePermission(serverUrl))) {
    msg.textContent = "서버 접근 권한이 없어 저장하지 않았습니다.";
    return;
  }
  await chrome.storage.local.set({
    serverUrl, apiKey: $("apiKey").value.trim(), enabled: $("enabled").checked, testMode: $("testMode").checked,
    blockUnscannableFiles: $("blockUnscannableFiles").checked,
  });
  msg.textContent = "저장했습니다.";
});

// ── 대시보드 연결 ──
const LINK_ERRORS = {
  http_400: "등록 코드가 올바르지 않거나 만료되었습니다.",
  network: "검사 서버에 연결할 수 없습니다. 서버 주소를 저장했는지 확인하세요.",
  timeout: "검사 서버 응답 시간이 초과되었습니다.",
};

function renderLink(linked) {
  $("linkState").textContent = !linked ? "로컬 모드 · 대시보드에 연결되지 않았습니다."
    : linked.managed ? `조직 관리 · ${linked.label}${linked.personId ? ` (${linked.personId})` : ""}`
    : `연결됨 · ${linked.label}`;
  $("linkForm").hidden = !!linked;
  $("linkBtn").hidden = !!linked;
  $("unlinkBtn").hidden = !linked;
}

chrome.storage.local.get({ linkedClient: null }).then(({ linkedClient }) => renderLink(linkedClient));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.linkedClient) renderLink(changes.linkedClient.newValue);
  if (changes.apiKey) $("apiKey").value = changes.apiKey.newValue || "";
});

// "https://검사서버#ABCD-EFGH" → { serverUrl, code }. 코드만 넣으면 serverUrl 은 null.
function parseLinkInput(value) {
  const hash = value.lastIndexOf("#");
  if (hash < 0 || !/^https?:\/\//i.test(value)) return { serverUrl: null, code: value };
  try {
    const url = new URL(value.slice(0, hash));
    return { serverUrl: (url.origin + url.pathname).replace(/\/+$/, ""), code: value.slice(hash + 1).trim() };
  } catch {
    return { serverUrl: null, code: "" };
  }
}

$("linkBtn").addEventListener("click", async () => {
  const msgEl = $("linkMsg");
  const { serverUrl, code } = parseLinkInput($("linkCode").value.trim());
  if (!code) { msgEl.textContent = "연결 정보나 등록 코드를 입력하세요."; return; }
  if (serverUrl) {
    if (!(await ensurePermission(serverUrl))) {
      msgEl.textContent = "검사 서버 접근 권한이 없어 연결하지 않았습니다.";
      return;
    }
    await chrome.storage.local.set({ serverUrl, serverEnabled: true });
    $("serverUrl").value = serverUrl;
  }
  msgEl.textContent = "연결 중…";
  const res = await chrome.runtime.sendMessage({ type: "enroll", code });
  $("linkCode").value = "";
  msgEl.textContent = res?.ok ? "연결했습니다." : (LINK_ERRORS[res?.error] || `실패: ${res?.error}`);
});

$("unlinkBtn").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "unlink" });
  $("linkMsg").textContent = res?.ok ? "연결을 해제했습니다." : `실패: ${res?.error}`;
});

$("test").addEventListener("click", async () => {
  msg.textContent = "확인 중…";
  const res = await chrome.runtime.sendMessage({ type: "health" });
  msg.textContent = res?.ok
    ? `연결됨 · 정책 ${res.data.policy_version}`
    : `실패: ${res?.error} (저장 후 다시 시도하세요)`;
});
