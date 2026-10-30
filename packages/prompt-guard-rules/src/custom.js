// 대시보드 사용자 규칙(키워드·정규식) — server/app/detection/custom.py 와 같은 동작.
// 규칙은 서버 /v1/rules/bundle 의 custom_rules 로 받는다. 정규식은 서버가 Python·JS 공통 문법만 허용해 저장한다.
import { pyRegExp } from "./pyre.js";

// u 모드에서 이스케이프가 허용되는 구문 문자만 이스케이프한다(Python re.escape 와 같은 리터럴 의미).
const escapeLiteral = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
const cpLength = (s) => [...s].length;

export function compileCustomRule(rule) {
  if (rule.kind === "keywords") {
    // 긴 키워드 우선(Python sorted(key=len, reverse=True) 와 같은 안정 정렬)
    const words = [...rule.keywords].sort((a, b) => cpLength(b) - cpLength(a));
    return new RegExp(words.map(escapeLiteral).join("|"), "gdu" + (rule.case_sensitive ? "" : "i"));
  }
  return pyRegExp(rule.pattern, { ignoreCase: !rule.case_sensitive });
}

/**
 * @returns {{ detect(text): object[], skipped: {id, error}[] }}
 * JS 에서 컴파일되지 않는 규칙은 건너뛰고 skipped 로 알려 준다(서버 판정에는 영향 없음).
 */
export function customDetector(rules) {
  const compiled = [];
  const skipped = [];
  for (const rule of rules.filter((r) => r.enabled !== false)) {
    try {
      compiled.push([rule, compileCustomRule(rule)]);
    } catch (e) {
      skipped.push({ id: rule.id, error: e.message });
    }
  }
  return {
    skipped,
    detect(text) {
      const out = [];
      for (const [rule, re] of compiled) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
          if (!m[0]) continue;
          out.push({
            type: rule.id, ruleId: `custom:${rule.id}`, start: m.index, end: m.index + m[0].length,
            confidence: "high", detector: "rule", reason: rule.reason || rule.label,
          });
        }
      }
      return out;
    },
  };
}
