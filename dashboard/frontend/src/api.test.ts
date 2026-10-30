import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, buildQuery } from "./api";

const emptyPage = {
  items: [],
  page: 0,
  size: 20,
  totalElements: 0,
  totalPages: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe("V2 query contract", () => {
  it("preserves literal prompt searches and all dynamic filters", () => {
    const params = new URLSearchParams(
      buildQuery(
        {
          from: "2026-10-23T15:00:00.000Z",
          to: "2026-10-30T15:00:00.000Z",
          versionId: "version_2",
          service: "custom-service",
          personId: "member_1",
          tagId: "custom_tag",
          policyStateId: "custom_policy",
          q: "  홍_% & 길동  ",
          hasDetections: "false",
          interval: "hour",
        },
        { page: 0, size: 20 },
      ),
    );
    expect(params.get("q")).toBe("  홍_% & 길동  ");
    expect(params.get("versionId")).toBe("version_2");
    expect(params.get("tagId")).toBe("custom_tag");
    expect(params.get("policyStateId")).toBe("custom_policy");
    expect(params.get("hasDetections")).toBe("false");
    expect(params.get("page")).toBe("0");
    expect(params.get("from")).toBe("2026-10-23T15:00:00.000Z");
    expect(buildQuery({ service: "", q: "" })).toBe("");
    expect(
      new URLSearchParams(buildQuery({ unmapped: "true" })).get("unmapped"),
    ).toBe("true");
  });

  it("separates personQuery from prompt q and forwards cancellation", async () => {
    const response = { ...emptyPage, page: 2 };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    expect(
      await api.people(
        { tagId: "tag_1", q: "API_KEY_%" },
        "kim",
        2,
        controller.signal,
      ),
    ).toEqual(response);
    const [url, options] = fetchMock.mock.calls[0];
    const params = new URL(url, "https://local.test").searchParams;
    expect(params.get("q")).toBe("API_KEY_%");
    expect(params.get("personQuery")).toBe("kim");
    expect(params.get("tagId")).toBe("tag_1");
    expect(params.get("page")).toBe("2");
    expect(options.signal).toBe(controller.signal);
  });

  it("keeps event pagination independent from interpretation and detection filters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(emptyPage)));
    vi.stubGlobal("fetch", fetchMock);
    await api.events(
      {
        versionId: "published_1",
        personId: "EMP-001",
        policyStateId: "private",
        hasDetections: "true",
      },
      3,
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/events?versionId=published_1&personId=EMP-001&policyStateId=private&hasDetections=true&page=3&size=20",
    );
  });
});

describe("configuration version lifecycle", () => {
  it("sends revision-checked draft edits and publish while preserving logical IDs", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      revision: 4,
      name: "새 태그 카탈로그",
      tags: [
        {
          id: "tag_stable",
          parentId: null,
          name: "고객 자료",
          color: "#9D174D",
          description: "",
          examples: ["김가상"],
          guidance: "이름을 찾습니다.",
          order: 0,
        },
      ],
      policyStates: [
        {
          id: "policy_stable",
          name: "사내 설정",
          color: "#166534",
          description: "",
          order: 0,
        },
      ],
    };
    await api.createVersion({ name: "복제본", baseVersionId: "published_1" });
    await api.saveVersion("draft_1", input);
    await api.publishVersion("draft_1", 5);
    await api.activateVersion("draft_1");
    expect(
      fetchMock.mock.calls.map(([url, options]) => [
        url,
        options.method,
        options.body && JSON.parse(options.body),
      ]),
    ).toEqual([
      [
        "/api/v1/config-versions",
        "POST",
        { name: "복제본", baseVersionId: "published_1" },
      ],
      ["/api/v1/config-versions/draft_1", "PUT", input],
      ["/api/v1/config-versions/draft_1/publish", "POST", { revision: 5 }],
      ["/api/v1/config-versions/draft_1/activate", "POST", undefined],
    ]);
    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  it("accepts empty 204 delete responses without attempting JSON parsing", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.deleteVersion("draft_1")).resolves.toBeUndefined();
    await expect(api.deleteSavedSearch("snapshot_1")).resolves.toBeUndefined();
    expect(
      fetchMock.mock.calls.map(([url, options]) => [url, options.method]),
    ).toEqual([
      ["/api/v1/config-versions/draft_1", "DELETE"],
      ["/api/v1/saved-searches/snapshot_1", "DELETE"],
    ]);
  });

  it("forwards cancellation to version, classifier and saved-search reads", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await api.versions(signal);
    await api.version("a/b", signal);
    await api.classifierConfig(signal);
    await api.savedSearches(signal);
    await api.savedSearch("search_1", signal);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/config-versions",
      "/api/v1/config-versions/a%2Fb",
      "/api/v1/classifier-config",
      "/api/v1/saved-searches",
      "/api/v1/saved-searches/search_1",
    ]);
    expect(
      fetchMock.mock.calls.every(([, options]) => options.signal === signal),
    ).toBe(true);
  });
});

describe("immutable saved-search snapshots", () => {
  it("saves the full filter set, then reads frozen membership using only its ID and page", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    const filters = {
      from: "2026-10-22T15:00:00Z",
      to: "2026-10-29T15:00:00Z",
      versionId: "published_1",
      q: "%_literal",
      tagId: "tag_1",
    };
    await api.saveSearch({ name: "이번 주 점검", filters });
    const signal = new AbortController().signal;
    await api.snapshotEvents("snapshot_1", 3, signal);
    await api.snapshotMetrics("snapshot_1", signal);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: "이번 주 점검",
      filters,
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/v1/saved-searches/snapshot_1/events?page=3&size=20",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "/api/v1/saved-searches/snapshot_1/metrics",
    );
    expect(fetchMock.mock.calls[1][1].signal).toBe(signal);
    expect(fetchMock.mock.calls[2][1].signal).toBe(signal);
  });
});

describe("response and error handling", () => {
  it("preserves cancellation during response body reading", async () => {
    const controller = new AbortController();
    const cancellation = new DOMException("Aborted", "AbortError");
    const response = {
      ok: true,
      status: 200,
      json: () => {
        controller.abort();
        return Promise.reject(cancellation);
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(api.metrics({}, controller.signal)).rejects.toBe(cancellation);
  });

  it("posts person registration as JSON", async () => {
    const person = { id: "kim_1", name: "김민지" };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ...person,
            eventCount: 0,
            findingCount: 0,
            lastEventAt: null,
          }),
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await api.createPerson(person);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/people",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(person),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("surfaces revision errors and safely handles non-JSON proxy failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "REVISION_CONFLICT",
            message: "다른 변경이 저장되었습니다.",
            fieldErrors: { revision: "새로 불러와 주세요." },
          }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("<html>Unavailable</html>", { status: 502 }),
      )
      .mockResolvedValueOnce(new Response("null", { status: 500 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.publishVersion("draft_1", 2)).rejects.toMatchObject({
      status: 409,
      code: "REVISION_CONFLICT",
      message: "다른 변경이 저장되었습니다.",
      fieldErrors: { revision: "새로 불러와 주세요." },
    });
    await expect(api.metrics()).rejects.toBeInstanceOf(ApiError);
    await expect(api.events()).rejects.toMatchObject({
      status: 500,
      code: "REQUEST_FAILED",
    });
    await expect(api.versions()).rejects.toMatchObject({
      status: 200,
      code: "INVALID_RESPONSE",
    });
  });
});
