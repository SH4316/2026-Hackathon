import { Link } from "react-router-dom";
import { api } from "./api";
import { guardApi } from "./guard";
import { useResource } from "./hooks";
import { ErrorState } from "./ui";
import type { Tag } from "./types";

export function regexReason(reason: string): string {
  return (
    {
      too_long: "정규식은 최대 4,000자입니다.",
      nested_quantifier: "중첩된 반복 수량자는 사용할 수 없습니다.",
      syntax_error: "Python 정규식 문법이 올바르지 않습니다.",
      matches_empty: "빈 문자열과 일치하는 정규식은 사용할 수 없습니다.",
    }[reason] ?? `검사 서버가 규칙을 건너뛰었습니다. (${reason})`
  );
}

export function useSkippedRegex(refreshKey: unknown = null) {
  return useResource(async (signal) => {
    const { data: status } = await guardApi.orgStatus(signal);
    let tags: Tag[] = [];
    let namesUnavailable = false;
    if (status.version_id && Object.keys(status.skipped_regex ?? {}).length) {
      try {
        tags = (await api.version(status.version_id, signal)).tags;
      } catch (error) {
        if (signal.aborted) throw error;
        namesUnavailable = true;
      }
    }
    return { status, tags, namesUnavailable };
  }, [refreshKey]);
}

export function SkippedRegexWarning({ refreshKey }: { refreshKey?: unknown }) {
  const resource = useSkippedRegex(refreshKey);
  if (resource.error)
    return <ErrorState message={resource.error} retry={resource.refresh} />;
  const skipped = Object.entries(resource.data?.status.skipped_regex ?? {});
  if (!skipped.length) return null;
  return (
    <div className="guard-warning" role="alert">
      <strong>건너뛴 태그 정규식 {skipped.length}개</strong>
      <p>다음 규칙은 검사에 사용되지 않습니다.</p>
      <ul>
        {skipped.map(([id, reason]) => (
          <li key={id}>
            <Link
              to={`/settings/metrics?versionId=${encodeURIComponent(resource.data!.status.version_id ?? "")}&tagId=${encodeURIComponent(id)}`}
            >
              {resource.data?.tags.find((tag) => tag.id === id)?.name ?? id}
            </Link>
            {" · "}
            {regexReason(reason)}
          </li>
        ))}
      </ul>
      {resource.data?.namesUnavailable && (
        <small>태그 이름을 불러오지 못해 태그 ID를 표시합니다.</small>
      )}
    </div>
  );
}
