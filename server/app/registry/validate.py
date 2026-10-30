"""대시보드에서 입력한 정규식 검사.

서버는 모든 요청에 사용자 정규식을 실행하고, 같은 규칙이 JS 라이브러리(@prompt-guard/rules)로도 배포된다.
그래서 (1) 처리 시간이 폭증하는 패턴(ReDoS)을 막고 (2) Python·JS 양쪽에서 같은 의미인 문법만 허용한다.
휴리스틱 검사라 모든 위험 패턴을 잡지는 못한다. 장기적으로는 RE2 같은 선형 시간 엔진을 검토한다.
"""

from __future__ import annotations

import re

MAX_PATTERN_LEN = 300

# Python·JS 의미가 다르거나 한쪽에만 있는 문법
_FORBIDDEN = [
    (r"\(\?P", "Python 전용 이름 그룹 (?P...)"),
    (r"\(\?<[A-Za-z]", "이름 그룹 (?<name>...)"),
    (r"\(\?[aiLmsux-]+[):]", "인라인 플래그 (?i) 등(대소문자는 case_sensitive 로 지정)"),
    (r"\(\?>", "원자 그룹 (?>...)"),
    (r"\(\?\(", "조건 그룹"),
    (r"\\[AZzG]", "\\A \\Z \\z \\G 앵커(^ $ 를 사용)"),
    (r"\\[1-9]", "역참조 \\1"),
    (r"\\[pPN]\{?", "\\p \\N 속성 이스케이프"),
    (r"[*+?}][+]", "소유 수량자 *+ ++ ?+ }+"),
]
# 수량자가 붙은 그룹 안에 또 수량자가 있는 패턴: (a+)+, (\w*)*, (x{1,}){2,} 등
_NESTED_QUANT = re.compile(r"\((?:[^()\\]|\\.)*(?:[*+]|\{\d*,\d*\})(?:[^()\\]|\\.)*\)(?:[*+]|\{\d*,\d*\})")


class RegexRejected(ValueError):
    pass


def check_custom_regex(pattern: str, case_sensitive: bool = False) -> re.Pattern[str]:
    if len(pattern) > MAX_PATTERN_LEN:
        raise RegexRejected(f"{MAX_PATTERN_LEN}자 이하만 허용")
    for forbidden, why in _FORBIDDEN:
        if re.search(forbidden, pattern):
            raise RegexRejected(why)
    if _NESTED_QUANT.search(pattern):
        raise RegexRejected("중첩 수량자(예: (a+)+)는 처리 시간이 폭증할 수 있음")
    try:
        compiled = re.compile(pattern, 0 if case_sensitive else re.IGNORECASE)
    except re.error as exc:
        raise RegexRejected(f"문법 오류: {exc.msg}") from None
    if compiled.search("") is not None:
        raise RegexRejected("빈 문자열과 일치하는 패턴은 허용하지 않음")
    return compiled
