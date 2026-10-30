// 형식 검증. 통과해도 실존·유효·소유를 보장하지 않는다. (server/app/detection/validators.py)
import { S_CLASS, digitValue, pyInt } from "./pyre.js";

export function luhnOk(digits) {
  const chars = [...digits].reverse();
  let total = 0;
  for (let i = 0; i < chars.length; i++) {
    let n = digitValue(chars[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }
  return total % 10 === 0;
}

const RRN_SEP = new RegExp(`[-${S_CLASS}]`, "gu");
const CENTURY = { 1: 1900, 2: 1900, 5: 1900, 6: 1900, 3: 2000, 4: 2000, 7: 2000, 8: 2000 };

function validDate(y, m, d) {
  if (!(m >= 1 && m <= 12) || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

/** 주민등록번호 앞 6자리 + 성별자리로 생년월일 유효성만 본다. */
export function rrnDateOk(rrn) {
  const c = [...rrn.replace(RRN_SEP, "")];
  const yy = pyInt(c.slice(0, 2).join(""));
  const mm = pyInt(c.slice(2, 4).join(""));
  const dd = pyInt(c.slice(4, 6).join(""));
  const century = CENTURY[pyInt(c[6] ?? "")];
  if (century === undefined) return false;
  return validDate(century + yy, mm, dd);
}

export function cardOk(value) {
  const digits = [...value.replace(/[ -]/g, "")];
  if (digits.length < 13 || digits.length > 19 || !"3456".includes(digits[0])) return false;
  return luhnOk(digits.join(""));
}

/** JWT 헤더가 alg 를 가진 JSON 객체인지(서명 검증 아님) */
export function jwtHeaderOk(value) {
  const header = value.split(".", 1)[0];
  const b64 = (header + "=".repeat((4 - (header.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof obj === "object" && obj !== null && !Array.isArray(obj) && Object.hasOwn(obj, "alg");
  } catch {
    return false;
  }
}
