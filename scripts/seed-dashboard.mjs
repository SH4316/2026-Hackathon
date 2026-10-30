// Register the extension's shipped finding types through the dashboard's public API.
import policy from "../extension/vendor/prompt-guard-rules/data/policy.js";
import "../extension/src/labels.js";

export const DEFAULT_VERSION_NAME = "확장프로그램 기본 필터";
export const DEV_VERSION_NAME = "개발용 확장 필터 · Jev";
export const JEV_FILTERS = [
  {
    id: "api_key",
    name: "API 키",
    prompt: "입력에 실제 API 인증 키, 비밀 토큰 또는 서비스 접근 자격증명이 포함되어 있는지 판단하세요. "
      + "제공사별 키 형식뿐 아니라 문맥상 인증에 사용하는 비밀값도 포함합니다. "
      + "공개 API 주소, API 이름, 일반적인 개발 설명, 값이 없는 설정 키, 이미 마스킹된 자리표시자는 제외합니다.",
  },
  {
    id: "person_name",
    name: "사람 이름",
    prompt: "입력에 개인을 지칭하는 사람의 실명이나 성명이 포함되어 있는지 판단하세요. "
      + "한국어와 외국어 이름, 문맥상 특정 사람을 식별하는 성명을 포함합니다. "
      + "회사·서비스·제품·프로젝트 이름과 일반 명사, 익명화된 이름, 이름을 묻는 일반적인 설명은 제외합니다.",
  },
];

const colors = {
  personal_id: "#D27669", personal: "#D27669", financial: "#BD9854",
  credential: "#C17079", infrastructure: "#6684F1", security: "#9C87B9",
  confidential: "#6C8BB4", sensitive_personal: "#B7789F", third_party: "#57A7A0",
};

export function buildDefaultTags({ includeJev = false } = {}) {
  const builtin = Object.entries(policy.types).map(([id, spec]) => ({ id, ...spec, source: "builtin" }));
  const custom = (policy.ruleset.custom_rules || []).map(rule => ({ ...rule, source: "custom" }));
  const context = (policy.ruleset.context_detectors || []).map(rule => ({ ...rule, source: "context" }));
  const entries = [...builtin, ...custom, ...context];
  if (includeJev) entries.push(...JEV_FILTERS.map(filter => ({
    ...filter, category: filter.id === "api_key" ? "credential" : "personal", action: "mask", source: "jev",
  })));
  return entries.map((entry, order) => ({
    id: entry.id,
    name: entry.label || globalThis.PG.TYPE_LABELS[entry.id] || entry.name || entry.id,
    description: entry.prompt || `확장프로그램 기본 필터 · ${globalThis.PG.ACTION_LABELS[entry.action] || entry.action}`,
    examples: (entry.keywords || []).slice(0, 20),
    guidance: entry.source === "jev"
      ? "Jev가 입력 전체를 분류합니다. 탐지 시 입력 전체가 정제 대상이 될 수 있습니다."
      : entry.source === "builtin"
        ? "기본 내장 필터의 탐지 결과를 집계합니다. 내장 필터의 기준과 조치는 서버 정책에서 관리합니다."
        : `검사 서버 관리의 ${entry.source === "custom" ? "사용자 규칙" : "서버 Jev"}에서 탐지 기준을 편집합니다.`,
    jevThreshold: entry.source === "jev" ? 0.5 : null,
    pythonRegex: "",
    color: colors[entry.category] || "#6684F1",
    parentId: null,
    order,
    enabled: entry.enabled !== false,
  }));
}

export async function initializeDashboard({ baseUrl, includeJev = false, fetchImpl = fetch }) {
  const name = includeJev ? DEV_VERSION_NAME : DEFAULT_VERSION_NAME;
  const api = baseUrl.replace(/\/$/, "") + "/api/v1";
  async function request(method, path, body) {
    const response = await fetchImpl(api + path, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }

  const versions = await request("GET", "/config-versions");
  const existing = versions.find(version => version.name === name);
  let version = existing
    ? await request("GET", `/config-versions/${encodeURIComponent(existing.id)}`)
    : await request("POST", "/config-versions", { name });
  const path = `/config-versions/${encodeURIComponent(version.id)}`;

  // A failed first run can leave a draft. Append missing defaults while retaining edits.
  // Published versions belong to the user and are never updated on later starts.
  if (version.status === "DRAFT") {
    const ids = new Set(version.tags.map(tag => tag.id));
    const missing = buildDefaultTags({ includeJev }).filter(tag => !ids.has(tag.id));
    if (missing.length) {
      version = await request("PUT", path, {
        revision: version.revision,
        name: version.name,
        tags: [...version.tags, ...missing],
        policyStates: version.policyStates,
      });
    }
    if (includeJev) {
      for (const filter of JEV_FILTERS) {
        if (version.jevPrompts.some(prompt => prompt.name === filter.name)) continue;
        version = await request("POST", path + "/jev-prompts", {
          revision: version.revision,
          name: filter.name,
          prompt: filter.prompt,
          outputs: [{ tagId: filter.id, threshold: version.tags.find(tag => tag.id === filter.id).jevThreshold }],
          enabled: true,
        });
      }
    }
    version = await request("POST", path + "/publish", { revision: version.revision });
  }

  // Re-read the pointer after initialization, preserving any existing active version.
  const current = await request("GET", "/config-versions");
  if (!current.some(item => item.isActive)) version = await request("POST", path + "/activate");
  return version;
}

if (import.meta.main) {
  try {
    const mode = process.env.SEED_JEV_FILTERS || "false";
    if (!["true", "false"].includes(mode)) throw new Error("SEED_JEV_FILTERS must be true or false");
    const version = await initializeDashboard({
      baseUrl: process.env.DASHBOARD_URL || "http://dashboard:8080",
      includeJev: mode === "true",
    });
    console.log(`Dashboard filters ready: ${version.name} (${version.tags.length} tags)`);
  } catch (error) {
    console.error(`Dashboard filter initialization failed: ${error.message}`);
    process.exitCode = 1;
  }
}
