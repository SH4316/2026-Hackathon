import { describe, expect, it } from "vitest";
import { normalizeServiceFilter, personDetailHref } from "./query";

describe("person detail navigation", () => {
  it("preserves prompt and dynamic event filters while clearing the previous person list context", () => {
    const input = new URLSearchParams({
      from: "2026-10-01",
      to: "2026-10-30",
      service: "claude",
      versionId: "version_2",
      tagId: "custom_tag",
      policyStateId: "custom_policy",
      q: "literal_%",
      hasDetections: "false",
      interval: "hour",
      page: "2",
      personQuery: "김민지",
      personId: "different-person",
    });
    const url = new URL(
      personDetailHref("EMP-001", input),
      "https://local.test",
    );
    expect(url.pathname).toBe("/people/EMP-001");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-10-01",
      to: "2026-10-30",
      service: "claude",
      versionId: "version_2",
      tagId: "custom_tag",
      policyStateId: "custom_policy",
      q: "literal_%",
      hasDetections: "false",
      interval: "hour",
    });
    expect(input.get("page")).toBe("2");
    expect(input.get("personId")).toBe("different-person");
  });

  it("accepts location search, preserves unmapped, and omits empty query delimiters", () => {
    expect(
      personDetailHref("person_1", "?page=3&personQuery=kim&personId=old"),
    ).toBe("/people/person_1");
    expect(
      personDetailHref("person/1", "?q=literal&unmapped=true&page=1"),
    ).toBe("/people/person%2F1?q=literal&unmapped=true");
  });
});

describe("service query validation", () => {
  it("matches backend trimming, lowercasing and custom slugs", () => {
    expect(normalizeServiceFilter(" ChatGPT ")).toBe("chatgpt");
    expect(normalizeServiceFilter("CUSTOM-service_1")).toBe("custom-service_1");
    expect(normalizeServiceFilter(" ")).toBeUndefined();
    expect(normalizeServiceFilter(null)).toBeUndefined();
  });

  it("rejects unsupported characters and more than 64 normalized characters", () => {
    expect(() => normalizeServiceFilter("my service")).toThrow("서비스는");
    expect(() => normalizeServiceFilter("https://chatgpt.com")).toThrow(
      "서비스는",
    );
    expect(() => normalizeServiceFilter("a".repeat(65))).toThrow("서비스는");
    expect(normalizeServiceFilter("a".repeat(64))).toHaveLength(64);
  });
});
