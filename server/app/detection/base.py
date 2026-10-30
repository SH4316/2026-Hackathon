from __future__ import annotations

from dataclasses import dataclass

from app.schemas import Confidence


@dataclass(frozen=True)
class Candidate:
    """탐지기 출력. 원문 값은 들고 다니지 않고 위치만 보관한다."""

    type: str
    rule_id: str
    start: int
    end: int
    confidence: Confidence
    detector: str = "rule"  # "rule" | "model"
    reason: str = ""

    @property
    def length(self) -> int:
        return self.end - self.start
