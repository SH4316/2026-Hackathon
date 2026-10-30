/** Person detail starts at its first event page and keeps the current event filters. */
export function personDetailHref(
  id: string,
  search: string | URLSearchParams = "",
): string {
  const params = new URLSearchParams(search);
  for (const key of ["page", "personQuery", "personId"]) params.delete(key);
  const query = params.toString();
  return `/people/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
}

export function normalizeServiceFilter(
  value: string | null | undefined,
): string | undefined {
  const service = value?.trim().toLowerCase();
  if (!service) return undefined;
  if (!/^[a-z0-9_-]{1,64}$/.test(service)) {
    throw new Error("서비스는 영문, 숫자, 하이픈, 밑줄로 1~64자여야 합니다.");
  }
  return service;
}
