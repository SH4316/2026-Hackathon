import { fetchRuleBundle } from "../vendor/prompt-guard-rules/src/index.js";

export const BUNDLE_KEY = "ruleBundle";
export const BUNDLE_ALARM = "rules-bundle-refresh";

// 캐시는 설정과 자격 증명별로 분리한다. 토큰 자체는 캐시에 넣지 않는다.
export async function bundleScope(settings) {
  const data = new TextEncoder().encode(JSON.stringify([settings.serverUrl.replace(/\/+$/, ""), settings.apiKey || ""]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), b => b.toString(16).padStart(2, "0")).join("");
}

export function createBundleCache({ read, write, fetchBundle = fetchRuleBundle }) {
  let cache = null, generation = 0, pending = null;
  async function current(settings) {
    const scope = await bundleScope(settings);
    const saved = cache?.scope === scope ? cache : await read();
    if (saved?.scope !== scope) return null;
    cache = saved;
    return saved;
  }
  async function refresh(settings) {
    if (!settings.serverEnabled) return null;
    const scope = await bundleScope(settings), stamp = generation;
    if (pending?.scope === scope && pending.generation === stamp) return pending.task;
    const task = (async () => {
      const previous = await current(settings);
      const result = await fetchBundle(settings.serverUrl, { apiKey: settings.apiKey,
        etag: previous?.etag, signal: AbortSignal.timeout(settings.timeoutMs || 15000) });
      if (stamp !== generation) return null;
      if (result.status === "not_modified") { cache = previous; return previous; }
      if (!result.bundle || !Array.isArray(result.bundle.custom_rules)) throw new Error("invalid_rules_bundle");
      cache = { scope, etag: result.etag, bundle: result.bundle };
      await write(cache);
      return cache;
    })();
    pending = { scope, generation: stamp, task };
    try { return await task; } finally { if (pending?.task === task) pending = null; }
  }
  function invalidate() { generation++; cache = null; }
  return { current, refresh, invalidate };
}
