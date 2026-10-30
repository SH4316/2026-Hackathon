import test from "node:test";
import assert from "node:assert/strict";
import { runInspection } from "../src/inspection.js";
import { createGuard } from "../vendor/prompt-guard-rules/src/index.js";

const guard = createGuard();
const request = { request_id: "test", input_version: 4, text: "내일 날씨 알려 줘", context: {} };
const base = guard.inspectRequest(request);
const prediction = (decision = "allow") => ({ ok: true, data: { decision, tier: decision === "allow" ? "none" : "tier1" } });
const run = (overrides = {}) => runInspection({ kind: "inspect", request,
  settings: { serverEnabled: true, localAiEnabled: true },
  server: async () => ({ ok: true, data: base }), ai: async () => prediction(), guard, ...overrides });

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
