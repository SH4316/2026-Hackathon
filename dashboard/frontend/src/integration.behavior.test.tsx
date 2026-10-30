import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { api, ApiError } from "./api";
import { MetricSettings } from "./MetricSettings";
import {
  EventTable,
  RefreshButton,
  SearchFilters,
  VersionSelect,
  WorkspaceProvider,
  useDashboardFilters,
} from "./ui";
import type { ConfigVersion, SecurityEvent } from "./types";

const draft = (id: string, name = id): ConfigVersion => ({
  id,
  name,
  status: "DRAFT",
  isActive: false,
  revision: 1,
  createdAt: "2026-10-29T15:00:00Z",
  publishedAt: null,
  tags: [
    {
      id: "tag_1",
      enabled: true,
      name: "고객 정보",
      description: "",
      examples: ["첫 예시", "둘째 예시"],
      guidance: "",
      jevThreshold: null,
      pythonRegex: "",
      color: "#123456",
      parentId: null,
      order: 0,
    },
  ],
  jevPrompts: [],
  policyStates: [
    {
      id: "policy_1",
      name: "사내 정책",
      description: "",
      color: "#123456",
      order: 0,
    },
  ],
});
const published = (id: string, isActive = false): ConfigVersion => ({
  ...draft(id),
  status: "PUBLISHED",
  isActive,
  publishedAt: "2026-10-29T15:00:00Z",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
}

afterEach(cleanup);

function FilterHarness({ config }: { config: ConfigVersion | null }) {
  const state = useDashboardFilters();
  const location = useLocation();
  return (
    <>
      <SearchFilters state={state} config={config} />
      <output aria-label="검색 URL">{location.search}</output>
    </>
  );
}

describe("dynamic search forms", () => {
  it("restores the selected tag after the catalog loads and preserves literal prompt whitespace", async () => {
    const config = published("published_1", true);
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    const content = (value: ConfigVersion | null) => (
      <MemoryRouter
        initialEntries={["/events?versionId=published_1&tagId=tag_1&page=3"]}
      >
        <WorkspaceProvider>
          <FilterHarness config={value} />
        </WorkspaceProvider>
      </MemoryRouter>
    );
    const { rerender } = render(content(null));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "검색" }).disabled,
    ).toBe(true);
    rerender(content(config));
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "메트릭 태그" })
        .value,
    ).toBe("tag_1");
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt 검색" }), {
      target: { value: "  token_% 😀  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    const params = new URLSearchParams(
      screen.getByLabelText("검색 URL").textContent!,
    );
    expect(params.get("q")).toBe("  token_% 😀  ");
    expect(params.get("tagId")).toBe("tag_1");
    expect(params.has("page")).toBe(false);
    expect(params.has("unmapped")).toBe(false);
    expect(params.get("versionId")).toBe("published_1");
    await waitFor(() => expect(api.versions).toHaveBeenCalledOnce());
  });

  it("clears version-specific selections when switching view versions, preserving prompt/person filters", async () => {
    vi.spyOn(api, "versions").mockResolvedValue([
      published("v1", true),
      published("v2"),
    ]);
    function Harness() {
      const state = useDashboardFilters();
      const location = useLocation();
      return (
        <>
          <VersionSelect state={state} />
          <output aria-label="검색 URL">{location.search}</output>
        </>
      );
    }
    render(
      <MemoryRouter
        initialEntries={[
          "/?versionId=v1&tagId=tag_1&unmapped=true&policyStateId=policy_1&page=3&q=literal_%&personId=person_1&service=claude",
        ]}
      >
        <WorkspaceProvider>
          <Harness />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("option", { name: "v2" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "v2" } });
    expect(
      Object.fromEntries(
        new URLSearchParams(screen.getByLabelText("검색 URL").textContent!),
      ),
    ).toEqual({
      versionId: "v2",
      q: "literal_%",
      personId: "person_1",
      service: "claude",
    });
  });

  it("reloads active-version metadata on manual refresh and follows an unpinned active view", async () => {
    vi.spyOn(api, "versions")
      .mockResolvedValueOnce([published("v1", true)])
      .mockResolvedValueOnce([published("v1"), published("v2", true)]);
    const refresh = vi.fn();
    function Harness() {
      const state = useDashboardFilters();
      return (
        <>
          <output aria-label="조회 버전">{state.filters.versionId}</output>
          <RefreshButton refresh={refresh} loading={false} updatedAt={null} />
        </>
      );
    }
    render(
      <MemoryRouter>
        <WorkspaceProvider>
          <Harness />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("조회 버전").textContent).toBe("v1"),
    );
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() =>
      expect(screen.getByLabelText("조회 버전").textContent).toBe("v2"),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(api.versions).toHaveBeenCalledTimes(2);
  });
});

