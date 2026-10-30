// 브라우저 안의 규칙 엔진(@prompt-guard/rules). 입력하는 즉시 위험을 알려 주는 용도다.
// 서버와 같은 규칙·정책이지만 보안 경계가 아니다. 전송 허용 여부는 계속 서버의 '검사 완료 + 통과'만 근거로 한다.
// 번들러가 없어 vendor/ 에 복사해 둔 파일을 동적 import 한다(npm run vendor).
var PG = (globalThis.PG = globalThis.PG || {});

PG.local = null;
(async () => {
  try {
    const mod = await import(chrome.runtime.getURL("vendor/prompt-guard-rules/src/index.js"));
    PG.local = mod.createGuard();
    PG.hooks?.localReady?.();
  } catch {
    PG.local = null; // 로드에 실패해도 서버 검사는 그대로 동작한다
  }
})();
