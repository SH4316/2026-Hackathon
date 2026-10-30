import test from "node:test";
import assert from "node:assert/strict";
import { runInspection } from "../src/inspection.js";
import { localGuard } from "../src/personal.js";
import { createGuard } from "../vendor/prompt-guard-rules/src/index.js";

const guard = createGuard();
const request = { request_id: "test", input_version: 4, text: "내일 날씨 알려 줘", context: {} };
const base = guard.inspectRequest(request);
const prediction = (decision = "allow") => ({ ok: true, data: { decision, tier: decision === "allow" ? "none" : "tier1" } });
const run = (overrides = {}) => runInspection({ kind: "inspect", request,
  settings: { serverEnabled: true, localAiEnabled: true },
  server: async () => ({ ok: true, data: base }), ai: async () => prediction(), guard, ...overrides });

test("managed submissions hold gray on failed or missing records in every inspection mode", async () => {
  for (const localAiEnabled of [false, true]) {
    for (const send_action of ["normal", "confirmed", "forced"]) {
      for (const report_status of ["failed", undefined, null, "invalid"]) {
        const r = await run({ settings: { serverEnabled: true, localAiEnabled, orgManaged: true },
          request: { ...request, context: { stage: "submit", send_action } },
          server: async () => ({ ok: true, data: { ...base, report_status } }) });
        assert.equal(r.data.status, "incomplete");
        assert.equal(r.data.signal, "gray");
        assert.equal(r.data.decision, "warn");
        assert.ok(r.data.notices.includes("report_failed"));
      }
    }
  }
});
test("managed recorded/skipped submissions, drafts and sanitize keep their inspection result", async () => {
  for (const report_status of ["recorded", "skipped"]) {
    const r = await run({ settings: { serverEnabled: true, localAiEnabled: true, orgManaged: true },
      server: async () => ({ ok: true, data: { ...base, report_status } }) });
    assert.equal(r.data.status, "complete");
    assert.equal(r.data.decision, "allow");
  }
  const draft = await run({ settings: { serverEnabled: true, localAiEnabled: false, orgManaged: true },
    request: { ...request, context: { stage: "draft" } } });
  assert.equal(draft.data.status, "complete");
  const sanitized = await run({ kind: "sanitize", settings: { serverEnabled: true, localAiEnabled: false, orgManaged: true } });
  assert.equal(sanitized.data.status, "complete");
});
test("managed linked clients still require server records when server switch is disabled", async () => {
  const r = await run({ settings: { serverEnabled: false, localAiEnabled: true, linkedClient: { managed: true } },
    server: async () => ({ ok: true, data: { ...base, report_status: "failed", decision: "block" } }) });
  assert.equal(r.data.signal, "gray");
  assert.equal(r.data.decision, "block");
  assert.ok(r.data.notices.includes("report_failed"));
});

test("offline AI inspection never calls the server, preserves request IDs", async () => {
  const r = await run({ settings: { serverEnabled: false, localAiEnabled: true }, server: () => assert.fail("network call") });
  assert.equal(r.data.decision, "allow");
  assert.equal(r.data.input_version, 4);
  assert.equal(r.data.inspection_source, "local_ai");
});
test("server-only mode does not call the AI", async () => {
  const r = await run({ settings: { serverEnabled: true, localAiEnabled: false }, ai: () => assert.fail("AI called") });
  assert.equal(r.data, base);
});
test("AI cannot downgrade a server block or incomplete result", async () => {
  for (const status of ["complete", "incomplete", "error"]) {
    const r = await run({ server: async () => ({ ok: true, data: { ...base, decision: "block", status } }) });
    assert.equal(r.data.decision, "block");
    assert.equal(r.data.status, status);
    assert.equal(r.data.signal, status === "complete" ? "red" : "gray");
  }
});
test("AI-only PII is retained without inventing a span", async () => {
  const r = await run({ ai: async () => prediction("block") });
  assert.equal(r.data.decision, "block");
  assert.deepEqual(r.data.findings, []);
  assert.equal(r.data.ai_assessment.tier, "tier1");
});
test("network failure/timeout uses local AI; server auth/errors never fall back", async () => {
  for (const error of ["network", "timeout", "http_401", "http_503", "invalid_inspection"]) {
    const r = await run({ server: async () => ({ ok: false, error }) });
    if (["network", "timeout"].includes(error)) {
      assert.equal(r.data.status, "complete");
      assert.ok(r.data.notices.includes("server_unavailable_local_check"));
    } else assert.deepEqual(r, { ok: false, error });
  }
});
test("AI failure, malformed output or loading never allow sending", async () => {
  for (const value of [{ ok: false, error: "local_ai_not_ready" }, { ok: true, data: {} }, { ok: true, data: { decision: "invalid" } }]) {
    const r = await run({ ai: async () => value });
    assert.equal(r.data.status, "incomplete");
    assert.equal(r.data.signal, "gray");
    assert.notEqual(r.data.decision, "allow");
  }
});
test("both disabled hold sending instead of allowing silently", async () => {
  assert.deepEqual(await run({ settings: { serverEnabled: false, localAiEnabled: false } }), { ok: false, error: "no_inspector" });
});
test("local rules still block when the AI says allow", async () => {
  const r = await run({ request: { ...request, text: "AWS 키 AKIAIOSFODNN7EXAMPLE" },
    settings: { serverEnabled: false, localAiEnabled: true } });
  assert.equal(r.data.decision, "block");
  assert.ok(r.data.findings.some((f) => f.type === "aws_access_key_id"));
});
test("sanitize rechecks replaced text with AI and keeps residual risk", async () => {
  const r = await run({ kind: "sanitize", request: { ...request, text: "메일 test@example.com" },
    settings: { serverEnabled: false, localAiEnabled: true },
    ai: async (text) => { assert.ok(text.includes("[EMAIL_1]")); assert.ok(!text.includes("test@example.com")); return prediction("warn"); } });
  assert.equal(r.data.decision, "warn");
  assert.ok(r.data.sanitized_text.includes("[EMAIL_1]"));
  assert.equal(r.data.changes.length, 1);
});
test("server sanitize rechecks server output, not original text", async () => {
  const r = await run({ kind: "sanitize", server: async () => ({ ok: true, data: { ...base, sanitized_text: "[EMAIL_1]", changes: [], remaining_findings: [] } }),
    ai: async (text) => { assert.equal(text, "[EMAIL_1]"); return prediction(); } });
  assert.equal(r.data.inspection_source, "server_and_local_ai");
});