describe("configuration editing", () => {
  it.each(["😀".repeat(80), "짧은 버전 이름"])(
    "clones a published version using a name bounded to 80 Unicode code points: %s",
    async (sourceName) => {
      const source = { ...published("published_long", true), name: sourceName };
      const expectedName =
        Array.from(sourceName).slice(0, 77).join("") + " 복사";
      const cloned = { ...draft("draft_cloned"), name: expectedName };
      vi.spyOn(api, "versions").mockResolvedValue([source]);
      vi.spyOn(api, "version").mockImplementation(async (id) =>
        id === source.id ? source : cloned,
      );
      const create = vi.spyOn(api, "createVersion").mockResolvedValue(cloned);
      render(
        <MemoryRouter
          initialEntries={["/settings/metrics?versionId=published_long"]}
        >
          <WorkspaceProvider>
            <MetricSettings />
          </WorkspaceProvider>
        </MemoryRouter>,
      );
      fireEvent.click(
          await screen.findByRole("button", { name: "복제" }),
      );
      await waitFor(() => expect(create).toHaveBeenCalledOnce());
      expect(create).toHaveBeenCalledWith({
        name: expectedName,
        baseVersionId: source.id,
      });
      expect(
        Array.from(create.mock.calls[0][0].name).length,
      ).toBeLessThanOrEqual(80);
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLInputElement>("textbox", { name: "버전 이름" })
            .value,
        ).toBe(expectedName),
      );
      expect(source.name).toBe(sourceName);
    },
  );

  it("saves newline-delimited examples as separate entries and keeps the selected tag", async () => {
    const config = draft("draft_1");
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const save = vi
      .spyOn(api, "saveVersion")
      .mockImplementation(async (_id, input) => ({
        ...config,
        ...input,
        tags: input.tags.map((tag) => ({ ...tag, enabled: tag.enabled ?? config.tags.find((item) => item.id === tag.id)?.enabled ?? true })),
        revision: 2,
      }));
    render(
      <MemoryRouter initialEntries={["/settings/metrics?versionId=draft_1"]}>
        <WorkspaceProvider>
          <MetricSettings />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    const examples = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "태그 예시",
    });
    expect(examples.value).toBe("첫 예시\n둘째 예시");
    fireEvent.change(examples, {
      target: { value: "새 예시\n둘째 😀 예시\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1].tags[0].examples).toEqual([
      "새 예시",
      "둘째 😀 예시",
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLTextAreaElement>("textbox", { name: "태그 예시" })
          .value,
      ).toBe("새 예시\n둘째 😀 예시"),
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "초안 저장" })
        .disabled,
    ).toBe(true);
  });

  it("saves a numeric Jev threshold without changing guidance or Python regex", async () => {
    const config = draft("draft_jev");
    config.tags[0].guidance = "분류 참고 맥락";
    config.tags[0].pythonRegex = String.raw`(?i)\bconfidential\b`;
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const save = vi
      .spyOn(api, "saveVersion")
      .mockImplementation(async (_id, input) => ({
        ...config,
        ...input,
        tags: input.tags.map((tag) => ({ ...tag, enabled: tag.enabled ?? config.tags.find((item) => item.id === tag.id)?.enabled ?? true })),
        revision: 2,
      }));
    render(
      <MemoryRouter initialEntries={["/settings/metrics?versionId=draft_jev"]}>
        <WorkspaceProvider>
          <MetricSettings />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    const prompt = await screen.findByRole<HTMLInputElement>("spinbutton", {
      name: "Jev 임계값",
    });
    expect(prompt.value).toBe("");
    const edited = "0.123456";
    fireEvent.change(prompt, { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toBe("draft_jev");
    expect(save.mock.calls[0][1].tags[0]).toMatchObject({
      jevThreshold: Number(edited),
      guidance: "분류 참고 맥락",
      pythonRegex: String.raw`(?i)\bconfidential\b`,
    });
    expect(config.tags[0].jevThreshold).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "초안 저장" })
          .disabled,
      ).toBe(true),
    );
    expect(prompt.value).toBe(edited);
  });

  it("saves Python regex source with inline flags, named groups, backslashes and newlines without changing the Jev threshold", async () => {
    const config = draft("draft_regex");
    config.tags[0].jevThreshold = 0.5;
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const save = vi
      .spyOn(api, "saveVersion")
      .mockImplementation(async (_id, input) => ({
        ...config,
        ...input,
        tags: input.tags.map((tag) => ({ ...tag, enabled: tag.enabled ?? config.tags.find((item) => item.id === tag.id)?.enabled ?? true })),
        revision: 2,
      }));
    render(
      <MemoryRouter initialEntries={["/settings/metrics?versionId=draft_regex"]}>
        <WorkspaceProvider>
          <MetricSettings />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    const regex = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Python 정규식",
    });
    expect(regex.value).toBe("");
    const edited = String.raw`(?imx)^\b(?P<label>internal|confidential)\b[ \t]*$` + "\n# 합성 😀\n  ";
    fireEvent.change(regex, { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1].tags[0]).toMatchObject({
      pythonRegex: edited,
      jevThreshold: 0.5,
    });
    expect(config.tags[0].pythonRegex).toBe("");
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "초안 저장" })
          .disabled,
      ).toBe(true),
    );
    expect(regex.value).toBe(edited);
  });

  it("starts a child tag with an unset Jev threshold and empty Python regex instead of inheriting its parent's values", async () => {
    const config = draft("draft_child");
    config.tags[0].jevThreshold = 0.75;
    config.tags[0].pythonRegex = String.raw`(?i)\bconfidential\b`;
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const save = vi
      .spyOn(api, "saveVersion")
      .mockImplementation(async (_id, input) => ({
        ...config,
        ...input,
        tags: input.tags.map((tag) => ({ ...tag, enabled: tag.enabled ?? config.tags.find((item) => item.id === tag.id)?.enabled ?? true })),
        revision: 2,
      }));
    render(
      <MemoryRouter initialEntries={["/settings/metrics?versionId=draft_child"]}>
        <WorkspaceProvider>
          <MetricSettings />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    expect(
      (await screen.findByRole<HTMLInputElement>("spinbutton", {
        name: "Jev 임계값",
      })).value,
    ).toBe("0.75");
    fireEvent.click(screen.getByRole("button", { name: "하위 태그" }));
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: "Jev 임계값",
      }).value,
    ).toBe("");
    expect(
      screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Python 정규식",
      }).value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][1].tags).toEqual([
      config.tags[0],
      expect.objectContaining({ parentId: "tag_1", jevThreshold: null, pythonRegex: "" }),
    ]);
  });

  it("opens the version and output tag selected by a Jev metric deep link", async () => {
    const config = draft("draft_link");
    config.tags.push({ ...config.tags[0], id: "tag_2", name: "이메일", parentId: "tag_1", jevThreshold: 0 });
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    render(<MemoryRouter initialEntries={["/settings/metrics?versionId=draft_link&tagId=tag_2"]}><WorkspaceProvider><MetricSettings /></WorkspaceProvider></MemoryRouter>);
    const name = await screen.findByRole<HTMLInputElement>("textbox", { name: "태그 이름" });
    expect(name.value).toBe("이메일");
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Jev 임계값" }).value).toBe("0");
    expect(screen.queryByRole("textbox", { name: "Jev 판단 프롬프트" })).toBeNull();
  });

  it("keeps an invalid tag threshold visible and blocks full and detail saves until corrected", async () => {
    const config = draft("draft_invalid_threshold");
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const fullSave = vi.spyOn(api, "saveVersion");
    const detailsSave = vi.spyOn(api, "saveTagDetails");
    render(<MemoryRouter initialEntries={["/settings/metrics?versionId=draft_invalid_threshold"]}><WorkspaceProvider><MetricSettings /></WorkspaceProvider></MemoryRouter>);
    const threshold = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Jev 임계값" });
    for (const value of ["-0.1", "1.1", "0.1234567"]) {
      fireEvent.change(threshold, { target: { value } });
      expect(threshold.value).toBe(value);
      expect(threshold.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "초안 저장" }).disabled).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(true);
    }
    expect(fullSave).not.toHaveBeenCalled();
    expect(detailsSave).not.toHaveBeenCalled();
    fireEvent.change(threshold, { target: { value: "0" } });
    expect(threshold.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(false);
  });

  it("clears an existing zero threshold to null when saving tag details", async () => {
    const config = published("published_clear_threshold");
    config.tags[0].jevThreshold = 0;
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const save = vi.spyOn(api, "saveTagDetails").mockImplementation(async (_versionId, tagId, input) => {
      const { revision, ...details } = input;
      return { ...config, revision: revision + 1, tags: config.tags.map((tag) => tag.id === tagId ? { ...tag, ...details, enabled: details.enabled ?? tag.enabled } : tag) };
    });
    render(<MemoryRouter initialEntries={["/settings/metrics?versionId=published_clear_threshold"]}><WorkspaceProvider><MetricSettings /></WorkspaceProvider></MemoryRouter>);
    const threshold = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Jev 임계값" });
    expect(threshold.value).toBe("0");
    fireEvent.change(threshold, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][2].jevThreshold).toBeNull();
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(true));
    expect(threshold.value).toBe("");
  });

  it.each([
    ["Python 정규식", 4000],
  ] as const)("counts code points and marks an oversized %s without truncating it", async (label, limit) => {
    const config = draft("draft_limit");
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    render(
      <MemoryRouter initialEntries={["/settings/metrics?versionId=draft_limit"]}>
        <WorkspaceProvider>
          <MetricSettings />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    const prompt = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: label,
    });
    const atLimit = "😀".repeat(limit);
    fireEvent.change(prompt, { target: { value: atLimit } });
    expect(prompt.value).toBe(atLimit);
    expect(prompt.getAttribute("aria-invalid")).toBe("false");
    const limitLabel = limit.toLocaleString("en-US");
    expect(screen.getByText(`${limitLabel} / ${limitLabel}자`)).toBeTruthy();

    fireEvent.change(prompt, { target: { value: atLimit + "가" } });
    expect(prompt.value).toBe(atLimit + "가");
    expect(prompt.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText(`${(limit + 1).toLocaleString("en-US")} / ${limitLabel}자 · 길이를 줄여 주세요`),
    ).toBeTruthy();
  });

  it("edits and saves published tag details while keeping tree and policy controls locked", async () => {
    const config = published("published_jev", true);
    config.tags[0].jevThreshold = 0.75;
    config.tags[0].pythonRegex = String.raw`(?i)\bconfidential\b`;
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const fullSave = vi.spyOn(api, "saveVersion");
    const save = vi.spyOn(api, "saveTagDetails").mockImplementation(async (_id, tagId, input) => {
      const { revision, ...details } = input;
      return {
        ...config,
        revision: revision + 1,
        tags: config.tags.map((tag) => tag.id === tagId ? { ...tag, ...details, enabled: details.enabled ?? tag.enabled } : tag),
      };
    });
    render(
      <MemoryRouter initialEntries={["/settings/metrics?versionId=published_jev"]}>
        <WorkspaceProvider>
          <MetricSettings />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    const prompt = await screen.findByRole<HTMLInputElement>("spinbutton", {
      name: "Jev 임계값",
    });
    expect(prompt.value).toBe(String(config.tags[0].jevThreshold));
    expect(prompt.matches(":disabled")).toBe(false);
    const regex = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Python 정규식",
    });
    expect(regex.value).toBe(config.tags[0].pythonRegex);
    expect(regex.matches(":disabled")).toBe(false);
    expect(screen.getByRole("combobox", { name: "상위 태그" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "최상위 태그 추가" }).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "하위 태그" })).toBeNull();
    expect(screen.queryByRole("button", { name: "초안 저장" })).toBeNull();
    const editedPrompt = "0";
    const editedRegex = String.raw`(?im)^\b(?P<label>private)\b$` + "\n  ";
    fireEvent.change(screen.getByRole("textbox", { name: "태그 이름" }), { target: { value: "수정한 고객 정보" } });
    fireEvent.change(screen.getByLabelText("태그 색상"), { target: { value: "#654321" } });
    fireEvent.change(screen.getByRole("textbox", { name: "태그 설명" }), { target: { value: "새 설명" } });
    fireEvent.change(screen.getByRole("textbox", { name: "태그 예시" }), { target: { value: "새 예시\n두 번째 😀" } });
    fireEvent.change(screen.getByRole("textbox", { name: "판단 참고사항" }), { target: { value: "새 맥락" } });
    fireEvent.change(prompt, { target: { value: editedPrompt } });
    fireEvent.change(regex, { target: { value: editedRegex } });
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(config.id, "tag_1", {
      revision: 1,
      enabled: true,
      name: "수정한 고객 정보",
      color: "#654321",
      description: "새 설명",
      examples: ["새 예시", "두 번째 😀"],
      guidance: "새 맥락",
      jevThreshold: Number(editedPrompt),
      pythonRegex: editedRegex,
    });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(true));
    expect(prompt.value).toBe(editedPrompt);
    expect(regex.value).toBe(editedRegex);
    expect(config.tags[0].name).toBe("고객 정보");
    expect(fullSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "정책 상태 1" }));
    expect(screen.getByRole("textbox", { name: "정책 상태 이름" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("textbox", { name: "정책 설명" }).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("정책 색상").matches(":disabled")).toBe(true);
  });

  it("keeps other unsaved details, tree changes and policies when saving only the selected tag", async () => {
    const config = draft("draft_partial");
    config.tags.push({ ...config.tags[0], id: "tag_2", name: "이메일", order: 1 });
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const detailsSave = vi.spyOn(api, "saveTagDetails").mockImplementation(async (_id, tagId, input) => {
      const { revision, ...details } = input;
      return { ...config, revision: revision + 1, tags: config.tags.map((tag) => tag.id === tagId ? { ...tag, ...details, enabled: details.enabled ?? tag.enabled } : tag) };
    });
    const fullSave = vi.spyOn(api, "saveVersion").mockImplementation(async (_id, input) => ({ ...config, ...input, tags: input.tags.map((tag) => ({ ...tag, enabled: tag.enabled ?? config.tags.find((item) => item.id === tag.id)?.enabled ?? true })), revision: input.revision + 1 }));
    render(<MemoryRouter initialEntries={["/settings/metrics?versionId=draft_partial"]}><WorkspaceProvider><MetricSettings /></WorkspaceProvider></MemoryRouter>);
    await screen.findByRole("textbox", { name: "태그 이름" });
    fireEvent.change(screen.getByRole("textbox", { name: "버전 이름" }), { target: { value: "저장 전 버전 이름" } });
    fireEvent.click(screen.getByRole("button", { name: "이메일" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Jev 임계값" }), { target: { value: "0.625" } });
    fireEvent.change(screen.getByRole("combobox", { name: "상위 태그" }), { target: { value: "tag_1" } });
    fireEvent.click(screen.getByRole("button", { name: "정책 상태 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "정책 상태 이름" }), { target: { value: "저장 전 정책" } });
    fireEvent.click(screen.getByRole("button", { name: "메트릭 태그 2" }));
    fireEvent.change(screen.getByRole("textbox", { name: "태그 설명" }), { target: { value: "선택 태그 설명" } });
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await waitFor(() => expect(detailsSave).toHaveBeenCalledOnce());
    expect(detailsSave.mock.calls[0][0]).toBe(config.id);
    expect(detailsSave.mock.calls[0][1]).toBe("tag_1");
    expect(detailsSave.mock.calls[0][2]).toMatchObject({ revision: 1, description: "선택 태그 설명" });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(true));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "버전 이름" }).value).toBe("저장 전 버전 이름");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "초안 저장" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "이메일" }));
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Jev 임계값" }).value).toBe("0.625");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "상위 태그" }).value).toBe("tag_1");
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() => expect(fullSave).toHaveBeenCalledOnce());
    expect(fullSave.mock.calls[0][1]).toMatchObject({ revision: 2, name: "저장 전 버전 이름", policyStates: [expect.objectContaining({ name: "저장 전 정책" })] });
    expect(fullSave.mock.calls[0][1].tags).toEqual([
      expect.objectContaining({ id: "tag_1", description: "선택 태그 설명", parentId: null, order: 0 }),
      expect.objectContaining({ id: "tag_2", jevThreshold: 0.625, parentId: "tag_1", order: 0 }),
    ]);
  });

  it("retains the selected tag's input and dirty state after a revision conflict", async () => {
    const config = published("published_conflict", true);
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    const save = vi.spyOn(api, "saveTagDetails").mockRejectedValue(new ApiError(409, { code: "REVISION_CONFLICT", message: "다른 창에서 수정했습니다. 새로고침 후 확인하세요." }));
    render(<MemoryRouter initialEntries={["/settings/metrics?versionId=published_conflict"]}><WorkspaceProvider><MetricSettings /></WorkspaceProvider></MemoryRouter>);
    const prompt = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Jev 임계값" });
    const edited = "0.375";
    fireEvent.change(prompt, { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await screen.findByText("다른 창에서 수정했습니다. 새로고침 후 확인하세요.");
    expect(prompt.value).toBe(edited);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" }).disabled).toBe(false);
    expect(save).toHaveBeenCalledWith(config.id, "tag_1", expect.objectContaining({ revision: 1, jevThreshold: Number(edited) }));
    expect(config.tags[0].jevThreshold).toBeNull();
  });

  it("saves a new tag through the draft before enabling separate detail saves", async () => {
    const config = draft("draft_new_tag");
    vi.spyOn(api, "versions").mockResolvedValue([config]);
    vi.spyOn(api, "version").mockResolvedValue(config);
    let saved = config;
    const fullSave = vi.spyOn(api, "saveVersion").mockImplementation(async (_id, input) => {
      saved = { ...config, ...input, tags: input.tags.map((tag) => ({ ...tag, enabled: tag.enabled ?? config.tags.find((item) => item.id === tag.id)?.enabled ?? true })), revision: input.revision + 1 };
      return saved;
    });
    const detailsSave = vi.spyOn(api, "saveTagDetails").mockImplementation(async (_id, tagId, input) => {
      const { revision, ...details } = input;
      return { ...saved, revision: revision + 1, tags: saved.tags.map((tag) => tag.id === tagId ? { ...tag, ...details, enabled: details.enabled ?? tag.enabled } : tag) };
    });
    render(<MemoryRouter initialEntries={["/settings/metrics?versionId=draft_new_tag"]}><WorkspaceProvider><MetricSettings /></WorkspaceProvider></MemoryRouter>);
    await screen.findByRole("textbox", { name: "태그 이름" });
    fireEvent.click(screen.getByRole("button", { name: "하위 태그" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Jev 임계값" }), { target: { value: "0.6" } });
    const saveButton = screen.getByRole<HTMLButtonElement>("button", { name: "세부 정보 저장" });
    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText("새 태그의 내용은 ‘초안 저장’으로 함께 저장하세요.")).toBeTruthy();
    fireEvent.click(saveButton);
    expect(detailsSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() => expect(fullSave).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "초안 저장" }).disabled).toBe(true));
    const newTag = fullSave.mock.calls[0][1].tags.find((tag) => tag.id !== "tag_1")!;
    expect(newTag).toMatchObject({ parentId: "tag_1", jevThreshold: 0.6 });
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Jev 임계값" }), { target: { value: "0.8" } });
    fireEvent.click(screen.getByRole("button", { name: "세부 정보 저장" }));
    await waitFor(() => expect(detailsSave).toHaveBeenCalledOnce());
    expect(detailsSave).toHaveBeenCalledWith(config.id, newTag.id, expect.objectContaining({ revision: 2, jevThreshold: 0.8 }));
  });

  it("hides the previous editable version while the next version loads", async () => {
    const first = draft("draft_1");
    const second = draft("draft_2");
    const pending = deferred<ConfigVersion>();
    vi.spyOn(api, "versions").mockResolvedValue([first, second]);
    vi.spyOn(api, "version").mockImplementation((id) =>
      id === first.id ? Promise.resolve(first) : pending.promise,
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={["/settings/metrics?versionId=draft_1"]}>
        <WorkspaceProvider>
          <MetricSettings />
        </WorkspaceProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("textbox", { name: "버전 이름" });
    fireEvent.change(screen.getByRole("textbox", { name: "태그 이름" }), {
      target: { value: "저장 전 변경" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "설정 버전 선택" }), {
      target: { value: "draft_2" },
    });
    expect(screen.queryByRole("textbox", { name: "태그 이름" })).toBeNull();
    expect(screen.queryByRole("button", { name: "초안 저장" })).toBeNull();
    await act(async () => pending.resolve(second));
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "버전 이름" })
        .value,
    ).toBe("draft_2");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "태그 이름" })
        .value,
    ).toBe("고객 정보");
  });
});

