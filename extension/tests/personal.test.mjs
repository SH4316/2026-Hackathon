// 개인 정규식 규칙 단위 테스트: node --test tests/*.test.mjs  (브라우저·서버 없이 실행)
// 서버 응답은 같은 규칙·정책의 브라우저 엔진(createGuard)으로 대신한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuard } from "../vendor/prompt-guard-rules/src/index.js";
import { checkPattern, localGuard, mergeInspect, mergeSanitize, normalizeToken, validateRule } from "../src/personal.js";

await import("../src/restore.js");
const { buildTokenMap, restoreText } = globalThis.PG.restore;
const server = createGuard();
const dest = { provider: "openai", channel: "consumer" };
const EMP = { id: "my_emp", label: "사번", pattern: "(?<![A-Z0-9])EMP-\\d{6}(?!\\d)", action: "mask",
              token: "MY_EMP_ID", case_sensitive: true, enabled: true };

test("서버 사용자 규칙과 같은 정규식 제한을 적용한다", () => {
  for (const bad of ["(a+)+", "(?P<x>a)", "(?i)abc", "\\1", "a*", "x".repeat(4001)]) {
    assert.throws(() => checkPattern(bad), undefined, bad);
  }
  assert.throws(() => checkPattern("[unclosed"), /문법 오류/);
  assert.ok(checkPattern(EMP.pattern, true));
  assert.equal(validateRule(EMP), null);
  assert.match(validateRule({ ...EMP, token: "emp" }), /토큰/);
  assert.equal(normalizeToken("emp_id"), "MY_EMP_ID");
  assert.equal(normalizeToken("MY_EMP_ID"), "MY_EMP_ID");
});

test("\\d 는 Python 처럼 Unicode 숫자도 잡는다", () => {
  assert.ok(checkPattern("과제-\\d{4}").exec("과제-１２３４"));
});

test("서버 판정에 개인 규칙을 더해 강화한다", () => {
  const text = "사번 EMP-123456 으로 조회해 줘";
  const res = server.inspect(text, { destination: dest });
  assert.equal(res.decision, "allow");
  const merged = mergeInspect(res, text, [EMP], dest);
  assert.equal(merged.decision, "block");
  assert.equal(merged.signal, "red");
  const [f] = merged.findings;
  assert.equal(f.rule_id, "personal:my_emp");
  assert.equal(text.slice(f.span.start_utf16, f.span.end_utf16), "EMP-123456");
});

test("꺼진 규칙·잘못된 규칙은 쓰지 않고, 서버 결과를 약하게 만들지 않는다", () => {
  const text = "키 AKIAIOSFODNN7EXAMPLE, EMP-123456";
  const res = server.inspect(text, { destination: dest });
  const off = mergeInspect(res, text, [{ ...EMP, enabled: false }, { ...EMP, id: "my_bad", pattern: "(a+)+" }], dest);
  assert.deepEqual(off, res);
  const warnOnly = mergeInspect(res, text, [{ ...EMP, action: "warn" }], dest);
  assert.equal(warnOnly.decision, "block"); // 서버의 block 은 그대로
});

test("정제: 서버 정제문의 개인 규칙 구간을 치환하고 복원 매핑도 맞는다", () => {
  const text = "kim@example.com 담당 EMP-123456, 다시 EMP-123456 와 EMP-000001";
  const ins = mergeInspect(server.inspect(text, { destination: dest }), text, [EMP], dest);
  const san = mergeSanitize(server.sanitize(text, { destination: dest }), [EMP], dest);
  assert.equal(san.sanitized_text, "[EMAIL_1] 담당 [MY_EMP_ID_1], 다시 [MY_EMP_ID_1] 와 [MY_EMP_ID_2]");
  assert.equal(san.decision, "allow");
  assert.deepEqual(san.changes.find((c) => c.type === "my_emp"), { type: "my_emp", token: "[MY_EMP_ID_1]", count: 2 });
  const m = buildTokenMap(text, ins.findings, san.sanitized_text);
  assert.equal(m.verified, true);
  assert.equal(restoreText(san.sanitized_text, m.entries), text);
});

test("정제: block 규칙은 치환하지 않고 남은 항목으로 돌려준다", () => {
  const text = "a@b.io 그리고 EMP-123456";
  const san = mergeSanitize(server.sanitize(text, { destination: dest }), [{ ...EMP, action: "block" }], dest);
  assert.equal(san.decision, "block");
  const [f] = san.remaining_findings;
  assert.equal(san.sanitized_text.slice(f.span.start_utf16, f.span.end_utf16), "EMP-123456");
});

test("브라우저 엔진에도 개인 규칙이 들어간다", () => {
  const r = localGuard([EMP]).inspect("EMP-123456", { destination: dest });
  assert.deepEqual(r.findings.map((f) => f.type), ["my_emp"]);
});


test("개인 패턴 길이 4000자는 허용하고 4001자는 거부한다", () => {
  assert.ok(checkPattern("x".repeat(4000)));
  assert.throws(() => checkPattern("x".repeat(4001)), /4000/);
});

test("서버 custom_rules와 조직 정규식을 즉시 검사에 쓰며 Python 전용 문법은 기록하고 건너뛴다", () => {
  const bundle = { ruleset_version: 42, modules: { custom_rules: true }, context_detectors: [],
    custom_rules: [{ id: "distributed", label: "서버 배포", kind: "keywords", keywords: ["배포비밀"], action: "block", token: "DIST" }],
    org_rules: { tag_action: "mask", regex: [
      { tag_id: "org1", type: "org1", name: "조직 사번", token: "ORG1", pattern: "ORG-\\d{4}" },
      { tag_id: "org2", type: "org2", name: "Python 규칙", token: "ORG2", pattern: "(?P<python>secret)" },
    ] } };
  const guard = localGuard([], bundle);
  assert.equal(guard.inspect("배포비밀").decision, "block");
  assert.equal(guard.inspect("ORG-１２３４").findings[0].type, "org1");
  assert.equal(guard.skippedRules[0].id, "org2");
});
