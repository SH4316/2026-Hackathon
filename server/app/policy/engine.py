"""YAML 정책 → 탐지 후보별 위험도·조치 결정, 요청 단위 판단.

탐지 신뢰도(confidence)·위험도(severity)·조치(action)는 서로 다른 필드다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from app.detection.base import Candidate
from app.schemas import Action, Decision, Severity

_SEVERITY_RANK = {s: i for i, s in enumerate(
    [Severity.INFO, Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL])}
_ACTION_RANK = {a: i for i, a in enumerate([Action.ALLOW, Action.WARN, Action.MASK, Action.BLOCK])}


@dataclass(frozen=True)
class TypePolicy:
    category: str
    severity: Severity
    action: Action
    token: str


@dataclass(frozen=True)
class Policy:
    version: str
    model_required: bool
    types: dict[str, TypePolicy]
    default: TypePolicy

    @classmethod
    def load(cls, path: Path) -> Policy:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        default = _type_policy("UNKNOWN", raw.get("default", {}))
        types = {name: _type_policy(name, spec) for name, spec in raw.get("types", {}).items()}
        return cls(version=str(raw["version"]), model_required=bool(raw.get("model_required", False)),
                   types=types, default=default)

    def for_type(self, type_: str) -> TypePolicy:
        return self.types.get(type_, self.default)

    def priority(self, c: Candidate) -> tuple[int, int, int, int]:
        """겹침 해결 우선순위: 조치 > 위험도 > 규칙 탐지 우선 > 긴 구간."""
        tp = self.for_type(c.type)
        return (_ACTION_RANK[tp.action], _SEVERITY_RANK[tp.severity],
                1 if c.detector == "rule" else 0, c.length)


def _type_policy(name: str, spec: dict) -> TypePolicy:
    return TypePolicy(
        category=spec.get("category", "uncategorized"),
        severity=Severity(spec.get("severity", "medium")),
        action=Action(spec.get("action", "warn")),
        token=spec.get("token", name.upper()),
    )


def decide(actions: list[Action]) -> Decision:
    """원문 기준 판단. mask 대상이 남아 있으면 원문은 전송할 수 없으므로 block."""
    if any(a in (Action.BLOCK, Action.MASK) for a in actions):
        return Decision.BLOCK
    if Action.WARN in actions:
        return Decision.WARN
    return Decision.ALLOW
