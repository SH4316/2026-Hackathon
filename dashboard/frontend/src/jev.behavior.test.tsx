import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { api, ApiError } from "./api";
import { JevSettings } from "./JevSettings";
import { WorkspaceProvider } from "./ui";
import type { ConfigVersion, SaveJevPromptInput } from "./types";

function configuration(): ConfigVersion {
  return {
    id: "published_jev", name: "선택한 트리", status: "PUBLISHED", isActive: true,
    revision: 7, createdAt: "2026-10-29T15:00:00Z", publishedAt: "2026-10-29T16:00:00Z",
    tags: [
      { id: "parent", enabled: true, name: "고객 정보", description: "", examples: [], guidance: "별도 판단 맥락", jevThreshold: 0, pythonRegex: String.raw`(?i)\bprivate\b`, color: "#123456", parentId: null, order: 0 },
      { id: "child", enabled: true, name: "이메일", description: "", examples: [], guidance: "", jevThreshold: null, pythonRegex: "", color: "#234567", parentId: "parent", order: 0 },
    ],
    jevPrompts: [
      { id: "jev_1", enabled: true, name: "연락처 검사", prompt: "  저장한 판단 기준 😀\n  ", tagIds: ["parent", "child"] },
      { id: "jev_2", enabled: true, name: "다른 검사", prompt: "동일한 태그를 출력합니다.", tagIds: ["child"] },
    ],
    policyStates: [],
  };
}

function saved(config: ConfigVersion, promptId: string, input: SaveJevPromptInput): ConfigVersion {
  const prompt = { id: promptId, enabled: input.enabled ?? config.jevPrompts.find((item) => item.id === promptId)?.enabled ?? true, name: input.name, prompt: input.prompt, tagIds: input.outputs.map((output) => output.tagId) };
  return {
    ...config, revision: input.revision + 1,
    jevPrompts: config.jevPrompts.some((item) => item.id === promptId)
      ? config.jevPrompts.map((item) => item.id === promptId ? prompt : item)
      : [...config.jevPrompts, prompt],
    tags: config.tags.map((tag) => {
      const output = input.outputs.find((item) => item.tagId === tag.id);
      return output ? { ...tag, jevThreshold: output.threshold } : tag;
    }),
  };
}

function mount(config: ConfigVersion) {
  vi.spyOn(api, "versions").mockResolvedValue([config]);
  vi.spyOn(api, "version").mockResolvedValue(config);
  return render(<MemoryRouter initialEntries={[`/settings/jev?versionId=${config.id}`]}><WorkspaceProvider><JevSettings /></WorkspaceProvider></MemoryRouter>);
}

afterEach(cleanup);

