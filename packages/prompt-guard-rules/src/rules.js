// 정규식·형식 기반 규칙 탐지기. server/app/detection/rules.py 와 같은 규칙·같은 순서.
// 패턴 문자열은 Python 원본을 그대로 옮기고 pyRegExp 로 Unicode 의미를 맞춘다.
// (u 모드에서 허용되지 않는 \" 이스케이프만 " 로 바꾸고, [\s\S] 는 [^] 로 썼다)
import { ipAddress, ipNetwork } from "./ipaddress.js";
import { pyRegExp } from "./pyre.js";
import { cardOk, jwtHeaderOk, rrnDateOk } from "./validators.js";

export const RULESET_VERSION = "rules-0.1.0";

const NB = String.raw`(?<![A-Za-z0-9])`; // 영숫자 경계(한글 인접은 허용)
const NA = String.raw`(?![A-Za-z0-9])`;

const keep = (ok) => (value) => (ok(value) ? { confidence: "high" } : null);

function ipVerdict(value) {
  if (value.includes("/")) {
    const net = ipNetwork(value);
    if (!net) return null;
    return { type: net.isPrivate ? "internal_cidr" : "cidr", confidence: "high" };
  }
  const ip = ipAddress(value);
  if (!ip) return null;
  if (ip.isLoopback || ip.isUnspecified) return { type: "ip_address", confidence: "low" };
  return { type: ip.isPrivate ? "internal_ip" : "ip_address", confidence: "high" };
}

const rule = (ruleId, type, pattern, confidence, opts = {}) => ({
  ruleId, type, confidence, group: opts.group ?? 0, validate: opts.validate ?? null,
  reason: opts.reason ?? "", regex: pyRegExp(pattern, { ignoreCase: !!opts.ignoreCase }),
});

export const RULES = [
  // ── 개인정보 ──
  rule("kr_rrn", "rrn", String.raw`(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)`, "high",
    { validate: keep(rrnDateOk), reason: "주민등록번호 형식" }),
  rule("kr_mobile", "phone", String.raw`(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)`, "high",
    { reason: "휴대전화번호 형식" }),
  rule("kr_landline", "phone", String.raw`(?<!\d)0(?:2|[3-6][1-5])-\d{3,4}-\d{4}(?!\d)`, "high",
    { reason: "유선전화번호 형식" }),
  rule("email", "email", String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`, "high",
    { reason: "이메일 주소 형식" }),
  rule("kr_passport", "passport", NB + String.raw`[MSRODG](?:\d{8}|\d{3}[A-Z]\d{4})` + NA, "medium",
    { reason: "여권번호 형식" }),
  rule("kr_driver_license", "driver_license", String.raw`(?<!\d)(?:1[1-9]|2[0-8])-\d{2}-\d{6}-\d{2}(?!\d)`,
    "medium", { reason: "운전면허번호 형식" }),
  // ── 금융정보 ──
  rule("credit_card", "credit_card", String.raw`(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)`, "high",
    { validate: keep(cardOk), reason: "카드번호 형식 및 Luhn 체크섬 일치" }),
  rule("kr_bank_account_ctx", "bank_account",
    String.raw`(?:계좌|account)(?:번호|\s*(?:no\.?|number))?\s*[:：]?\s*` +
      String.raw`(\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?|\d{10,14})(?!\d)`,
    "medium", { group: 1, ignoreCase: true, reason: "'계좌' 문맥과 계좌번호 형식" }),
  // ── 인증정보 ──
  rule("aws_access_key_id", "aws_access_key_id", NB + String.raw`(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}` + NA,
    "high", { reason: "AWS Access Key ID 형식" }),
  rule("github_token", "github_token",
    NB + String.raw`(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})` + NA, "high",
    { reason: "GitHub 토큰 형식" }),
  rule("jwt", "jwt", String.raw`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*`, "high",
    { validate: keep(jwtHeaderOk), reason: "JWT 형식(서명 검증 아님)" }),
  rule("pem_private_key", "private_key",
    String.raw`-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[^]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|\Z)`,
    "high", { reason: "PEM 개인키 블록" }),
  rule("password_assignment", "password",
    // 정제 토큰([PASSWORD_1] 등)은 재검사에서 다시 잡지 않는다.
    String.raw`(?:password|passwd|pwd|비밀번호|비번|패스워드)\s*[:=]\s*["']?(?!\[[A-Z_]+_\d+\])([^\s"']{4,})`,
    "low", { group: 1, ignoreCase: true, reason: "비밀번호 키 뒤의 값" }),
  rule("secret_assignment", "secret_config_value",
    String.raw`(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret)` +
      String.raw`["']?\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{8,})`,
    "medium", { group: 1, ignoreCase: true, reason: "설정 키에 할당된 비밀 값" }),
  // ── 인프라 정보 ──
  rule("url_with_credentials", "url_with_credentials",
    String.raw`\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@[^\s]+`, "high",
    { ignoreCase: true, reason: "자격증명이 포함된 URL" }),
  rule("url", "url", String.raw`\bhttps?://[^\s<>"']+`, "high", { ignoreCase: true, reason: "URL" }),
  rule("internal_domain", "internal_domain",
    String.raw`\b(?:[a-z0-9-]+\.)+(?:internal|local|corp|lan|intra)\b`, "medium",
    { ignoreCase: true, reason: "내부용 도메인 접미사" }),
  rule("ipv4", "ip_address", String.raw`(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?(?![\d.])`, "high",
    { validate: ipVerdict, reason: "IPv4 주소/CIDR" }),
  rule("ipv6", "ip_address",
    String.raw`(?<![:\w])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?:/\d{1,3})?(?![:\w])`, "high",
    { validate: ipVerdict, reason: "IPv6 주소/CIDR" }),
  rule("mac_address", "mac_address",
    String.raw`(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])`, "high",
    { reason: "MAC 주소 형식" }),
  // ── 보안정보 ──
  rule("cve", "cve", String.raw`\bCVE-\d{4}-\d{4,7}\b`, "high", { ignoreCase: true, reason: "CVE 식별자" }),
];

/**
 * 규칙 탐지. 후보의 start/end 는 UTF-16 위치(JS 문자열 인덱스)다.
 * @returns {{type, ruleId, start, end, confidence, detector, reason}[]}
 */
export function detect(text, rules = RULES) {
  const out = [];
  for (const r of rules) {
    r.regex.lastIndex = 0;
    for (const m of text.matchAll(r.regex)) {
      const value = m[r.group];
      if (!value) continue;
      let { type, confidence } = r;
      if (r.validate) {
        const verdict = r.validate(value);
        if (!verdict) continue;
        type = verdict.type || type;
        confidence = verdict.confidence;
      }
      const [start, end] = m.indices[r.group];
      out.push({ type, ruleId: r.ruleId, start, end, confidence, detector: "rule", reason: r.reason });
    }
  }
  return out;
}
