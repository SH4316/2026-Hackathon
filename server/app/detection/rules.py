"""정규식·형식 기반 규칙 탐지기.

초기 지원 형식은 한국 기준이다(주민등록번호, 휴대전화, 여권, 운전면허, 계좌).
국가별 확장은 rule_id 접두어(kr_, us_ ...)로 분리해 추가한다.
"""

from __future__ import annotations

import base64
import json
import re
from datetime import date
from collections.abc import Callable
from dataclasses import dataclass

from app.detection.base import Candidate
from app.detection.validators import luhn_ok, parse_ip, parse_network, rrn_date_ok
from app.schemas import Confidence

RULESET_VERSION = "rules-0.2.1"

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


def _intl_phone(value: str):
    # E.164 는 국가번호 포함 8~15자리
    n = sum(ch.isdigit() for ch in value)
    return (None, Confidence.MEDIUM) if 8 <= n <= 15 else None


def _has_digits(value: str):
    # 키워드 뒤 식별번호는 숫자가 4개 이상이어야 한다(단어 오탐 방지)
    return (None, Confidence.MEDIUM) if sum(ch.isdigit() for ch in value) >= 4 else None


def _id_digits(value: str):
    """구분자 없는 긴 숫자 중 식별번호가 아닐 가능성이 큰 것을 뺀다."""
    # 8자리 YYYYMMDD 날짜(1900~2099)
    if len(value) == 8:
        try:
            y, m, d = int(value[:4]), int(value[4:6]), int(value[6:8])
            if 1900 <= y <= 2099:
                date(y, m, d)
                return None
        except ValueError:
            pass
    digits = [int(ch) for ch in value]
    # 같은 숫자 반복(11111111), 1씩 오르내리는 연속 숫자(123456789, 987654321) — 예시·자리 채움 값
    steps = {b - a for a, b in zip(digits, digits[1:])}
    if steps <= {0} or steps == {1} or steps == {-1}:
        return None
    # 끝이 0000 인 어림수(100000000, 25000000) — 금액·수량
    if value.endswith("0000"):
        return None
    # 유닉스 시각(초 10자리·밀리초 13자리). 주문번호 등과 겹치지 않도록 2014~2033년 범위만 본다.
    n = int(value)
    if (len(value) == 10 and 1_400_000_000 <= n < 2_000_000_000) or \
       (len(value) == 13 and 1_400_000_000_000 <= n < 2_000_000_000_000):
        return None
    return (None, Confidence.LOW)


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
    # 북미(NANP) 번호: 지역·국번 첫 자리 2~9, 내선(x123, ext.123) 포함. 한국 번호(0으로 시작)와 겹치지 않는다.
    Rule("nanp_phone", "phone",
         _r(r"(?<![\w+])(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]\d{4}"
            r"(?:\s?(?:x|ext\.?)\s?\d{1,6})?(?!\d)", re.IGNORECASE),
         Confidence.HIGH, reason="북미 전화번호 형식"),
    # 국제 형식(+국가번호): 숫자 8~15자리
    Rule("intl_phone", "phone", _r(r"(?<![\w+])\+[1-9]\d{0,2}(?:[-.\s]?\(?\d{1,4}\)?){2,5}(?!\d)"),
         Confidence.MEDIUM, validate=_intl_phone, reason="국제 전화번호 형식(+국가번호)"),
    Rule("email", "email", _r(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
         Confidence.HIGH, reason="이메일 주소 형식"),
    Rule("kr_passport", "passport", _r(_NB + r"[MSRODG](?:\d{8}|\d{3}[A-Z]\d{4})" + _NA),
         Confidence.MEDIUM, reason="여권번호 형식"),
    Rule("kr_driver_license", "driver_license",
         _r(r"(?<!\d)(?:1[1-9]|2[0-8])-\d{2}-\d{6}-\d{2}(?!\d)"), Confidence.MEDIUM,
         reason="운전면허번호 형식"),
    # 식별번호: 키워드(학번·사번·ID·No. 등) 뒤 값, 또는 구분자 없는 8~16자리 숫자(학생·회원·주문번호 등).
    # 카드·주민번호·전화번호와 겹치면 병합 시 그쪽(더 강한 조치)이 대표가 된다.
    Rule("id_number_ctx", "id_number",
         _r(r"(?:학번|사번|군번|회원\s?번호|고객\s?번호|수험\s?번호|학생\s?번호|"
            r"\b(?:student|employee|member|customer|roll|pin|account|user)?\s{0,3}(?:id|no\.?|number|#))"
            r"\s{0,10}[:：#]\s{0,10}([A-Z0-9][A-Z0-9-]{4,19})(?![A-Za-z0-9])", re.IGNORECASE),
         Confidence.MEDIUM, group=1, validate=_has_digits, reason="식별번호 키워드 뒤 값"),
    # 앞뒤가 영숫자·밑줄이거나 소수점·URL 파라미터(=, &, ?) 위치면 제외(타임스탬프·URL 속 숫자 오탐 방지)
    # 통화 기호 뒤($ ₩ € £ ¥)와 단위 앞(공백 + 원·명·개·% 등)도 제외한다. 단위가 바로 붙은 경우(1500원)는
    # 한글이 단어 문자라 뒤 경계에서 이미 제외된다.
    Rule("long_digit_id", "id_number",
         _r(r"(?<![\w.,/=&?#$₩€£¥-])\d{8,16}(?![\w.,/-])"
            r"(?!\s(?:원|달러|엔|위안|유로|억|만|천|명|개|건|회|배|점|%|퍼센트|원정|km|kg|mb|gb|kb|ms|bytes?|"
            r"won|usd|krw|eur|jpy|dollars?|people|users?|times|views|rows|records)(?![A-Za-z]))",
            re.IGNORECASE),
         Confidence.LOW, validate=_id_digits,
         reason="구분자 없는 8~16자리 숫자(식별번호 후보: 날짜·금액·수량·시각·반복/연속 숫자 제외)"),
    # 주소: 미국식(번지 + 거리명 + USPS 접미사 [+ 호수] [+ 도시, 주 우편번호]),
    #       한국 도로명(시·군·구 + 도로명 + 건물번호)
    Rule("us_street_address", "street_address",
         _r(r"(?<![\w-])\d{1,6}\s+(?:[A-Z][a-z]+\s+){1,3}"
            r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|"
            r"Terrace|Parkway|Pkwy|Highway|Hwy|Circle|Cir|Square|Trail|Bypass|Center|Centers|"
            r"Crossing|Plaza|Ridge|Heights|Loop|Pike|Point|Station|Valley|Walk|Alley|Expressway|"
            r"Freeway|Junction|Landing|Manor|Meadows?|Park|Ports?|Shores?|Springs?|Summit|Turnpike|"
            r"Villages?|Vista|Wells?|Estates?|Gardens?|Groves?|Harbors?|Hills?|Islands?|Lakes?|"
            r"Mills?|Mountains?|Oaks|Orchard|Pines|Prairie|Ramp|Ranch|Rapids?|Rest|Roads|Routes?|"
            r"Row|Run|Spur|Streets|Stravenue|Throughway|Trace|Track|Tunnel|Unions?|Viaducts?|Views?)"
            r"\.?(?:,?\s+(?:Apt|Apartment|Suite|Ste|Unit)\.?\s*\d+[A-Z]?)?"
            r"(?:,?\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)?(?![\w])"),
         Confidence.MEDIUM, reason="미국식 거리 주소 형식"),
    Rule("kr_road_address", "street_address",
         _r(r"(?:[가-힣]{1,10}(?:특별시|광역시|특별자치시|특별자치도|도|시)\s)?"
            r"[가-힣]{1,10}(?:시|군|구)\s[가-힣0-9]{1,15}(?:대로|로|길)\s?\d{1,4}(?:-\d{1,4})?"
            r"(?:번길\s?\d{1,4}(?:-\d{1,4})?)?"),
         Confidence.MEDIUM, reason="도로명 주소 형식(시·군·구 + 도로명 + 건물번호)"),
    # 개인 계정: 소셜·프로필 URL(영상 시청 링크는 제외), 아이디 키워드 뒤 값
    # (@핸들은 기관·서비스 언급과 구별되지 않아 규칙에서 뺐다 — 평가에서 개인 아이디 0건, 기관명 오탐만 발생)
    Rule("profile_url", "url_personal",
         _r(r"(?<![\w.-])(?:(?:https?:)?//|(?:ht)?tps?://)?(?:www\.|m\.)?"
            r"(?:(?:facebook|instagram|twitter|x|tiktok|github|threads)\.com/@?|linkedin\.com/in/|"
            r"youtube\.com/(?:channel/|c/|user/|@)|medium\.com/@|behance\.net/|dribbble\.com/)"
            r"[A-Za-z0-9_.-]{2,}", re.IGNORECASE),
         Confidence.MEDIUM, reason="개인 소셜·프로필 URL"),
    Rule("username_ctx", "username",
         _r(r"\b(?:user\s?name|user\s?id|login\s?id|handle|아이디|계정명)\s?[:：]\s?@?([A-Za-z][A-Za-z0-9_.]{2,29})"
            r"(?![\w@])", re.IGNORECASE),
         Confidence.MEDIUM, group=1, reason="아이디 키워드 뒤 값"),
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
