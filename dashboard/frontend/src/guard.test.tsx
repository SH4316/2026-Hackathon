import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "./api";
import App from "./App";
import { GuardSettings } from "./GuardSettings";
import {
  codePoints,
  guardRequest,
  validateRule,
  type GuardRule,
  type GuardRuleset,
  type GuardRuntime,
} from "./guard";

const rule: GuardRule = {
  id: "project_code",
  label: "프로젝트 코드",
  token: "PROJECT",
  category: "custom",
  severity: "high",
  action: "mask",
  enabled: true,
  kind: "regex",
  pattern: "비공개",
  keywords: [],
  case_sensitive: false,
  reason: "내부 코드",
  distribute: true,
};
let runtime: GuardRuntime;
let rules: GuardRuleset;
let calls: {
  path: string;
  method: string;
  body: any;
  headers: Record<string, string>;
}[];
let conflict = false;
let disconnected = false;
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
function mount(tab = "status") {
  return render(
    <MemoryRouter initialEntries={[`/settings/guard?tab=${tab}`]}>
      <GuardSettings />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  conflict = false;
  disconnected = false;
  calls = [];
  runtime = {
    model_mode: "optional",
    model_status: "endpoint_unset",
    model_endpoint_set: false,
    model_ready: false,
    modules: { custom_rules: true, context_model: true },
    policy_version: "policy-demo",
    ruleset_version: 7,
    org: { managed: true, version_id: "v1", revision: 2 },
  };
  rules = {
    version: 7,
    modules: { custom_rules: true, context_model: true },
    custom_rules: [{ ...rule }],
    context_detectors: [
      {
        id: "private_plan",
        label: "내부 계획",
        category: "custom",
        token: "PLAN",
        severity: "high",
        action: "warn",
        enabled: true,
        criteria: "공개되지 않은 사업 계획",
        examples: ["내부 계획입니다"],
        counter_examples: ["공개된 자료입니다"],
      },
    ],
    prompt_template: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = String(url).replace("/api/v1/guard/", "");
      const method = options.method ?? "GET";
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({
        path,
        method,
        body,
        headers: options.headers as Record<string, string>,
      });
      if (disconnected)
        return json(
          {
            code: "GUARD_UNAVAILABLE",
            message: "검사 서버에 연결할 수 없습니다.",
          },
          503,
        );
      if (conflict && method === "PUT") return json({ detail: "stale" }, 412);
      if (method === "GET") {
        if (path === "runtime") return json(runtime);
        if (path === "ruleset") return json(rules, 200, { ETag: '"7"' });
        if (path === "org/settings")
          return json({
            report_text: "full",
            tag_action: "mask",
            jev_enabled: true,
            tag_map: {},
            policy_state_map: { allow: null, warn: null, block: null },
            source_id: "prompt-guard",
          });
        if (path === "clients")
          return json({
            clients: [
              {
                client_id: "client_demo",
                label: "데모 사용자",
                person_id: "person_demo",
                client_type: "browser_extension",
                device_name: "테스트 브라우저",
                last_seen_at: null,
                revoked_at: null,
              },
            ],
          });
        if (path === "prompt")
          return json({
            default_template: "기본 {detectors}",
            rendered_system_prompt: "저장된 판단 프롬프트",
          });
      }
      if (path === "runtime" && method === "PUT") {
        runtime = { ...runtime, ...body };
        return json(runtime);
      }
      if (path === "enrollments")
        return json(
          { code: "DEMO-1234", expires_at: "2026-10-31T01:00:00Z" },
          201,
        );
      if (path.startsWith("clients/"))
        return method === "DELETE"
          ? new Response(null, { status: 204 })
          : json({ label: body.label });
      if (path === "org/settings") return json(body);
      if (path.endsWith("/test"))
        return json({ matches: [{ start: 0, end: 3 }] });
      if (path === "prompt")
        rules = { ...rules, prompt_template: body.template };
      if (path === "modules") rules = { ...rules, modules: body };
      if (path.startsWith("custom-rules/"))
        rules = { ...rules, custom_rules: method === "DELETE" ? [] : [body] };
      if (path.startsWith("context-detectors/"))
        rules = {
          ...rules,
          context_detectors: method === "DELETE" ? [] : [body],
        };
      rules = { ...rules, version: rules.version + 1 };
      return json(rules, 200, { ETag: `"${rules.version}"` });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mutations = (path: string) =>
  calls.filter((call) => call.path === path && call.method !== "GET");

describe("guard administration", () => {
  it("shows model warning and saves model mode and module switches with revision headers", async () => {
    mount();
    await screen.findByText(
      /모델 엔드포인트가 설정되지 않아 Jev 기능이 비활성화되었습니다/,
    );
    expect(screen.getByText("policy-demo")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "모델 모드" }), {
      target: { value: "disabled" },
    });
    fireEvent.click(screen.getByRole("button", { name: "모델 모드 저장" }));
    await screen.findByText("설정을 저장했습니다.");
    expect(mutations("runtime")[0].body).toEqual({ model_mode: "disabled" });
    await waitFor(() =>
      expect(
        screen
          .getByRole("switch", { name: "사용자 규칙 모듈" })
          .matches(":disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("switch", { name: "사용자 규칙 모듈" }));
    fireEvent.click(screen.getByRole("button", { name: "모듈 저장" }));
    await waitFor(() =>
      expect(mutations("modules")[0].body).toEqual({
        custom_rules: false,
        context_model: true,
      }),
    );
    expect(mutations("modules")[0].headers["If-Match"]).toBe('"7"');
  });
  it("edits, tests and deletes a regex while preserving distribute=false and latest ETag", async () => {
    mount("rules");
    fireEvent.change(await screen.findByRole("textbox", { name: /^정규식/ }), {
      target: { value: "내부.{1,20}" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "클라이언트에 배포 (distribute)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await screen.findByText("설정을 저장했습니다.");
    expect(mutations("custom-rules/project_code")[0].body).toMatchObject({
      pattern: "내부.{1,20}",
      distribute: false,
      keywords: [],
    });
    fireEvent.change(screen.getByRole("textbox", { name: "시험 텍스트" }), {
      target: { value: "내부 코드" },
    });
    fireEvent.click(screen.getByRole("button", { name: "규칙 시험" }));
    await screen.findByText("시험 결과");
    expect(mutations("custom-rules/test")[0].body.rule.distribute).toBe(false);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "규칙 삭제" }));
    await waitFor(() =>
      expect(mutations("custom-rules/project_code")[1].method).toBe("DELETE"),
    );
    expect(mutations("custom-rules/project_code")[1].headers["If-Match"]).toBe(
      '"8"',
    );
  });
  it("adds a keyword rule", async () => {
    mount("rules");
    fireEvent.click(await screen.findByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByRole("textbox", { name: "이름" }), {
      target: { value: "기밀 키워드" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^ID/ }), {
      target: { value: "secret_word" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^키워드/ }), {
      target: { value: "비공개\n기밀" },
    });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() =>
      expect(mutations("custom-rules/secret_word")[0].body).toMatchObject({
        kind: "keywords",
        keywords: ["비공개", "기밀"],
        pattern: null,
      }),
    );
  });
  it("accepts 4,000 code points and prevents a 4,001-character regex", async () => {
    mount("rules");
    const input = await screen.findByRole("textbox", { name: /^정규식/ });
    fireEvent.change(input, { target: { value: "😀".repeat(4000) } });
    expect(
      screen.getByRole("button", { name: "규칙 저장" }).matches(":disabled"),
    ).toBe(false);
    fireEvent.change(input, { target: { value: "a".repeat(4001) } });
    expect(
      screen.getByRole("button", { name: "규칙 저장" }).matches(":disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "규칙 시험" }).matches(":disabled"),
    ).toBe(true);
  });
  it("retains drafts on conflicts and resets them on explicit refresh", async () => {
    conflict = true;
    mount("rules");
    fireEvent.change(await screen.findByRole("textbox", { name: "이름" }), {
      target: { value: "미저장 규칙" },
    });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await screen.findByText(/다른 변경이 먼저 저장되었습니다/);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "이름" }).value,
    ).toBe("미저장 규칙");
    fireEvent.click(screen.getByRole("button", { name: /새로고침/ }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>("textbox", { name: "이름" }).value,
      ).toBe("프로젝트 코드"),
    );
  });
  it("edits and tests Jev criteria and saves a separate prompt template", async () => {
    mount("jev");
    fireEvent.change(
      await screen.findByRole("textbox", { name: /^Jev 판단 기준/ }),
      { target: { value: "신규 제품 개발에 관한 내부 계획" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    await screen.findByText("설정을 저장했습니다.");
    expect(mutations("context-detectors/private_plan")[0].body.criteria).toBe(
      "신규 제품 개발에 관한 내부 계획",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Jev 시험 텍스트" }), {
      target: { value: "내부 계획 예시" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Jev 시험" }));
    await screen.findByText("시험 결과");
    expect(
      mutations("context-detectors/test")[0].body.detectors[0].criteria,
    ).toBe("신규 제품 개발에 관한 내부 계획");
    fireEvent.change(
      screen.getByRole("textbox", { name: /^프롬프트 템플릿/ }),
      { target: { value: "검사할 기준: {detectors}" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "템플릿 저장" }));
    await waitFor(() =>
      expect(mutations("prompt")[0].body).toEqual({
        template: "검사할 기준: {detectors}",
      }),
    );
    expect(mutations("prompt")[0].headers["If-Match"]).toBe('"8"');
  });
  it("persists all organization fields and rejects malformed mappings", async () => {
    mount("org");
    const mapping = await screen.findByRole("textbox", {
      name: /^정책 상태 매핑/,
    });
    fireEvent.change(mapping, {
      target: { value: '{"allow":null,"warn":"review","block":"blocked"}' },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "조직 Jev 판단 사용 (jev_enabled)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "조직 설정 저장" }));
    await screen.findByText("설정을 저장했습니다.");
    expect(mutations("org/settings")[0].body).toEqual({
      report_text: "full",
      tag_action: "mask",
      jev_enabled: false,
      source_id: "prompt-guard",
      tag_map: {},
      policy_state_map: { allow: null, warn: "review", block: "blocked" },
    });
    fireEvent.change(mapping, { target: { value: "[]" } });
    fireEvent.click(screen.getByRole("button", { name: "조직 설정 저장" }));
    await screen.findByText(/매핑에는 유효한 ID/);
    expect(mutations("org/settings")).toHaveLength(1);
  });
  it("issues a person-bound code and supports client rename and revoke", async () => {
    vi.spyOn(api, "people").mockResolvedValue({
      items: [
        {
          id: "person_demo",
          name: "데모 사람",
          eventCount: 0,
          findingCount: 0,
          lastEventAt: null,
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
    mount("clients");
    fireEvent.change(
      await screen.findByRole("combobox", { name: "등록할 사람" }),
      { target: { value: "person_demo" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "등록 코드 발급" }));
    await screen.findByText("DEMO-1234");
    expect(mutations("enrollments")[0].body).toEqual({
      person_id: "person_demo",
      label: "데모 사람",
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "데모 사용자 연결 이름" }),
      { target: { value: "변경한 이름" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    await screen.findByText("연결 이름을 변경했습니다.");
    expect(mutations("clients/client_demo")[0].body).toEqual({
      label: "변경한 이름",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "연결 해지" }));
    await screen.findByText("연결을 해지했습니다.");
    expect(mutations("clients/client_demo")[1].method).toBe("DELETE");
  });
  it("shows retryable 503 guidance without management forms", async () => {
    disconnected = true;
    mount();
    await screen.findByText("검사 서버에 연결할 수 없습니다.");
    expect(screen.queryByRole("button", { name: "모델 모드 저장" })).toBeNull();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });
  it.each(["/", "/settings/jev", "/settings/guard"])(
    "shows endpoint warning at %s and the SPA navigation",
    async (route) => {
      vi.spyOn(api, "versions").mockResolvedValue([]);
      vi.spyOn(api, "metrics").mockResolvedValue({ versionId: null } as any);
      render(
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>,
      );
      await screen.findByText(
        /모델 엔드포인트가 설정되지 않아 Jev 기능이 비활성화되었습니다/,
      );
      expect(
        screen
          .getAllByRole("link", { name: "검사 서버 관리" })
          .every((link) => link.getAttribute("href") === "/settings/guard"),
      ).toBe(true);
    },
  );
  it("uses code-point limits and sends If-Match without management keys", async () => {
    expect(codePoints("A😀나")).toBe(3);
    expect(validateRule({ ...rule, pattern: "x".repeat(4000) })).toBeNull();
    expect(validateRule({ ...rule, pattern: "x".repeat(4001) })).toContain(
      "4,000",
    );
    const response = await guardRequest("custom-rules/project_code", {
      method: "PUT",
      body: rule,
      etag: '"7"',
    });
    expect(response.etag).toBe('"8"');
    expect(
      mutations("custom-rules/project_code")[0].headers,
    ).not.toHaveProperty("X-Admin-Key");
  });
  it("supports keyboard tab navigation", async () => {
    mount();
    await screen.findByRole("button", { name: "모델 모드 저장" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "상태" }), {
      key: "ArrowRight",
    });
    expect(
      screen
        .getByRole("tab", { name: "사용자 규칙" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "사용자 규칙" }),
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "사용자 규칙" }), {
      key: "Home",
    });
    expect(
      screen.getByRole("tab", { name: "상태" }).getAttribute("aria-selected"),
    ).toBe("true");
  });
  it("maps network failure and non-object errors to Korean guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(guardRequest("runtime")).rejects.toMatchObject({
      status: 503,
      code: "GUARD_UNAVAILABLE",
      message: expect.stringContaining("검사 서버에 연결할 수 없습니다"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("null", { status: 503 })),
    );
    await expect(guardRequest("runtime")).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("검사 서버에 연결할 수 없습니다"),
    });
  });
});
