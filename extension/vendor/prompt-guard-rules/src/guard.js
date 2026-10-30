// 검사·정제 파이프라인(server/app/services/pipeline.py 의 규칙 부분).
// 로컬 모델 문맥 탐지는 포함하지 않는다. 정책이 모델 검사를 요구하면 status=incomplete 로 표시한다.
import defaultBundle from "../data/policy.js";
import { customDetector } from "./custom.js";
import { merge } from "./merge.js";
import { Policy, decide } from "./policy.js";
import { codePointIndex } from "./pyre.js";
import { RULESET_VERSION, detect } from "./rules.js";
import { applyTokens, assignTokens } from "./sanitize.js";

const SIGNAL = { allow: "green", warn: "yellow", block: "red" };
const STATUS_ORDER = ["complete", "incomplete", "error"];

/**
 * @param {object} [options]
 * @param {object|Policy} [options.policy] 정책 번들(기본: 서버 정책을 내보낸 data/policy.js)
 * @param {object} [options.ruleset] 서버 /v1/rules/bundle 응답(기본: 정책 번들에 든 초기 ruleset)
 * @param {() => (Date|string)} [options.today] 목적지 근거 만료 판단 기준일
 */
export function createGuard({ policy = defaultBundle, ruleset, today = () => new Date() } = {}) {
  const base = policy instanceof Policy ? policy : new Policy(policy);
  const rs = ruleset ?? (policy instanceof Policy ? null : policy.ruleset) ?? null;
  const pol = rs ? base.withCustomTypes([...rs.custom_rules, ...rs.context_detectors]) : base;
  const custom = customDetector(rs && rs.modules?.custom_rules !== false ? rs.custom_rules : []);
  const detectorVersions = { rules: RULESET_VERSION, ...(rs ? { ruleset: `rs-${rs.ruleset_version}` } : {}) };

  function candidates(text) {
    return [...detect(text), ...custom.detect(text)].map((c) => ({
      ...c, cpStart: codePointIndex(text, c.start), cpEnd: codePointIndex(text, c.end),
    }));
  }

  function analyze(text) {
    const notices = [];
    let status = "complete";
    if (pol.modelRequired) {
      status = "incomplete";
      notices.push("model_check_required_but_disabled");
    }
    const merged = merge(candidates(text), (c) => pol.priority(c));
    let decision = decide(merged.map((m) => pol.actionFor(m.primary.type)));
    if (status !== "complete") {
      if (decision === "allow") decision = "warn"; // 검사 미완료면 allow 로 내보내지 않는다
      return { status, decision, signal: "gray", merged, notices };
    }
    return { status, decision, signal: SIGNAL[decision], merged, notices };
  }

  function toFindings(merged) {
    return merged.map((m, i) => {
      const c = m.primary;
      const tp = pol.forType(c.type);
      const action = pol.actionFor(c.type);
      return {
        finding_id: `f${i + 1}`,
        type: c.type,
        category: tp.category,
        rule_id: c.ruleId,
        detector: c.detector === "model" ? "model" : "rule",
        confidence: c.confidence,
        severity: tp.severity,
        action,
        span: { start: c.cpStart, end: c.cpEnd, start_utf16: c.start, end_utf16: c.end },
        reason: c.reason,
        replacement: action === "allow" || action === "block" ? null : `[${tp.token}_n]`,
      };
    });
  }

  function resolve(destination) {
    return pol.resolveDestination(destination?.provider ?? null, destination?.channel ?? null, today());
  }

  const destOut = (d) => ({
    provider: d.provider, channel: d.channel, tier: d.tier.name, verified: d.verified, basis: d.basis,
  });

  /** 서버 /v1/inspect 응답과 같은 구조(request_id, input_version 제외) */
  function inspect(text, { destination } = {}) {
    const [dest, destNotices] = resolve(destination);
    const a = analyze(text);
    return {
      status: a.status,
      decision: a.decision,
      signal: a.signal,
      findings: toFindings(a.merged),
      policy_version: pol.version,
      destination: destOut(dest),
      detector_versions: { ...detectorVersions },
      notices: [...destNotices, ...a.notices],
    };
  }

  /** 서버 /v1/sanitize 응답과 같은 구조. 직접 검사 → mask/warn 구간 치환 → 재검사 */
  function sanitize(text, { destination } = {}) {
    const [dest, destNotices] = resolve(destination);
    const first = analyze(text);
    const targets = first.merged
      .filter((m) => ["mask", "warn"].includes(pol.actionFor(m.primary.type)))
      .map((m) => ({ start: m.primary.start, end: m.primary.end, type: m.primary.type,
                     tokenPrefix: pol.forType(m.primary.type).token }));
    const tokens = assignTokens(text, targets);
    const sanitized = applyTokens(text, tokens);

    const second = analyze(sanitized);
    const status = [first.status, second.status].reduce((a, b) =>
      STATUS_ORDER.indexOf(b) > STATUS_ORDER.indexOf(a) ? b : a);
    let { decision, signal } = second;
    if (status !== "complete") {
      signal = "gray";
      if (decision === "allow") decision = "warn";
    }
    const changes = new Map();
    for (const [r, token] of tokens) {
      const key = `${r.type}\u0000${token}`;
      const prev = changes.get(key);
      changes.set(key, { type: r.type, token, count: (prev?.count ?? 0) + 1 });
    }
    return {
      status,
      sanitized_text: sanitized,
      decision,
      signal,
      changes: [...changes.values()],
      remaining_findings: toFindings(second.merged),
      policy_version: pol.version,
      destination: destOut(dest),
      detector_versions: { ...detectorVersions },
      notices: [...destNotices, ...[...new Set([...first.notices, ...second.notices])].sort()],
    };
  }

  // 서버 요청 형식 그대로 받고 request_id·input_version 을 돌려준다.
  const withIds = (req, body) => ({ request_id: req.request_id, input_version: req.input_version, ...body });
  const inspectRequest = (req) => withIds(req, inspect(req.text, { destination: req.context?.destination }));
  const sanitizeRequest = (req) => withIds(req, sanitize(req.text, { destination: req.context?.destination }));

  return {
    policy: pol, inspect, sanitize, inspectRequest, sanitizeRequest, detect: candidates,
    rulesetVersion: rs?.ruleset_version ?? null,
    skippedRules: custom.skipped, // JS 에서 컴파일하지 못한 사용자 규칙
  };
}
