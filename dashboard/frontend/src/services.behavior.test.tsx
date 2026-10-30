import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import App from "./App";
import { api } from "./api";
import { ServiceChart } from "./charts";
import { KNOWN_SERVICES } from "./format";
import { SearchFilters, ServiceLabel, useDashboardFilters } from "./ui";
import type { Metrics, VersionSummary } from "./types";

vi.mock("./GuardBanner", () => ({ GuardBanner: () => null }));
vi.mock("./charts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./charts")>(),
  Trend: () => null,
}));

afterEach(cleanup);

const version: VersionSummary = {
  id: "v1", name: "테스트 버전", status: "PUBLISHED", isActive: true,
  revision: 1, createdAt: "2026-10-29T15:00:00Z", publishedAt: "2026-10-29T15:00:00Z",
};

function metrics(services: Metrics["services"] = []): Metrics {
  return {
    versionId: "v1",
    summary: { eventCount: 0, findingCount: 0, personCount: 0, detectedEventCount: 0 },
    series: [], tags: [], unmapped: { count: 0, eventCount: 0 }, policies: [], services,
  };
}

function chartServices(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>(".service-bar-row"))
    .map((row) => new URL(row.href).searchParams.get("service")!);
}

const href = (service: string) => `/events?service=${service}`;

describe("service catalog search and display", () => {
  it("shows labeled provider suggestions and submits a service outside the catalog", () => {
    function Harness() {
      const state = useDashboardFilters();
      const location = useLocation();
      return <>
        <SearchFilters state={state} />
        <output aria-label="검색 URL">{location.search}</output>
      </>;
    }
    const { container } = render(<MemoryRouter><Harness /></MemoryRouter>);
    const input = screen.getByRole<HTMLInputElement>("combobox", { name: "AI 서비스" });
    const suggestions = container.querySelector<HTMLDataListElement>(`#${input.list!.id}`)!;
    expect(Array.from(suggestions.options, ({ value, label }) => ({ id: value, label })))
      .toEqual(KNOWN_SERVICES);
    fireEvent.change(input, { target: { value: " INTERNAL-AI " } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    expect(new URLSearchParams(screen.getByLabelText("검색 URL").textContent!).get("service"))
      .toBe("internal-ai");
  });

  it.each([
    ...KNOWN_SERVICES,
    { id: "chatgpt", label: "ChatGPT" },
    { id: "claude", label: "Claude" },
    { id: "gemini", label: "Gemini" },
    { id: "internal-ai", label: "internal-ai" },
    { id: "custom-provider", label: "custom-provider" },
  ])("displays $id as $label", ({ id, label }) => {
    render(<ServiceLabel service={id} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("service chart", () => {
  it("shows all known services at zero when no events or service filter exist", () => {
    const { container } = render(<MemoryRouter>
      <ServiceChart metrics={metrics()} href={href} />
    </MemoryRouter>);
    expect(chartServices(container)).toEqual(KNOWN_SERVICES.map(({ id }) => id));
    expect(screen.getAllByText("분석 Prompt 0건")).toHaveLength(11);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".service-track span"), (bar) => bar.style.width))
      .toEqual(Array(11).fill("0%"));
  });

  it("keeps recorded services first, preserves ties, and adds only missing providers without changing counts", () => {
    const data = metrics([
      { service: "anthropic", eventCount: 1, findingCount: 3 },
      { service: "internal-ai", eventCount: 4, findingCount: 0 },
      { service: "openai", eventCount: 4, findingCount: 2 },
      { service: "chatgpt", eventCount: 1, findingCount: 1 },
    ]);
    const before = structuredClone(data);
    const { container } = render(<MemoryRouter>
      <ServiceChart metrics={data} href={href} />
    </MemoryRouter>);
    expect(chartServices(container)).toEqual([
      "internal-ai", "openai", "anthropic", "chatgpt",
      ...KNOWN_SERVICES.filter(({ id }) => id !== "openai" && id !== "anthropic").map(({ id }) => id),
    ]);
    const internal = screen.getByRole("link", { name: /internal-ai/ });
    expect(within(internal).getByText("분석 Prompt 4건")).toBeTruthy();
    expect(internal.querySelector("strong")!.textContent).toBe("0개");
    const claude = screen.getByRole("link", { name: /Claude/ });
    expect(claude.querySelector("strong")!.textContent).toBe("3개");
    expect(claude.querySelector<HTMLElement>(".service-track span")!.style.width).toBe("100%");
    expect(data).toEqual(before);
  });

  it.each(["openai", "chatgpt", "internal-ai"])("does not pad filtered results for %s", (service) => {
    const data = metrics([{ service, eventCount: 2, findingCount: 1 }]);
    const { container } = render(<MemoryRouter>
      <ServiceChart metrics={data} serviceFilter={service} href={href} />
    </MemoryRouter>);
    expect(chartServices(container)).toEqual([service]);
    expect(screen.getByText("분석 Prompt 2건")).toBeTruthy();
  });

  it("keeps the empty state for a filter without results", () => {
    render(<ServiceChart metrics={metrics()} serviceFilter="internal-ai" />);
    expect(screen.getByText("아직 기록된 서비스가 없습니다.")).toBeTruthy();
    expect(screen.queryByText("ChatGPT")).toBeNull();
  });

  it.each([undefined, "openai"])("uses the overview URL's service filter (%s) and preserves summary totals", async (service) => {
    const data = metrics([{ service: "openai", eventCount: 2, findingCount: 3 }]);
    data.summary = { eventCount: 2, findingCount: 3, personCount: 1, detectedEventCount: 2 };
    const before = structuredClone(data);
    vi.spyOn(api, "versions").mockResolvedValue([version]);
    const fetchMetrics = vi.spyOn(api, "metrics").mockResolvedValue(data);
    const { container } = render(<MemoryRouter initialEntries={[`/?versionId=v1${service ? `&service=${service}` : ""}`]}>
      <App />
    </MemoryRouter>);
    await waitFor(() => expect(container.querySelectorAll(".service-bar-row")).toHaveLength(service ? 1 : 11));
    expect(chartServices(container)).toEqual(service ? ["openai"] : KNOWN_SERVICES.map(({ id }) => id));
    expect(fetchMetrics).toHaveBeenCalledWith(expect.objectContaining({ service }), expect.any(AbortSignal));
    const summary = screen.getByRole("region", { name: "조회 기간 요약" });
    expect(Array.from(summary.querySelectorAll(".stat-value"), (value) => value.textContent))
      .toEqual(["2건", "3개", "2건", "1명"]);
    expect(data).toEqual(before);
  });
});
