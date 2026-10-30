// Python `re`(str 패턴) 의 Unicode 동작을 JS 정규식으로 맞추기 위한 조각.
// JS 의 \d \w \b 는 ASCII 기준이라 한글·전각 문자 주변에서 Python 과 결과가 달라진다.

/** Python \d : Unicode 십진 숫자 */
export const D = "\\p{Nd}";
/** Python \w : 문자·숫자·밑줄 */
export const W = "[\\p{L}\\p{N}_]";
const W_INNER = "\\p{L}\\p{N}_";
/** Python \s : str.isspace() 와 같은 공백 집합 */
const S_INNER = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const S = `[${S_INNER}]`;
export const NOT_S = `[^${S_INNER}]`;
/** 문자 클래스 안에 넣을 \s / \w 내용 */
export const S_CLASS = S_INNER;
export const W_CLASS = W_INNER;
/** Python \b : \w 와 비\w 의 경계 */
export const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

/**
 * 패턴 문자열의 \d \s \w \b 를 Python 의미로 바꾼다.
 * 문자 클래스 안([...])의 \d \s \w 도 펼친다. 이스케이프된 백슬래시는 그대로 둔다.
 */
export function pyPattern(src) {
  let out = "";
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      const nx = src[i + 1];
      i++;
      if (nx === "d") out += inClass ? "\\p{Nd}" : D;
      else if (nx === "w") out += inClass ? W_INNER : W;
      else if (nx === "s") out += inClass ? S_INNER : S;
      else if (nx === "b" && !inClass) out += B;
      else if (nx === "Z" && !inClass) out += "$";
      else out += "\\" + nx;
      continue;
    }
    if (ch === "[" && !inClass) inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    out += ch;
  }
  return out;
}

/** Python 패턴 문자열 → JS RegExp (g: 반복, d: 그룹 위치, u: Unicode) */
export function pyRegExp(src, { ignoreCase = false } = {}) {
  return new RegExp(pyPattern(src), "gdu" + (ignoreCase ? "i" : ""));
}

/** Unicode 십진 숫자(\p{Nd}) 한 글자의 값. 숫자 블록은 0부터 10개씩 연속한다. */
export function digitValue(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  if (!/^\p{Nd}$/u.test(ch)) return NaN;
  let start = cp;
  while (start > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

/** Python int() 처럼 Unicode 숫자 문자열을 정수로 바꾼다(숫자가 아니면 NaN). */
export function pyInt(str) {
  const chars = [...str];
  if (!chars.length) return NaN;
  let n = 0;
  for (const ch of chars) {
    const d = digitValue(ch);
    if (Number.isNaN(d)) return NaN;
    n = n * 10 + d;
  }
  return n;
}

/** UTF-16 위치 → code point 위치(Python 문자열 인덱스) */
export function codePointIndex(text, utf16Index) {
  let cp = 0;
  for (let i = 0; i < utf16Index; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < utf16Index) i++;
    cp++;
  }
  return cp;
}
