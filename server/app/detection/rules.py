"""정규식·형식 기반 규칙 탐지기.

초기 지원 형식은 한국 기준이다(주민등록번호, 휴대전화, 여권, 운전면허, 계좌).
국가별 확장은 rule_id 접두어(kr_, us_ ...)로 분리해 추가한다.
"""

from __future__ import annotations

import base64
import json
import re
from collections.abc import Callable
from dataclasses import dataclass

from app.detection.base import Candidate
from app.detection.validators import luhn_ok, parse_ip, parse_network, rrn_date_ok
from app.schemas import Confidence

RULESET_VERSION = "rules-0.1.0"

# 검증 함수: 매치 값 → (타입 재지정 또는 None, 신뢰도) 또는 None(버림)
Validator = Callable[[str], "tuple[str | None, Confidence] | None"]


@dataclass(frozen=True)
class Rule:
    rule_id: str
    type: str
    pattern: re.Pattern[str]
    confidence: Confidence
    group: int = 0
    validate: Validator | None = None
    reason: str = ""


def _rrn(value: str):
    return (None, Confidence.HIGH) if rrn_date_ok(value) else None


def _card(value: str):
    digits = re.sub(r"[ -]", "", value)
    if not 13 <= len(digits) <= 19 or digits[0] not in "3456":
        return None
    return (None, Confidence.HIGH) if luhn_ok(digits) else None


