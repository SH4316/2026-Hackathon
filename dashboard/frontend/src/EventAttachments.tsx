import { useEffect, useState } from "react";
import { api } from "./api";
import { useResource } from "./hooks";
import type { DetectorImage } from "./types";
import { ErrorState, LoadingState, Panel } from "./ui";

export function EventAttachments({ eventId }: { eventId: number }) {
  const resource = useResource(
    (signal) => api.detectorEvent(eventId, signal),
    [eventId],
  );
  return (
    <Panel
      className="attachment-panel"
      title="첨부 파일"
      description="수집된 파일 이름과 이미지 원본입니다. 이미지 외 파일은 이름만 수집합니다."
    >
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : !resource.data ? (
        <LoadingState />
      ) : (
        <>
          {!!resource.data.files.length && (
            <ul className="attachment-files">
              {resource.data.files.map((file, index) => (
                <li key={index}>{file.name}</li>
              ))}
            </ul>
          )}
          <div className="attachment-images">
            {resource.data.images.map((image) => (
              <ImageAttachment
                key={`${eventId}-${image.id}`}
                eventId={eventId}
                image={image}
              />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
function ImageAttachment({
  eventId,
  image,
}: {
  eventId: number;
  image: DetectorImage;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const downloadPath = `/api/v1/events/${eventId}/attachments/images/${image.id}`;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    async function load() {
      try {
        const response = await fetch(downloadPath, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("이미지를 불러오지 못했습니다.");
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        // Downloads deliberately use octet-stream; restore the collected MIME for previews.
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: image.media_type }),
        );
        setUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted)
          setError("이미지 미리보기를 불러오지 못했습니다.");
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [downloadPath, image.media_type, revision]);
  return (
    <figure className="attachment-image">
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            className="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            다시 시도
          </button>
        </div>
      ) : url ? (
        <img
          src={url}
          alt={image.name}
          loading="lazy"
          onError={() =>
            setError(
              "지원하지 않거나 손상된 이미지입니다. 원본을 다운로드해 확인해 주세요.",
            )
          }
        />
      ) : (
        <p role="status">이미지 불러오는 중…</p>
      )}
      <figcaption>
        <strong>{image.name}</strong>
        <span>
          {image.media_type} · {Math.ceil(image.size_bytes / 1024)} KB
        </span>
        <a className="text-link" href={downloadPath} download={image.name}>
          원본 다운로드
        </a>
      </figcaption>
    </figure>
  );
}
