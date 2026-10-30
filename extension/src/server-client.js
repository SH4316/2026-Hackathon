export const REQUEST_TIMEOUT_MS = 15_000;
// Compose allows 120s per model call; inspection can run both context and org Jev checks.
// Leave room for those checks and reporting within a service worker message's 5-minute limit.
export const INSPECTION_TIMEOUT_MS = 270_000;

export async function requestServer(method, path, body, settings, {
  fetchImpl = globalThis.fetch, keepAlive,
} = {}) {
  const inspection = method === "POST" && ["/v1/inspect", "/v1/sanitize"].includes(path);
  const timeoutMs = inspection ? settings.inspectionTimeoutMs || INSPECTION_TIMEOUT_MS
    : settings.timeoutMs || REQUEST_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // A slow CPU inference must not lose its response when Chrome idles the worker.
  // Only keep it alive while this bounded request is in flight, including body parsing.
  const pulse = keepAlive && timeoutMs > 30_000
    ? setInterval(() => { Promise.resolve().then(keepAlive).catch(() => {}); }, 20_000) : null;
  try {
    const headers = { "Content-Type": "application/json" };
    if (settings.apiKey) headers["X-API-Key"] = settings.apiKey;
    const res = await fetchImpl(settings.serverUrl.replace(/\/+$/, "") + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    try { return { ok: true, data: res.status === 204 ? null : await res.json() }; }
    catch { return { ok: false, error: ctrl.signal.aborted ? "timeout" : "invalid_inspection" }; }
  } catch (err) {
    return { ok: false, error: ctrl.signal.aborted || err.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
    if (pulse !== null) clearInterval(pulse);
  }
}

export async function checkServer(settings, request = requestServer) {
  if (!settings.serverEnabled) return { ok: false, error: "server_disabled" };
  // /readyz is public. Check the same credentials used for inspection before reporting a connection.
  const rules = await request("GET", "/v1/rules/bundle", undefined, settings);
  if (!rules.ok) return rules;
  if (!Array.isArray(rules.data?.custom_rules)) return { ok: false, error: "invalid_inspection" };
  const ready = await request("GET", "/readyz", undefined, settings);
  if (ready.ok && ready.data?.org?.managed && !rules.data.org_rules) {
    return { ok: false, error: "org_config_unavailable" };
  }
  return ready;
}