def _jwt(value: str):
    header = value.split(".", 1)[0]
    try:
        decoded = json.loads(base64.urlsafe_b64decode(header + "=" * (-len(header) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    return (None, Confidence.HIGH) if isinstance(decoded, dict) and "alg" in decoded else None


def _ip(value: str):
    if "/" in value:
        net = parse_network(value)
        if net is None:
            return None
        return ("internal_cidr" if net.is_private else "cidr", Confidence.HIGH)
    ip = parse_ip(value)
    if ip is None:
        return None
    if ip.is_loopback or ip.is_unspecified:
        return ("ip_address", Confidence.LOW)
    return ("internal_ip" if ip.is_private else "ip_address", Confidence.HIGH)


_NB = r"(?<![A-Za-z0-9])"  # 영숫자 경계(한글 인접은 허용)
_NA = r"(?![A-Za-z0-9])"


def _r(p: str, flags: int = 0) -> re.Pattern[str]:
    return re.compile(p, flags)


RULES: list[Rule] = [
    # ── 개인정보 ──
    Rule("kr_rrn", "rrn", _r(r"(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)"), Confidence.HIGH,
         validate=_rrn, reason="주민등록번호 형식"),
    Rule("kr_mobile", "phone", _r(r"(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"),
         Confidence.HIGH, reason="휴대전화번호 형식"),
    Rule("kr_landline", "phone", _r(r"(?<!\d)0(?:2|[3-6][1-5])-\d{3,4}-\d{4}(?!\d)"),
         Confidence.HIGH, reason="유선전화번호 형식"),
    Rule("email", "email", _r(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
         Confidence.HIGH, reason="이메일 주소 형식"),
    Rule("kr_passport", "passport", _r(_NB + r"[MSRODG](?:\d{8}|\d{3}[A-Z]\d{4})" + _NA),
         Confidence.MEDIUM, reason="여권번호 형식"),
    Rule("kr_driver_license", "driver_license",
         _r(r"(?<!\d)(?:1[1-9]|2[0-8])-\d{2}-\d{6}-\d{2}(?!\d)"), Confidence.MEDIUM,
         reason="운전면허번호 형식"),
    # ── 금융정보 ──
    Rule("credit_card", "credit_card", _r(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)"), Confidence.HIGH,
         validate=_card, reason="카드번호 형식 및 Luhn 체크섬 일치"),
    Rule("kr_bank_account_ctx", "bank_account",
         _r(r"(?:계좌|account)(?:번호|\s*(?:no\.?|number))?\s*[:：]?\s*"
            r"(\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?|\d{10,14})(?!\d)", re.IGNORECASE),
         Confidence.MEDIUM, group=1, reason="'계좌' 문맥과 계좌번호 형식"),
    # ── 인증정보 ──
    Rule("aws_access_key_id", "aws_access_key_id",
         _r(_NB + r"(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}" + _NA), Confidence.HIGH,
         reason="AWS Access Key ID 형식"),
    Rule("github_token", "github_token",
         _r(_NB + r"(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})" + _NA),
         Confidence.HIGH, reason="GitHub 토큰 형식"),
    Rule("jwt", "jwt", _r(r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*"),
         Confidence.HIGH, validate=_jwt, reason="JWT 형식(서명 검증 아님)"),
    Rule("pem_private_key", "private_key",
         _r(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|\Z)"),
         Confidence.HIGH, reason="PEM 개인키 블록"),
    Rule("password_assignment", "password",
         # 정제 토큰([PASSWORD_1] 등)은 재검사에서 다시 잡지 않는다.
         _r(r"(?:password|passwd|pwd|비밀번호|비번|패스워드)\s*[:=]\s*[\"']?"
            r"(?!\[[A-Z_]+_\d+\])([^\s\"']{4,})",
            re.IGNORECASE),
         Confidence.LOW, group=1, reason="비밀번호 키 뒤의 값"),
    Rule("secret_assignment", "secret_config_value",
         _r(r"(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret)"
            r"[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_\-./+=]{8,})", re.IGNORECASE),
         Confidence.MEDIUM, group=1, reason="설정 키에 할당된 비밀 값"),
    # ── 인프라 정보 ──
    Rule("url_with_credentials", "url_with_credentials",
         _r(r"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@[^\s]+", re.IGNORECASE), Confidence.HIGH,
         reason="자격증명이 포함된 URL"),
    Rule("url", "url", _r(r"\bhttps?://[^\s<>\"']+", re.IGNORECASE), Confidence.HIGH,
         reason="URL"),
    Rule("internal_domain", "internal_domain",
         _r(r"\b(?:[a-z0-9-]+\.)+(?:internal|local|corp|lan|intra)\b", re.IGNORECASE),
         Confidence.MEDIUM, reason="내부용 도메인 접미사"),
    Rule("ipv4", "ip_address", _r(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?(?![\d.])"),
         Confidence.HIGH, validate=_ip, reason="IPv4 주소/CIDR"),
    Rule("ipv6", "ip_address",
         _r(r"(?<![:\w])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?:/\d{1,3})?(?![:\w])"),
         Confidence.HIGH, validate=_ip, reason="IPv6 주소/CIDR"),
    Rule("mac_address", "mac_address",
         _r(r"(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])"),
         Confidence.HIGH, reason="MAC 주소 형식"),
    # ── 보안정보 ──
    Rule("cve", "cve", _r(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE), Confidence.HIGH,
         reason="CVE 식별자"),
    # TODO: 시스템 로그·설정 키(지원 제품·키 이름 합의 후 추가)
]


class RuleDetector:
    name = "rules"
    version = RULESET_VERSION

    def __init__(self, rules: list[Rule] | None = None) -> None:
        self.rules = rules if rules is not None else RULES

    def detect(self, text: str) -> list[Candidate]:
        out: list[Candidate] = []
        for rule in self.rules:
            for m in rule.pattern.finditer(text):
                value = m.group(rule.group)
                if not value:
                    continue
                type_, conf = rule.type, rule.confidence
                if rule.validate is not None:
                    verdict = rule.validate(value)
                    if verdict is None:
                        continue
                    type_ = verdict[0] or type_
                    conf = verdict[1]
                out.append(Candidate(type=type_, rule_id=rule.rule_id, start=m.start(rule.group),
                                     end=m.end(rule.group), confidence=conf, reason=rule.reason))
        return out
