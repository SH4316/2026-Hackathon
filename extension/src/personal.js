// 개인 정규식 규칙: 사용자가 설정 화면에서 이 브라우저에만 추가하는 규칙.
// - 서버는 이 규칙을 모른다. 그래서 서비스 워커가 서버 판정에 개인 규칙 탐지 결과를 더해 판정을 '강화만' 한다.
//   개인 규칙으로 서버의 탐지를 취소하거나 조치를 약하게 만들 수 없다.
// - 정규식 제한은 서버 사용자 규칙(server/app/registry/validate.py)과 같다. 문법은 Python 의미(\d \w \b 는 Unicode).
// - 규칙(이름·패턴)만 chrome.storage.local 에 저장한다. 시험 문장·원문은 저장하지 않는다.
import defaultBundle from "../vendor/prompt-guard-rules/data/policy.js";
import { applyTokens, assignTokens, createGuard, decide } from "../vendor/prompt-guard-rules/src/index.js";
import { codePointIndex, pyRegExp } from "../vendor/prompt-guard-rules/src/pyre.js";

export const STORAGE_KEY = "personalRules";
export const MAX_RULES = 50;
export const MAX_PATTERN_LEN = 4000;
// 서버 토큰([EMAIL_1] 등)과 겹치지 않도록 개인 규칙 토큰에는 항상 붙인다.
export const TOKEN_PREFIX = "MY_";
export const ACTIONS = ["warn", "mask", "block"];

