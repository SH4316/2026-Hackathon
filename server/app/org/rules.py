"""대시보드 활성 설정 → 이 서버에서 실행할 조직 규칙.

- 태그별 pythonRegex: Python re 로 실행. 일치 구간이 그 태그의 탐지다.
- Jev 프롬프트: 로컬 모델이 출력 태그별 점수(0~1)를 내고(Decider 는 입력 전체 분류),
  태그의 jevThreshold 가 설정된 경우에만 `점수 >= 임계값` 이면 탐지로 본다(미설정 태그는 판정하지 않음).
- 태그 ID 가 서버의 기존 탐지 유형과 겹치면 유형 이름을 `org_<태그 ID>` 로 바꾸고, 대시보드 기록에는 tag_map 으로 되돌린다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.detection.base import Candidate
from app.policy.engine import TypePolicy
from app.schemas import Action, Confidence, Severity

MAX_REGEX_LEN = 4000
# 수량자가 붙은 그룹 안에 또 수량자가 있는 패턴(ReDoS 위험): (a+)+, (\w*)* 등. registry/validate.py 와 같은 휴리스틱.
_NESTED_QUANT = re.compile(r"\((?:[^()\\]|\\.)*(?:[*+]|\{\d*,\d*\})(?:[^()\\]|\\.)*\)(?:[*+]|\{\d*,\d*\})")


@dataclass(frozen=True)
class JevPrompt:
    id: str
    name: str
    prompt: str
    outputs: dict[str, str]  # 태그 ID → 태그 이름


@dataclass
class OrgRules:
    version_id: str
    revision: int
    tag_names: dict[str, str]
    thresholds: dict[str, float]          # 설정된 태그만
    type_of: dict[str, str]               # 태그 ID → 탐지 유형
    policy_state_ids: set[str] = field(default_factory=set)
    regex: list[tuple[str, re.Pattern[str]]] = field(default_factory=list)  # (태그 ID, 패턴)
    jev: list[JevPrompt] = field(default_factory=list)
    skipped: dict[str, str] = field(default_factory=dict)  # 쓸 수 없는 태그 정규식: 태그 ID → 사유

    @property
    def key(self) -> tuple[str, int]:
        return (self.version_id, self.revision)

    def tag_of(self, type_: str) -> str | None:
        for tag, t in self.type_of.items():
            if t == type_:
                return tag
        return None

    def type_policies(self, action: Action) -> dict[str, TypePolicy]:
        return {t: TypePolicy(category="org", severity=Severity.HIGH, action=action, token=_token(tag))
                for tag, t in self.type_of.items()}

    def bundle(self, action: Action) -> dict:
        return {"version_id": self.version_id, "revision": self.revision, "tag_action": action.value,
                "regex": [{"tag_id": tag, "type": self.type_of[tag], "name": self.tag_names[tag],
                           "token": _token(tag), "pattern": pattern.pattern}
                          for tag, pattern in self.regex]}

    def detect_regex(self, text: str) -> list[Candidate]:
        out = []
        for tag, pattern in self.regex:
            for m in pattern.finditer(text):
                if m.end() > m.start():
                    out.append(Candidate(type=self.type_of[tag], rule_id=f"org-regex:{tag}", start=m.start(),
                                         end=m.end(), confidence=Confidence.HIGH,
                                         reason=f"{self.tag_names[tag]}(조직 규칙)"))
        return out


def _token(tag_id: str) -> str:
    return "ORG_" + re.sub(r"[^A-Z0-9]", "_", tag_id.upper())[:26]


def check_regex(source: str) -> re.Pattern[str]:
    if len(source) > MAX_REGEX_LEN:
        raise ValueError("too_long")
    if _NESTED_QUANT.search(source):
        raise ValueError("nested_quantifier")
    try:
        compiled = re.compile(source)
    except (re.error, OverflowError, RecursionError):
        raise ValueError("syntax_error") from None
    if compiled.search("") is not None:
        raise ValueError("matches_empty")
    return compiled


def compile_org(config: dict, reserved_types: set[str], jev_enabled: bool = True) -> OrgRules:
    # 부모·자식 태그의 enabled 는 각 태그에 독립적으로 적용한다. 이전 설정은 기본 활성이다.
    tags = [t for t in config.get("tags") or [] if t.get("enabled", True)]
    names = {t["id"]: t.get("name") or t["id"] for t in tags}
    type_of = {tag: (f"org_{tag}" if tag in reserved_types else tag) for tag in names}
    thresholds = {t["id"]: float(t["jevThreshold"]) for t in tags if t.get("jevThreshold") is not None}
    rules = OrgRules(version_id=config["id"], revision=int(config.get("revision", 0)), tag_names=names,
                     thresholds=thresholds, type_of=type_of,
                     policy_state_ids={s["id"] for s in config.get("policyStates") or []})
    for t in tags:
        src = t.get("pythonRegex") or ""
        if not src.strip():
            continue
        try:
            rules.regex.append((t["id"], check_regex(src)))
        except ValueError as exc:
            rules.skipped[t["id"]] = str(exc)
    if jev_enabled:
        for p in config.get("jevPrompts") or []:
            if not p.get("enabled", True):
                continue
            outputs = {tag: names[tag] for tag in p.get("tagIds") or [] if tag in names}
            if (p.get("prompt") or "").strip() and outputs:
                rules.jev.append(JevPrompt(p["id"], p.get("name") or p["id"], p["prompt"], outputs))
    return rules
