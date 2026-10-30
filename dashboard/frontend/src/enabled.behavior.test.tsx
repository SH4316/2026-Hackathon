import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import App from "./App";
import { api, ApiError } from "./api";
import { MetricSettings } from "./MetricSettings";
import { JevSettings } from "./JevSettings";
import { WorkspaceProvider } from "./ui";
import type { ConfigVersion, SaveJevPromptInput, SaveTagDetailsInput } from "./types";

function configuration(): ConfigVersion {
  return {
    id: "published_enabled", name: "사용 설정 트리", status: "PUBLISHED", isActive: true,
    revision: 4, createdAt: "2026-10-29T15:00:00Z", publishedAt: "2026-10-29T16:00:00Z",
    tags: [
      { id: "parent", name: "고객 정보", enabled: true, description: "보존할 설명", examples: ["예시 😀"], guidance: "태그 맥락", jevThreshold: 0, pythonRegex: String.raw`(?i)\bprivate\b`, color: "#123456", parentId: null, order: 0 },
      { id: "child", name: "이메일", enabled: true, description: "", examples: [], guidance: "", jevThreshold: 0.5, pythonRegex: "", color: "#234567", parentId: "parent", order: 0 },
    ],
    jevPrompts: [{ id: "jev_1", name: "연락처 검사", enabled: true, prompt: "  판단 기준 😀\n  ", tagIds: ["parent", "child"] }],
    policyStates: [{ id: "policy_1", name: "사내 정책", description: "", color: "#123456", order: 0 }],
  };
}

function saveTag(config: ConfigVersion, tagId: string, input: SaveTagDetailsInput): ConfigVersion {
  const { revision, enabled, ...details } = input;
  return { ...config, revision: revision + 1, tags: config.tags.map((tag) => tag.id === tagId ? { ...tag, ...details, enabled: enabled ?? tag.enabled } : tag) };
}
function savePrompt(config: ConfigVersion, promptId: string, input: SaveJevPromptInput): ConfigVersion {
  return {
    ...config, revision: input.revision + 1,
    jevPrompts: config.jevPrompts.map((prompt) => prompt.id === promptId ? { ...prompt, name: input.name, prompt: input.prompt, enabled: input.enabled ?? prompt.enabled, tagIds: input.outputs.map((output) => output.tagId) } : prompt),
    tags: config.tags.map((tag) => { const output = input.outputs.find((item) => item.tagId === tag.id); return output ? { ...tag, jevThreshold: output.threshold } : tag; }),
  };
}
function mount(config: ConfigVersion, page: "metrics" | "jev") {
  vi.spyOn(api, "versions").mockResolvedValue([config]);
  vi.spyOn(api, "version").mockResolvedValue(config);
  return render(<MemoryRouter initialEntries={[`/settings/${page}?versionId=${config.id}`]}><WorkspaceProvider>{page === "metrics" ? <MetricSettings /> : <JevSettings />}</WorkspaceProvider></MemoryRouter>);
}
afterEach(cleanup);

