"""대시보드에서 추가한 사용자 규칙(키워드·정규식) 탐지기."""

from __future__ import annotations

import re

from app.detection.base import Candidate
from app.registry.schema import CustomRule
from app.registry.validate import check_custom_regex
from app.schemas import Confidence


def compile_rule(rule: CustomRule) -> re.Pattern[str]:
    if rule.kind == "keywords":
        # 긴 키워드를 먼저 시도해 짧은 키워드가 앞부분만 잡는 것을 막는다. 한국어 조사가 붙어도 잡도록 경계는 두지 않는다.
        words = sorted(rule.keywords, key=len, reverse=True)
        return re.compile("|".join(re.escape(w) for w in words), 0 if rule.case_sensitive else re.IGNORECASE)
    return check_custom_regex(rule.pattern or "", rule.case_sensitive)


class CustomRuleDetector:
    def __init__(self, rules: list[CustomRule]) -> None:
        self.rules = [(r, compile_rule(r)) for r in rules if r.enabled]

    def detect(self, text: str) -> list[Candidate]:
        out: list[Candidate] = []
        for rule, pattern in self.rules:
            for m in pattern.finditer(text):
                if m.end() > m.start():
                    out.append(Candidate(type=rule.id, rule_id=f"custom:{rule.id}", start=m.start(),
                                         end=m.end(), confidence=Confidence.HIGH,
                                         reason=rule.reason or rule.label))
        return out
