import { useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import { personDetailHref } from "./query";
import { useResource } from "./hooks";
import { CATEGORY_LABELS, formatDateTime, formatNumber } from "./format";
import type { Metrics, Person } from "./types";
import {
  EmptyState,
  ErrorState,
  EventTable,
  FilterBar,
  Icon,
  LoadingState,
  PageTitle,
  Pagination,
  Panel,
  PersonName,
  PolicyBadge,
  RefreshButton,
  ServiceLabel,
  usePageFilters,
  type IconName,
} from "./ui";

const navigation: {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}[] = [
  { to: "/", label: "전체 현황", icon: "overview", end: true },
  { to: "/events", label: "탐지 이력", icon: "events" },
  { to: "/people", label: "사람 관리", icon: "people" },
  { to: "/settings/monitoring", label: "감시 설정", icon: "settings" },
];

export default function App() {
  const location = useLocation();
  const current = navigation.find((n) =>
    n.end ? location.pathname === "/" : location.pathname.startsWith(n.to),
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
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
              {n.icon === "settings" && (
                <span className="nav-soon">준비 중</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="workspace-avatar">
            <Icon name="shield" size={19} />
          </span>
          <div>
            <strong>로컬 워크스페이스</strong>
            <span>시연 환경 · 로그인 없음</span>
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
            <span className="environment-dot" />
            로컬 시연
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
            <Route
              path="/settings/monitoring"
              element={<MonitoringSettings />}
            />
            <Route path="*" element={<NotFound />} />
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

function StatStrip({
  metrics,
  personal = false,
}: {
  metrics: Metrics;
  personal?: boolean;
}) {
  const { summary } = metrics;
  const stats = [
    {
      label: "수집 이벤트",
      value: summary.eventCount,
      unit: "건",
      note: "중복 전송 제외",
      icon: "events" as IconName,
    },
    {
      label: "감지 수량",
      value: summary.findingCount,
      unit: "개",
      note: "선택한 감지 항목 기준",
      icon: "shield" as IconName,
    },
    {
      label: personal ? "이용 AI 서비스" : "기록이 있는 사람",
      value: personal ? metrics.services.length : summary.personCount,
      unit: personal ? "개" : "명",
      note: "조회 기간 내 수집 기준",
      icon: "people" as IconName,
    },
    {
      label: "설정 미확인",
      value: summary.unknownPolicyCount,
      unit: "건",
      note: "미확인으로 보고된 정책 상태",
      icon: "info" as IconName,
    },
  ];
  return (
    <section className="stat-strip" aria-label="조회 기간 요약">
      {stats.map((stat) => (
        <div className="stat" key={stat.label}>
          <div className="stat-label">
            {stat.label}
            <Icon name={stat.icon} size={17} />
          </div>
          <div className="stat-value">
            {formatNumber(stat.value)}
            <span>{stat.unit}</span>
          </div>
          <p>{stat.note}</p>
        </div>
      ))}
    </section>
  );
}

function Trend({ metrics }: { metrics: Metrics }) {
  if (!metrics.summary.eventCount)
    return (
      <div className="chart-empty">
        <Icon name="events" size={24} />
        <p>수집된 이벤트가 생기면 일별 추이가 표시됩니다.</p>
      </div>
    );
  return (
    <div
      className="trend-chart"
      role="img"
      aria-label={
        "일별 수집 추이. 이벤트 총 " +
        formatNumber(metrics.summary.eventCount) +
        "건, 감지 수량 " +
        formatNumber(metrics.summary.findingCount) +
        "개."
      }
    >
      <ResponsiveContainer width="100%" height={248}>
        <LineChart
          data={metrics.daily}
          margin={{ top: 12, right: 18, bottom: 6, left: -16 }}
          accessibilityLayer
        >
          <CartesianGrid
            vertical={false}
            stroke="#e9edf2"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#687487", fontSize: 11 }}
            tickFormatter={(value: string) => value.slice(5).replace("-", ".")}
            minTickGap={26}
            dy={10}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#687487", fontSize: 11 }}
          />
          <Tooltip
            labelFormatter={(label) => String(label).replaceAll("-", ".")}
            contentStyle={{
              border: "1px solid #e3e7ed",
              borderRadius: 10,
              fontSize: 12,
              boxShadow: "0 5px 16px #172b4d0d",
            }}
          />
          <Legend
            iconType="plainline"
            iconSize={16}
            wrapperStyle={{ fontSize: 12, paddingTop: 18 }}
          />
          <Line
            type="monotone"
            dataKey="eventCount"
            name="이벤트 (건)"
            stroke="#4268cc"
            strokeWidth={2.5}
            dot={
              metrics.daily.length < 10
                ? { r: 3, strokeWidth: 2, fill: "#fff" }
                : false
            }
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="findingCount"
            name="감지 수량 (개)"
            stroke="#8a9bbf"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryDistribution({
  metrics,
  onChoose,
}: {
  metrics: Metrics;
  onChoose: (category: string) => string;
}) {
  const maximum = Math.max(...metrics.categories.map((c) => c.count), 1);
  return (
    <div className="category-distribution">
      {metrics.categories.map((c) => (
        <Link
          to={onChoose(c.category)}
          key={c.category}
          className={"category-row category-" + c.category}
        >
          <div>
            <span>
              <span className="category-dot" />
              {CATEGORY_LABELS[c.category]}
            </span>
            <strong>
              {formatNumber(c.count)}
              <small>개</small>
            </strong>
          </div>
          <div className="quantity-track">
            <span
              style={{
                width: c.count
                  ? Math.max(2, (c.count / maximum) * 100) + "%"
                  : "0%",
              }}
            />
          </div>
          <span className="category-events">
            {formatNumber(c.eventCount)}개 이벤트에서 감지
          </span>
        </Link>
      ))}
    </div>
  );
}

function PolicyDistribution({
  metrics,
  onChoose,
}: {
  metrics: Metrics;
  onChoose: (policy: string) => string;
}) {
  const total = metrics.policies.reduce((sum, p) => sum + p.eventCount, 0);
  return (
    <div className="policy-distribution">
      <div className="policy-segments" aria-hidden="true">
        {total ? (
          metrics.policies
            .filter((p) => p.eventCount)
            .map((p) => (
              <span
                key={p.policyState}
                className={"segment-" + p.policyState}
                style={{ flex: p.eventCount }}
              />
            ))
        ) : (
          <span className="segment-empty" />
        )}
      </div>
      <div className="policy-rows">
        {metrics.policies.map((p) => (
          <Link key={p.policyState} to={onChoose(p.policyState)}>
            <PolicyBadge state={p.policyState} />
            <strong>
              {formatNumber(p.eventCount)}
              <small>건</small>
            </strong>
            <Icon name="chevron" size={14} />
          </Link>
        ))}
      </div>
      <p className="panel-footnote">
        <Icon name="info" size={14} />
        정책 정보가 없는 이벤트는 이 분포에서 제외됩니다.
      </p>
    </div>
  );
}

function Overview() {
  const state = usePageFilters();
  const resource = useResource(
    async (signal) => {
      if (state.filterError) throw new Error(state.filterError);
      const [metrics, events] = await Promise.all([
        api.metrics(state.filters, signal),
        api.events(state.filters, 0, signal),
      ]);
      return { metrics, events };
    },
    [state.key],
  );
  const linkToEvents = (key?: string, value?: string) => {
    const p = new URLSearchParams(state.params);
    p.delete("page");
    if (key && value) p.set(key, value);
    return "/events?" + p.toString();
  };
  return (
    <>
      <PageTitle
        title="전체 현황"
        description="AI 사용의 정책 상태와 보안 감지 기록을 한눈에 확인하세요."
        action={<RefreshButton {...resource} />}
      />
      <FilterBar state={state} />
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : !resource.data ? (
        <LoadingState />
      ) : (
        <div className="dashboard-content" aria-busy={resource.loading}>
          <StatStrip metrics={resource.data.metrics} />
          <div className="chart-grid">
            <Panel
              title="수집 추이"
              description="이벤트 건수와 감지 수량의 일별 변화"
              action={<span className="subtle-label">일별</span>}
            >
              <Trend metrics={resource.data.metrics} />
            </Panel>
            <Panel
              title="항목별 감지"
              description="감지 항목을 선택해 이력을 확인하세요"
            >
              <CategoryDistribution
                metrics={resource.data.metrics}
                onChoose={(value) => linkToEvents("category", value)}
              />
            </Panel>
          </div>
          <div className="secondary-grid">
            <Panel
              title="정책 상태"
              description="감지 시스템이 보고한 학습 설정"
            >
              <PolicyDistribution
                metrics={resource.data.metrics}
                onChoose={(value) => linkToEvents("policyState", value)}
              />
            </Panel>
            <Panel
              title="서비스별 수집"
              description="조회 기간에 기록된 AI 서비스"
            >
              {resource.data.metrics.services.length ? (
                <div className="service-overview">
                  <div className="service-overview-head">
                    <span>AI 서비스</span>
                    <span>이벤트</span>
                    <span>감지 수량</span>
                  </div>
                  {resource.data.metrics.services.map((s) => (
                    <Link
                      to={linkToEvents("service", s.service)}
                      key={s.service}
                    >
                      <ServiceLabel service={s.service} />
                      <strong>
                        {formatNumber(s.eventCount)}
                        <small>건</small>
                      </strong>
                      <strong>
                        {formatNumber(s.findingCount)}
                        <small>개</small>
                      </strong>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="compact-empty">
                  아직 기록된 AI 서비스가 없습니다.
                </div>
              )}
            </Panel>
          </div>
          <Panel
            title="최근 수집 이벤트"
            description="선택한 조회 조건의 최근 이벤트 5건"
            action={
              <Link to={linkToEvents()} className="text-link">
                전체 이력
                <Icon name="arrow" size={15} />
              </Link>
            }
            className="table-panel"
          >
            <EventTable
              events={resource.data.events.items.slice(0, 5)}
              search={state.params.toString()}
              emptyAction={
                <Link to="/people" className="button">
                  사람 등록하기
                  <Icon name="arrow" size={15} />
                </Link>
              }
            />
          </Panel>
        </div>
      )}
    </>
  );
}

function Events() {
  const state = usePageFilters();
  const resource = useResource(
    async (signal) => {
      if (state.filterError) throw new Error(state.filterError);
      return api.events(state.filters, state.page, signal);
    },
    [state.key, state.page],
  );
  return (
    <>
      <PageTitle
        title="탐지 이력"
        description="수집된 이벤트와 항목별 감지 수량을 확인하세요."
        action={<RefreshButton {...resource} />}
      />
      <FilterBar state={state} />
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : !resource.data ? (
        <LoadingState />
      ) : (
        <Panel
          title="수집 이벤트"
          description={
            "조회 조건에 맞는 이벤트 " +
            formatNumber(resource.data.totalElements) +
            "건"
          }
          className="table-panel"
          action={<span className="subtle-label">최신순</span>}
        >
          <EventTable
            events={resource.data.items}
            search={state.params.toString()}
          />
          <Pagination page={resource.data} onChange={state.setPage} />
        </Panel>
      )}
    </>
  );
}

function Registration({
  onSuccess,
  close,
}: {
  onSuccess: (person: Person) => void;
  close: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const person = await api.createPerson({
        id: String(form.get("id")).trim(),
        name: String(form.get("name")).trim(),
      });
      onSuccess(person);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "등록하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="registration-panel">
      <div className="registration-heading">
        <div>
          <h2>새 사람 등록</h2>
          <p>감지 시스템이 사용할 고유 ID와 표시 이름을 등록하세요.</p>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label="등록 폼 닫기"
          disabled={pending}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>사람 ID</span>
          <input
            name="id"
            placeholder="예: EMP-001"
            required
            pattern="(?:[A-Za-z0-9_]|-){1,80}"
            maxLength={80}
            title="영문, 숫자, 하이픈, 밑줄로 된 1~80자 ID"
            autoFocus
            disabled={pending}
          />
          <small>영문·숫자·하이픈·밑줄, 최대 80자</small>
        </label>
        <label>
          <span>표시 이름</span>
          <input
            name="name"
            placeholder="예: 김민수"
            required
            maxLength={80}
            disabled={pending}
          />
          <small>등록 후 ID와 이름은 변경할 수 없습니다.</small>
        </label>
        <button
          className="button button-primary"
          disabled={pending}
          type="submit"
        >
          <Icon name={pending ? "refresh" : "plus"} size={16} />
          {pending ? "등록 중…" : "등록하기"}
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
  const state = usePageFilters();
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const query = state.params.get("q") || "";
  const resource = useResource(
    async (signal) => {
      if (state.filterError) throw new Error(state.filterError);
      return api.people(state.filters, query, state.page, signal);
    },
    [state.key, query, state.page],
  );
  function registered(person: Person) {
    setShowForm(false);
    setNotice(person.name + " (" + person.id + ")님을 등록했습니다.");
    resource.refresh();
  }
  return (
    <>
      <PageTitle
        title="사람 관리"
        description="수집 대상자를 등록하고 사람별 AI 사용 기록을 확인하세요."
        action={
          <>
            <RefreshButton {...resource} />
            <button
              className="button button-primary"
              onClick={() => {
                setShowForm(!showForm);
                setNotice("");
              }}
              aria-expanded={showForm}
            >
              <Icon name="plus" size={16} />
              사람 등록
            </button>
          </>
        }
      />
      {showForm && (
        <Registration onSuccess={registered} close={() => setShowForm(false)} />
      )}
      <div aria-live="polite">
        {notice && (
          <div className="success-notice">
            <Icon name="check" size={17} />
            {notice}
            <button
              className="icon-button"
              aria-label="알림 닫기"
              onClick={() => setNotice("")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
      <FilterBar state={state} hidePerson showSearch />
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : !resource.data ? (
        <LoadingState />
      ) : (
        <Panel
          title="등록된 사람"
          description={
            "총 " +
            formatNumber(resource.data.totalElements) +
            "명 · 숫자는 선택한 조회 조건 기준입니다."
          }
          className="table-panel"
        >
          {resource.data.items.length ? (
            <>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="사람 목록"
              >
                <table className="data-table people-table">
                  <thead>
                    <tr>
                      <th>사람</th>
                      <th>수집 이벤트</th>
                      <th>감지 수량</th>
                      <th>최근 이벤트</th>
                      <th>
                        <span className="sr-only">상세 보기</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {resource.data.items.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <PersonName name={p.name} id={p.id} />
                        </td>
                        <td>
                          <strong className="table-number">
                            {formatNumber(p.eventCount)}
                          </strong>
                          <span className="unit">건</span>
                        </td>
                        <td>
                          <strong className="table-number">
                            {formatNumber(p.findingCount)}
                          </strong>
                          <span className="unit">개</span>
                        </td>
                        <td className="time-cell">
                          {p.lastEventAt ? (
                            formatDateTime(p.lastEventAt)
                          ) : (
                            <span className="muted">기록 없음</span>
                          )}
                        </td>
                        <td>
                          <Link
                            className="text-link"
                            to={personDetailHref(p.id, state.params)}
                          >
                            기록 보기
                            <Icon name="chevron" size={15} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : !resource.data.totalElements ? (
            <EmptyState
              title={query ? "검색 결과가 없습니다" : "등록된 사람이 없습니다"}
              description={
                query
                  ? "이름이나 ID를 바꿔 검색해 보세요."
                  : "사람을 먼저 등록해야 해당 ID로 보낸 이벤트를 수집할 수 있습니다."
              }
              action={
                !query && (
                  <button
                    className="button button-primary"
                    onClick={() => setShowForm(true)}
                  >
                    <Icon name="plus" size={16} />첫 사람 등록하기
                  </button>
                )
              }
            />
          ) : null}
          <Pagination page={resource.data} onChange={state.setPage} />
        </Panel>
      )}
    </>
  );
}

function PersonDetail() {
  const { id = "" } = useParams();
  const state = usePageFilters(id);
  const resource = useResource(
    async (signal) => {
      if (state.filterError) throw new Error(state.filterError);
      const [person, metrics, events] = await Promise.all([
        api.person(id, state.filters, signal),
        api.metrics(state.filters, signal),
        api.events(state.filters, state.page, signal),
      ]);
      return { person, metrics, events };
    },
    [id, state.key, state.page],
  );
  return (
    <>
      <Link className="back-link" to="/people">
        <Icon name="back" size={15} />
        사람 목록
      </Link>
      <PageTitle
        title={
          resource.data
            ? resource.data.person.name + "님의 기록"
            : "개인별 기록"
        }
        description={"사람 ID: " + id + " · 조회 기간의 정책 상태와 감지 이력"}
        action={<RefreshButton {...resource} />}
      />
      <FilterBar state={state} hidePerson />
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : !resource.data ? (
        <LoadingState />
      ) : (
        <div className="dashboard-content">
          <StatStrip metrics={resource.data.metrics} personal />
          <Panel
            title="개인별 수집 추이"
            description="조회 기간의 이벤트 건수와 감지 수량"
          >
            <Trend metrics={resource.data.metrics} />
          </Panel>
          <div className="secondary-grid">
            <Panel title="항목별 감지" description="개인별 감지 수량">
              <CategoryDistribution
                metrics={resource.data.metrics}
                onChoose={(category) => {
                  const p = new URLSearchParams(state.params);
                  p.set("category", category);
                  p.delete("page");
                  return "/people/" + encodeURIComponent(id) + "?" + p;
                }}
              />
            </Panel>
            <Panel
              title="정책 상태"
              description="감지 시스템이 보고한 학습 설정"
            >
              <PolicyDistribution
                metrics={resource.data.metrics}
                onChoose={(policy) => {
                  const p = new URLSearchParams(state.params);
                  p.set("policyState", policy);
                  p.delete("page");
                  return "/people/" + encodeURIComponent(id) + "?" + p;
                }}
              />
            </Panel>
          </div>
          <Panel
            title="이벤트 이력"
            description={
              "총 " + formatNumber(resource.data.events.totalElements) + "건"
            }
            className="table-panel"
          >
            <EventTable
              events={resource.data.events.items}
              search={state.params.toString()}
            />
            <Pagination page={resource.data.events} onChange={state.setPage} />
          </Panel>
        </div>
      )}
    </>
  );
}

function EventDetail() {
  const { id = "" } = useParams();
  const location = useLocation();
  const resource = useResource((signal) => api.event(id, signal), [id]);
  const e = resource.data;
  return (
    <>
      <Link className="back-link" to={"/events" + location.search}>
        <Icon name="back" size={15} />
        탐지 이력
      </Link>
      <PageTitle
        title={"이벤트 #" + id}
        description="감지 시스템이 전송한 이벤트의 상세 기록입니다."
        action={<RefreshButton {...resource} />}
      />
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : !e ? (
        <LoadingState />
      ) : (
        <div className="dashboard-content">
          <Panel title="이벤트 정보">
            <dl className="event-info">
              <div>
                <dt>사람</dt>
                <dd>
                  <PersonName name={e.personName} id={e.personId} />
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
                  <PolicyBadge state={e.policyState} />
                </dd>
              </div>
            </dl>
          </Panel>
          <div className="secondary-grid">
            <Panel
              title="감지 항목과 수량"
              description={
                "이벤트 1건에 포함된 감지 수량: " +
                formatNumber(e.findingCount) +
                "개"
              }
            >
              {e.findings.length ? (
                <div className="event-findings">
                  {e.findings.map((f) => (
                    <div className={"category-" + f.category} key={f.category}>
                      <span>
                        <span className="category-dot" />
                        {CATEGORY_LABELS[f.category]}
                      </span>
                      <strong>
                        {formatNumber(f.quantity)}
                        <small>개</small>
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="compact-empty">
                  감지 항목이 없는 정책 상태 이벤트입니다.
                </div>
              )}
              <p className="panel-footnote">
                <Icon name="info" size={14} />
                대화 원문과 감지된 민감정보 값은 저장하지 않습니다.
              </p>
            </Panel>
            <Panel title="수집 정보">
              <dl className="ingestion-info">
                <div>
                  <dt>수집 시스템 ID</dt>
                  <dd className="code-value">{e.sourceId}</dd>
                </div>
                <div>
                  <dt>외부 이벤트 ID</dt>
                  <dd className="code-value">{e.eventId}</dd>
                </div>
                <div>
                  <dt>서버 수신 시각</dt>
                  <dd>{formatDateTime(e.receivedAt)}</dd>
                </div>
              </dl>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function MonitoringSettings() {
  return (
    <>
      <PageTitle
        title="감시 설정"
        description="감시 대상과 수집 항목을 설정하는 화면입니다."
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
          <h2>설정 기능을 준비하고 있습니다</h2>
          <p>
            아래는 설정 예시입니다. 설정 변경과 감지기 연동은 아직 지원하지
            않습니다.
          </p>
          <span>
            대시보드의 이벤트 수집 API와 기록 조회는 사용할 수 있습니다.
          </span>
        </div>
      </div>
      <div className="settings-layout">
        <section className="settings-section">
          <div className="settings-section-title">
            <h2>감시 대상</h2>
            <p>정책 상태와 보안 항목을 확인할 AI 서비스를 선택합니다.</p>
          </div>
          <fieldset disabled className="settings-fields">
            <legend className="sr-only">AI 서비스 설정 예시</legend>
            {[
              { key: "chatgpt", desc: "ChatGPT에서 발생하는 이벤트" },
              { key: "claude", desc: "Claude에서 발생하는 이벤트" },
              { key: "gemini", desc: "Gemini에서 발생하는 이벤트" },
            ].map((s) => (
              <label className="setting-row" key={s.key}>
                <span>
                  <ServiceLabel service={s.key} />
                  <span className="setting-description">{s.desc}</span>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    defaultChecked
                    aria-label={s.key + " 감시"}
                  />
                  <span />
                </span>
              </label>
            ))}
          </fieldset>
        </section>
        <section className="settings-section">
          <div className="settings-section-title">
            <h2>보안 감지 항목</h2>
            <p>감지 시 항목별 수량과 개인별 이력에 기록할 항목입니다.</p>
          </div>
          <fieldset disabled className="settings-fields">
            <legend className="sr-only">보안 감지 항목 설정 예시</legend>
            {[
              {
                key: "PERSONAL_DATA",
                desc: "이메일 등 개인을 식별할 수 있는 정보",
              },
              {
                key: "CREDENTIAL",
                desc: "API 키, 비밀번호 등 인증에 사용되는 정보",
              },
              { key: "CONFIDENTIAL", desc: "조직 내부의 기밀로 분류된 정보" },
            ].map((c) => (
              <label className="setting-row" key={c.key}>
                <span>
                  <span className="setting-label">
                    {CATEGORY_LABELS[c.key as keyof typeof CATEGORY_LABELS]}
                  </span>
                  <span className="setting-description">{c.desc}</span>
                </span>
                <input
                  className="checkbox"
                  type="checkbox"
                  defaultChecked
                  aria-label={
                    CATEGORY_LABELS[c.key as keyof typeof CATEGORY_LABELS] +
                    " 감지"
                  }
                />
              </label>
            ))}
          </fieldset>
        </section>
        <section className="settings-section">
          <div className="settings-section-title">
            <h2>정책 상태 수집</h2>
            <p>학습 설정을 보안 감지 수량과 구분하여 기록합니다.</p>
          </div>
          <fieldset disabled className="settings-fields">
            <legend className="sr-only">정책 상태 수집 설정 예시</legend>
            <label className="setting-row">
              <span>
                <span className="setting-label">학습 설정 상태 기록</span>
                <span className="setting-description">
                  학습 허용 · 학습 미사용 · 설정 미확인
                </span>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  defaultChecked
                  aria-label="학습 설정 상태 기록"
                />
                <span />
              </span>
            </label>
            <div className="settings-explanation">
              <Icon name="info" size={16} />
              <p>설정 미확인은 학습 허용이나 정책 위반을 의미하지 않습니다.</p>
            </div>
          </fieldset>
        </section>
        <div className="settings-save">
          <span>
            <Icon name="lock" size={14} />
            설정 예시는 실제 감지 시스템에 적용되지 않습니다.
          </span>
          <button className="button button-primary" disabled>
            설정 저장
          </button>
        </div>
      </div>
    </>
  );
}

function NotFound() {
  return (
    <EmptyState
      title="페이지를 찾을 수 없습니다"
      description="주소를 확인하거나 전체 현황으로 돌아가세요."
      action={
        <Link to="/" className="button button-primary">
          전체 현황으로 이동
          <Icon name="arrow" size={15} />
        </Link>
      }
    />
  );
}