describe("version-scoped tag participation", () => {
  it.each([true, false])("saves a published tag from enabled=%s without changing its children or detector settings", async (enabled) => {
    let config = configuration();
    config.tags[0].enabled = enabled;
    const original = structuredClone(config);
    const save = vi.spyOn(api, "saveTagDetails").mockImplementation(async (_id, tagId, input) => { config = saveTag(config, tagId, input); return config; });
    mount(config, "metrics");
    const toggle = await screen.findByRole<HTMLInputElement>("switch", { name: "태그 사용" });
    expect(toggle.checked).toBe(enabled);
    expect(toggle.matches(":disabled")).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(!enabled);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][2]).toMatchObject({ enabled: !enabled, revision: 4, pythonRegex: original.tags[0].pythonRegex, jevThreshold: 0 });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(true));
    expect(config).toMatchObject({ id: original.id, status: "PUBLISHED", isActive: true, publishedAt: original.publishedAt, revision: 5 });
    expect(config.tags[0]).toEqual({ ...original.tags[0], enabled: !enabled });
    expect(config.tags[1]).toEqual(original.tags[1]);
    expect(config.jevPrompts).toEqual(original.jevPrompts);
    expect(config.policyStates).toEqual(original.policyStates);
    if (enabled) expect(screen.getByRole("button", { name: /고객 정보.*사용 안 함/ })).toBeTruthy();
  });

  it("locks the tag switch during a save and preserves the unsaved state after a conflict", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<ConfigVersion>((_resolve, fail) => { reject = fail; });
    const save = vi.spyOn(api, "saveTagDetails").mockReturnValue(pending);
    mount(configuration(), "metrics");
    const toggle = await screen.findByRole<HTMLInputElement>("switch", { name: "태그 사용" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    expect(toggle.matches(":disabled")).toBe(true);
    await act(async () => reject(new ApiError(409, { code: "REVISION_CONFLICT", message: "다른 창의 사용 설정을 확인하세요." })));
    await screen.findByText("다른 창의 사용 설정을 확인하세요.");
    expect(toggle.checked).toBe(false);
    expect(toggle.matches(":disabled")).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(false);
    expect(save.mock.calls[0][2]).toMatchObject({ enabled: false, revision: 4 });
  });

  it("preserves another tag's unsaved switch, tree, version name and policy edits during a detail save", async () => {
    const config = { ...configuration(), status: "DRAFT" as const, isActive: false, publishedAt: null };
    const detail = vi.spyOn(api, "saveTagDetails").mockImplementation(async (_id, tagId, input) => saveTag(config, tagId, input));
    const full = vi.spyOn(api, "saveVersion").mockImplementation(async (_id, input) => ({ ...config, ...input, revision: input.revision + 1, tags: input.tags.map((tag) => ({ ...tag, enabled: tag.enabled ?? true })) }));
    mount(config, "metrics");
    await screen.findByRole("switch", { name: "태그 사용" });
    fireEvent.change(screen.getByRole("textbox", { name: "버전 이름" }), { target: { value: "미저장 버전" } });
    fireEvent.click(screen.getByRole("button", { name: "이메일" }));
    fireEvent.click(screen.getByRole("switch", { name: "태그 사용" }));
    fireEvent.change(screen.getByRole("combobox", { name: "상위 태그" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "정책 상태 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "정책 상태 이름" }), { target: { value: "미저장 정책" } });
    fireEvent.click(screen.getByRole("button", { name: "메트릭 태그 2" }));
    fireEvent.click(screen.getByRole("switch", { name: "태그 사용" }));
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await waitFor(() => expect(detail).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /이메일.*사용 안 함/ }));
    expect(screen.getByRole<HTMLInputElement>("switch", { name: "태그 사용" }).checked).toBe(false);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "상위 태그" }).value).toBe("");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "버전 이름" }).value).toBe("미저장 버전");
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() => expect(full).toHaveBeenCalledOnce());
    expect(full.mock.calls[0][1]).toMatchObject({ revision: 5, name: "미저장 버전", tags: [expect.objectContaining({ id: "parent", enabled: false }), expect.objectContaining({ id: "child", enabled: false, parentId: null })], policyStates: [expect.objectContaining({ name: "미저장 정책" })] });
  });

  it("starts a new child enabled even if its parent is disabled", async () => {
    const config = { ...configuration(), status: "DRAFT" as const, publishedAt: null };
    config.tags[0].enabled = false;
    mount(config, "metrics");
    await screen.findByRole("switch", { name: "태그 사용" });
    fireEvent.click(screen.getByRole("button", { name: "하위 태그" }));
    expect(screen.getByRole<HTMLInputElement>("switch", { name: "태그 사용" }).checked).toBe(true);
  });
});

