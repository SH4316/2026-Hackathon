// 토큰 복원 단위 테스트: node --test tests/*.test.mjs  (브라우저·서버 없이 실행)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuard } from "../vendor/prompt-guard-rules/src/index.js";

await import("../src/restore.js");
const { buildTokenMap, restoreText } = globalThis.PG.restore;
const guard = createGuard();
const dest = { provider: "openai", channel: "consumer" };

test("서버와 같은 번호를 매기고 같은 값은 같은 토큰을 쓴다", () => {
  const text = "a@x.com 와 b@y.com 그리고 a@x.com";
  const ins = guard.inspect(text, { destination: dest });
  const san = guard.sanitize(text, { destination: dest });
  const m = buildTokenMap(text, ins.findings, san.sanitized_text);
  assert.equal(san.sanitized_text, "[EMAIL_1] 와 [EMAIL_2] 그리고 [EMAIL_1]");
  assert.equal(m.verified, true);
  assert.deepEqual(m.entries, { "[EMAIL_1]": "a@x.com", "[EMAIL_2]": "b@y.com" });
  assert.equal(restoreText(san.sanitized_text, m.entries), text);
});

test("이모지(UTF-16 2칸) 뒤의 위치도 맞는다", () => {
  const text = "😀 문의 kim@example.com 카드 4111 1111 1111 1111";
  const ins = guard.inspect(text, { destination: dest });
  const san = guard.sanitize(text, { destination: dest });
  const m = buildTokenMap(text, ins.findings, san.sanitized_text);
  assert.equal(m.verified, true);
  assert.equal(restoreText(san.sanitized_text, m.entries), text);
});

test("서버 정제문과 다르면 검증 실패로 표시한다", () => {
  const text = "a@x.com";
  const ins = guard.inspect(text, { destination: dest });
  assert.equal(buildTokenMap(text, ins.findings, "[EMAIL_9]").verified, false);
});

test("치환하지 않는 항목은 매핑에서 제외한다", () => {
  const text = "문의는 평범한 문장입니다.";
  const ins = guard.inspect(text, { destination: dest });
  assert.deepEqual(buildTokenMap(text, ins.findings, text), { entries: {}, verified: true });
});

test("매핑에 없는 토큰·Object 프로토타입 이름은 그대로 둔다", () => {
  assert.equal(restoreText("[EMAIL_1] [EMAIL_3]", { "[EMAIL_1]": "a@x.com" }), "a@x.com [EMAIL_3]");
  assert.equal(restoreText("[CONSTRUCTOR_1]", {}), "[CONSTRUCTOR_1]");
});
