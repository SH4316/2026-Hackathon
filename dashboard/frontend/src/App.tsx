import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { api } from "./api";
import { useResource } from "./hooks";
import { formatDateTime, formatNumber, highlightSegments } from "./format";
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
  PersonName,
  PolicyBadge,
  ServiceLabel,
  TagChip,
  WorkspaceProvider,
  useWorkspace,
  useDashboardFilters,
  VersionSelect,
  RangeControls,
  SearchFilters,
  StatStrip,
  filterQuery,
  type IconName,
} from "./ui";
import { Trend, MetricTree, ServiceChart, PolicyChart } from "./charts";
import { MetricSettings } from "./MetricSettings";
import { JevSettings } from "./JevSettings";
import { SavedSearches, SavedSearchDetail } from "./SavedSearches";
import type { Person, Filters } from "./types";
const navigation: {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}[] = [
  { to: "/", label: "전체 현황", icon: "overview", end: true },
  { to: "/events", label: "탐지 이력", icon: "events" },
  { to: "/people", label: "사람 관리", icon: "people" },
  { to: "/settings/metrics", label: "메트릭 설정", icon: "tree" },
  { to: "/settings/jev", label: "Jev 설정", icon: "code" },
  { to: "/saved-searches", label: "저장된 검색", icon: "save" },
  { to: "/settings/monitoring", label: "감시 연동", icon: "settings" },
];
export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
function Shell() {
  const location = useLocation();
  const current = navigation.find((n) =>
    n.end ? location.pathname === "/" : location.pathname.startsWith(n.to),
  );
  const { versions } = useWorkspace();
  const active = versions.find((v) => v.isActive);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-symbol">
            <Icon name="shield" size={25} />
          </span>
          <span className="brand-name">
            AI 보안 관제<span>사용 기록 대시보드</span>
          </span>
        </Link>
        <div className="workspace-label">워크스페이스</div>
        <nav aria-label="주 메뉴">
          {navigation.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                "nav-link" + (isActive ? " active" : "")
              }
            >
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
              {n.to === "/settings/monitoring" && (
                <span className="nav-soon">준비 중</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-api">
          <a href="/swagger-ui.html" target="_blank" rel="noreferrer">
            <Icon name="code" size={17} />
            API 문서
            <Icon name="arrow" size={14} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <span className="workspace-avatar">
            <Icon name="shield" size={19} />
          </span>
          <div>
            <strong>로컬 워크스페이스</strong>
            <span>사용자 정의 메트릭</span>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            <span>워크스페이스</span>
            <Icon name="chevron" size={13} />
            <strong>{current?.label || "페이지"}</strong>
          </div>
          <div className="environment-label">
            <span
              className={"environment-dot " + (active ? "has-active" : "")}
            />
            <span>{active ? "활성 설정 연결됨" : "활성 설정 없음"}</span>
            <span className="topbar-divider" />
            <Icon name="refresh" size={14} />
            <span>수동 갱신</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/people" element={<People />} />
            <Route path="/people/:id" element={<PersonDetail />} />
            <Route path="/settings/metrics" element={<MetricSettings />} />
            <Route path="/settings/jev" element={<JevSettings />} />
            <Route path="/saved-searches" element={<SavedSearches />} />
            <Route path="/saved-searches/:id" element={<SavedSearchDetail />} />
            <Route
              path="/settings/monitoring"
              element={<MonitoringSettings />}
            />
            <Route
              path="*"
              element={
                <EmptyState
                  title="페이지를 찾을 수 없습니다"
                  action={
                    <Link className="button button-primary" to="/">
                      전체 현황으로 이동
                    </Link>
                  }
                />
              }
            />
          </Routes>
        </main>
        <footer className="page-footer">
          <span>AI 보안 관제</span>
          <span>모든 시각은 한국 시간(KST) 기준입니다.</span>
        </footer>
      </div>
    </div>
  );
}
function Overview() {
  const state = useDashboardFilters();
  const ws = useWorkspace();
  const r = useResource(
    (signal) => {
      if (state.error) throw new Error(state.error);
      return api.metrics(state.filters, signal);
    },
    [state.key],
  );
  const link = (extra: Partial<Filters>) =>
    "/events?" + filterQuery({ ...state.filters, ...extra });
  return (
    <>
      <PageTitle
        title="전체 현황"
        description="Prompt 탐지량과 태그별 변화를 한눈에 확인하세요."
        action={<RefreshButton {...r} />}
      />
      <div className="overview-toolbar">
        <RangeControls state={state} />
        <Link className="text-link" to={link({})}>
          상세 검색
          <Icon name="arrow" size={15} />
        </Link>
      </div>
      {ws.error ? (
        <ErrorState message={ws.error} retry={ws.reload} />
      ) : r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : !r.data || ws.loading ? (
        <LoadingState />
      ) : !r.data.versionId ? (
        <Panel title="메트릭을 설정하고 시작하세요">
          <EmptyState
            icon="tree"
            title="아직 메트릭 트리 버전이 없습니다"
            description="태그와 정책 상태를 자유롭게 만들고 첫 버전을 발행·활성화하세요. 분류기는 활성 버전의 태그 정보를 가져가 사용할 수 있습니다."
            action={
              <Link className="button button-primary" to="/settings/metrics">
                <Icon name="plus" size={16} />첫 메트릭 버전 만들기
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="dashboard-content" aria-busy={r.loading}>
          <StatStrip metrics={r.data} />
          <div className="overview-graph-grid">
            <Panel
              title="시계열 탐지량"
              description="분석한 Prompt와 감지 영역의 변화"
              action={
                <span className="subtle-label">
                  {state.filters.interval === "hour" ? "시간별" : "일별"}
                </span>
              }
            >
              <Trend metrics={r.data} interval={state.filters.interval} />
            </Panel>
            <Panel title="서비스별 탐지량" description="AI 서비스별 감지 영역">
              <ServiceChart
                metrics={r.data}
                href={(service) => link({ service })}
              />
            </Panel>
          </div>
          <div className="overview-lower-grid">
            <Panel
              title="메트릭 트리"
              description={
                r.data.tags.filter((t) => t.parentId === null).length +
                "개 최상위 태그 · 펼쳐서 하위 항목 확인"
              }
              action={
                <Link className="text-link" to="/settings/metrics">
                  트리 관리
                  <Icon name="arrow" size={14} />
                </Link>
              }
            >
              <MetricTree
                metrics={r.data}
                href={(tagId, unmapped) =>
                  link(
                    unmapped
                      ? { unmapped: "true", tagId: undefined }
                      : { tagId, unmapped: undefined },
                  )
                }
              />
            </Panel>
            <Panel
              title="정책 상태 분포"
              description="사용자 정의 정책 상태별 Prompt 수"
            >
              <PolicyChart
                metrics={r.data}
                href={(policyStateId) => link({ policyStateId })}
              />
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
function SaveSearchForm({
  filters,
  close,
}: {
  filters: Filters;
  close: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const saved = await api.saveSearch({
        name: String(new FormData(e.currentTarget).get("name")).trim(),
        filters,
      });
      navigate("/saved-searches/" + saved.id);
    } catch (x) {
      setError(
        x instanceof Error ? x.message : "검색 결과를 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="inline-form-panel">
      <div>
        <h2>검색 결과 저장</h2>
        <p>현재 조건과 전체 결과를 고정된 스냅샷으로 저장합니다.</p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span className="sr-only">저장 이름</span>
          <input
            name="name"
            aria-label="저장 이름"
            placeholder="예: 고객 정보 검토 · 10월"
            maxLength={80}
            required
            autoFocus
            disabled={pending}
          />
        </label>
        <button className="button button-primary" disabled={pending}>
          저장
        </button>
        <button
          type="button"
          className="button"
          onClick={close}
          disabled={pending}
        >
          취소
        </button>
      </form>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
function Events() {
  const state = useDashboardFilters();
  const r = useResource(
    (signal) => {
      if (state.error) throw new Error(state.error);
      return api.events(state.filters, state.page, signal);
    },
    [state.key, state.page],
  );
  const config = useResource(
    (signal) =>
      state.filters.versionId
        ? api.version(state.filters.versionId, signal)
        : Promise.resolve(null),
    [state.filters.versionId],
  );
  const [save, setSave] = useState(false);
  return (
    <>
      <PageTitle
        title="탐지 이력"
        description="Prompt와 감지 태그를 검색하고 결과를 저장하세요."
        action={
          <>
            <RefreshButton {...r} />
            <button
              className="button button-primary"
              onClick={() => setSave(!save)}
              disabled={!state.filters.versionId || !r.data || !!r.error}
            >
              <Icon name="save" size={16} />
              결과 저장
            </button>
          </>
        }
      />
      <div className="search-toolbar">
        <VersionSelect state={state} />
        <span>선택한 버전의 트리로 전체 기록을 조회합니다.</span>
      </div>
      {save && (
        <SaveSearchForm filters={state.filters} close={() => setSave(false)} />
      )}
      <SearchFilters state={state} config={config.data} />
      {config.error && (
        <ErrorState message={config.error} retry={config.refresh} />
      )}{" "}
      {r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : !r.data ? (
        <LoadingState />
      ) : (
        <Panel
          title="수집된 Prompt"
          description={"검색 결과 " + formatNumber(r.data.totalElements) + "건"}
          className="table-panel"
          action={<span className="subtle-label">최신순</span>}
        >
          <EventTable
            events={r.data.items}
            search={filterQuery(state.filters)}
          />
          <Pagination page={r.data} onChange={state.setPage} />
        </Panel>
      )}
    </>
  );
}
function RegisterPerson({
  done,
  close,
}: {
  done: (p: Person) => void;
  close: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const d = new FormData(e.currentTarget);
    try {
      done(
        await api.createPerson({
          id: String(d.get("id")).trim(),
          name: String(d.get("name")).trim(),
        }),
      );
    } catch (x) {
      setError(x instanceof Error ? x.message : "등록하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="registration-panel">
      <div className="registration-heading">
        <div>
          <h2>새 사람 등록</h2>
          <p>외부 분류기가 사용할 고유 ID를 등록하세요.</p>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label="등록 폼 닫기"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>사람 ID</span>
          <input
            name="id"
            required
            pattern="(?:[A-Za-z0-9_]|-){1,80}"
            maxLength={80}
            placeholder="EMP-001"
            disabled={pending}
            autoFocus
          />
          <small>영문·숫자·하이픈·밑줄</small>
        </label>
        <label>
          <span>표시 이름</span>
          <input
            name="name"
            maxLength={80}
            required
            placeholder="김민수"
            disabled={pending}
          />
        </label>
        <button className="button button-primary" disabled={pending}>
          등록하기
        </button>
      </form>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function People() {
  const state = useDashboardFilters();
  const query = state.params.get("personQuery") || "";
  const [register, setRegister] = useState(false);
  const [notice, setNotice] = useState("");
  const r = useResource(
    (signal) => {
      if (state.error) throw new Error(state.error);
      return api.people(state.filters, query, state.page, signal);
    },
    [state.key, query, state.page],
  );
  return (
    <>
      <PageTitle
        title="사람 관리"
        description="수집 대상자를 등록하고 사람별 Prompt 기록을 확인하세요."
        action={
          <>
            <RefreshButton {...r} />
            <button
              className="button button-primary"
              onClick={() => setRegister(!register)}
            >
              <Icon name="plus" size={16} />
              사람 등록
            </button>
          </>
        }
      />
      {register && (
        <RegisterPerson
          close={() => setRegister(false)}
          done={(p) => {
            setRegister(false);
            setNotice(p.name + "님을 등록했습니다.");
            r.refresh();
          }}
        />
      )}
      {notice && (
        <div role="status" className="success-notice">
          <Icon name="check" size={17} />
          {notice}
        </div>
      )}
      <div className="people-toolbar">
        <RangeControls state={state} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = new URLSearchParams(state.params);
            p.set(
              "personQuery",
              String(new FormData(e.currentTarget).get("query") || ""),
            );
            p.delete("page");
            state.setParams(p);
          }}
        >
          <input
            name="query"
            aria-label="사람 검색"
            placeholder="이름 또는 ID 검색"
            defaultValue={query}
          />
          <button className="button" type="submit">
            <Icon name="search" size={15} />
            검색
          </button>
        </form>
      </div>
      {r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : !r.data ? (
        <LoadingState />
      ) : (
        <Panel
          title="등록된 사람"
          description={
            "총 " +
            formatNumber(r.data.totalElements) +
            "명 · 선택한 기간의 집계"
          }
          className="table-panel"
        >
          {r.data.items.length ? (
            <div
              className="table-scroll"
              role="region"
              tabIndex={0}
              aria-label="사람 목록"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>사람</th>
                    <th>분석 Prompt</th>
                    <th>감지 영역</th>
                    <th>최근 기록</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {r.data.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <PersonName
                          id={p.id}
                          name={p.name}
                          search={filterQuery(state.filters)}
                        />
                      </td>
                      <td>
                        <strong>{formatNumber(p.eventCount)}</strong>
                        <span className="unit">건</span>
                      </td>
                      <td>
                        <strong>{formatNumber(p.findingCount)}</strong>
                        <span className="unit">개</span>
                      </td>
                      <td className="time-cell">
                        {p.lastEventAt
                          ? formatDateTime(p.lastEventAt)
                          : "기록 없음"}
                      </td>
                      <td>
                        <Link
                          className="text-link"
                          to={
                            "/people/" +
                            p.id +
                            "?" +
                            filterQuery({
                              ...state.filters,
                              personId: undefined,
                            })
                          }
                        >
                          기록 보기
                          <Icon name="chevron" size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="등록된 사람이 없습니다"
              description="사람을 등록하면 해당 ID로 보낸 Prompt를 수집할 수 있습니다."
              action={
                <button
                  className="button button-primary"
                  onClick={() => setRegister(true)}
                >
                  사람 등록하기
                </button>
              }
            />
          )}
          <Pagination page={r.data} onChange={state.setPage} />
        </Panel>
      )}
    </>
  );
}
function PersonDetail() {
  const { id = "" } = useParams();
  const state = useDashboardFilters(id);
  const r = useResource(
    async (signal) => {
      if (state.error) throw new Error(state.error);
      const [person, metrics, events] = await Promise.all([
        api.person(id, state.filters, signal),
        api.metrics(state.filters, signal),
        api.events(state.filters, state.page, signal),
      ]);
      return { person, metrics, events };
    },
    [id, state.key, state.page],
  );
  const config = useResource(
    (signal) =>
      state.filters.versionId
        ? api.version(state.filters.versionId, signal)
        : Promise.resolve(null),
    [state.filters.versionId],
  );
  return (
    <>
      <Link className="back-link" to="/people">
        <Icon name="back" size={15} />
        사람 목록
      </Link>
      <PageTitle
        title={r.data ? r.data.person.name + "님의 기록" : "개인별 기록"}
        description={"사람 ID: " + id}
        action={<RefreshButton {...r} />}
      />
      <div className="search-toolbar">
        <VersionSelect state={state} />
      </div>
      <SearchFilters state={state} config={config.data} hidePerson />
      {r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : !r.data ? (
        <LoadingState />
      ) : (
        <div className="dashboard-content">
          <StatStrip metrics={r.data.metrics} />
          <Panel title="개인별 시계열 탐지량">
            <Trend metrics={r.data.metrics} interval={state.filters.interval} />
          </Panel>
          <Panel
            title="Prompt 이력"
            description={formatNumber(r.data.events.totalElements) + "건"}
            className="table-panel"
          >
            <EventTable
              events={r.data.events.items}
              search={filterQuery(state.filters)}
            />
            <Pagination page={r.data.events} onChange={state.setPage} />
          </Panel>
        </div>
      )}
    </>
  );
}
function EventDetail() {
  const { id = "" } = useParams();
  const location = useLocation();
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setSelected(null), [id]);
  const returnTo = (location.state as { returnTo?: unknown } | null)?.returnTo;
  const snapshotReturn =
    typeof returnTo === "string" &&
    /^\/saved-searches\/[A-Za-z0-9_-]+(?:\?page=\d+)?$/.test(returnTo)
      ? returnTo
      : null;
  const r = useResource((signal) => api.event(id, signal), [id]);
  const e = r.data;
  return (
    <>
      <Link
        className="back-link"
        to={snapshotReturn || "/events" + location.search}
      >
        <Icon name="back" size={15} />
        {snapshotReturn ? "저장된 검색 결과" : "탐지 이력"}
      </Link>
      <PageTitle
        title={"Prompt #" + id}
        description="원문에서 감지 위치와 연결된 태그를 확인하세요."
        action={<RefreshButton {...r} />}
      />
      {r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : !e ? (
        <LoadingState />
      ) : (
        <div className="dashboard-content">
          <Panel title="수집 정보">
            <dl className="event-info">
              <div>
                <dt>사람</dt>
                <dd>
                  <PersonName id={e.personId} name={e.personName} />
                </dd>
              </div>
              <div>
                <dt>AI 서비스</dt>
                <dd>
                  <ServiceLabel service={e.service} model={e.model} />
                </dd>
              </div>
              <div>
                <dt>발생 시각</dt>
                <dd>{formatDateTime(e.occurredAt)}</dd>
              </div>
              <div>
                <dt>정책 상태</dt>
                <dd>
                  <PolicyBadge name={e.policyStateName} />
                </dd>
              </div>
            </dl>
          </Panel>
          <div className="prompt-detail-grid">
            <Panel
              title="Prompt 원문"
              description="감지 부분을 선택하면 원문의 해당 위치가 강조됩니다."
              action={
                selected !== null && (
                  <button
                    className="text-button"
                    onClick={() => setSelected(null)}
                  >
                    전체 강조
                  </button>
                )
              }
            >
              <div className="prompt-content">
                {highlightSegments(e.prompt, e.detections).map((s, i) =>
                  s.detections.length ? (
                    <mark
                      key={i}
                      className={
                        selected === null ||
                        s.detections.some((d) => d.id === selected)
                          ? ""
                          : "mark-muted"
                      }
                      title={s.tags.map((t) => t.name).join(", ")}
                    >
                      {s.text}
                    </mark>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </div>
            </Panel>
            <Panel
              title="감지된 부분"
              description={
                "중복을 제외한 감지 영역 " + formatNumber(e.findingCount) + "개"
              }
            >
              {e.detections.length ? (
                <div className="detection-list">
                  {e.detections.map((d, index) => (
                    <button
                      className={
                        "detection-item " +
                        (selected === d.id ? "selected" : "")
                      }
                      key={d.id}
                      onClick={() =>
                        setSelected(selected === d.id ? null : d.id)
                      }
                      aria-pressed={selected === d.id}
                    >
                      <span className="detection-index">{index + 1}</span>
                      <span className="detection-item-content">
                        <strong>{d.text}</strong>
                        <span className="finding-list">
                          {d.tags.map((t) => (
                            <TagChip key={t.id} {...t} />
                          ))}
                        </span>
                        <small>
                          문자 위치 {d.start}–{d.end} · 끝 위치 제외
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="감지된 부분이 없습니다"
                  description="이 Prompt는 감지량 0으로 기록되었습니다."
                />
              )}
            </Panel>
          </div>
          <Panel title="연동 정보">
            <dl className="ingestion-info">
              <div>
                <dt>수집 시스템 / 이벤트</dt>
                <dd className="code-value">
                  {e.sourceId} / {e.eventId}
                </dd>
              </div>
              <div>
                <dt>분류기 사용 버전</dt>
                <dd>
                  <Link
                    className="text-link code-value"
                    to={"/settings/metrics?versionId=" + e.versionId}
                  >
                    {e.versionId}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>서버 수신 시각</dt>
                <dd>{formatDateTime(e.receivedAt)}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}
    </>
  );
}
function MonitoringSettings() {
  const { versions } = useWorkspace();
  const active = versions.find((v) => v.isActive);
  const r = useResource(
    (signal) =>
      active ? api.version(active.id, signal) : Promise.resolve(null),
    [active?.id],
  );
  return (
    <>
      <PageTitle
        title="감시 연동"
        description="외부 감지 엔진의 연동 설정을 위한 화면입니다."
        action={
          <span className="badge preparing">
            <Icon name="lock" size={13} />
            준비 중
          </span>
        }
      />
      <div className="settings-notice">
        <span className="notice-icon">
          <Icon name="lock" size={22} />
        </span>
        <div>
          <h2>감지 엔진 설정은 준비 중입니다</h2>
          <p>
            태그와 정책 상태는 메트릭 설정에서 관리할 수 있습니다. 외부 분류기는
            활성 설정 API를 읽고 감지 결과를 전송합니다.
          </p>
          <Link className="text-link" to="/settings/metrics">
            메트릭 설정으로 이동
            <Icon name="arrow" size={14} />
          </Link>
        </div>
      </div>
      <Panel
        title="활성 버전의 수집 항목"
        description={
          active
            ? active.name + " · " + (r.data?.tags.length ?? 0) + "개 태그"
            : "활성 버전 없음"
        }
      >
        {r.data ? (
          <div
            className="monitoring-catalog"
            role="region"
            tabIndex={0}
            aria-label="활성 버전의 수집 태그 목록"
          >
            <fieldset disabled className="settings-fields">
              {r.data.tags.map((t) => (
                <label className="setting-row" key={t.id}>
                  <span>
                    <span className="setting-label">{t.name}</span>
                    <span className="setting-description">{t.description}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked
                    readOnly
                    aria-label={t.name + " 감시"}
                  />
                </label>
              ))}
              {!r.data.tags.length && (
                <p className="compact-empty">
                  활성 버전에 등록된 태그가 없습니다.
                </p>
              )}
            </fieldset>
          </div>
        ) : (
          <EmptyState
            icon="tree"
            title="활성 설정을 먼저 준비하세요"
            description="메트릭 버전을 발행·활성화하면 여기에서 수집 항목을 확인할 수 있습니다."
          />
        )}
        <div className="settings-save panel-save">
          <span>
            <Icon name="lock" size={14} />이 화면에서 감지 엔진의 동작은 변경할
            수 없습니다.
          </span>
          <button className="button button-primary" disabled>
            연동 설정 저장
          </button>
        </div>
      </Panel>
    </>
  );
}