describe("independent Jev settings", () => {
  it("edits a published prompt and several output thresholds atomically while keeping tag context separate", async () => {
    const config = configuration();
    const save = vi.spyOn(api, "saveJevPrompt").mockImplementation(async (_versionId, promptId, input) => saved(config, promptId, input));
    const tagSave = vi.spyOn(api, "saveTagDetails");
    const fullSave = vi.spyOn(api, "saveVersion");
    mount(config);
    const prompt = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Jev 판단 프롬프트" });
    expect(prompt.value).toBe(config.jevPrompts[0].prompt);
    expect(prompt.matches(":disabled")).toBe(false);
    expect(screen.getByRole("link", { name: "이메일 태그 설정" }).getAttribute("href")).toBe("/settings/metrics?versionId=published_jev&tagId=child");
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "고객 정보 임계값" }).value).toBe("0");
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "이메일 임계값" }).value).toBe("");
    const text = "  수정한 독립 프롬프트 😀\n다음 줄\n  ";
    fireEvent.change(prompt, { target: { value: text } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "고객 정보 임계값" }), { target: { value: "0.123456" } });
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(config.id, "jev_1", {
      revision: 7, enabled: true, name: "연락처 검사", prompt: text,
      outputs: [{ tagId: "parent", threshold: 0.123456 }, { tagId: "child", threshold: null }],
    });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "판단 저장" }).disabled).toBe(true));
    expect(prompt.value).toBe(text);
    expect(config.tags[0].guidance).toBe("별도 판단 맥락");
    expect(config.tags[0].jevThreshold).toBe(0);
    expect(tagSave).not.toHaveBeenCalled();
    expect(fullSave).not.toHaveBeenCalled();
  });

  it("creates a prompt using existing tags and preserves unset versus zero thresholds", async () => {
    const config = configuration();
    config.jevPrompts = [];
    const create = vi.spyOn(api, "createJevPrompt").mockImplementation(async (_versionId, input) => saved(config, "jev_new", input));
    mount(config);
    await waitFor(() => expect(screen.getAllByRole<HTMLButtonElement>("button", { name: "새 Jev 판단" })[0].disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("button", { name: "새 Jev 판단" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Jev 판단 이름" }), { target: { value: "새 독립 검사" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "고객 정보 결과 태그" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "이메일 결과 태그" }));
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(config.id, {
      revision: 7, enabled: true, name: "새 독립 검사", prompt: "",
      outputs: [{ tagId: "parent", threshold: 0 }, { tagId: "child", threshold: null }],
    });
    await screen.findByText("Jev 판단을 저장했습니다. 선택한 트리 버전에만 적용됩니다.");
  });

  it("uses the latest shared tag threshold when switching between prompts", async () => {
    const config = configuration();
    const save = vi.spyOn(api, "saveJevPrompt").mockImplementation(async (_versionId, promptId, input) => saved(config, promptId, input));
    mount(config);
    await screen.findByRole("textbox", { name: "Jev 판단 프롬프트" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "이메일 임계값" }), { target: { value: "0.65" } });
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "판단 저장" }).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /^다른 검사/ }));
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "이메일 임계값" }).value).toBe("0.65");
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "고객 정보 임계값" }).disabled).toBe(true);
  });

  it("unselects an output without sending an overwrite for the unselected tag threshold", async () => {
    const config = configuration();
    config.tags[1].jevThreshold = 0.6;
    const save = vi.spyOn(api, "saveJevPrompt").mockImplementation(async (_versionId, promptId, input) => saved(config, promptId, input));
    mount(config);
    fireEvent.click(await screen.findByRole("checkbox", { name: "이메일 결과 태그" }));
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][2].outputs).toEqual([{ tagId: "parent", threshold: 0 }]);
    const next = await save.mock.results[0].value;
    expect(next.tags).toEqual(config.tags);
    expect(next.jevPrompts[1]).toEqual(config.jevPrompts[1]);
  });

  it.each(["1.000001", "0.1234567", "-0.1"])("keeps invalid threshold %s visible and blocks saving", async (value) => {
    const save = vi.spyOn(api, "saveJevPrompt");
    mount(configuration());
    const threshold = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "고객 정보 임계값" });
    fireEvent.change(threshold, { target: { value } });
    expect(threshold.value).toBe(value);
    expect(threshold.getAttribute("aria-invalid")).toBe("true");
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "판단 저장" });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(save).not.toHaveBeenCalled();
  });

  it("retains unsaved prompt text and threshold after a revision conflict", async () => {
    const save = vi.spyOn(api, "saveJevPrompt").mockRejectedValue(new ApiError(409, { code: "REVISION_CONFLICT", message: "다른 창의 Jev 설정을 확인하세요." }));
    mount(configuration());
    const prompt = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Jev 판단 프롬프트" });
    fireEvent.change(prompt, { target: { value: "  보존할 미저장 기준 😀\n  " } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "이메일 임계값" }), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "판단 저장" }));
    await screen.findByText("다른 창의 Jev 설정을 확인하세요.");
    expect(prompt.value).toBe("  보존할 미저장 기준 😀\n  ");
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "이메일 임계값" }).value).toBe("0.5");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "판단 저장" }).disabled).toBe(false);
    expect(save.mock.calls[0][2].revision).toBe(7);
  });

  it("deletes only the selected prompt with the version's current revision", async () => {
    const config = configuration();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const remove = vi.spyOn(api, "deleteJevPrompt").mockResolvedValue({ ...config, revision: 8, jevPrompts: [config.jevPrompts[1]] });
    mount(config);
    fireEvent.click(await screen.findByRole("button", { name: "판단 삭제" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(config.id, "jev_1", 7));
    await screen.findByText("Jev 판단을 삭제했습니다. 결과 태그와 임계값은 유지됩니다.");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Jev 판단 이름" }).value).toBe("다른 검사");
    expect(config.tags).toHaveLength(2);
  });

  it("hides the previous editable settings while a history-selected version is loading", async () => {
    const first = configuration();
    const second = { ...configuration(), id: "published_other", name: "다른 트리", isActive: false,
      jevPrompts: [{ id: "jev_other", enabled: true, name: "다른 버전 검사", prompt: "다른 버전의 판단 기준", tagIds: ["child"] }],
    };
    let resolve!: (value: ConfigVersion) => void;
    const pending = new Promise<ConfigVersion>((complete) => { resolve = complete; });
    vi.spyOn(api, "versions").mockResolvedValue([first, second]);
    vi.spyOn(api, "version").mockImplementation(async (id) => id === first.id ? first : pending);
    function HistoryNavigation() {
      const navigate = useNavigate();
      return <button onClick={() => navigate(1)}>다음 기록 버전</button>;
    }
    render(<MemoryRouter initialEntries={[`/settings/jev?versionId=${first.id}`, `/settings/jev?versionId=${second.id}`]} initialIndex={0}><WorkspaceProvider><HistoryNavigation /><JevSettings /></WorkspaceProvider></MemoryRouter>);
    expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Jev 판단 프롬프트" })).value).toBe(first.jevPrompts[0].prompt);
    fireEvent.click(screen.getByRole("button", { name: "다음 기록 버전" }));
    expect(screen.queryByRole("textbox", { name: "Jev 판단 프롬프트" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^연락처 검사/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "고객 정보 결과 태그" })).toBeNull();
    await act(async () => { resolve(second); });
    expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Jev 판단 프롬프트" })).value).toBe("다른 버전의 판단 기준");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Jev 설정 버전 선택" }).value).toBe(second.id);
  });

  it("counts prompt Unicode code points and blocks oversized text without truncation", async () => {
    mount(configuration());
    const prompt = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Jev 판단 프롬프트" });
    const atLimit = "😀".repeat(12000);
    fireEvent.change(prompt, { target: { value: atLimit } });
    expect(prompt.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByText(/12,000 \/ 12,000자/)).toBeTruthy();
    fireEvent.change(prompt, { target: { value: atLimit + "가" } });
    expect(prompt.value).toBe(atLimit + "가");
    expect(prompt.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "판단 저장" }).disabled).toBe(true);
  });
});
