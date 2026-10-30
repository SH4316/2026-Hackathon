import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createId,
  dateRangeToFilters,
  descendantIds,
  flattenTree,
  formatDateTime,
  formatNumber,
  getDefaultDateRange,
  highlightSegments,
} from "./format";
import type { Detection, Tag } from "./types";

afterEach(() => vi.unstubAllGlobals());

describe("Seoul calendar ranges", () => {
  it("includes Seoul today when UTC is still the preceding date", () => {
    expect(getDefaultDateRange(new Date("2026-10-29T15:00:00Z"))).toEqual({
      from: "2026-10-24",
      to: "2026-10-30",
    });
    expect(getDefaultDateRange(new Date("2026-10-29T14:59:59Z"))).toEqual({
      from: "2026-10-23",
      to: "2026-10-29",
    });
  });

  it("uses inclusive local dates and an exclusive UTC end across a leap day", () => {
    expect(
      dateRangeToFilters({ from: "2024-02-28", to: "2024-02-29" }),
    ).toEqual({
      from: "2024-02-27T15:00:00.000Z",
      to: "2024-02-29T15:00:00.000Z",
    });
    expect(
      dateRangeToFilters({ from: "2026-12-31", to: "2026-12-31" }),
    ).toEqual({
      from: "2026-12-30T15:00:00.000Z",
      to: "2026-12-31T15:00:00.000Z",
    });
  });

  it("rejects impossible, partial, reversed and overlong dates", () => {
    for (const range of [
      { from: "2026-02-29", to: "2026-03-01" },
      { from: "", to: "2026-10-30" },
      { from: "2026-10-30", to: "2026-10-29" },
      { from: "2025-01-01", to: "2026-01-02" },
    ])
      expect(() => dateRangeToFilters(range)).toThrow();
    expect(() =>
      dateRangeToFilters({ from: "2024-01-01", to: "2024-12-31" }),
    ).not.toThrow();
  });
});

describe("Korean display formatting", () => {
  it("uses count grouping and a fixed Seoul timezone", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatDateTime("2026-10-29T15:05:00Z")).toContain("2026. 10. 30.");
    expect(formatDateTime("2026-10-29T15:05:00Z")).toContain("00:05");
    expect(formatDateTime(null)).toBe("기록 없음");
  });
});

function tag(id: string, parentId: string | null = null, order = 0): Tag {
  return {
    id,
    name: id,
    parentId,
    order,
    color: "#1D4ED8",
    description: "",
    examples: [],
    guidance: "",
    jevThreshold: null,
    pythonRegex: "",
  };
}

function detection(
  id: number,
  start: number,
  end: number,
  text: string,
  tagIds = ["tag_1"],
): Detection {
  return {
    id,
    start,
    end,
    text,
    tags: tagIds.map((id) => ({ id, name: id, color: "#1D4ED8" })),
  };
}

