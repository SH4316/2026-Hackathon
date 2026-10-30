import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, ApiError } from "./api";
import { GuardBanner } from "./GuardBanner";
import { GuardSettings } from "./GuardSettings";
import { MetricSettings } from "./MetricSettings";
import { guardApi } from "./guard";
import { WorkspaceProvider } from "./ui";
import type { ConfigVersion } from "./types";

const configuration = (): ConfigVersion => ({
  id: "v1", name: "조직 규칙", status: "DRAFT", isActive: false, revision: 3,
  createdAt: "2026-10-30T00:00:00Z", publishedAt: null, jevPrompts: [], policyStates: [],
  tags: [
    { id: "tag_1", name: "사번", enabled: true, description: "", examples: [], guidance: "", jevThreshold: null, pythonRegex: "[", color: "#123456", parentId: null, order: 0 },
    { id: "tag_2", name: "내부 문서", enabled: true, description: "", examples: [], guidance: "", jevThreshold: null, pythonRegex: "(a+)+", color: "#123456", parentId: null, order: 1 },
  ],
});

function metrics(config = configuration()) {
  vi.spyOn(api, "versions").mockResolvedValue([config]);
  return render(<MemoryRouter initialEntries={[`/settings/metrics?versionId=${config.id}`]}>
    <WorkspaceProvider><MetricSettings /></WorkspaceProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  vi.spyOn(api, "version").mockResolvedValue(configuration());
  vi.spyOn(guardApi, "orgStatus").mockResolvedValue({ data: {
    managed: true, version_id: "v1", revision: 3,
    skipped_regex: { tag_1: "syntax_error", tag_2: "nested_quantifier" },
  }, etag: null });
  vi.spyOn(guardApi, "runtime").mockResolvedValue({ data: {
    model_mode: "optional", model_status: "active", model_endpoint_set: true, model_ready: true,
    modules: { custom_rules: true, context_model: true }, policy_version: "demo", ruleset_version: 1,
    org: { managed: true, version_id: "v1", revision: 3 },
  }, etag: null });
  vi.spyOn(guardApi, "ruleset").mockResolvedValue({ data: {
    version: 1, modules: { custom_rules: true, context_model: true },
    custom_rules: [], context_detectors: [], prompt_template: null,
  }, etag: '"1"' });
});
afterEach(cleanup);

