// 대시보드 사용자 규칙(키워드·정규식) — server/app/detection/custom.py 와 같은 동작.
// 규칙은 서버 /v1/rules/bundle 의 custom_rules 로 받는다. 정규식은 서버가 Python·JS 공통 문법만 허용해 저장한다.
import { pyRegExp } from "./pyre.js";

// u 모드에서 이스케이프가 허용되는 구문 문자만 이스케이프한다(Python re.escape 와 같은 리터럴 의미).
const escapeLiteral = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
const cpLength = (s) => [...s].length;
const ASCII_WORD = /^[A-Za-z0-9]$/;
const NESTED_QUANT = /\((?:[^()\\]|\\.)*(?:[*+]|\{\d*,\d*\})(?:[^()\\]|\\.)*\)(?:[*+]|\{\d*,\d*\})/;

// 영문·숫자로 시작/끝나는 키워드는 영단어 경계를 둔다("Confidential" 이 "confidentially" 를 잡지 않게).
// 한글로 끝나는 키워드는 조사가 붙어도 잡도록 경계를 두지 않는다("블루문은"). (custom.py keyword_pattern)
function keywordPattern(word) {
  const chars = [...word];
  let p = escapeLiteral(word);
  if (ASCII_WORD.test(chars[0])) p = "(?<![A-Za-z0-9])" + p;
  if (ASCII_WORD.test(chars[chars.length - 1])) p += "(?![A-Za-z0-9])";
  return p;
}

export function compileCustomRule(rule) {
  if (rule.kind === "keywords") {
    // 긴 키워드 우선(Python sorted(key=len, reverse=True) 와 같은 안정 정렬)
    const words = [...rule.keywords].sort((a, b) => cpLength(b) - cpLength(a));
    return new RegExp(words.map(keywordPattern).join("|"), "gdu" + (rule.case_sensitive ? "" : "i"));
  }
  if (cpLength(rule.pattern) > 4000) throw new Error("정규식은 4000자 이하만 허용합니다");
  if (NESTED_QUANT.test(rule.pattern)) throw new Error("중첩 수량자는 허용하지 않습니다");
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
