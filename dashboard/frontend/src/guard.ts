import { ApiError } from "./api";

export type ModelMode = "disabled" | "optional" | "required";
export interface GuardRuntime {
  model_mode: ModelMode;
  model_status: "active" | "disabled" | "endpoint_unset" | "unavailable";
  model_endpoint_set: boolean;
  model_ready: boolean;
  modules: GuardModules;
  policy_version: string;
  ruleset_version: number;
  org: {
    managed?: boolean;
    dashboard_error?: string | null;
    version_id?: string | null;
    revision?: number | null;
  };
}
export interface GuardModules {
  custom_rules: boolean;
  context_model: boolean;
}
export interface GuardOrgStatus {
  managed: boolean;
  version_id?: string | null;
  revision?: number | null;
  skipped_regex?: Record<string, string>;
}
export interface GuardType {
  id: string;
  label: string;
  category: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  action: "allow" | "warn" | "mask" | "block";
  token: string;
  enabled: boolean;
}
export interface GuardRule extends GuardType {
  kind: "keywords" | "regex";
  keywords: string[];
  pattern: string | null;
  case_sensitive: boolean;
  reason: string;
  distribute: boolean;
}
export interface GuardJudgment extends GuardType {
  criteria: string;
  examples: string[];
  counter_examples: string[];
}
export interface GuardRuleset {
  version: number;
  modules: GuardModules;
  custom_rules: GuardRule[];
  context_detectors: GuardJudgment[];
  prompt_template: string | null;
}
export interface GuardOrg {
  report_text: "full" | "masked" | "off";
  tag_action: GuardType["action"];
  jev_enabled: boolean;
  tag_map: Record<string, string>;
  policy_state_map: Record<"allow" | "warn" | "block", string | null>;
  source_id: string;
}
export interface GuardClient {
  client_id: string;
  label: string;
  person_id: string | null;
  client_type: string;
  device_name: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}
export interface Enrollment {
  code: string;
  expires_at: string;
}
export interface GuardResponse<T> {
  data: T;
  etag: string | null;
}

export async function guardRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    etag?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<GuardResponse<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/guard/${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.etag ? { "If-Match": options.etag } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(503, {
      code: "GUARD_UNAVAILABLE",
      message:
        "검사 서버에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
    });
  }
  if (!response.ok) {
    const parsed = await response.json().catch(() => null);
    const body = parsed && typeof parsed === "object" ? parsed : {};
    const message =
      response.status === 412
        ? "다른 변경이 먼저 저장되었습니다. 입력을 보관하고 있습니다. 새로고침으로 최신 설정을 확인한 뒤 다시 저장해 주세요."
        : response.status === 503
          ? typeof body.message === "string"
            ? body.message
            : typeof body.detail === "string"
              ? body.detail
              : "검사 서버에 연결할 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요."
          : typeof body.message === "string"
            ? body.message
            : typeof body.detail === "string"
              ? body.detail
              : "입력값과 서버 상태를 확인한 뒤 다시 시도해 주세요.";
    throw new ApiError(response.status, {
      code: body.code ?? "GUARD_REQUEST_FAILED",
      message,
    });
  }
  return {
    data:
      response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T),
    etag: response.headers.get("ETag"),
  };
}
export const guardApi = {
  runtime: (signal?: AbortSignal) =>
    guardRequest<GuardRuntime>("runtime", { signal }),
  ruleset: (signal?: AbortSignal) =>
    guardRequest<GuardRuleset>("ruleset", { signal }),
  org: (signal?: AbortSignal) =>
    guardRequest<GuardOrg>("org/settings", { signal }),
  orgStatus: (signal?: AbortSignal) =>
    guardRequest<GuardOrgStatus>("org/status", { signal }),
  clients: (signal?: AbortSignal) =>
    guardRequest<{ clients: GuardClient[] }>("clients", { signal }),
};
export const codePoints = (text: string) => Array.from(text).length;
export function validateRule(rule: GuardRule): string | null {
  if (rule.kind === "regex" && codePoints(rule.pattern ?? "") > 4000)
    return "정규식은 최대 4,000자입니다.";
  return null;
}
