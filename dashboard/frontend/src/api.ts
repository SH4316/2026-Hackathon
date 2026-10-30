import type {
  ApiErrorResponse,
  ConfigVersion,
  CreateVersionInput,
  Filters,
  Metrics,
  Page,
  Person,
  SavedSearch,
  SaveSearchInput,
  SaveTagDetailsInput,
  SaveVersionInput,
  SecurityEvent,
  VersionSummary,
} from "./types";

const BASE_URL = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, response: ApiErrorResponse) {
    super(response.message);
    this.name = "ApiError";
    this.status = status;
    this.code = response.code;
    this.fieldErrors = response.fieldErrors;
  }
}

/** URLSearchParams preserves literal prompt searches, including SQL wildcard characters. */
export function buildQuery(
  filters: Filters = {},
  extra: Record<string, string | number | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (
      value !== undefined &&
      value !== null &&
      (key === "q" ? String(value) !== "" : String(value).trim() !== "")
    ) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });
  if (!response.ok) {
    let body: Partial<ApiErrorResponse> = {};
    try {
      const parsed: unknown = await response.json();
      if (parsed !== null && typeof parsed === "object")
        body = parsed as Partial<ApiErrorResponse>;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A local proxy or unavailable server may return a non-JSON error.
    }
    throw new ApiError(response.status, {
      code: typeof body.code === "string" ? body.code : "REQUEST_FAILED",
      message:
        typeof body.message === "string"
          ? body.message
          : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      fieldErrors: body.fieldErrors,
    });
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(response.status, {
      code: "INVALID_RESPONSE",
      message: "서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
}

function json(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function resourceId(id: string | number): string {
  return encodeURIComponent(String(id));
}

export const api = {
  versions(signal?: AbortSignal): Promise<VersionSummary[]> {
    return request("/config-versions", { signal });
  },
  version(id: string, signal?: AbortSignal): Promise<ConfigVersion> {
    return request(`/config-versions/${resourceId(id)}`, { signal });
  },
  createVersion(input: CreateVersionInput): Promise<ConfigVersion> {
    return request("/config-versions", json("POST", input));
  },
  saveVersion(id: string, input: SaveVersionInput): Promise<ConfigVersion> {
    return request(`/config-versions/${resourceId(id)}`, json("PUT", input));
  },
  saveTagDetails(
    versionId: string,
    tagId: string,
    input: SaveTagDetailsInput,
  ): Promise<ConfigVersion> {
    return request(
      `/config-versions/${resourceId(versionId)}/tags/${resourceId(tagId)}`,
      json("PUT", input),
    );
  },
  publishVersion(id: string, revision: number): Promise<ConfigVersion> {
    return request(
      `/config-versions/${resourceId(id)}/publish`,
      json("POST", { revision }),
    );
  },
  activateVersion(id: string): Promise<ConfigVersion> {
    return request(`/config-versions/${resourceId(id)}/activate`, {
      method: "POST",
    });
  },
  deleteVersion(id: string): Promise<void> {
    return request(`/config-versions/${resourceId(id)}`, { method: "DELETE" });
  },
  classifierConfig(signal?: AbortSignal): Promise<ConfigVersion> {
    return request("/classifier-config", { signal });
  },
  people(
    filters: Filters = {},
    q = "",
    page = 0,
    signal?: AbortSignal,
  ): Promise<Page<Person>> {
    return request(
      `/people${buildQuery(filters, { personQuery: q, page, size: 20 })}`,
      { signal },
    );
  },
  person(
    id: string,
    filters: Filters = {},
    signal?: AbortSignal,
  ): Promise<Person> {
    return request(`/people/${resourceId(id)}${buildQuery(filters)}`, {
      signal,
    });
  },
  events(
    filters: Filters = {},
    page = 0,
    signal?: AbortSignal,
  ): Promise<Page<SecurityEvent>> {
    return request(`/events${buildQuery(filters, { page, size: 20 })}`, {
      signal,
    });
  },
  event(id: number | string, signal?: AbortSignal): Promise<SecurityEvent> {
    return request(`/events/${resourceId(id)}`, { signal });
  },
  metrics(filters: Filters = {}, signal?: AbortSignal): Promise<Metrics> {
    return request(`/metrics${buildQuery(filters)}`, { signal });
  },
  createPerson(person: { id: string; name: string }): Promise<Person> {
    return request("/people", json("POST", person));
  },
  savedSearches(signal?: AbortSignal): Promise<SavedSearch[]> {
    return request("/saved-searches", { signal });
  },
  savedSearch(id: string, signal?: AbortSignal): Promise<SavedSearch> {
    return request(`/saved-searches/${resourceId(id)}`, { signal });
  },
  saveSearch(input: SaveSearchInput): Promise<SavedSearch> {
    return request("/saved-searches", json("POST", input));
  },
  deleteSavedSearch(id: string): Promise<void> {
    return request(`/saved-searches/${resourceId(id)}`, { method: "DELETE" });
  },
  snapshotEvents(
    id: string,
    page = 0,
    signal?: AbortSignal,
  ): Promise<Page<SecurityEvent>> {
    return request(
      `/saved-searches/${resourceId(id)}/events${buildQuery({}, { page, size: 20 })}`,
      {
        signal,
      },
    );
  },
  snapshotMetrics(id: string, signal?: AbortSignal): Promise<Metrics> {
    return request(`/saved-searches/${resourceId(id)}/metrics`, { signal });
  },
};
