import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { Metrics } from "./types";
import { formatNumber, KNOWN_SERVICES } from "./format";
import { Icon, ServiceLabel, EmptyState } from "./ui";

export function Trend({
  metrics,
  interval = "day",
}: {
  metrics: Metrics;
  interval?: string;
}) {
  if (!metrics.summary.eventCount)
    return (
      <div className="chart-empty">
        <Icon name="events" size={26} />
        <p>수집된 Prompt가 생기면 시계열 탐지량이 표시됩니다.</p>
      </div>
    );
  const label = (v: string) =>
    v.length === 10
      ? v.slice(5).replace("-", ".")
      : new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          hour12: false,
        }).format(new Date(v));
  return (
    <div
      className="trend-chart"
      role="img"
      aria-label={
        "시계열 탐지량: Prompt " +
        metrics.summary.eventCount +
        "건, 감지 영역 " +
        metrics.summary.findingCount +
        "개"
      }
    >
      <ResponsiveContainer width="100%" height={248}>
        <LineChart
          data={metrics.series}
          margin={{ top: 15, right: 20, left: -12, bottom: 5 }}
          accessibilityLayer
        >
          <CartesianGrid
            vertical={false}
            stroke="#334155"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="bucket"
            tickFormatter={label}
            tick={{ fill: "#94A3B8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={45}
            dy={8}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#94A3B8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            labelFormatter={(v) => label(String(v))}
            contentStyle={{
              background: "#0F172A",
              border: "1px solid #334155",
              borderRadius: 9,
              fontSize: 12,
              color: "#F1F5F9",
            }}
          />
          <Legend
            iconType="plainline"
            iconSize={17}
            wrapperStyle={{ fontSize: 12, paddingTop: 18 }}
          />
          <Line
            type="monotone"
            dataKey="findingCount"
            name="감지 영역 (개)"
            stroke="#3B82F6"
            strokeWidth={2.5}
            dot={metrics.series.length < 10 ? { r: 3, fill: "#0F172A" } : false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="eventCount"
            name="분석 Prompt (건)"
            stroke="#64748B"
            strokeWidth={1.7}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <span className="chart-unit">
        {interval === "hour" ? "시간별" : "일별"} · 같은 감지 위치는 태그 수와
        관계없이 한 번만 계산합니다.
      </span>
    </div>
  );
}
export function MetricTree({
  metrics,
  href,
}: {
  metrics: Metrics;
  href: (tagId?: string, unmapped?: boolean) => string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const nodes = metrics.tags;
  const max = Math.max(1, ...nodes.map((x) => x.count));
  const visit = (parent: string | null, depth: number): React.ReactNode =>
    nodes
      .filter((n) => n.parentId === parent)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((n) => {
        const children = nodes.some((x) => x.parentId === n.id);
        const open = expanded.has(n.id);
        return (
          <div key={n.id}>
            <div
              className="metric-tree-row"
              style={{ paddingLeft: 18 + depth * 19 }}
            >
              <button
                className={"tree-chevron " + (open ? "expanded" : "")}
                disabled={!children}
                aria-label={n.name + (open ? " 접기" : " 펼치기")}
                aria-expanded={children ? open : undefined}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(n.id)) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  })
                }
              >
                <Icon name="chevron" size={13} />
              </button>
              <Link to={href(n.id)} className="metric-tree-label">
                <span className="tag-dot" style={{ background: n.color }} />
                {n.name}
              </Link>
              <span className="tree-mini-bar" aria-hidden="true">
                <span
                  style={{
                    width: Math.max(0, (n.count / max) * 100) + "%",
                    background: n.color,
                  }}
                />
              </span>
              <Link to={href(n.id)} className="tree-count">
                {formatNumber(n.count)}
                <small>개</small>
              </Link>
              <span className="tree-events">
                {formatNumber(n.eventCount)}건
              </span>
            </div>
            {children && open && visit(n.id, depth + 1)}
          </div>
        );
      });
  return (
    <>
      {nodes.length ? (
        <div className="metric-tree-scroll">{visit(null, 0)}</div>
      ) : (
        <EmptyState
          icon="tree"
          title="이 버전에 등록된 태그가 없습니다"
          description="메트릭 설정에서 태그를 만들고 트리에 배치하세요."
        />
      )}
      {metrics.unmapped.count > 0 && (
        <Link className="unmapped-row" to={href(undefined, true)}>
          <Icon name="info" size={15} />
          선택 버전에 없는 태그
          <span>
            {formatNumber(metrics.unmapped.count)}개
            <Icon name="chevron" size={14} />
          </span>
        </Link>
      )}
      <p className="graph-note">
        상위 태그는 자신과 하위 태그의 감지 영역을 중복 없이 집계합니다.
      </p>
    </>
  );
}
export function ServiceChart({
  metrics,
  serviceFilter,
  href,
}: {
  metrics: Metrics;
  serviceFilter?: string;
  href?: (service: string) => string;
}) {
  const recorded = new Set(metrics.services.map((s) => s.service));
  const services = serviceFilter
    ? metrics.services
    : [
        ...metrics.services,
        ...KNOWN_SERVICES.filter(({ id }) => !recorded.has(id)).map(({ id }) => ({
          service: id,
          eventCount: 0,
          findingCount: 0,
        })),
      ].sort((a, b) => b.eventCount - a.eventCount);
  const max = Math.max(1, ...services.map((s) => s.findingCount));
  if (!services.length)
    return <div className="compact-empty">아직 기록된 서비스가 없습니다.</div>;
  return (
    <div className="service-bars">
      {services.map((s) => {
        const body = (
          <>
            <div className="service-bar-head">
              <ServiceLabel service={s.service} />
              <strong>
                {formatNumber(s.findingCount)}
                <small>개</small>
              </strong>
            </div>
            <div className="service-track">
              <span style={{ width: (s.findingCount / max) * 100 + "%" }} />
            </div>
            <span className="service-bar-note">
              분석 Prompt {formatNumber(s.eventCount)}건
            </span>
          </>
        );
        return href ? (
          <Link
            to={href(s.service)}
            key={s.service}
            className="service-bar-row"
          >
            {body}
          </Link>
        ) : (
          <div key={s.service} className="service-bar-row">
            {body}
          </div>
        );
      })}
    </div>
  );
}
export function PolicyChart({
  metrics,
  href,
}: {
  metrics: Metrics;
  href?: (id: string) => string;
}) {
  const max = Math.max(1, ...metrics.policies.map((p) => p.eventCount));
  if (!metrics.policies.length)
    return (
      <div className="compact-empty">
        정책 상태가 수집되면 분포가 표시됩니다.
      </div>
    );
  return (
    <div className="policy-bars">
      {metrics.policies.map((p) => {
        const content = (
          <>
            <span className="policy-bar-name">
              <span className="tag-dot" style={{ background: p.color }} />
              {p.name}
              {!p.mapped && <small>다른 버전</small>}
            </span>
            <span className="policy-bar-track" aria-hidden="true">
              <span
                style={{
                  width: (p.eventCount / max) * 100 + "%",
                  background: p.color,
                }}
              />
            </span>
            <strong>
              {formatNumber(p.eventCount)}
              <small>건</small>
            </strong>
          </>
        );
        return href && p.mapped ? (
          <Link to={href(p.id)} key={p.id}>
            {content}
          </Link>
        ) : (
          <div key={p.id}>{content}</div>
        );
      })}
      <p className="graph-note">
        정책 정보가 없는 Prompt는 이 분포에서 제외됩니다.
      </p>
    </div>
  );
}
