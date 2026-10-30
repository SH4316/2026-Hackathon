import { Link } from "react-router-dom";
import { guardApi, type GuardRuntime } from "./guard";
import { useResource } from "./hooks";
import { ErrorState } from "./ui";
import { SkippedRegexWarning } from "./SkippedRegex";

export function ModelWarning({ runtime }: { runtime: GuardRuntime }) {
  const message =
    runtime.model_status === "endpoint_unset"
      ? "모델 엔드포인트가 설정되지 않아 Jev 기능이 비활성화되었습니다"
      : runtime.model_status === "disabled"
        ? "모델이 비활성화되어 Jev 기능을 사용할 수 없습니다."
        : runtime.model_status === "unavailable"
          ? "모델에 연결할 수 없어 Jev 기능을 사용할 수 없습니다."
          : null;
  return message ? (
    <div className="guard-warning" role="alert">
      {message} <Link to="/settings/guard">검사 서버 관리</Link>
    </div>
  ) : null;
}
export function GuardBanner() {
  const resource = useResource((signal) => guardApi.runtime(signal), []);
  return (
    <>
      <SkippedRegexWarning refreshKey={resource.updatedAt} />
      {resource.error ? (
        <div className="guard-banner">
          <ErrorState message={resource.error} retry={resource.refresh} />
        </div>
      ) : resource.data ? (
        <ModelWarning runtime={resource.data.data} />
      ) : null}
    </>
  );
}
