import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, ApiError } from "./api";
import { ConnectionSettings } from "./ConnectionSettings";
import { PersonEnrollment } from "./PersonEnrollment";
import { WorkspaceProvider } from "./ui";
import type { ConfigVersion, DetectorSettings } from "./types";

const settings: DetectorSettings = {
  reportText: "full", tagMap: { email: "email" }, tagAction: "mask", jevEnabled: true,
  policyStateMap: { allow: null, warn: null, block: null }, revision: 4, updatedAt: null,
};
const version: ConfigVersion = {
  id: "v1", name: "합성 설정", status: "PUBLISHED", isActive: true, revision: 1,
  createdAt: "2026-10-30T00:00:00Z", publishedAt: "2026-10-30T00:00:00Z",
  tags: [], jevPrompts: [], policyStates: [
    { id: "review", name: "검토", description: "", color: "#123456", order: 0 },
  ],
};
beforeEach(() => {
  vi.spyOn(api, "versions").mockResolvedValue([version]);
  vi.spyOn(api, "version").mockResolvedValue(version);
  vi.spyOn(api, "connectors").mockResolvedValue([]);
  vi.spyOn(api, "detectorSettings").mockResolvedValue(settings);
  vi.spyOn(api, "saveDetectorSettings").mockImplementation(async (input) => ({ ...input, updatedAt: null }));
});
afterEach(cleanup);
function mount() {
  render(<MemoryRouter><WorkspaceProvider><ConnectionSettings /></WorkspaceProvider></MemoryRouter>);
}

it("saves shared organization settings and policy mapping through the dashboard API", async () => {
  mount();
  await screen.findAllByRole("option", { name: "검토 (review)" });
  expect(screen.getByRole("radio", { name: /검사한 원문과/ }).matches(":checked")).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "warn 정책 상태" }), { target: { value: "review" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Jev 판정 사용/ }));
  fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
  await screen.findByText("저장했습니다. 연결된 검사 서버는 30초 안에 반영합니다.");
  expect(api.saveDetectorSettings).toHaveBeenCalledWith({
    reportText: "full", tagMap: { email: "email" }, tagAction: "mask", jevEnabled: false,
    policyStateMap: { allow: null, warn: "review", block: null }, revision: 4,
  });
  expect(screen.getByRole("link", { name: /실행 상태·규칙/ }).getAttribute("href")).toBe("/settings/guard");
});

it("keeps an edited policy mapping visible when the shared revision conflicts", async () => {
  vi.mocked(api.saveDetectorSettings).mockRejectedValue(new ApiError(409, {
    code: "REVISION_CONFLICT", message: "다른 변경이 저장되었습니다.",
  }));
  mount();
  await screen.findAllByRole("option", { name: "검토 (review)" });
  const mapping = screen.getByRole("combobox", { name: "warn 정책 상태" });
  fireEvent.change(mapping, { target: { value: "review" } });
  fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
  await screen.findByText(/다른 변경이 먼저 저장되었습니다/);
  expect((mapping as HTMLSelectElement).value).toBe("review");
});

it("issues a person's enrollment code from the dashboard with its server address", async () => {
  vi.spyOn(api, "createEnrollment").mockResolvedValue({
    code: "ABCD-2345", personId: "person-1", expiresAt: "2026-10-31T00:00:00Z",
    connectionInfo: "https://guard.example.org#ABCD-2345",
  });
  render(<PersonEnrollment personId="person-1" />);
  fireEvent.click(screen.getByRole("button", { name: "연결 코드 발급" }));
  await screen.findByText("https://guard.example.org#ABCD-2345");
  await waitFor(() => expect(api.createEnrollment).toHaveBeenCalledWith("person-1"));
});
