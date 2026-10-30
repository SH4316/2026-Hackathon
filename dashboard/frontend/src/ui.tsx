import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  CATEGORY_LABELS,
  POLICY_LABELS,
  SERVICE_LABELS,
  dateRangeToFilters,
  getDefaultDateRange,
  formatDateTime,
  formatNumber,
} from "./format";
import type {
  Category,
  Filters,
  Page,
  PolicyState,
  SecurityEvent,
} from "./types";
import { normalizeServiceFilter, personDetailHref } from "./query";

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
  | "calendar"
  | "filter"
  | "info"
  | "back"
  | "external";
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
  arrow: (
    <>
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </>
  ),
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
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h2" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  back: <path d="M19 12H5m5-5-5 5 5 5" />,
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />
    </>
  ),
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
      <button className="button" onClick={refresh} disabled={loading}>
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
export function PolicyBadge({ state }: { state: PolicyState | null }) {
  return (
    <span className={"badge policy-" + (state || "NONE")}>
      <span className="status-dot" />
      {state ? POLICY_LABELS[state] : "정책 정보 없음"}
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
  const name = SERVICE_LABELS[service] || service;
  return (
    <span className="service-cell">
      <span
        className={
          "service-monogram service-" +
          (["chatgpt", "claude", "gemini"].includes(service)
            ? service
            : "other")
        }
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
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
  link = true,
}: {
  name: string;
  id: string;
  link?: boolean;
}) {
  const location = useLocation();
  const content = (
    <>
      <span className="avatar" aria-hidden="true">
        {name.trim().slice(0, 1)}
      </span>
      <span>
        <span className="cell-primary">{name}</span>
        <span className="cell-secondary person-id">{id}</span>
      </span>
    </>
  );
  return link ? (
    <Link to={personDetailHref(id, location.search)} className="person-cell">
      {content}
    </Link>
  ) : (
    <span className="person-cell">{content}</span>
  );
}
export function EmptyState({
  title = "아직 수집된 이벤트가 없습니다",
  description = "사람을 등록하고 수집 API로 이벤트를 전송하면 기록이 표시됩니다.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="events" size={26} />
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
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton skeleton-number" />
        ))}
      </div>
      <div className="skeleton skeleton-chart" />
      <span className="sr-only">데이터를 불러오고 있습니다.</span>
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
        <h3>데이터를 불러오지 못했습니다</h3>
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
export function Pagination({
  page,
  onChange,
}: {
  page: Page<unknown>;
  onChange: (page: number) => void;
}) {
  if (!page.totalElements) return null;
  if (page.page >= page.totalPages) {
    return (
      <div className="pagination">
        <span>요청한 페이지에 기록이 없습니다</span>
        <button className="button button-small" onClick={() => onChange(0)}>
          첫 페이지로
        </button>
      </div>
    );
  }
  const first = page.page * page.size + 1;
  const last = Math.min((page.page + 1) * page.size, page.totalElements);
  return (
    <div className="pagination">
      <span>
        전체 <strong>{formatNumber(page.totalElements)}</strong>개 중{" "}
        {formatNumber(first)}–{formatNumber(last)}
      </span>
      <div>
        <button
          className="button button-small"
          disabled={page.page === 0}
          onClick={() => onChange(page.page - 1)}
          aria-label="이전 페이지"
        >
          <Icon name="back" size={16} />
        </button>
        <span>
          {page.page + 1} / {Math.max(page.totalPages, 1)}
        </span>
        <button
          className="button button-small"
          disabled={page.page + 1 >= page.totalPages}
          onClick={() => onChange(page.page + 1)}
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
  emptyAction,
}: {
  events: SecurityEvent[];
  search?: string;
  emptyAction?: ReactNode;
}) {
  if (!events.length)
    return (
      <EmptyState
        title="표시할 이벤트가 없습니다"
        description="선택한 조건에 맞는 기록이 없습니다. 필터를 변경하거나 새 이벤트를 수집해 보세요."
        action={emptyAction}
      />
    );
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="이벤트 목록"
    >
      <table className="data-table event-table">
        <thead>
          <tr>
            <th>
              발생 시각 <span className="sort-indicator">↓</span>
            </th>
            <th>사람</th>
            <th>AI 서비스</th>
            <th>정책 상태</th>
            <th>감지 항목 · 수량</th>
            <th>
              <span className="sr-only">상세 보기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="time-cell">
                <Link to={"/events/" + event.id + (search ? "?" + search : "")}>
                  {formatDateTime(event.occurredAt)}
                </Link>
              </td>
              <td>
                <PersonName name={event.personName} id={event.personId} />
              </td>
              <td>
                <ServiceLabel service={event.service} model={event.model} />
              </td>
              <td>
                <PolicyBadge state={event.policyState} />
              </td>
              <td>
                <div className="finding-list">
                  {event.findings.length ? (
                    event.findings.map((f) => (
                      <span
                        className={"finding-chip category-" + f.category}
                        key={f.category}
                      >
                        {CATEGORY_LABELS[f.category]}
                        <strong>{formatNumber(f.quantity)}</strong>
                      </span>
                    ))
                  ) : (
                    <span className="muted">감지 항목 없음</span>
                  )}
                </div>
              </td>
              <td>
                <Link
                  className="icon-link"
                  to={"/events/" + event.id + (search ? "?" + search : "")}
                  aria-label={"이벤트 " + event.id + " 상세 보기"}
                >
                  <Icon name="chevron" size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function usePageFilters(personId?: string) {
  const [params, setParams] = useSearchParams();
  const defaults = getDefaultDateRange();
  const range = {
    from: params.get("from") || defaults.from,
    to: params.get("to") || defaults.to,
  };
  let filters: Filters = {};
  let filterError: string | null = null;
  try {
    filters = {
      ...dateRangeToFilters(range),
      service: normalizeServiceFilter(params.get("service")),
      personId: personId || params.get("personId") || undefined,
      category: (params.get("category") || undefined) as Category | undefined,
      policyState: (params.get("policyState") || undefined) as
        PolicyState | undefined,
    };
  } catch (e) {
    filterError = e instanceof Error ? e.message : "조회 기간을 확인해 주세요.";
  }
  const requestedPage = Number(params.get("page"));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage >= 0
      ? requestedPage
      : 0;
  function setPage(value: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(value));
    setParams(next);
  }
  return {
    filters,
    filterError,
    range,
    params,
    setParams,
    page,
    setPage,
    key: JSON.stringify(filters) + (filterError || ""),
  };
}
export type PageFilters = ReturnType<typeof usePageFilters>;
export function FilterBar({
  state,
  hidePerson = false,
  showSearch = false,
}: {
  state: PageFilters;
  hidePerson?: boolean;
  showSearch?: boolean;
}) {
  const [error, setError] = useState("");
  const { params, setParams, range } = state;
  const activeCount = [
    "service",
    "category",
    "policyState",
    ...(hidePerson ? [] : ["personId"]),
  ].filter((k) => params.get(k)).length;
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    const newRange = {
      from: String(data.get("from") || ""),
      to: String(data.get("to") || ""),
    };
    try {
      dateRangeToFilters(newRange);
      normalizeServiceFilter(String(data.get("service") || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "날짜를 확인해 주세요.");
      return;
    }
    for (const [key, value] of data.entries())
      if (String(value).trim()) next.set(key, String(value).trim());
    const service = normalizeServiceFilter(next.get("service"));
    if (service) next.set("service", service);
    else next.delete("service");
    setError("");
    setParams(next);
  }
  function reset() {
    setError("");
    setParams({});
  }
  return (
    <form className="filter-bar" onSubmit={apply} key={params.toString()}>
      <div className="filter-top">
        <div className="filter-caption">
          <Icon name="filter" size={17} />
          <span>조회 조건</span>
          {activeCount > 0 && (
            <span className="filter-count">{activeCount}</span>
          )}
        </div>
        <button className="text-button" type="button" onClick={reset}>
          초기화
        </button>
      </div>
      <div className={"filter-fields " + (showSearch ? "with-search" : "")}>
        <label className="date-range-field">
          <span>
            조회 기간 <small>한국 시간</small>
          </span>
          <span className="date-inputs">
            <input
              type="date"
              name="from"
              aria-label="시작일"
              defaultValue={range.from}
              required
            />
            <span>—</span>
            <input
              type="date"
              name="to"
              aria-label="종료일"
              defaultValue={range.to}
              required
            />
          </span>
        </label>
        <label>
          <span>AI 서비스</span>
          <input
            name="service"
            list="ai-services"
            placeholder="전체 서비스"
            title="영문, 숫자, 하이픈, 밑줄로 된 1~64자 서비스 ID"
            defaultValue={params.get("service") || ""}
          />
          <datalist id="ai-services">
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </datalist>
        </label>
        <label>
          <span>감지 항목</span>
          <select name="category" defaultValue={params.get("category") || ""}>
            <option value="">전체 항목</option>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>정책 상태</span>
          <select
            name="policyState"
            defaultValue={params.get("policyState") || ""}
          >
            <option value="">전체 상태</option>
            {Object.entries(POLICY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!hidePerson && (
          <label>
            <span>사람 ID</span>
            <input
              name="personId"
              placeholder="전체 사람"
              defaultValue={params.get("personId") || ""}
            />
          </label>
        )}
        {showSearch && (
          <label className="search-field">
            <span>사람 검색</span>
            <input
              name="q"
              placeholder="이름 또는 ID"
              defaultValue={params.get("q") || ""}
            />
          </label>
        )}
        <button className="button button-primary apply-button" type="submit">
          조회
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
