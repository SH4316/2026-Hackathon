"""검증된 구간을 코드로 치환한다(LLM 재작성 사용 안 함).

- 같은 요청 안에서 같은 (유형, 값)은 같은 토큰으로 치환한다. 예) [EMAIL_1]
- 문자열 뒤쪽부터 치환해 앞쪽 위치가 밀리지 않게 한다.
- 복원 매핑은 반환·저장하지 않는다(자동 복원은 후속 범위).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Replacement:
    start: int
    end: int
    type: str
    token_prefix: str


def assign_tokens(text: str, items: list[Replacement]) -> list[tuple[Replacement, str]]:
    seen: dict[tuple[str, str], str] = {}
    counters: Counter[str] = Counter()
    out: list[tuple[Replacement, str]] = []
    for r in sorted(items, key=lambda r: r.start):
        key = (r.type, text[r.start:r.end])
        if key not in seen:
            counters[r.token_prefix] += 1
            seen[key] = f"[{r.token_prefix}_{counters[r.token_prefix]}]"
        out.append((r, seen[key]))
    return out


def apply(text: str, tokens: list[tuple[Replacement, str]]) -> str:
    for r, token in sorted(tokens, key=lambda t: t[0].start, reverse=True):
        text = text[:r.start] + token + text[r.end:]
    return text
