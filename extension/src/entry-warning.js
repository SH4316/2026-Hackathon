// 접속과 선택 모델 변경마다 안내한다. 기존 전송·첨부 확인이 끝난 뒤에 표시한다.
(() => {
  const PG = globalThis.PG;
  let enabled = false, ready = false, retry = null, destinations = null;
  let managed = false, userEnabled = true, lastKey = null, generation = 0;
  function check(update = false) {
    clearTimeout(retry);
    if (!ready) return;
    if (!enabled) {
      if (PG.ui.entryPolicyKey()) PG.ui.closeModal();
      return;
    }
    const snapshot = PG.siteContext.current() || PG.siteContext.read();
    const policy = PG.entryPolicy.evaluate(snapshot, destinations);
    if (!policy) return;
    if (policy.key === lastKey) {
      if (update && PG.ui.entryPolicyKey() === policy.key) PG.ui.showEntryPolicy(policy);
      return;
    }
    // 닫힌 뒤 현재 모델을 다시 읽는다. 기존 확인창이나 승인에는 손대지 않는다.
    if (PG.ui.isOpen()) { retry = setTimeout(check, 200); return; }
    lastKey = policy.key;
    PG.ui.showEntryPolicy(policy);
  }
  async function loadPolicy() {
    const stamp = ++generation;
    const request = chrome.runtime.sendMessage({ type: "rules:bundle" }).catch(() => null);
    const vendor = await import(chrome.runtime.getURL("vendor/prompt-guard-rules/data/policy.js")).catch(() => null);
    // 서버가 응답하지 않아도 접속 안내를 먼저 표시한다.
    const response = await Promise.race([request, new Promise(resolve => setTimeout(() => resolve(null), 300))]);
    if (stamp !== generation) return;
    destinations = response?.data?.destinations || vendor?.default?.destinations || null;
    ready = true;
    check(true);
    if (!response?.data?.destinations) void request.then(result => {
      if (stamp !== generation || !result?.data?.destinations) return;
      destinations = result.data.destinations;
      check(true);
    });
  }

  chrome.runtime.sendMessage({ type: "settings" }).then(response => {
    if (!response?.ok) return;
    managed = !!(response.data?.orgManaged || response.data?.linkedClient?.managed);
    userEnabled = response.data?.enabled !== false;
    enabled = userEnabled || managed;
    void loadPolicy();
  }).catch(() => {});
  chrome.storage.onChanged.addListener(changes => {
    if (changes.enabled) userEnabled = changes.enabled.newValue !== false;
    if (changes.linkedClient) managed = !!changes.linkedClient.newValue?.managed;
    enabled = userEnabled || managed;
    if (["ruleBundle", "serverEnabled", "serverUrl", "apiKey", "linkedClient"].some(key => changes[key])) void loadPolicy();
    check();
  });
  PG.siteContext.subscribe(() => queueMicrotask(() => check(true)));
  addEventListener("pagehide", () => clearTimeout(retry));
})();
