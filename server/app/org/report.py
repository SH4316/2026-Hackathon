"""대시보드 detector-events 본문 만들기(조직 설정 report_text 에 따라 원문 처리).

- full:   원문과 탐지 구간 그대로
- masked: 탐지된 모든 구간(조치와 무관)을 [TOKEN_n] 으로 바꾼 문장. 탐지 구간은 토큰 위치로 옮긴다.
- off:    보내지 않음(호출 측에서 걸러짐)

대시보드는 같은 구간의 여러 태그를 합집합으로 합치므로, 겹쳐서 하나로 병합된 탐지도
병합 전 후보마다 finding 을 보내 각 태그가 집계되게 한다.
"""

from __future__ import annotations

from collections.abc import Callable

from app.detection.base import Candidate
from app.detection.merge import Merged
from app.org.rules import OrgRules
from app.org.settings import OrgSettings
from app.sanitize.replacer import Replacement, apply, assign_tokens


def _utf16(text: str, idx: int) -> int:
    return len(text[:idx].encode("utf-16-le")) // 2


def build_event(*, rules: OrgRules, settings: OrgSettings, person_id: str, text: str, response: dict,
                merged: list[Merged], token_of: Callable[[str], str],
                finding_of: Callable[[Candidate], dict]) -> dict:
    """response: /v1/inspect 응답(JSON). finding_of(c) → c 의 finding(JSON, span 제외 필드 사용)."""
    groups = sorted(merged, key=lambda m: m.primary.start)
    if settings.report_text == "masked":
        tokens = assign_tokens(text, [Replacement(m.primary.start, m.primary.end, m.primary.type,
                                                  token_of(m.primary.type)) for m in groups])
        out_text = apply(text, tokens)
        spans, delta = [], 0
        for r, token in sorted(tokens, key=lambda t: t[0].start):
            spans.append((r.start + delta, r.start + delta + len(token)))
            delta += len(token) - (r.end - r.start)
    else:
        out_text = text
        spans = [(m.primary.start, m.primary.end) for m in groups]

    findings, seen = [], set()
    for m, (g_start, g_end) in zip(groups, spans):
        for c in m.members:
            # masked 면 병합 그룹 전체가 토큰 하나가 되므로 모든 후보가 토큰 위치를 쓴다.
            start, end = (g_start, g_end) if settings.report_text == "masked" else (c.start, c.end)
            if (c.type, start, end) in seen:
                continue
            seen.add((c.type, start, end))
            f = finding_of(c)
            f["finding_id"] = f"f{len(findings) + 1}"
            f["span"] = {"start": start, "end": end, "start_utf16": _utf16(out_text, start),
                         "end_utf16": _utf16(out_text, end)}
            findings.append(f)

    present = {f["type"] for f in findings}
    tag_map = {t: tag for t, tag in settings.tag_map.items() if t in present and tag in rules.tag_names}
    tag_map.update({t: tag for tag, t in rules.type_of.items() if t != tag and t in present})
    payload = {"source_id": settings.source_id, "person_id": person_id, "version_id": rules.version_id,
               "text": out_text, "result": {**response, "findings": findings}}
    if tag_map:
        payload["tag_map"] = tag_map
    return payload
