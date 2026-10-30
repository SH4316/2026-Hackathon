"""겹치는 탐지 구간 병합.

겹치는 후보들은 하나의 구간(합집합)으로 묶고, 정책상 우선순위가 가장 높은 후보의
유형을 대표로 쓴다. 합집합을 쓰므로 어떤 탐지 결과의 글자도 정제에서 누락되지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace

from app.detection.base import Candidate


@dataclass(frozen=True)
class Merged:
    primary: Candidate        # 대표 후보(구간은 합집합으로 확장됨)
    members: tuple[Candidate, ...]


def merge(candidates: list[Candidate], priority: Callable[[Candidate], tuple]) -> list[Merged]:
    ordered = sorted(candidates, key=lambda c: (c.start, -c.end))
    groups: list[list[Candidate]] = []
    group_end = -1
    for c in ordered:
        if groups and c.start < group_end:
            groups[-1].append(c)
            group_end = max(group_end, c.end)
        else:
            groups.append([c])
            group_end = c.end

    out: list[Merged] = []
    for g in groups:
        best = max(g, key=priority)
        start, end = min(c.start for c in g), max(c.end for c in g)
        out.append(Merged(primary=replace(best, start=start, end=end), members=tuple(g)))
    return out
