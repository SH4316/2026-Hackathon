const statusEl = document.getElementById("status");
const detailEl = document.getElementById("detail");
const enabledEl = document.getElementById("enabled");

chrome.storage.local.get({ enabled: true }).then(({ enabled }) => { enabledEl.checked = enabled; });
enabledEl.addEventListener("change", () => chrome.storage.local.set({ enabled: enabledEl.checked }));
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.runtime.sendMessage({ type: "health" }).then((res) => {
  if (res?.ok) {
    statusEl.dataset.state = "ok";
    statusEl.textContent = "연결됨";
    const d = res.data;
    detailEl.textContent = `정책 ${d.policy_version} · 모델 ${d.model_mode}` +
      (d.model_ready === false ? " (준비 안 됨)" : "");
  } else {
    statusEl.dataset.state = "error";
    statusEl.textContent = res?.error === "http_503" ? "준비 안 됨" : "연결 안 됨";
    detailEl.textContent = "검사할 수 없으면 전송을 보류합니다. 설정에서 서버 주소를 확인하세요.";
  }
});

chrome.storage.local.get({ stats: {} }).then(({ stats }) => {
  document.getElementById("stats").textContent =
    `이 브라우저에서 막은 전송·첨부 ${stats.blocked || 0}회 · 안전하게 다듬은 횟수 ${stats.sanitized || 0}회 · 그래도 전송 ${stats.forced || 0}회`;
});
