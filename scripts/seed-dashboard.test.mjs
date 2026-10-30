import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import policy from "../extension/vendor/prompt-guard-rules/data/policy.js";
import { createGuard } from "../extension/vendor/prompt-guard-rules/src/index.js";
import {
  buildDefaultTags,
  DEFAULT_VERSION_NAME,
  DEV_VERSION_NAME,
  initializeDashboard,
  JEV_FILTERS,
} from "./seed-dashboard.mjs";

function version(overrides = {}) {
  return {
    id: "v_existing",
    name: "사용자 설정",
    status: "PUBLISHED",
    revision: 1,
    isActive: false,
    tags: [],
    policyStates: [],
    jevPrompts: [],
    ...overrides,
  };
}

// Exercise HTTP/JSON and revision handling against the dashboard's REST contract.
async function dashboard(t, { versions = [], failures = [] } = {}) {
  const state = { versions: structuredClone(versions), requests: [], errors: [] };
  const faults = [...failures];
  let sequence = 0;
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const path = new URL(request.url, "http://localhost").pathname;
    const call = { method: request.method, path, body };
    state.requests.push(call);
    const reply = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    const fault = faults.findIndex((entry) => entry.method === call.method && path.endsWith(entry.suffix));
    if (fault >= 0) {
      const [{ status }] = faults.splice(fault, 1);
      reply(status, { code: "INJECTED_FAILURE" });
      return;
    }
    try {
      if (path === "/api/v1/config-versions") {
        if (request.method === "GET") {
          reply(200, state.versions.map(({ tags, policyStates, jevPrompts, ...summary }) => summary));
          return;
        }
        assert.equal(request.method, "POST");
        assert.equal(typeof body.name, "string");
        assert.deepEqual(Object.keys(body).filter((key) => !["name", "baseVersionId"].includes(key)), []);
        const created = version({ id: `v_seed_${++sequence}`, name: body.name, status: "DRAFT", revision: 0 });
        state.versions.push(created);
        reply(201, created);
        return;
      }
      const match = path.match(/^\/api\/v1\/config-versions\/([^/]+)(?:\/(publish|activate|jev-prompts))?$/);
      assert.ok(match, `Unexpected endpoint: ${request.method} ${path}`);
      const current = state.versions.find((entry) => entry.id === match[1]);
      assert.ok(current, `Unknown version: ${match[1]}`);
      const operation = match[2];
      if (!operation && request.method === "GET") {
        reply(200, current);
        return;
      }
      if (operation === "activate") {
        assert.equal(request.method, "POST");
        assert.equal(current.status, "PUBLISHED");
        state.versions.forEach((entry) => { entry.isActive = entry.id === current.id; });
        reply(200, current);
        return;
      }
      assert.equal(body.revision, current.revision, "Mutation must use the latest revision");
      if (!operation) {
        assert.equal(request.method, "PUT");
        assert.equal(current.status, "DRAFT");
        assert.deepEqual(Object.keys(body).sort(), ["name", "policyStates", "revision", "tags"]);
        assert.ok(Array.isArray(body.tags));
        assert.ok(Array.isArray(body.policyStates));
        assert.equal(new Set(body.tags.map((tag) => tag.id)).size, body.tags.length);
        for (const tag of body.tags) {
          assert.match(tag.id, /^[A-Za-z0-9_-]{1,80}$/);
          assert.ok(tag.name.length > 0 && tag.name.length <= 80);
          assert.match(tag.color, /^#[0-9A-Fa-f]{6}$/);
          assert.equal(typeof tag.enabled, "boolean");
        }
        current.name = body.name;
        current.tags = structuredClone(body.tags);
        current.policyStates = structuredClone(body.policyStates);
      } else if (operation === "jev-prompts") {
        assert.equal(request.method, "POST");
        assert.deepEqual(Object.keys(body).sort(), ["enabled", "name", "outputs", "prompt", "revision"]);
        assert.equal(typeof body.enabled, "boolean");
        assert.equal(typeof body.prompt, "string");
        assert.ok(body.prompt.trim());
        const ids = new Set(current.tags.map((tag) => tag.id));
        for (const output of body.outputs) {
          assert.deepEqual(Object.keys(output).sort(), ["tagId", "threshold"]);
          assert.ok(ids.has(output.tagId), "Jev outputs must reference an existing tag");
          assert.ok(output.threshold >= 0 && output.threshold <= 1);
          current.tags.find((tag) => tag.id === output.tagId).jevThreshold = output.threshold;
        }
        current.jevPrompts.push({
          id: `j_seed_${++sequence}`,
          name: body.name,
          prompt: body.prompt,
          tagIds: body.outputs.map((output) => output.tagId),
          enabled: body.enabled,
        });
      } else {
        assert.equal(operation, "publish");
        assert.equal(request.method, "POST");
        assert.equal(current.status, "DRAFT");
        assert.deepEqual(Object.keys(body), ["revision"]);
        current.status = "PUBLISHED";
      }
      current.revision += 1;
      reply(200, current);
    } catch (error) {
      state.errors.push(error);
      reply(500, { code: "TEST_CONTRACT_FAILURE" });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(state.errors, [], "Seeder violated the dashboard API contract");
  });
  return { state, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("default tags cover every extension bundle type without duplicate execution rules", () => {
  const expected = new Set([
    ...Object.keys(policy.types),
    ...policy.ruleset.custom_rules.map((rule) => rule.id),
    ...policy.ruleset.context_detectors.map((rule) => rule.id),
  ]);
  const tags = buildDefaultTags();
  assert.deepEqual(new Set(tags.map((tag) => tag.id)), expected);
  assert.equal(tags.length, expected.size);
  for (const tag of tags) {
    assert.equal(tag.pythonRegex, "");
    assert.equal(tag.jevThreshold, null);
    assert.ok(Array.isArray(tag.examples));
  }
  assert.equal(tags.find((tag) => tag.id === "rrn").name, "주민등록번호");
  assert.equal(tags.find((tag) => tag.id === "email").name, "이메일 주소");
  for (const id of ["id_number", "street_address", "url_personal", "username"]) {
    assert.notEqual(tags.find((tag) => tag.id === id).name, id);
  }
  const guard = createGuard();
  for (const text of ["kim@example.com", "010-2345-6789", "AKIAIOSFODNN7EXAMPLE", "10.24.1.8", "대외비"]) {
    const findings = guard.inspect(text).findings;
    assert.ok(findings.length, `Representative extension filter did not detect ${text}`);
    findings.forEach((finding) => assert.ok(expected.has(finding.type), `Unmapped finding: ${finding.type}`));
  }
});

test("development tags add API keys and person names with usable Jev thresholds", () => {
  const original = buildDefaultTags();
  const development = buildDefaultTags({ includeJev: true });
  assert.deepEqual(JEV_FILTERS.map((filter) => filter.id).sort(), ["api_key", "person_name"]);
  assert.equal(development.length, original.length + 2);
  for (const filter of JEV_FILTERS) {
    const tag = development.find((entry) => entry.id === filter.id);
    assert.ok(tag.enabled);
    assert.equal(tag.jevThreshold, 0.5);
    assert.equal(tag.pythonRegex, "");
  }
});

test("empty dashboard receives a published, active default version", async (t) => {
  const { state, baseUrl } = await dashboard(t);
  await initializeDashboard({ baseUrl });
  assert.equal(state.versions.length, 1);
  const seeded = state.versions[0];
  assert.equal(seeded.name, DEFAULT_VERSION_NAME);
  assert.equal(seeded.status, "PUBLISHED");
  assert.equal(seeded.isActive, true);
  assert.deepEqual(seeded.tags, buildDefaultTags());
  assert.deepEqual(seeded.jevPrompts, []);
});

test("development initialization saves enabled Jev prompts and output thresholds before publishing", async (t) => {
  const { state, baseUrl } = await dashboard(t);
  await initializeDashboard({ baseUrl, includeJev: true });
  const seeded = state.versions[0];
  assert.equal(seeded.name, DEV_VERSION_NAME);
  assert.equal(seeded.status, "PUBLISHED");
  assert.equal(seeded.isActive, true);
  assert.deepEqual(seeded.tags, buildDefaultTags({ includeJev: true }));
  for (const filter of JEV_FILTERS) {
    const prompt = seeded.jevPrompts.find((entry) => entry.name === filter.name);
    assert.ok(prompt?.enabled);
    assert.equal(prompt.prompt, filter.prompt);
    assert.deepEqual(prompt.tagIds, [filter.id]);
  }
  assert.equal(seeded.jevPrompts.length, 2);
});

test("repeated initialization preserves saved tag and Jev edits without writes", async (t) => {
  const { state, baseUrl } = await dashboard(t);
  await initializeDashboard({ baseUrl, includeJev: true });
  const seeded = state.versions[0];
  Object.assign(seeded.tags[0], { name: "사용자가 바꾼 이름", enabled: false });
  Object.assign(seeded.jevPrompts[0], { name: "사용자가 바꾼 판단", prompt: "사용자 기준", enabled: false });
  const saved = structuredClone(state.versions);
  state.requests.length = 0;
  await initializeDashboard({ baseUrl, includeJev: true });
  assert.deepEqual(state.versions, saved);
  assert.ok(state.requests.every((call) => call.method === "GET"));
});

test("initialization registers defaults while preserving a different active version", async (t) => {
  const active = version({ isActive: true, tags: [{ id: "custom", name: "내 분류" }] });
  const { state, baseUrl } = await dashboard(t, { versions: [active] });
  await initializeDashboard({ baseUrl, includeJev: true });
  assert.deepEqual(state.versions[0], active);
  assert.equal(state.versions.length, 2);
  assert.equal(state.versions[1].status, "PUBLISHED");
  assert.equal(state.versions[1].isActive, false);
  assert.ok(!state.requests.some((call) => call.path.endsWith("/activate")));
});

test("interrupted empty draft is reused instead of creating another version", async (t) => {
  const draft = version({ name: DEFAULT_VERSION_NAME, status: "DRAFT", revision: 0 });
  const { state, baseUrl } = await dashboard(t, { versions: [draft] });
  await initializeDashboard({ baseUrl });
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].id, draft.id);
  assert.deepEqual(state.versions[0].tags, buildDefaultTags());
  assert.equal(state.versions[0].status, "PUBLISHED");
  assert.equal(state.versions[0].isActive, true);
});

