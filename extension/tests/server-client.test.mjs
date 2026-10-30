import test from "node:test";
import assert from "node:assert/strict";
import { checkServer, requestServer } from "../src/server-client.js";

const settings = { serverEnabled: true, serverUrl: "https://fixture.invalid/", apiKey: "synthetic-key", timeoutMs: 15_000 };
const json = data => new Response(JSON.stringify(data));
const pendingFetch = () => {
  let signal, finish;
  return {
    fetchImpl: (_url, options) => {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        finish = resolve;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    signal: () => signal,
    finish: data => finish(json(data)),
  };
};

for (const kind of ["inspect", "sanitize"]) {
  test(`${kind} waits beyond 15s and keeps the worker active only until the response completes`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const fetch = pendingFetch();
    let pulses = 0;
    const result = requestServer("POST", `/v1/${kind}`, { text: "합성 문장" }, settings,
      { fetchImpl: fetch.fetchImpl, keepAlive: async () => { pulses++; } });
    t.mock.timers.tick(40_000);
    await Promise.resolve();
    assert.equal(fetch.signal().aborted, false);
    assert.equal(pulses, 2);
    fetch.finish({ status: "complete", input_version: 4 });
    assert.deepEqual(await result, { ok: true, data: { status: "complete", input_version: 4 } });
    t.mock.timers.tick(300_000);
    await Promise.resolve();
    assert.equal(fetch.signal().aborted, false, "finished requests leave no abort timer");
    assert.equal(pulses, 2, "finished requests leave no keepalive timer");
  });
}

test("inspection timeout remains bounded and stops keeping the worker active", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const fetch = pendingFetch();
  let pulses = 0;
  const result = requestServer("POST", "/v1/inspect", {}, settings,
    { fetchImpl: fetch.fetchImpl, keepAlive: async () => { pulses++; } });
  t.mock.timers.tick(270_000);
  assert.deepEqual(await result, { ok: false, error: "timeout" });
  const stopped = pulses;
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(pulses, stopped);
});

test("ordinary requests keep the 15s timeout and inspection supports a separate override", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  for (const [method, path, configured, timeout] of [
    ["GET", "/readyz", settings, 15_000],
    ["POST", "/v1/auth/enroll", settings, 15_000],
    ["POST", "/v1/inspect", { ...settings, inspectionTimeoutMs: 5000 }, 5000],
  ]) {
    const fetch = pendingFetch();
    const result = requestServer(method, path, undefined, configured, { fetchImpl: fetch.fetchImpl });
    t.mock.timers.tick(timeout - 1);
    assert.equal(fetch.signal().aborted, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await result, { ok: false, error: "timeout" });
  }
});

test("request preserves the URL, credentials and inspection payload", async () => {
  const body = { input_version: 8, text: "합성 문장", context: { stage: "submit" } };
  const result = await requestServer("POST", "/v1/inspect", body, settings, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://fixture.invalid/v1/inspect");
      assert.equal(options.headers["X-API-Key"], "synthetic-key");
      assert.deepEqual(JSON.parse(options.body), body);
      return json({ status: "complete", input_version: 8 });
    },
  });
  assert.equal(result.data.input_version, 8);
});

test("HTTP failures, invalid JSON, network failures and body timeouts remain failures", async t => {
  for (const status of [401, 422, 500, 503]) {
    const result = await requestServer("POST", "/v1/inspect", {}, settings,
      { fetchImpl: async () => new Response("{}", { status }) });
    assert.deepEqual(result, { ok: false, error: `http_${status}` });
  }
  assert.deepEqual(await requestServer("POST", "/v1/inspect", {}, settings,
    { fetchImpl: async () => new Response("invalid") }), { ok: false, error: "invalid_inspection" });
  assert.deepEqual(await requestServer("POST", "/v1/inspect", {}, settings,
    { fetchImpl: async () => { throw new TypeError("synthetic network failure"); } }), { ok: false, error: "network" });
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const result = requestServer("POST", "/v1/inspect", {}, { ...settings, inspectionTimeoutMs: 1000 }, {
    fetchImpl: async (_url, { signal }) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }) }),
  });
  await Promise.resolve();
  t.mock.timers.tick(1000);
  assert.deepEqual(await result, { ok: false, error: "timeout" });
});

test("connection check rejects missing or invalid credentials even when readiness is public", async () => {
  const paths = [];
  assert.deepEqual(await checkServer(settings, async (_method, path) => {
    paths.push(path);
    return { ok: false, error: "http_401" };
  }), { ok: false, error: "http_401" });
  assert.deepEqual(paths, ["/v1/rules/bundle"]);
});

test("connection check distinguishes missing organization rules, model failure and success", async () => {
  for (const [managed, orgRules, modelReady, error] of [
    [true, null, true, "org_config_unavailable"],
    [true, {}, false, "http_503"],
    [true, {}, true, null],
    [false, null, true, null],
  ]) {
    const paths = [];
    const ready = modelReady ? { ok: true, data: { policy_version: "fixture", org: { managed } } }
      : { ok: false, error: "http_503" };
    const result = await checkServer(settings, async (_method, path, _body, configured) => {
      paths.push(path);
      assert.equal(configured, settings);
      return path.endsWith("bundle") ? { ok: true, data: { custom_rules: [], org_rules: orgRules } } : ready;
    });
    assert.deepEqual(result, error ? { ok: false, error } : ready);
    assert.deepEqual(paths, ["/v1/rules/bundle", "/readyz"]);
  }
  assert.deepEqual(await checkServer({ serverEnabled: false }, () => assert.fail("server disabled")),
    { ok: false, error: "server_disabled" });
});
