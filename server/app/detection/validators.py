"""형식 검증 헬퍼. 통과해도 실존·유효·소유를 보장하지 않는다."""

from __future__ import annotations

import ipaddress
import re
from datetime import date


def luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def rrn_date_ok(rrn: str) -> bool:
    """주민등록번호 앞 6자리 + 성별자리로 생년월일 유효성만 본다.
    2020년 10월 이후 발급분은 체크섬 규칙이 없어 체크섬은 신뢰도 보조로만 쓴다."""
    digits = re.sub(r"[-\s]", "", rrn)  # 규칙이 하이픈·공백 구분자를 허용한다
    yy, mm, dd, g = int(digits[0:2]), int(digits[2:4]), int(digits[4:6]), int(digits[6])
    century = {1: 1900, 2: 1900, 5: 1900, 6: 1900, 3: 2000, 4: 2000, 7: 2000, 8: 2000}.get(g)
    if century is None:
        return False
    try:
        date(century + yy, mm, dd)
    except ValueError:
        return False
    return True


def parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def parse_network(value: str) -> ipaddress.IPv4Network | ipaddress.IPv6Network | None:
    try:
        return ipaddress.ip_network(value, strict=False)
    except ValueError:
        return None