test("resuming a partial draft appends missing tags and preserves user tags and policies", async (t) => {
  const retained = { ...buildDefaultTags()[0], name: "수정한 분류", enabled: false };
  const custom = { ...retained, id: "employee_id", name: "사번" };
  const policyStates = [{ id: "review", name: "확인 필요", description: "사용자 정책", color: "#6684F1", order: 0 }];
  const draft = version({
    name: DEV_VERSION_NAME, status: "DRAFT", tags: [retained, custom], policyStates,
  });
  const { state, baseUrl } = await dashboard(t, { versions: [draft] });
  await initializeDashboard({ baseUrl, includeJev: true });
  const seeded = state.versions[0];
  assert.deepEqual(seeded.tags.find((tag) => tag.id === retained.id), retained);
  assert.deepEqual(seeded.tags.find((tag) => tag.id === custom.id), custom);
  assert.deepEqual(seeded.policyStates, policyStates);
  assert.equal(seeded.tags.length, buildDefaultTags({ includeJev: true }).length + 1);
  assert.equal(seeded.status, "PUBLISHED");
});

test("activation rechecks the current selection after initialization", async (t) => {
  const { state, baseUrl } = await dashboard(t, { versions: [version()] });
  let lists = 0;
  const fetchImpl = async (url, options) => {
    if (options.method === "GET" && url.endsWith("/config-versions") && ++lists === 2) {
      state.versions[0].isActive = true;
    }
    return fetch(url, options);
  };
  await initializeDashboard({ baseUrl, fetchImpl });
  assert.equal(state.versions[0].isActive, true);
  assert.equal(state.versions[1].isActive, false);
  assert.ok(!state.requests.some((call) => call.path.endsWith("/activate")));
});