describe("skipped organization regex", () => {
  it.each(["전체 현황", "검사 서버 관리"])("shows skipped tag names and Korean reasons in %s", async (page) => {
    render(<MemoryRouter>{page === "전체 현황" ? <GuardBanner /> : <GuardSettings />}</MemoryRouter>);
    await screen.findByText("건너뛴 태그 정규식 2개");
    expect(screen.getByRole("link", { name: "사번" }).getAttribute("href"))
      .toBe("/settings/metrics?versionId=v1&tagId=tag_1");
    expect(screen.getByRole("link", { name: "내부 문서" })).toBeTruthy();
    expect(screen.getByText(/Python 정규식 문법이 올바르지 않습니다/)).toBeTruthy();
    expect(screen.getByText(/중첩된 반복 수량자는 사용할 수 없습니다/)).toBeTruthy();
    expect(guardApi.orgStatus).toHaveBeenCalled();
  });

  it("marks skipped tags in metric settings and shows the selected tag's reason", async () => {
    metrics();
    const first = await screen.findByRole("button", { name: /사번.*정규식/ });
    expect(within(first).getByText("정규식 건너뜀")).toBeTruthy();
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/사번 정규식이 검사에서 건너뛰어졌습니다/).textContent)
      .toContain("Python 정규식 문법이 올바르지 않습니다.");
    fireEvent.click(screen.getByRole("button", { name: /내부 문서.*정규식/ }));
    expect(screen.getByText(/내부 문서 정규식이 검사에서 건너뛰어졌습니다/).textContent)
      .toContain("중첩된 반복 수량자는 사용할 수 없습니다.");
  });

  it("does not apply the active server version's skip markers to another version", async () => {
    metrics({ ...configuration(), id: "other" });
    await screen.findByRole("textbox", { name: "Python 정규식" });
    await waitFor(() => expect(api.version).toHaveBeenCalledWith("v1", expect.any(AbortSignal)));
    expect(screen.queryByText("정규식 건너뜀")).toBeNull();
    expect(screen.queryByText(/검사에서 건너뛰어졌습니다/)).toBeNull();
  });

  it("keeps skip reasons visible when tag names cannot be loaded", async () => {
    vi.mocked(api.version).mockRejectedValue(new Error("태그 조회 실패"));
    render(<MemoryRouter><GuardBanner /></MemoryRouter>);
    await screen.findByRole("link", { name: "tag_1" });
    expect(screen.getByText(/Python 정규식 문법이 올바르지 않습니다/)).toBeTruthy();
    expect(screen.getByText("태그 이름을 불러오지 못해 태그 ID를 표시합니다.")).toBeTruthy();
  });

  it("does not load a catalog or show a warning when no rules were skipped", async () => {
    vi.mocked(guardApi.orgStatus).mockResolvedValue({ data: { managed: true, skipped_regex: {} }, etag: null });
    render(<MemoryRouter><GuardBanner /></MemoryRouter>);
    await waitFor(() => expect(guardApi.orgStatus).toHaveBeenCalled());
    expect(api.version).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers retry when organization status cannot be loaded", async () => {
    vi.mocked(guardApi.orgStatus).mockRejectedValueOnce(new Error("검사 서버 상태 조회 실패"));
    render(<MemoryRouter><GuardSettings /></MemoryRouter>);
    await screen.findByText("검사 서버 상태 조회 실패");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("건너뛴 태그 정규식 2개");
  });

  it("refreshes skipped rules after organization settings are reloaded", async () => {
    render(<MemoryRouter><GuardSettings /></MemoryRouter>);
    await screen.findByText("건너뛴 태그 정규식 2개");
    vi.mocked(guardApi.orgStatus).mockResolvedValue({ data: { managed: true, version_id: "v1", skipped_regex: {} }, etag: null });
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(screen.queryByText("건너뛴 태그 정규식 2개")).toBeNull());
  });

  it.each([
    ["too_long", "정규식은 최대 4,000자입니다."],
    ["matches_empty", "빈 문자열과 일치하는 정규식은 사용할 수 없습니다."],
  ])("translates %s from the server", async (reason, message) => {
    vi.mocked(guardApi.orgStatus).mockResolvedValue({ data: { managed: true, version_id: "v1", skipped_regex: { tag_1: reason } }, etag: null });
    render(<MemoryRouter><GuardBanner /></MemoryRouter>);
    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });
});

describe("server validation save errors", () => {
  it.each(["초안 저장", "세부 정보 저장"])("keeps unsaved regex and shows a tag field error after %s is rejected", async (button) => {
    const failure = new ApiError(400, { code: "INVALID_INPUT", message: "입력값을 확인해 주세요.",
      fieldErrors: { "tags.tag_1.pythonRegex": "빈 문자열과 일치하는 정규식은 사용할 수 없습니다." } });
    const saveDraft = vi.spyOn(api, "saveVersion").mockRejectedValue(failure);
    const saveTag = vi.spyOn(api, "saveTagDetails").mockRejectedValue(failure);
    metrics();
    const regex = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Python 정규식" });
    fireEvent.change(regex, { target: { value: "x*" } });
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(regex.getAttribute("aria-invalid")).toBe("true"));
    expect(regex.value).toBe("x*");
    expect(screen.getByText(/입력값을 확인해 주세요.*사번:/).textContent)
      .toContain("빈 문자열과 일치하는 정규식은 사용할 수 없습니다.");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: button }).disabled).toBe(false);
    expect(button === "초안 저장" ? saveDraft : saveTag).toHaveBeenCalledOnce();
    fireEvent.change(regex, { target: { value: "x+" } });
    expect(regex.getAttribute("aria-invalid")).toBe("false");
  });

  it("keeps input available for retry after the configured guard becomes unavailable", async () => {
    vi.spyOn(api, "saveTagDetails").mockRejectedValue(new ApiError(503, {
      code: "GUARD_UNAVAILABLE", message: "검사 서버에서 정규식을 검증하지 못했습니다.",
    }));
    metrics();
    const regex = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Python 정규식" });
    fireEvent.change(regex, { target: { value: "private+" } });
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await screen.findByText("검사 서버에서 정규식을 검증하지 못했습니다.");
    expect(regex.value).toBe("private+");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(false);
  });
});
