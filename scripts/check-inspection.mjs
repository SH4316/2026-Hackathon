#!/usr/bin/env node
// Live API smoke test with fixed synthetic inputs. No enrollment or configuration changes.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { checkServer, requestServer } from "../extension/src/server-client.js";

const { values } = parseArgs({ options: {
  server: { type: "string", default: "http://127.0.0.1:8000" },
  output: { type: "string" },
} });
const target = new URL(values.server);
assert.ok(["http:", "https:"].includes(target.protocol), "server must use HTTP or HTTPS");
assert.ok(!target.username && !target.password && !target.search && !target.hash,
  "put credentials in PG_API_KEY, never in the server URL");
const apiKey = process.env.PG_API_KEY || process.env.PG_API_KEYS?.split(",").map(key => key.trim()).find(Boolean);
const settings = { serverUrl: target.href.replace(/\/+$/, ""), apiKey, serverEnabled: true };
const report = { server: settings.serverUrl, started_at: new Date().toISOString(),
  credential_configured: !!apiKey, results: [] };
const clean = "오늘 회의 안건을 세 문장으로 정리해 주세요.";
const sensitive = "합성 테스트 데이터: 이메일 qa.user@example.com, AWS 공식 예시 키 AKIAIOSFODNN7EXAMPLE";
let version = 0;

function request(text, stage = "draft") {
  return { request_id: crypto.randomUUID(), input_version: ++version, text,
    context: { client_type: "browser_extension", stage,
      destination: { provider: "openai", channel: "consumer" },
      ...(stage === "submit" ? { send_action: "normal" } : {}) } };
}

function summary(response) {
  const data = response.data;
  return { ok: response.ok, ...(response.error ? { error: response.error } : {}),
    ...(data ? { status: data.status, decision: data.decision, signal: data.signal,
      notices: data.notices, report_status: data.report_status,
      findings: (data.findings || data.remaining_findings || []).map(({ type, action, detector }) => ({ type, action, detector })),
      detector_versions: data.detector_versions,
      changes: data.changes?.map(({ type, count }) => ({ type, count })) } : {}) };
}

async function run(name, work) {
  const started = performance.now(), result = { name, passed: false };
  console.log(`RUN ${name}`);
  try {
    await work(result);
    result.passed = true;
  } catch (error) {
    // Assertion messages are fixed strings; network errors are reduced to codes by requestServer.
    result.error = error.code || error.name;
    if (error instanceof assert.AssertionError) result.check = error.message.split("\n")[0];
  }
  result.elapsed_s = Math.round((performance.now() - started) / 10) / 100;
  report.results.push(result);
  console.log(`${result.passed ? "PASS" : "FAIL"} ${name} (${result.elapsed_s}s) ${JSON.stringify(result.response || {})}`
    + (result.check ? ` ${result.check}` : ""));
}

function complete(response, body) {
  assert.equal(response.ok, true, "request must succeed");
  assert.equal(response.data.request_id, body.request_id, "response must match the request ID");
  assert.equal(response.data.input_version, body.input_version, "response must match the input version");
  assert.equal(response.data.status, "complete", "all required inspection steps must complete");
}

await run("server_health", async result => {
  const response = await requestServer("GET", "/healthz", undefined, settings);
  result.response = { ok: response.ok, error: response.error, status: response.data?.status };
  assert.equal(response.ok, true, "health request must succeed");
  assert.equal(response.data?.status, "ok", "server must be alive");
});

await run("invalid_key_rejected", async result => {
  const response = await requestServer("POST", "/v1/inspect", request(clean),
    { ...settings, apiKey: `invalid-smoke-${crypto.randomUUID()}` });
  result.response = summary(response);
  assert.equal(response.error, "http_401", "invalid API key must be rejected with HTTP 401");
});

await run("authenticated_rules_and_model", async result => {
  assert.ok(apiKey, "PG_API_KEY or PG_API_KEYS must be configured for the target server");
  const response = await checkServer(settings);
  result.response = { ok: response.ok, error: response.error, model_mode: response.data?.model_mode,
    model_status: response.data?.model_status, model_ready: response.data?.model_ready,
    org_managed: response.data?.org?.managed, dashboard_error: response.data?.org?.dashboard_error };
  assert.equal(response.ok, true, "credentials, organization rules and model readiness must pass");
});

if (report.results.at(-1).passed) {
  for (const stage of ["draft", "submit"]) {
    await run(`clean_${stage}_allowed`, async result => {
      const body = request(clean, stage);
      const response = await requestServer("POST", "/v1/inspect", body, settings);
      result.response = summary(response);
      complete(response, body);
      assert.equal(response.data.decision, "allow", "clean sample must be allowed");
      assert.equal(response.data.signal, "green", "clean sample must have a green signal");
      if (stage === "submit") assert.ok(["recorded", "skipped"].includes(response.data.report_status),
        "submission reporting must complete or be explicitly skipped");
    });
  }

  await run("sensitive_submit_blocked", async result => {
    const body = request(sensitive, "submit");
    const response = await requestServer("POST", "/v1/inspect", body, settings);
    result.response = summary(response);
    complete(response, body);
    assert.equal(response.data.decision, "block", "sensitive sample must be blocked");
    assert.equal(response.data.signal, "red", "sensitive sample must have a red signal");
    const types = new Set(response.data.findings.map(finding => finding.type));
    for (const type of ["email", "aws_access_key_id"]) assert.ok(types.has(type), `${type} must be detected`);
  });

  await run("sensitive_sanitized_and_rechecked", async result => {
    const body = request(sensitive);
    const response = await requestServer("POST", "/v1/sanitize", body, settings);
    result.response = summary(response);
    complete(response, body);
    assert.equal(response.data.decision, "allow", "sanitized sample must pass its second inspection");
    assert.equal(response.data.signal, "green", "sanitized sample must have a green signal");
    const text = response.data.sanitized_text;
    assert.equal(typeof text, "string", "sanitized text must be returned");
    for (const raw of ["qa.user@example.com", "AKIAIOSFODNN7EXAMPLE"]) {
      assert.equal(text.includes(raw), false, "synthetic sensitive values must be removed");
    }
    for (const token of ["[EMAIL_1]", "[AWS_KEY_1]"]) assert.ok(text.includes(token), "expected replacement token must be present");
  });
}

report.finished_at = new Date().toISOString();
report.passed = report.results.length === 7 && report.results.every(result => result.passed);
if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(`${report.passed ? "PASS" : "FAIL"} ${report.results.filter(result => result.passed).length}/${report.results.length} live checks`);
process.exitCode = report.passed ? 0 : 1;
