import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "./api";
import { EventAttachments } from "./EventAttachments";
import { EventTable } from "./ui";
import type { SecurityEvent } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("send actions and attachments", () => {
  it("shows forced-send and attachment badges and links an empty prompt", () => {
    const event: SecurityEvent = {
      id: 9,
      sourceId: "demo",
      eventId: "demo",
      versionId: "demo",
      receivedAt: "2026-10-30T00:00:00Z",
      model: null,
      policyStateId: null,
      policyStateName: null,
      prompt: "",
      sendAction: "forced",
      fileCount: 2,
      imageCount: 1,
      detections: [],
      findingCount: 0,
      personId: "demo",
      personName: "데모",
      service: "openai",
      occurredAt: "2026-10-30T00:00:00Z",
    };
    render(
      <MemoryRouter>
        <EventTable events={[event]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("강행 전송")).toBeTruthy();
    expect(screen.getByText("파일 2개")).toBeTruthy();
    expect(screen.getByText("이미지 1개")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "첨부 파일 전송" }).getAttribute("href"),
    ).toBe("/events/9");
  });
  it("loads file names, restores preview MIME, exposes downloads and revokes blobs", async () => {
    vi.spyOn(api, "detectorEvent").mockResolvedValue({
      files: [{ name: "보고서.docx" }],
      images: [
        {
          id: 3,
          name: "원본.png",
          media_type: "image/png",
          size_bytes: 6,
          download_path: "/api/v1/detector-events/9/images/3",
        },
      ],
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const create = vi.fn().mockReturnValue("blob:preview-demo");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revoke,
    });
    const view = render(<EventAttachments eventId={9} />);
    await screen.findByText("보고서.docx");
    expect(
      (await screen.findByRole("img", { name: "원본.png" })).getAttribute(
        "src",
      ),
    ).toBe("blob:preview-demo");
    expect(create.mock.calls[0][0].type).toBe("image/png");
    expect(
      screen
        .getByRole("link", { name: "원본 다운로드" })
        .getAttribute("download"),
    ).toBe("원본.png");
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/detector-events/9/images/3");
    fireEvent.error(screen.getByRole("img"));
    await screen.findByText(/지원하지 않거나 손상된 이미지/);
    expect(screen.getByRole("link", { name: "원본 다운로드" })).toBeTruthy();
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:preview-demo");
  });
});
