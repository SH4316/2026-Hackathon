// 진입 정책 + 화면에서 확인된 학습 ON 안내. 서버·AI 다운로드와 독립적으로 동작한다.
(() => {
  const PG = globalThis.PG;
  let enabled = false, ready = false, retry = null;
  const shown = new Set(), accounts = new Map();
  const observed = field => field?.status === "observed" ? field.value : null;
  function check() {
    clearTimeout(retry);
    if (!ready) return;
    const snapshot = PG.siteContext.current() || PG.siteContext.read();
    const trainingKey = `training-enabled:${snapshot.provider}`;
    // 불명확해졌다는 이유로 다시 경고하지 않는다. 실제 OFF/임시 대화 ON을 관측하면 재무장한다.
    if (observed(snapshot.training) === false || observed(snapshot.temporary) === true) shown.delete(trainingKey);
    const account = observed(snapshot.account);
    if (account !== null) {
      if (accounts.has(snapshot.provider) && accounts.get(snapshot.provider) !== account) shown.delete(trainingKey);
      accounts.set(snapshot.provider, account);
    }
    const policy = enabled ? PG.entryPolicy.evaluate(snapshot) : null;
    const active = PG.ui.entryPolicyKey();
    if (active && active !== policy?.key) PG.ui.closeModal();
    if (!policy || shown.has(policy.key)) return;
    // 이미 열린 전송/파일 확인창을 덮어쓰지 않는다.
    if (PG.ui.isOpen()) { retry = setTimeout(check, 500); return; }
    shown.add(policy.key);
    PG.ui.showEntryPolicy(policy);
  }
  chrome.runtime.sendMessage({ type: "settings" }).then(response => {
    if (!response?.ok) return;
    ready = true;
    enabled = response.data?.enabled !== false;
    check();
  }).catch(() => {});
  chrome.storage.onChanged.addListener(changes => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      check();
    }
  });
  PG.siteContext.subscribe(() => {
    // 다른 구독자의 기존 승인 취소가 끝난 뒤 진입 안내를 평가한다.
    queueMicrotask(check);
  });
  addEventListener("pagehide", () => clearTimeout(retry));
})();