describe("dynamic tag trees", () => {
  it("keeps equal-order siblings in ASCII ID order when mutable names change", () => {
    const tags = [
      { ...tag("a"), name: "가" },
      { ...tag("_"), name: "나" },
      { ...tag("A"), name: "다" },
      { ...tag("z", "A"), name: "가" },
      { ...tag("_child", "A"), name: "나" },
      { ...tag("Z", "A"), name: "다" },
      { ...tag("later", "A", 1), name: "가" },
    ];
    const structure = (items: Tag[]) =>
      flattenTree(items).map(({ id, parentId, order, depth }) => ({
        id, parentId, order, depth,
      }));
    const before = structure(tags);
    expect(before).toEqual([
      { id: "A", parentId: null, order: 0, depth: 0 },
      { id: "Z", parentId: "A", order: 0, depth: 1 },
      { id: "_child", parentId: "A", order: 0, depth: 1 },
      { id: "z", parentId: "A", order: 0, depth: 1 },
      { id: "later", parentId: "A", order: 1, depth: 1 },
      { id: "_", parentId: null, order: 0, depth: 0 },
      { id: "a", parentId: null, order: 0, depth: 0 },
    ]);

    const renamed = tags.map((item) => ({
      ...item,
      name: item.name === "가" ? "힣" : item.name === "다" ? "A" : "가",
    }));
    expect(structure(renamed)).toEqual(before);
    expect(flattenTree(renamed).find(({ id }) => id === "A")?.name).toBe("A");
  });

  it("flattens sibling order and depth without changing catalog objects", () => {
    const tags = [
      tag("child", "root"),
      tag("last", null, 1),
      tag("root"),
      tag("grandchild", "child"),
    ];
    const flattened = flattenTree(tags);
    expect(flattened.map(({ id, depth }) => [id, depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
      ["last", 0],
    ]);
    expect(tags[0]).not.toHaveProperty("depth");
    expect(descendantIds(tags, "root")).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
    expect(descendantIds(tags, "last")).toEqual(["last"]);
    expect(descendantIds(tags, "missing")).toEqual([]);
  });

  it("keeps transient orphan or cyclic editor states visible and terminates traversal", () => {
    const tags = [
      tag("orphan", "missing"),
      tag("a", "b"),
      tag("b", "a"),
      tag("self", "self"),
    ];
    expect(new Set(flattenTree(tags).map(({ id }) => id))).toEqual(
      new Set(["orphan", "a", "b", "self"]),
    );
    expect(flattenTree(tags)).toHaveLength(4);
    expect(descendantIds(tags, "a")).toEqual(["a", "b"]);
    expect(descendantIds(tags, "self")).toEqual(["self"]);
    expect(flattenTree([])).toEqual([]);
  });
});

describe("Unicode prompt highlights", () => {
  it("uses code-point offsets to mark the second repeated emoji without splitting surrogates", () => {
    const segments = highlightSegments("가😀나😀다", [
      detection(1, 3, 4, "😀"),
    ]);
    expect(
      segments.map(({ text, detections }) => [
        text,
        detections.map(({ id }) => id),
      ]),
    ).toEqual([
      ["가😀나", []],
      ["😀", [1]],
      ["다", []],
    ]);
    expect(segments[1]).toMatchObject({ start: 3, end: 4 });
    expect(segments.map(({ text }) => text).join("")).toBe("가😀나😀다");
  });

  it("splits overlaps and unions tags without losing either detection", () => {
    const first = detection(1, 1, 4, "😀BC", ["name", "shared"]);
    const second = detection(2, 3, 5, "C😀", ["shared", "phone"]);
    const segments = highlightSegments("A😀BC😀D", [first, second]);
    expect(
      segments.map(({ text, detections }) => [
        text,
        detections.map(({ id }) => id),
      ]),
    ).toEqual([
      ["A", []],
      ["😀B", [1]],
      ["C", [1, 2]],
      ["😀", [2]],
      ["D", []],
    ]);
    expect(segments[2].tags.map(({ id }) => id)).toEqual([
      "name",
      "shared",
      "phone",
    ]);
    expect(segments[2].detections).toEqual([first, second]);
  });

  it("keeps adjacent intervals separate and supports multiple detections at the same interval", () => {
    const segments = highlightSegments("반복반복", [
      detection(1, 0, 2, "반복", ["tag_a"]),
      detection(2, 0, 2, "반복", ["tag_b"]),
      detection(3, 2, 4, "반복", ["tag_a"]),
    ]);
    expect(
      segments.map(({ text, detections }) => [
        text,
        detections.map(({ id }) => id),
      ]),
    ).toEqual([
      ["반복", [1, 2]],
      ["반복", [3]],
    ]);
    expect(segments[0].tags.map(({ id }) => id)).toEqual(["tag_a", "tag_b"]);
  });

  it("preserves combining marks, whitespace and ZWJ sequences without normalization", () => {
    const prompt = " e\u0301 👩‍💻\n";
    const segments = highlightSegments(prompt, [detection(1, 4, 7, "👩‍💻")]);
    expect(segments.map(({ text }) => text)).toEqual([" e\u0301 ", "👩‍💻", "\n"]);
    expect(segments.map(({ text }) => text).join("")).toBe(prompt);
  });

  it("leaves unrecognized or invalid spans unmarked and preserves the complete prompt", () => {
    const segments = highlightSegments("가😀나", [
      detection(1, -1, 1, "가"),
      detection(2, 1, 4, "😀나"),
      detection(3, 1.5, 2, "😀"),
      detection(4, 1, 1, ""),
      detection(5, 1, 2, "다른 문자열"),
    ]);
    expect(segments).toEqual([
      { start: 0, end: 3, text: "가😀나", detections: [], tags: [] },
    ]);
    expect(highlightSegments("", [])).toEqual([]);
    expect(
      highlightSegments("검출 없음", [])
        .map(({ text }) => text)
        .join(""),
    ).toBe("검출 없음");
  });
});

describe("client-generated stable IDs", () => {
  it("works on insecure LAN origins where only getRandomValues is available", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(17),
    });
    expect(createId("tag")).toBe(`tag_${"11".repeat(16)}`);
  });

  it("retains uniqueness and contract-safe characters without any crypto API", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Date, "now").mockReturnValue(1793318400000);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const ids = [
      createId("policy"),
      createId("policy"),
      createId("긴 prefix /".repeat(20)),
    ];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
  });
});
