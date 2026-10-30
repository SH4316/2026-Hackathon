// 서버가 배포하는 규칙 묶음(/v1/rules/bundle) 받기.
// 대시보드에서 규칙을 바꾸면 버전(ETag)이 바뀐다. 주기적으로 호출해 바뀐 경우에만 새 guard 를 만든다.
//
//   let state = { etag: null, guard: createGuard() };
//   const r = await fetchRuleBundle("https://guard.example.internal", { apiKey, etag: state.etag });
//   if (r.status === "updated") state = { etag: r.etag, guard: createGuard({ ruleset: r.bundle }) };

/**
 * @returns {Promise<{status: "updated", bundle: object, etag: string|null} | {status: "not_modified", etag: string}>}
 * 네트워크·인증 오류는 예외로 던진다. 호출 측은 이전 묶음을 계속 쓰되, 최종 판정은 서버 검사를 따른다.
 */
export async function fetchRuleBundle(serverUrl, { apiKey, etag, fetchImpl = globalThis.fetch, signal } = {}) {
  const headers = {};
  if (apiKey) headers["X-API-Key"] = apiKey;
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetchImpl(serverUrl.replace(/\/+$/, "") + "/v1/rules/bundle", { headers, signal });
  if (res.status === 304) return { status: "not_modified", etag };
  if (!res.ok) throw new Error(`rule bundle request failed: HTTP ${res.status}`);
  return { status: "updated", bundle: await res.json(), etag: res.headers.get("ETag") };
}