describe("independent Jev participation", () => {
  it.each([true, false])("saves a published judgment from enabled=%s with disabled outputs still selectable and editable", async (enabled) => {
    let config = configuration();
    config.jevPrompts[0].enabled = enabled;
    config.tags[0].enabled = false;
    const original = structuredClone(config);
    const save = vi.spyOn(api, "saveJevPrompt").mockImplementation(async (_id, promptId, input) => { config = savePrompt(config, promptId, input); return config; });
    mount(config, "jev");
    const toggle = await screen.findByRole<HTMLInputElement>("switch", { name: "Jev 판단 사용" });
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(toggle.checked).toBe(enabled);
    const binding = screen.getByRole<HTMLInputElement>("checkbox", { name: "고객 정보 결과 태그" });
    const threshold = screen.getByRole<HTMLInputElement>("spinbutton", { name: "고객 정보 임계값" });
    expect(binding.checked).toBe(true);
    expect(binding.matches(":disabled")).toBe(false);
    expect(threshold.matches(":disabled")).toBe(false);
    expect(screen.getByRole("link", { name: "고객 정보 태그 설정" })).toBeTruthy();
    expect(screen.getAllByText("사용 안 함").length).toBeGreaterThan(0);
    fireEvent.click(binding);
    fireEvent.click(binding);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][2]).toMatchObject({ revision: 4, enabled: !enabled, name: original.jevPrompts[0].name, prompt: original.jevPrompts[0].prompt, outputs: expect.arrayContaining([{ tagId: "parent", threshold: 0 }, { tagId: "child", threshold: 0.5 }]) });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "판단 저장" }).disabled).toBe(true));
    expect(config.jevPrompts[0].enabled).toBe(!enabled);
    expect(config.tags).toEqual(original.tags);
    expect(config).toMatchObject({ status: "PUBLISHED", isActive: true, revision: 5 });
    if (enabled) expect(screen.getByRole("button", { name: /연락처 검사.*사용 안 함/ })).toBeTruthy();
  });

  it("locks the judgment switch while pending and keeps disabled, text and threshold edits after 409", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<ConfigVersion>((_resolve, fail) => { reject = fail; });
    const save = vi.spyOn(api, "saveJevPrompt").mockReturnValue(pending);
    mount(configuration(), "jev");
    const toggle = await screen.findByRole<HTMLInputElement>("switch", { name: "Jev 판단 사용" });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("textbox", { name: "Jev 판단 프롬프트" }), { target: { value: "미저장 판단 😀" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "이메일 임계값" }), { target: { value: "0.625" } });
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    expect(toggle.matches(":disabled")).toBe(true);
    await act(async () => reject(new ApiError(409, { code: "REVISION_CONFLICT", message: "다른 창의 판단 설정을 확인하세요." })));
    await screen.findByText("다른 창의 판단 설정을 확인하세요.");
    expect(toggle.checked).toBe(false);
    expect(toggle.matches(":disabled")).toBe(false);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Jev 판단 프롬프트" }).value).toBe("미저장 판단 😀");
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "이메일 임계값" }).value).toBe("0.625");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "판단 저장" }).disabled).toBe(false);
    expect(save.mock.calls[0][2]).toMatchObject({ enabled: false, revision: 4 });
  });

  it("defaults a new judgment to enabled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount(configuration(), "jev");
    await screen.findByRole("switch", { name: "Jev 판단 사용" });
    fireEvent.click(screen.getByRole("button", { name: "새 Jev 판단" }));
    expect(screen.getByRole<HTMLInputElement>("switch", { name: "Jev 판단 사용" }).checked).toBe(true);
  });
});

describe("removed monitoring navigation", () => {
  it("redirects the old monitoring route to metric settings while preserving the complete query", async () => {
    const config = configuration();
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    function Location() { const location = useLocation(); return <output aria-label="현재 URL">{location.pathname + location.search}</output>; }
    render(<MemoryRouter initialEntries={[`/settings/monitoring?versionId=${config.id}&tagId=child&q=%20literal_%25%20`]}><Location /><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "메트릭 설정" });
    expect(screen.getByLabelText("현재 URL").textContent).toBe(`/settings/metrics?versionId=${config.id}&tagId=child&q=%20literal_%25%20`);
    expect(screen.queryByRole("link", { name: "감시 연동" })).toBeNull();
    expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "태그 이름" })).value).toBe("이메일");
  });
});