describe("snapshot event navigation", () => {
  it("retains the snapshot page as navigation state without contaminating frozen search filters", () => {
    const event: SecurityEvent = {
      id: 7,
      sourceId: "demo",
      eventId: "demo_7",
      versionId: "v1",
      personId: "person_1",
      personName: "가상 사람",
      prompt: "가😀나",
      occurredAt: "2026-10-29T15:00:00Z",
      receivedAt: "2026-10-29T15:00:00Z",
      service: "chatgpt",
      model: null,
      policyStateId: null,
      policyStateName: null,
      detections: [],
      findingCount: 0,
    };
    function Harness() {
      const location = useLocation();
      return (
        <>
          <EventTable
            events={[event]}
            search="q=literal&versionId=v1"
            returnTo="/saved-searches/snapshot_1?page=2"
          />
          <output aria-label="이동 정보">
            {JSON.stringify({
              path: location.pathname,
              search: location.search,
              state: location.state,
            })}
          </output>
        </>
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "이벤트 7 상세 보기" }));
    expect(JSON.parse(screen.getByLabelText("이동 정보").textContent!)).toEqual(
      {
        path: "/events/7",
        search: "?q=literal&versionId=v1",
        state: { returnTo: "/saved-searches/snapshot_1?page=2" },
      },
    );
  });
});