const FORBIDDEN = [
  [/\(\?P/, "Python 전용 이름 그룹 (?P...)"],
  [/\(\?<[A-Za-z]/, "이름 그룹 (?<name>...)"],
  [/\(\?[aiLmsux-]+[):]/, "인라인 플래그 (?i) 등(대소문자는 '대소문자 구분'으로 지정)"],
  [/\(\?>/, "원자 그룹 (?>...)"],
  [/\(\?\(/, "조건 그룹"],
  [/\\[AZzG]/, "\\A \\Z \\z \\G 앵커(^ $ 를 사용)"],
  [/\\[1-9]/, "역참조 \\1"],
  [/\\[pPN]\{?/, "\\p \\N 속성 이스케이프"],
  [/[*+?}][+]/, "소유 수량자 *+ ++ ?+ }+"],
];
// 수량자가 붙은 그룹 안에 또 수량자가 있는 패턴: (a+)+, (\w*)*, (x{1,}){2,} 등
const NESTED_QUANT = /\((?:[^()\\]|\\.)*(?:[*+]|\{\d*,\d*\})(?:[^()\\]|\\.)*\)(?:[*+]|\{\d*,\d*\})/;
const TOKEN_RE = /^[A-Z][A-Z0-9_]{1,30}$/;
const SERVER_TOKEN_RE = /\[[A-Z][A-Z0-9_]*_\d+\]/g;

/** @returns {RegExp} 검사를 통과한 정규식. 실패하면 Error(사유) */
export function checkPattern(pattern, caseSensitive = false) {
  if (!pattern) throw new Error("정규식을 입력하세요");
  if (pattern.length > MAX_PATTERN_LEN) throw new Error(`${MAX_PATTERN_LEN}자 이하만 허용`);
  for (const [re, why] of FORBIDDEN) if (re.test(pattern)) throw new Error(why);
  if (NESTED_QUANT.test(pattern)) throw new Error("중첩 수량자(예: (a+)+)는 처리 시간이 폭증할 수 있음");
  let compiled;
  try {
    compiled = pyRegExp(pattern, { ignoreCase: !caseSensitive });
  } catch (e) {
    throw new Error(`문법 오류: ${e.message}`);
  }
  if (compiled.exec("") !== null) throw new Error("빈 문자열과 일치하는 패턴은 허용하지 않음");
  return compiled;
}

export function normalizeToken(token) {
  const t = String(token || "").trim().toUpperCase();
  return t.startsWith(TOKEN_PREFIX) ? t : TOKEN_PREFIX + t;
}

/** 저장 전 검사. 문제가 없으면 null, 있으면 사유 문자열 */
export function validateRule(rule) {
  if (!rule.label?.trim() || rule.label.length > 60) return "이름은 1~60자로 입력하세요";
  if (!ACTIONS.includes(rule.action)) return "조치를 선택하세요";
  if (!TOKEN_RE.test(rule.token)) return "토큰 이름은 영문 대문자로 시작하고 영문 대문자·숫자·_ 만 쓸 수 있습니다";
  try {
    checkPattern(rule.pattern, rule.case_sensitive);
  } catch (e) {
    return e.message;
  }
  return null;
}

export function newRuleId() {
  return `my_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 개인 규칙 → 규칙 엔진의 사용자 규칙(regex) 형식 */
export function toCustomRules(rules) {
  return rules.filter((r) => r.enabled !== false && !validateRule(r)).map((r) => ({
    id: r.id, label: r.label, category: "personal", severity: r.action === "warn" ? "medium" : "high",
    action: r.action, token: r.token, enabled: true, kind: "regex", pattern: r.pattern,
    case_sensitive: !!r.case_sensitive, reason: `${r.label}(개인 규칙)`,
  }));
}

/** 기본 규칙 + 대시보드 기본 ruleset + 개인 규칙으로 만든 브라우저 규칙 엔진(입력 즉시 표시용) */
export function localGuard(rules, bundle = null) {
  const base = bundle || defaultBundle.ruleset;
  const org = bundle?.org_rules;
  const organization = (org?.regex || []).map((r) => ({
    id: r.type || r.tag_id, label: r.name, category: "organization", severity: "high",
    action: org.tag_action || "mask", token: r.token, enabled: true, kind: "regex",
    pattern: r.pattern, case_sensitive: true, reason: `${r.name}(조직 규칙)`,
  }));
  const guard = createGuard({ ruleset: { ...base, modules: { ...base.modules, custom_rules: true },
    context_detectors: base.context_detectors || [],
    custom_rules: [...(base.modules?.custom_rules === false ? [] : base.custom_rules || []),
      ...organization, ...toCustomRules(rules)] } });
  // pyre.js를 쓰는 엔진이 Python 전용 문법을 컴파일하지 못하면 건너뛴다.
  // 규칙 본문이나 검사 원문은 기록하지 않는다. 최종 판정은 계속 서버가 담당한다.
  if (guard.skippedRules.length) console.warn("Prompt Guard: 로컬 규칙 컴파일 생략", guard.skippedRules.map(({ id }) => id));
  return guard;
}

/** 시험: 일치 구간(UTF-16 위치) */
export function testRule(rule, text) {
  const re = checkPattern(rule.pattern, rule.case_sensitive);
  return [...text.matchAll(re)].filter((m) => m[0]).map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

// ── 서버 판정과 병합(서비스 워커) ──
const SIGNAL = { allow: "green", warn: "yellow", block: "red" };
const DECISION_RANK = { allow: 0, warn: 1, block: 2 };
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const utf16Span = (f) => ({ start: f.span.start_utf16, end: f.span.end_utf16 });

let cache = { key: null, guard: null, ids: null };
function personalGuard(rules) {
  const custom = toCustomRules(rules);
  const key = JSON.stringify(custom);
  if (cache.key !== key) {
    cache = {
      key,
      guard: createGuard({ ruleset: { ruleset_version: 0, modules: { custom_rules: true }, custom_rules: custom, context_detectors: [] } }),
      ids: new Set(custom.map((r) => r.id)),
    };
  }
  return cache;
}

// 개인 규칙 탐지 결과 중 이미 잡힌 구간(서버 탐지·토큰)과 겹치지 않는 것만
function personalFindings(rules, text, destination, taken) {
  const { guard, ids } = personalGuard(rules);
  if (!ids.size) return [];
  return guard.inspect(text, { destination }).findings
    .filter((f) => ids.has(f.type) && !taken.some((t) => overlaps(utf16Span(f), t)))
    .map((f) => ({ ...f, rule_id: `personal:${f.type}` }));
}

function combine(status, serverDecision, extraActions) {
  const extra = decide(extraActions);
  const decision = DECISION_RANK[extra] > DECISION_RANK[serverDecision] ? extra : serverDecision;
  return { decision, signal: status === "complete" ? SIGNAL[decision] : "gray" };
}

const byStart = (a, b) => a.span.start_utf16 - b.span.start_utf16;
const renumber = (findings) => findings.sort(byStart).map((f, i) => ({ ...f, finding_id: `f${i + 1}` }));

/** /v1/inspect 응답 + 개인 규칙 */
export function mergeInspect(result, text, rules, destination) {
  if (!result || !rules?.length) return result;
  const extra = personalFindings(rules, text, destination, result.findings.map(utf16Span));
  if (!extra.length) return result;
  return {
    ...result,
    ...combine(result.status, result.decision, extra.map((f) => f.action)),
    findings: renumber([...result.findings, ...extra]),
  };
}

// 앞쪽 치환으로 생긴 길이 차이만큼 뒤쪽 구간 위치를 옮긴다.
function shiftFinding(f, text, tokens) {
  let d16 = 0;
  let dcp = 0;
  for (const [r, token] of tokens) {
    if (r.end > f.span.start_utf16) continue;
    d16 += token.length - (r.end - r.start);
    dcp += token.length - (codePointIndex(text, r.end) - codePointIndex(text, r.start));
  }
  return { ...f, span: { start: f.span.start + dcp, end: f.span.end + dcp,
                         start_utf16: f.span.start_utf16 + d16, end_utf16: f.span.end_utf16 + d16 } };
}

/**
 * /v1/sanitize 응답 + 개인 규칙. 서버 정제문에 남은 개인 규칙 구간(mask·warn)을 [MY_..._n] 으로 치환한다.
 * 원문 순서대로 번호를 매기므로 PG.restore 가 원문 검사 결과로 같은 정제문을 다시 만들 수 있다.
 */
export function mergeSanitize(result, rules, destination) {
  const text = result?.sanitized_text;
  if (text == null || !rules?.length) return result;
  const taken = [...text.matchAll(SERVER_TOKEN_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  taken.push(...result.remaining_findings.map(utf16Span));
  const found = personalFindings(rules, text, destination, taken);
  if (!found.length) return result;

  const targets = found.filter((f) => f.action === "mask" || f.action === "warn").map((f) => ({
    ...utf16Span(f), type: f.type, tokenPrefix: f.replacement.slice(1, -3),
  }));
  const tokens = assignTokens(text, targets);
  const sanitized = applyTokens(text, tokens);
  const changes = new Map();
  for (const [r, token] of tokens) {
    const key = `${r.type}\u0000${token}`;
    changes.set(key, { type: r.type, token, count: (changes.get(key)?.count ?? 0) + 1 });
  }
  // 치환하지 않은 개인 규칙 구간(block)은 남은 항목이다.
  const remaining = [
    ...result.remaining_findings,
    ...found.filter((f) => f.action !== "mask" && f.action !== "warn"),
  ].map((f) => shiftFinding(f, text, tokens));
  return {
    ...result,
    ...combine(result.status, result.decision, remaining.map((f) => f.action)),
    sanitized_text: sanitized,
    changes: [...result.changes, ...changes.values()],
    remaining_findings: renumber(remaining),
  };
}
