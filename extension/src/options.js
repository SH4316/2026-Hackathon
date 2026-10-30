const $ = (id) => document.getElementById(id);
const msg = $("msg");

chrome.storage.local
  .get({ serverUrl: "http://127.0.0.1:8000", apiKey: "", enabled: true, testMode: false })
  .then((s) => {
    $("serverUrl").value = s.serverUrl;
    $("apiKey").value = s.apiKey;
    $("enabled").checked = s.enabled;
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
  if (!(await ensurePermission(serverUrl))) {
    msg.textContent = "서버 접근 권한이 없어 저장하지 않았습니다.";
    return;
  }
  await chrome.storage.local.set({
    serverUrl, apiKey: $("apiKey").value.trim(), enabled: $("enabled").checked, testMode: $("testMode").checked,
  });
  msg.textContent = "저장했습니다.";
});

$("test").addEventListener("click", async () => {
  msg.textContent = "확인 중…";
  const res = await chrome.runtime.sendMessage({ type: "health" });
  msg.textContent = res?.ok
    ? `연결됨 · 정책 ${res.data.policy_version}`
    : `실패: ${res?.error} (저장 후 다시 시도하세요)`;
});