const personalRule = { id: "my_emp", label: "사번", pattern: "EMP-\\d{6}", action: "mask",
  token: "MY_EMP_ID", case_sensitive: true, enabled: true };

test("personal rules strengthen server-only, combined and offline AI inspection", async () => {
  for (const settings of [
    { serverEnabled: true, localAiEnabled: false },
    { serverEnabled: true, localAiEnabled: true },
    { serverEnabled: false, localAiEnabled: true },
  ]) {
    const r = await run({ settings, request: { ...request, text: "EMP-123456" }, personalRules: [personalRule] });
    assert.equal(r.data.decision, "block");
    assert.ok(r.data.findings.some((f) => f.rule_id === "personal:my_emp"));
  }
});

test("AI checks the final personal-rule sanitized text on both server and offline paths", async () => {
  for (const serverEnabled of [true, false]) {
    const r = await run({ kind: "sanitize", request: { ...request, text: "사번 EMP-123456" },
      settings: { serverEnabled, localAiEnabled: true }, personalRules: [personalRule],
      server: async () => ({ ok: true, data: { ...base, sanitized_text: "사번 EMP-123456", changes: [], remaining_findings: [] } }),
      ai: async (text) => {
        assert.equal(text, "사번 [MY_EMP_ID_1]");
        return prediction();
      } });
    assert.equal(r.data.sanitized_text, "사번 [MY_EMP_ID_1]");
    assert.equal(r.data.changes[0].type, "my_emp");
  }
});

test("personal rules cannot clear server errors or an AI block", async () => {
  const r = await run({ request: { ...request, text: "EMP-123456" }, personalRules: [personalRule],
    server: async () => ({ ok: true, data: { ...base, status: "incomplete" } }), ai: async () => prediction("block") });
  assert.equal(r.data.decision, "block");
  assert.equal(r.data.status, "incomplete");
  assert.equal(r.data.signal, "gray");
});
test("org-managed: server failure never falls back to the local check", async () => {
  for (const error of ["network", "timeout"]) {
    let aiDone = false;
    const r = await run({ settings: { serverEnabled: true, localAiEnabled: true, orgManaged: true },
      server: async () => ({ ok: false, error }), ai: async () => { aiDone = true; return prediction(); } });
    assert.deepEqual(r, { ok: false, error });
    assert.equal(aiDone, true); // 진행 중인 AI 작업은 정리하고 끝낸다
  }
});
test("org-managed: server (dashboard rules) and local AI are combined, stricter wins", async () => {
  const settings = { serverEnabled: true, localAiEnabled: true, orgManaged: true };
  const strictAI = await run({ settings, server: async () => ({ ok: true, data: { ...base, report_status: "recorded" } }), ai: async () => prediction("block") });
  assert.equal(strictAI.data.decision, "block");
  assert.equal(strictAI.data.inspection_source, "server_and_local_ai");
  const strictServer = await run({ settings, server: async () => ({ ok: true, data: { ...base, report_status: "recorded", decision: "warn" } }) });
  assert.equal(strictServer.data.decision, "warn");
});


test("distributed organization and custom rules survive serverless AI inspection", async () => {
  const guard = localGuard([], { ruleset_version: 2, custom_rules: [
    { id: "distributed", label: "배포 규칙", token: "DISTRIBUTED", action: "block", kind: "keywords", keywords: ["합성기밀"] },
  ], context_detectors: [], org_rules: { tag_action: "block", regex: [
    { type: "org", name: "조직 코드", token: "ORG", pattern: "ORG-\\d{4}" },
  ] } });
  for (const text of ["합성기밀", "ORG-１２３４"]) {
    const r = await run({ guard, request: { ...request, text }, settings: { serverEnabled: false, localAiEnabled: true },
      server: () => assert.fail("server must stay off") });
    assert.equal(r.data.decision, "block");
    assert.equal(r.data.inspection_source, "local_ai");
  }
});
