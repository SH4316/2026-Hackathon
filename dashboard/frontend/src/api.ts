import type { ApiErrorResponse, Filters, Metrics, Page, Person, SecurityEvent } from './types';

const BASE_URL = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, response: ApiErrorResponse) {
    super(response.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = response.code;
    this.fieldErrors = response.fieldErrors;
  }
}

/** URLSearchParams keeps literal searches and additional service slugs intact. */
export function buildQuery(filters: Filters = {}, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  if (!response.ok) {
    let body: Partial<ApiErrorResponse> = {};
    try {
      const parsed: unknown = await response.json();
      if (parsed !== null && typeof parsed === 'object') body = parsed as Partial<ApiErrorResponse>;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A local proxy or unavailable server may return a non-JSON error.
    }
    throw new ApiError(response.status, {
      code: typeof body.code === 'string' ? body.code : 'REQUEST_FAILED',
      message: typeof body.message === 'string' ? body.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      fieldErrors: body.fieldErrors,
    });
  }
  try {
    return await response.json() as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(response.status, {
      code: 'INVALID_RESPONSE',
      message: '서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}

export const api = {
  people(filters: Filters = {}, q = '', page = 0, signal?: AbortSignal): Promise<Page<Person>> {
    return request(`/people${buildQuery(filters, { q, page, size: 20 })}`, { signal });
  },
  person(id: string, filters: Filters = {}, signal?: AbortSignal): Promise<Person> {
    return request(`/people/${encodeURIComponent(id)}${buildQuery(filters)}`, { signal });
  },
  events(filters: Filters = {}, page = 0, signal?: AbortSignal): Promise<Page<SecurityEvent>> {
    return request(`/events${buildQuery(filters, { page, size: 20 })}`, { signal });
  },
  event(id: number | string, signal?: AbortSignal): Promise<SecurityEvent> {
    return request(`/events/${encodeURIComponent(String(id))}`, { signal });
  },
  metrics(filters: Filters = {}, signal?: AbortSignal): Promise<Metrics> {
    return request(`/metrics${buildQuery(filters)}`, { signal });
  },
  createPerson(person: { id: string; name: string }): Promise<Person> {
    return request('/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(person),
    });
  },
};
