import assert from "node:assert/strict";
import { test } from "node:test";

import { Policy, createGuard, defaultPolicy, ipAddress, ipNetwork } from "../src/index.js";
import { codePointIndex, pyInt } from "../src/pyre.js";
import { customDetector } from "../src/custom.js";

const today = () => "2026-11-01";
const guard = createGuard({ today });

test("request shape echoes ids like the server", () => {
  const r = createGuard({ today }).inspectRequest({
    request_id: "r1", input_version: 7, text: "a@b.io",
    context: { client_type: "browser_extension", destination: { provider: "openai", channel: "consumer" } },
  });
  assert.equal(r.request_id, "r1");
  assert.equal(r.input_version, 7);
  assert.equal(r.decision, "block");
});

test("offsets: code point and UTF-16 both returned", () => {
  const [f] = guard.inspect("😀😀 a@b.io").findings;
  assert.deepEqual(f.span, { start: 3, end: 9, start_utf16: 5, end_utf16: 11 });
  assert.equal(codePointIndex("😀x", 2), 1);
});

test("Python \\b semantics: Korean letters are word characters", () => {
  assert.deepEqual(guard.inspect("CVE-2024-3094취약점").findings, []);
  assert.equal(guard.inspect("CVE-2024-3094 취약점").findings[0].type, "cve");
});

test("Unicode digits are parsed like Python int()", () => {
  assert.equal(pyInt("１２"), 12);
  assert.equal(pyInt("١٢"), 12); // 아랍-인도 숫자
  assert.ok(Number.isNaN(pyInt("1a")));
});

test("ipaddress port follows Python rules", () => {
  assert.equal(ipAddress("010.1.1.1"), null); // 앞자리 0 금지
  assert.equal(ipAddress("12:30:45"), null);
  assert.equal(ipAddress("192.0.0.9").isPrivate, false); // 예외 목록
  assert.equal(ipAddress("::ffff:a00:1").isPrivate, true);
  assert.equal(ipAddress("::1").isLoopback, true);
  assert.equal(ipNetwork("10.0.0.0/33"), null);
  assert.equal(ipNetwork("10.1.2.3/8").isPrivate, true); // strict=False
});

test("destination tiers are informational", () => {
  const p = new Policy(defaultPolicy);
  for (const tier of Object.values(p.tiers)) {
    for (const [name, tp] of Object.entries(p.types)) {
      assert.equal(p.actionFor(name), tp.action, `${tier.name}/${name}`);
    }
  }
});

test("destination cannot change findings, decisions, or sanitization", () => {
  for (const text of ["평범한 문장", "CVE-2024-12345", "서버 10.1.2.3", "kim@example.com"]) {
    for (const method of ["inspect", "sanitize"]) {
      const baseline = guard[method](text);
      for (const [provider, channel] of [["openai", "consumer"], ["openai", "api"], ["deepseek", "api"]]) {
        const r = guard[method](text, { destination: { provider, channel } });
        for (const key of ["status", "decision", "signal", "findings", "remaining_findings", "sanitized_text"]) {
          assert.deepEqual(r[key], baseline[key]);
        }
      }
    }
  }
});

test("custom regex accepts 4000 code points, rejects longer and nested quantifiers", () => {
  const rule = (pattern) => ({ id: "long_rule", kind: "regex", label: "긴 패턴", token: "LONG", pattern });
  for (const pattern of ["x".repeat(301), "x".repeat(4000), "😀".repeat(4000)]) {
    const detector = customDetector([rule(pattern)]);
    assert.deepEqual(detector.skipped, []);
    assert.equal(detector.detect(pattern).length, 1);
  }
  for (const pattern of ["x".repeat(4001), "(a+)+$", "(x{1,}){2,}"]) {
    const detector = customDetector([rule(pattern)]);
    assert.equal(detector.skipped.length, 1);
    assert.deepEqual(detector.detect("x"), []);
  }
});

test("stale destination evidence falls back to the default tier", () => {
  const bundle = structuredClone(defaultPolicy);
  bundle.destinations.org_contracts = [{ provider: "openai", channel: "api" }];
  const fresh = createGuard({ policy: bundle, today: () => "2026-11-01" });
  const stale = createGuard({ policy: bundle, today: () => "2027-06-01" });
  assert.equal(fresh.inspect("x", { destination: { provider: "openai", channel: "api" } }).destination.tier, "standard");
  const r = stale.inspect("x", { destination: { provider: "openai", channel: "api" } });
  assert.equal(r.destination.tier, "elevated");
  assert.deepEqual(r.notices, ["destination_policy_stale"]);
});

test("model_required policy is never complete without a model", () => {
  const bundle = { ...structuredClone(defaultPolicy), model_required: true };
  const r = createGuard({ policy: bundle, today }).inspect("평범한 문장");
  assert.equal(r.status, "incomplete");
  assert.equal(r.signal, "gray");
  assert.notEqual(r.decision, "allow");
});

test("sanitize never returns a restoration mapping", () => {
  const s = guard.sanitize("kim@example.com");
  assert.equal(s.sanitized_text, "[EMAIL_1]");
  assert.ok(!JSON.stringify(s).includes("kim@example.com"));
});

test("fetchRuleBundle uses ETag and returns not_modified on 304", async () => {
  const { fetchRuleBundle } = await import("../src/index.js");
  const calls = [];
  const fake = async (url, { headers }) => {
    calls.push(headers);
    if (headers["If-None-Match"] === '"rs-3-p"') return { status: 304, ok: false, headers: new Map() };
    return { status: 200, ok: true, headers: new Map([["ETag", '"rs-3-p"']]), json: async () => ({ ruleset_version: 3 }) };
  };
  const first = await fetchRuleBundle("http://x/", { apiKey: "k", fetchImpl: fake });
  assert.equal(first.status, "updated");
  assert.equal(first.bundle.ruleset_version, 3);
  const second = await fetchRuleBundle("http://x", { apiKey: "k", etag: first.etag, fetchImpl: fake });
  assert.equal(second.status, "not_modified");
  assert.equal(calls[1]["X-API-Key"], "k");
});

test("custom rule cannot redefine a built-in type", () => {
  assert.throws(() => createGuard({ ruleset: {
    ruleset_version: 1, modules: { custom_rules: true }, context_detectors: [],
    custom_rules: [{ id: "email", kind: "keywords", keywords: ["x"], label: "x", token: "X" }],
  } }));
});