test("failed Jev creation stops publishing and a retry preserves completed configuration", async (t) => {
  const { state, baseUrl } = await dashboard(t, {
    failures: [{ method: "POST", suffix: "/jev-prompts", status: 503 }],
  });
  await assert.rejects(initializeDashboard({ baseUrl, includeJev: true }), /503/);
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].status, "DRAFT");
  assert.equal(state.versions[0].isActive, false);
  assert.ok(!state.requests.some((call) => /\/(publish|activate)$/.test(call.path)));
  const existing = state.versions[0].tags[0];
  existing.name = "중단 중 보존할 태그";
  state.requests.length = 0;
  await initializeDashboard({ baseUrl, includeJev: true });
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].tags[0].name, existing.name);
  assert.equal(state.versions[0].jevPrompts.length, 2);
  assert.equal(state.versions[0].status, "PUBLISHED");
  assert.ok(!state.requests.some((call) => call.method === "PUT"));
});

test("retry after publishing failure retains existing Jev edits and does not duplicate prompts", async (t) => {
  const { state, baseUrl } = await dashboard(t, {
    failures: [{ method: "POST", suffix: "/publish", status: 503 }],
  });
  await assert.rejects(initializeDashboard({ baseUrl, includeJev: true }), /503/);
  assert.equal(state.versions[0].status, "DRAFT");
  const prompt = state.versions[0].jevPrompts[0];
  prompt.prompt = "중단 중 보존할 판단 기준";
  prompt.enabled = false;
  const saved = structuredClone(state.versions[0].jevPrompts);
  state.requests.length = 0;
  await initializeDashboard({ baseUrl, includeJev: true });
  assert.deepEqual(state.versions[0].jevPrompts, saved);
  assert.ok(!state.requests.some((call) => call.path.endsWith("/jev-prompts")));
  assert.equal(state.versions[0].status, "PUBLISHED");
});

test("initial API errors fail without attempting registration or activation", async (t) => {
  const { state, baseUrl } = await dashboard(t, {
    failures: [{ method: "GET", suffix: "/config-versions", status: 401 }],
  });
  await assert.rejects(initializeDashboard({ baseUrl }), /401/);
  assert.deepEqual(state.versions, []);
  assert.equal(state.requests.length, 1);
});

test("Compose entry command exits unsuccessfully when initialization fails", async (t) => {
  const { state, baseUrl } = await dashboard(t, {
    failures: [{ method: "GET", suffix: "/config-versions", status: 503 }],
  });
  const child = spawn(process.execPath, [new URL("./seed-dashboard.mjs", import.meta.url).pathname], {
    env: { ...process.env, DASHBOARD_URL: baseUrl, SEED_JEV_FILTERS: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.match(stderr, /503/);
  assert.deepEqual(state.versions, []);
});
