import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "./api";
import { useResource } from "./hooks";
import { formatDateTime, formatNumber } from "./format";
import {
  Icon,
  PageTitle,
  RefreshButton,
  Panel,
  EmptyState,
  ErrorState,
  LoadingState,
  EventTable,
  Pagination,
  StatStrip,
  filterQuery,
  useWorkspace,
} from "./ui";
import { Trend, MetricTree } from "./charts";

export function SavedSearches() {
  const r = useResource((signal) => api.savedSearches(signal), []);
  const ws = useWorkspace();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  async function remove(id: string) {
    if (
      !window.confirm(
        "저장된 검색을 삭제할까요? 원본 Prompt와 이벤트는 유지됩니다.",
      )
    )
      return;
    setPending(id);
    try {
      await api.deleteSavedSearch(id);
      r.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
    } finally {
      setPending("");
    }
  }
  return (
    <>
      <PageTitle
        title="저장된 검색"
        description="검색 조건과 저장 시점의 결과를 함께 보관합니다."
        action={<RefreshButton {...r} />}
      />
      <div className="snapshot-explanation">
        <Icon name="lock" size={18} />
        <p>
          저장된 결과는 고정됩니다. 새 기록을 포함하려면{" "}
          <strong>현재 데이터로 다시 조회</strong>하세요.
        </p>
      </div>
      {error && <ErrorState message={error} />}{" "}
      {r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : !r.data ? (
        <LoadingState />
      ) : !r.data.length ? (
        <Panel title="저장된 검색 결과">
          <EmptyState
            icon="save"
            title="아직 저장된 검색이 없습니다"
            description="탐지 이력에서 검색 조건을 적용한 뒤 결과 저장을 눌러 보세요."
            action={
              <Link className="button button-primary" to="/events">
                탐지 이력에서 검색
                <Icon name="arrow" size={15} />
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="saved-grid">
          {r.data.map((s) => (
            <article className="saved-card" key={s.id}>
              <div className="saved-card-heading">
                <span className="saved-icon">
                  <Icon name="save" size={19} />
                </span>
                <button
                  className="icon-button"
                  disabled={!!pending}
                  aria-label={s.name + " 삭제"}
                  onClick={() => remove(s.id)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
              <Link to={"/saved-searches/" + s.id} className="saved-card-title">
                {s.name}
                <Icon name="chevron" size={17} />
              </Link>
              <span className="saved-version">
                <Icon name="tree" size={13} />
                {ws.versions.find((v) => v.id === s.versionId)?.name ||
                  s.versionId}
              </span>
              <div className="saved-counts">
                <span>
                  <strong>{formatNumber(s.eventCount)}</strong> Prompt
                </span>
                <span>
                  <strong>{formatNumber(s.findingCount)}</strong> 감지 영역
                </span>
              </div>
              <div className="saved-card-bottom">
                <span>{formatDateTime(s.createdAt)} 저장</span>
                <Link
                  className="text-link"
                  to={"/events?" + filterQuery(s.filters)}
                >
                  다시 조회
                  <Icon name="arrow" size={13} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function SavedSearchDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("page"));
  const page = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
  const ws = useWorkspace();
  const navigate = useNavigate();
  const r = useResource(
    async (signal) => {
      const [saved, metrics, events] = await Promise.all([
        api.savedSearch(id, signal),
        api.snapshotMetrics(id, signal),
        api.snapshotEvents(id, page, signal),
      ]);
      return { saved, metrics, events };
    },
    [id, page],
  );
  return (
    <>
      <Link className="back-link" to="/saved-searches">
        <Icon name="back" size={15} />
        저장된 검색
      </Link>
      <PageTitle
        title={r.data?.saved.name || "저장된 검색 결과"}
        description={
          r.data
            ? formatDateTime(r.data.saved.createdAt) +
              "에 저장한 고정된 결과입니다."
            : "저장된 결과를 불러옵니다."
        }
        action={
          r.data && (
            <button
              className="button button-primary"
              onClick={() =>
                navigate("/events?" + filterQuery(r.data!.saved.filters))
              }
            >
              <Icon name="refresh" size={16} />
              현재 데이터로 다시 조회
            </button>
          )
        }
      />
      {r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : !r.data ? (
        <LoadingState />
      ) : (
        <div className="dashboard-content">
          <div className="snapshot-explanation">
            <Icon name="lock" size={17} />
            <p>
              <strong>
                {ws.versions.find((v) => v.id === r.data!.saved.versionId)
                  ?.name || "저장된 트리 버전"}
              </strong>{" "}
              · 저장 후 추가된 이벤트와 활성 버전 변경은 반영되지 않습니다.
            </p>
          </div>
          <StatStrip metrics={r.data.metrics} />
          <Panel title="저장된 시계열 탐지량">
            <Trend
              metrics={r.data.metrics}
              interval={r.data.saved.filters.interval}
            />
          </Panel>
          <Panel
            title="저장 당시 트리 집계"
            description="항목을 선택하면 같은 조건으로 현재 데이터를 검색합니다."
          >
            <MetricTree
              metrics={r.data.metrics}
              href={(tagId, unmapped) =>
                "/events?" +
                filterQuery({
                  ...r.data!.saved.filters,
                  tagId,
                  unmapped: unmapped ? "true" : undefined,
                })
              }
            />
          </Panel>
          <Panel
            title="고정된 Prompt 목록"
            description={formatNumber(r.data.events.totalElements) + "건"}
            className="table-panel"
          >
            <EventTable
              events={r.data.events.items}
              search={filterQuery(r.data.saved.filters)}
              returnTo={
                "/saved-searches/" + encodeURIComponent(id) + "?page=" + page
              }
            />
            <Pagination
              page={r.data.events}
              onChange={(p) => setParams({ page: String(p) })}
            />
          </Panel>
        </div>
      )}
    </>
  );
}
