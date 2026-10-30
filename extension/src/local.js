// 브라우저 안의 규칙 엔진(@prompt-guard/rules). 입력하는 즉시 위험을 알려 주는 용도다.
// 서버와 같은 규칙·정책이지만 보안 경계가 아니다. 전송 허용 여부는 서비스 워커가 조합한 '검사 완료 + 통과'만 근거로 한다.
// 번들러가 없어 vendor/ 에 복사해 둔 파일을 동적 import 한다(npm run vendor).
// 설정 화면의 개인 정규식 규칙(src/personal.js)도 함께 넣고, 규칙이 바뀌면 엔진을 다시 만든다.
var PG = (globalThis.PG = globalThis.PG || {});

PG.local = null;
(async () => {
  try {
    const personal = await import(chrome.runtime.getURL("src/personal.js"));
    const build = (rules) => {
      for (const r of rules) PG.TYPE_LABELS[r.id] = `${r.label}(개인 규칙)`;
      PG.local = personal.localGuard(rules);
      PG.hooks?.localReady?.();
    };
    const { [personal.STORAGE_KEY]: rules = [] } = await chrome.storage.local.get(personal.STORAGE_KEY);
    build(rules);
    chrome.storage.onChanged.addListener((changes) => {
      if (changes[personal.STORAGE_KEY]) build(changes[personal.STORAGE_KEY].newValue || []);
    });
  } catch {
    PG.local = null; // 로드에 실패해도 서버 검사는 그대로 동작한다
  }
})();
