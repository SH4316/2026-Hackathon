import {
  createContext,
  useContext,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useResource } from "./hooks";
import {
  dateRangeToFilters,
  getDefaultDateRange,
  formatDateTime,
  formatNumber,
  SERVICE_LABELS,
  flattenTree,
} from "./format";
import { normalizeServiceFilter, personDetailHref } from "./query";
import type {
  ConfigVersion,
  Filters,
  Metrics,
  Page,
  SecurityEvent,
  VersionSummary,
} from "./types";

export type IconName =
  | "overview"
  | "events"
  | "people"
  | "settings"
  | "shield"
  | "arrow"
  | "refresh"
  | "plus"
  | "search"
  | "chevron"
  | "lock"
  | "check"
  | "close"
  | "filter"
  | "info"
  | "back"
  | "tree"
  | "save"
  | "copy"
  | "trash"
  | "code"
  | "up"
  | "down";
const paths: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  events: (
    <>
      <path d="M8 4h12v16H8M4 7h.01M4 12h.01M4 17h.01M12 8h4M12 12h4M12 16h4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h7M15 7h5M4 17h3M11 17h9" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M18.5 7A8 8 0 0 0 5 6M5.5 17A8 8 0 0 0 19 18" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  back: <path d="M19 12H5m5-5-5 5 5 5" />,
  tree: (
    <>
      <rect x="3" y="3" width="6" height="5" rx="1" />
      <path d="M6 8v11h7M6 12h7" />
      <rect x="13" y="9" width="8" height="5" rx="1" />
      <rect x="13" y="17" width="8" height="5" rx="1" />
    </>
  ),
  save: (
    <>
      <path d="M4 3h13l4 4v14H3V3h1Z" />
      <path d="M7 3v6h9V3M7 21v-8h10v8" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  code: (
    <>
      <path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18" />
    </>
  ),
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
};
export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
const WorkspaceContext = createContext<{
  versions: VersionSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}>({ versions: [], loading: true, error: null, reload: () => {} });
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const r = useResource((signal) => api.versions(signal), []);
  return (
    <WorkspaceContext.Provider
      value={{
        versions: r.data || [],
        loading: r.loading,
        error: r.error,
        reload: r.refresh,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  return useContext(WorkspaceContext);
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}
export function RefreshButton({
  refresh,
  loading,
  updatedAt,
}: {
  refresh: () => void;
  loading: boolean;
  updatedAt: Date | null;
}) {
  const workspace = useWorkspace();
  return (
    <div className="refresh-control">
      {updatedAt && (
        <span className="updated-at">
          {new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(updatedAt)}{" "}
          갱신
        </span>
      )}
      <button
        className="button"
        onClick={() => {
          workspace.reload();
          refresh();
        }}
        disabled={loading}
      >
        <Icon
          name="refresh"
          size={16}
          className={loading ? "is-refreshing" : ""}
        />
        새로고침
      </button>
    </div>
  );
}
export function VersionBadge({
  version,
}: {
  version: Pick<VersionSummary, "isActive" | "status">;
}) {
  return (
    <span
      className={
        "badge " +
        (version.isActive
          ? "version-active"
          : version.status === "DRAFT"
            ? "version-draft"
            : "version-published")
      }
    >
      {version.isActive
        ? "활성"
        : version.status === "DRAFT"
          ? "초안"
          : "발행됨"}
    </span>
  );
}
export function TagChip({
  name,
  color = "#5776c6",
}: {
  name: string;
  color?: string;
}) {
  return (
    <span className="tag-chip">
      <span style={{ background: color }} />
      {name}
    </span>
  );
}
export function PolicyBadge({ name }: { name: string | null }) {
  return (
    <span className={"badge " + (name ? "policy-custom" : "policy-NONE")}>
      <span className="status-dot" />
      {name || "정책 정보 없음"}
    </span>
  );
}
export function ServiceLabel({
  service,
  model,
}: {
  service: string;
  model?: string | null;
}) {
  const name =
    SERVICE_LABELS[service] || (service === "unspecified" ? "미지정" : service);
  return (
    <span className="service-cell">
      <span className="service-monogram" aria-hidden="true">
        {name[0]}
      </span>
      <span>
        <span className="cell-primary">{name}</span>
        {model && <span className="cell-secondary">{model}</span>}
      </span>
    </span>
  );
}
export function PersonName({
  name,
  id,
  search = "",
}: {
  name: string;
  id: string;
  search?: string;
}) {
  return (
    <Link to={personDetailHref(id, search)} className="person-cell">
      <span className="avatar" aria-hidden="true">
        {name[0]}
      </span>
      <span>
        <span className="cell-primary">{name}</span>
        <span className="cell-secondary person-id">{id}</span>
      </span>
    </Link>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function EmptyState({
  title = "표시할 기록이 없습니다",
  description = "새 기록이 수집되면 이곳에 표시됩니다.",
  action,
  icon = "events",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function LoadingState() {
  return (
    <div
      className="loading-state"
      role="status"
      aria-label="데이터 불러오는 중"
    >
      <div className="skeleton skeleton-heading" />
      <div className="skeleton-row">
        {[0, 1, 2, 3].map((x) => (
          <div className="skeleton skeleton-number" key={x} />
        ))}
      </div>
      <div className="skeleton skeleton-chart" />
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <Icon name="info" />
      <div>
        <h3>요청을 처리하지 못했습니다</h3>
        <p>{message}</p>
      </div>
      {retry && (
        <button className="button" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  );
}
export function Pagination({
  page,
  onChange,
}: {
  page: Page<unknown>;
  onChange: (page: number) => void;
}) {
  if (!page.totalElements) return null;
  if (page.page >= page.totalPages)
    return (
      <div className="pagination">
        <span>요청한 페이지에 기록이 없습니다</span>
        <button className="button" onClick={() => onChange(0)}>
          첫 페이지로
        </button>
      </div>
    );
  return (
    <div className="pagination">
      <span>
        전체 <strong>{formatNumber(page.totalElements)}</strong>개 중{" "}
        {formatNumber(page.page * page.size + 1)}–
        {formatNumber(
          Math.min((page.page + 1) * page.size, page.totalElements),
        )}
      </span>
      <div>
        <button
          className="button button-small"
          onClick={() => onChange(page.page - 1)}
          disabled={!page.page}
          aria-label="이전 페이지"
        >
          <Icon name="back" size={16} />
        </button>
        <span>
          {page.page + 1} / {page.totalPages}
        </span>
        <button
          className="button button-small"
          onClick={() => onChange(page.page + 1)}
          disabled={page.page + 1 >= page.totalPages}
          aria-label="다음 페이지"
        >
          <Icon name="arrow" size={16} />
        </button>
      </div>
    </div>
  );
}
export function EventTable({
  events,
  search = "",
  returnTo,
}: {
  events: SecurityEvent[];
  search?: string;
  returnTo?: string;
}) {
  if (!events.length)
    return (
      <EmptyState description="선택한 검색 조건에 맞는 기록이 없습니다." />
    );
  return (
    <div
      className="table-scroll"
      role="region"
      tabIndex={0}
      aria-label="이벤트 목록"
    >
      <table className="data-table prompt-table">
        <thead>
          <tr>
            <th>Prompt · 발생 시각</th>
            <th>사람</th>
            <th>AI 서비스</th>
            <th>감지 영역</th>
            <th>감지 태그</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const tags = [
              ...new Map(
                e.detections.flatMap((d) => d.tags).map((t) => [t.id, t]),
              ).values(),
            ];
            return (
              <tr key={e.id}>
                <td>
                  <Link
                    className="prompt-preview"
                    to={"/events/" + e.id + (search ? "?" + search : "")}
                    state={returnTo ? { returnTo } : undefined}
                  >
                    {e.prompt}
                  </Link>
                  <span className="cell-secondary">
                    {formatDateTime(e.occurredAt)}
                  </span>
                </td>
                <td>
                  <PersonName
                    name={e.personName}
                    id={e.personId}
                    search={search}
                  />
                </td>
                <td>
                  <ServiceLabel service={e.service} />
                </td>
                <td>
                  <strong className="table-number">
                    {formatNumber(e.findingCount)}
                  </strong>
                  <span className="unit">개</span>
                </td>
                <td>
                  <div className="finding-list">
                    {tags.slice(0, 3).map((t) => (
                      <TagChip key={t.id} {...t} />
                    ))}
                    {tags.length > 3 && (
                      <span className="small-count">+{tags.length - 3}</span>
                    )}
                    {!tags.length && <span className="muted">감지 없음</span>}
                  </div>
                </td>
                <td>
                  <Link
                    className="icon-link"
                    aria-label={"이벤트 " + e.id + " 상세 보기"}
                    to={"/events/" + e.id + (search ? "?" + search : "")}
                    state={returnTo ? { returnTo } : undefined}
                  >
                    <Icon name="chevron" size={16} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function filterQuery(filters: Filters) {
  return new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v != null && v !== "") as [
      string,
      string,
    ][],
  ).toString();
}
export function seoulDate(value: string | Date) {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function useDashboardFilters(personId?: string) {
  const { versions } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const text = params.toString();
  const active = versions.find((v) => v.isActive);
  const result = useMemo(() => {
    try {
      const f: Filters = {
        ...dateRangeToFilters(getDefaultDateRange()),
        interval: "day",
      };
      for (const key of [
        "from",
        "to",
        "versionId",
        "service",
        "personId",
        "tagId",
        "policyStateId",
        "q",
        "hasDetections",
        "unmapped",
        "interval",
      ] as (keyof Filters)[]) {
        const value = params.get(key);
        if (value) (f as Record<string, string>)[key] = value;
      }
      if (!f.versionId && active) f.versionId = active.id;
      if (personId) f.personId = personId;
      f.service = normalizeServiceFilter(f.service);
      if (
        !Number.isFinite(Date.parse(f.from!)) ||
        !Number.isFinite(Date.parse(f.to!)) ||
        Date.parse(f.from!) >= Date.parse(f.to!)
      )
        throw new Error("시작 시각과 종료 시각을 확인해 주세요.");
      return { filters: f, error: null };
    } catch (e) {
      return {
        filters: {} as Filters,
        error: e instanceof Error ? e.message : "조회 조건을 확인해 주세요.",
      };
    }
  }, [text, active?.id, personId]);
  const rawPage = Number(params.get("page"));
  const page = Number.isSafeInteger(rawPage) && rawPage >= 0 ? rawPage : 0;
  const setPage = (value: number) => {
    const n = new URLSearchParams(params);
    n.set("page", String(value));
    setParams(n);
  };
  return {
    ...result,
    params,
    setParams,
    page,
    setPage,
    key: JSON.stringify(result.filters) + (result.error || ""),
  };
}
export type DashboardFilters = ReturnType<typeof useDashboardFilters>;
export function VersionSelect({ state }: { state: DashboardFilters }) {
  const { versions } = useWorkspace();
  return (
    <label className="version-select">
      <Icon name="tree" size={16} />
      <span className="sr-only">조회 트리 버전</span>
      <select
        aria-label="조회 트리 버전"
        value={state.filters.versionId || ""}
        onChange={(e) => {
          const p = new URLSearchParams(state.params);
          if (e.target.value) p.set("versionId", e.target.value);
          else p.delete("versionId");
          p.delete("page");
          p.delete("tagId");
          p.delete("policyStateId");
          p.delete("unmapped");
          state.setParams(p);
        }}
      >
        <option value="">
          활성 버전{versions.some((v) => v.isActive) ? " 사용" : " 없음"}
        </option>
        {versions
          .filter((v) => v.status === "PUBLISHED")
          .map((v) => (
            <option value={v.id} key={v.id}>
              {v.name}
              {v.isActive ? " · 활성" : ""}
            </option>
          ))}
      </select>
    </label>
  );
}
export function RangeControls({ state }: { state: DashboardFilters }) {
  function change(period: string) {
    const p = new URLSearchParams(state.params);
    const now = new Date();
    if (period === "24h") {
      p.set("from", new Date(now.getTime() - 86400000).toISOString());
      p.set("to", now.toISOString());
      p.set("interval", "hour");
    } else {
      const range = getDefaultDateRange();
      if (period === "30d") {
        const end = new Date(range.to + "T00:00:00+09:00");
        range.from = seoulDate(new Date(end.getTime() - 29 * 86400000));
      }
      const f = dateRangeToFilters(range);
      p.set("from", f.from!);
      p.set("to", f.to!);
      p.set("interval", "day");
    }
    p.set("period", period);
    p.delete("page");
    state.setParams(p);
  }
  return (
    <div className="range-controls">
      <div className="range-buttons" aria-label="조회 기간">
        {[
          ["24h", "24시간"],
          ["7d", "7일"],
          ["30d", "30일"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={
              (state.params.get("period") || "7d") === key ? "selected" : ""
            }
            onClick={() => change(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <VersionSelect state={state} />
    </div>
  );
}
export function SearchFilters({
  state,
  config,
  hidePerson = false,
  peopleSearch = false,
}: {
  state: DashboardFilters;
  config?: ConfigVersion | null;
  hidePerson?: boolean;
  peopleSearch?: boolean;
}) {
  const [error, setError] = useState("");
  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    try {
      const range = dateRangeToFilters({
        from: String(d.get("from")),
        to: String(d.get("to")),
      });
      const p = new URLSearchParams();
      for (const [k, v] of d.entries()) {
        const value = k === "q" ? String(v) : String(v).trim();
        if (k !== "from" && k !== "to" && value !== "") p.set(k, value);
      }
      p.set("from", range.from!);
      p.set("to", range.to!);
      p.set("interval", "day");
      if (state.filters.versionId) p.set("versionId", state.filters.versionId);
      if (p.get("tagId") === "__unmapped") {
        p.delete("tagId");
        p.set("unmapped", "true");
      }
      const service = normalizeServiceFilter(p.get("service"));
      if (service) p.set("service", service);
      setError("");
      state.setParams(p);
    } catch (x) {
      setError(x instanceof Error ? x.message : "검색 조건을 확인해 주세요.");
    }
  }
  const defaultRange = getDefaultDateRange();
  const from = state.error ? defaultRange.from : seoulDate(state.filters.from!);
  const to = state.error
    ? defaultRange.to
    : seoulDate(new Date(Date.parse(state.filters.to!) - 1));
  return (
    <form
      className="filter-bar advanced-filter"
      onSubmit={apply}
      key={
        state.params.toString() +
        ":" +
        (config?.id || "") +
        ":" +
        (config?.revision ?? "")
      }
    >
      <div className="filter-top">
        <span className="filter-caption">
          <Icon name="filter" size={17} />
          상세 검색
        </span>
        <button
          className="text-button"
          type="button"
          onClick={() => state.setParams({})}
        >
          초기화
        </button>
      </div>
      <div className="advanced-fields">
        <label className="date-range-field">
          <span>조회 기간 · 한국 시간</span>
          <span className="date-inputs">
            <input
              type="date"
              name="from"
              aria-label="시작일"
              required
              defaultValue={from}
            />
            <span>—</span>
            <input
              type="date"
              name="to"
              aria-label="종료일"
              required
              defaultValue={to}
            />
          </span>
        </label>
        <label className="search-query">
          <span>Prompt 검색</span>
          <input
            name="q"
            placeholder="원문에 포함된 내용"
            defaultValue={state.params.get("q") || ""}
          />
        </label>
        <label>
          <span>메트릭 태그</span>
          <select
            name="tagId"
            defaultValue={
              state.params.get("unmapped")
                ? "__unmapped"
                : state.params.get("tagId") || ""
            }
          >
            <option value="">전체 태그</option>
            {config &&
              flattenTree(config.tags).map((t) => (
                <option value={t.id} key={t.id}>
                  {"　".repeat(t.depth) + t.name}
                </option>
              ))}
            <option value="__unmapped">선택 버전에 없는 태그</option>
          </select>
        </label>
        <label>
          <span>정책 상태</span>
          <select
            name="policyStateId"
            defaultValue={state.params.get("policyStateId") || ""}
          >
            <option value="">전체 정책</option>
            {config?.policyStates.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>AI 서비스</span>
          <input
            name="service"
            list="services"
            placeholder="전체 서비스"
            defaultValue={state.params.get("service") || ""}
          />
          <datalist id="services">
            <option value="chatgpt" />
            <option value="claude" />
            <option value="gemini" />
          </datalist>
        </label>
        {!hidePerson && (
          <label>
            <span>사람 ID</span>
            <input
              name="personId"
              placeholder="전체 사람"
              defaultValue={state.params.get("personId") || ""}
            />
          </label>
        )}
        {peopleSearch && (
          <label>
            <span>사람 검색</span>
            <input
              name="personQuery"
              placeholder="이름 또는 ID"
              defaultValue={state.params.get("personQuery") || ""}
            />
          </label>
        )}
        <label>
          <span>감지 유무</span>
          <select
            name="hasDetections"
            defaultValue={state.params.get("hasDetections") || ""}
          >
            <option value="">전체 Prompt</option>
            <option value="true">감지 있음</option>
            <option value="false">감지 없음</option>
          </select>
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={!!state.filters.versionId && !config}
        >
          검색
        </button>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </form>
  );
}
export function StatStrip({ metrics }: { metrics: Metrics }) {
  const s = metrics.summary;
  return (
    <section className="stat-strip" aria-label="조회 기간 요약">
      {[
        {
          label: "분석한 Prompt",
          value: s.eventCount,
          unit: "건",
          note: "중복 전송 제외",
          icon: "events",
        },
        {
          label: "감지 영역",
          value: s.findingCount,
          unit: "개",
          note: "같은 위치는 한 번만 계산",
          icon: "shield",
        },
        {
          label: "감지된 Prompt",
          value: s.detectedEventCount,
          unit: "건",
          note: "감지 영역이 있는 기록",
          icon: "search",
        },
        {
          label: "기록이 있는 사람",
          value: s.personCount,
          unit: "명",
          note: "조회 기간 내 수집 기준",
          icon: "people",
        },
      ].map((s) => (
        <div className="stat" key={s.label}>
          <div className="stat-label">
            {s.label}
            <Icon name={s.icon as IconName} size={17} />
          </div>
          <div className="stat-value">
            {formatNumber(s.value)}
            <span>{s.unit}</span>
          </div>
          <p>{s.note}</p>
        </div>
      ))}
    </section>
  );
}
