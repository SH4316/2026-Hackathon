"""YAML 정책 → 탐지 후보별 위험도·조치 결정, 요청 단위 판단.

탐지 신뢰도(confidence)·위험도(severity)·조치(action)는 서로 다른 필드다.
전송 목적지 등급(destinations.yaml)은 조치를 강화만 하고 완화하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date
from pathlib import Path

import yaml

from app.detection.base import Candidate
from app.schemas import Action, Decision, Severity

_SEVERITY_RANK = {s: i for i, s in enumerate(
    [Severity.INFO, Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL])}
_ACTION_RANK = {a: i for i, a in enumerate([Action.ALLOW, Action.WARN, Action.MASK, Action.BLOCK])}
_DECISION_RANK = {d: i for i, d in enumerate([Decision.ALLOW, Decision.WARN, Decision.BLOCK])}


@dataclass(frozen=True)
class TypePolicy:
    category: str
    severity: Severity
    action: Action
    token: str


@dataclass(frozen=True)
class Tier:
    name: str
    escalate: dict[Action, Action]
    min_decision: Decision
    rank: int


@dataclass(frozen=True)
class Destination:
    """요청에 적용된 목적지 해석 결과."""

    provider: str          # 프로필에 있는 값 또는 "unknown"
    channel: str           # 프로필에 있는 값 또는 "unknown"
    tier: Tier
    basis: str | None
    verified: bool         # 기본 등급보다 낮은 등급이 org_contracts 로 확인됐는지


@dataclass(frozen=True)
class DestinationPolicy:
    default_tier: str
    tiers: dict[str, Tier]
    profiles: dict[str, dict[str, tuple[str, str]]]   # provider → channel → (tier, basis)
    verified_at: dict[str, date]                      # provider → 근거 마지막 확인일
    stale_after_days: int
    org_contracts: frozenset[tuple[str, str]] = field(default_factory=frozenset)

    @classmethod
    def load(cls, path: Path) -> DestinationPolicy:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        tiers = {
            name: Tier(name=name,
                       escalate={Action(k): Action(v) for k, v in (spec.get("escalate") or {}).items()},
                       min_decision=Decision(spec.get("min_decision", "allow")), rank=i)
            for i, (name, spec) in enumerate(raw["tiers"].items())
        }
        raw_profiles = raw.get("profiles") or {}
        profiles = {
            provider: {ch: (s["tier"], s.get("basis", "")) for ch, s in spec["channels"].items()}
            for provider, spec in raw_profiles.items()
        }
        verified_at = {provider: spec["verified_at"] for provider, spec in raw_profiles.items()}
        if not all(isinstance(d, date) for d in verified_at.values()):
            raise ValueError("verified_at must be YYYY-MM-DD")
        for channels in profiles.values():
            for tier, _ in channels.values():
                if tier not in tiers:
                    raise ValueError(f"unknown tier: {tier}")
        contracts = frozenset((c["provider"], c["channel"]) for c in raw.get("org_contracts") or [])
        if raw["default_tier"] not in tiers:
            raise ValueError("default_tier must be one of tiers")
        return cls(default_tier=raw["default_tier"], tiers=tiers, profiles=profiles,
                   verified_at=verified_at, stale_after_days=int(raw.get("stale_after_days", 90)),
                   org_contracts=contracts)

    def is_stale(self, provider: str, today: date | None = None) -> bool:
        today = today or date.today()
        return (today - self.verified_at[provider]).days > self.stale_after_days

    def resolve(self, provider: str | None, channel: str | None,
                today: date | None = None) -> tuple[Destination, list[str]]:
        default = self.tiers[self.default_tier]
        channels = self.profiles.get(provider or "")
        if channels is None:
            return Destination("unknown", "unknown", default, None, False), ["destination_unknown"]
        if channel not in channels:
            return (Destination(provider, "unknown", default, None, False),
                    ["destination_channel_unknown"])
        tier_name, basis = channels[channel]
        tier = self.tiers[tier_name]
        if self.is_stale(provider, today) and tier.rank < default.rank:
            # 재확인되지 않은 근거로 기본 등급보다 낮게 두지 않는다(조직 계약이 있어도 동일).
            return Destination(provider, channel, default, basis, False), ["destination_policy_stale"]
        if tier.rank >= default.rank:
            return Destination(provider, channel, tier, basis, False), []
        # 클라이언트 주장만으로 완화하지 않는다: 조직 계약 등록 시에만 낮은 등급 인정
        if (provider, channel) in self.org_contracts:
            return Destination(provider, channel, tier, basis, True), []
        return (Destination(provider, channel, default, basis, False),
                ["destination_channel_unverified"])


@dataclass(frozen=True)
class Policy:
    version: str
    model_required: bool
    types: dict[str, TypePolicy]
    default: TypePolicy
    destinations: DestinationPolicy
    detectors_seed_path: Path | None = None

    @classmethod
    def load(cls, path: Path) -> Policy:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        default = _type_policy("UNKNOWN", raw.get("default", {}))
        types = {name: _type_policy(name, spec) for name, spec in raw.get("types", {}).items()}
        destinations = DestinationPolicy.load(path.parent / raw["destinations_file"])
        seed = raw.get("detectors_seed_file")
        return cls(version=str(raw["version"]), model_required=bool(raw.get("model_required", False)),
                   types=types, default=default, destinations=destinations,
                   detectors_seed_path=path.parent / seed if seed else None)

    def with_custom_types(self, custom: dict[str, TypePolicy]) -> Policy:
        """대시보드 항목(사용자 규칙·문맥 탐지기)의 유형 정책을 더한다. 내장 유형은 덮어쓰지 않는다."""
        clash = set(custom) & set(self.types)
        if clash:
            raise ValueError(f"내장 유형과 겹침: {sorted(clash)}")
        return replace(self, types={**self.types, **custom})

    def for_type(self, type_: str) -> TypePolicy:
        return self.types.get(type_, self.default)

    def action_for(self, type_: str, tier: Tier) -> Action:
        base = self.for_type(type_).action
        escalated = tier.escalate.get(base, base)
        return max(base, escalated, key=_ACTION_RANK.__getitem__)  # 강화만 허용

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


def decide(actions: list[Action], min_decision: Decision = Decision.ALLOW) -> Decision:
    """원문 기준 판단. mask 대상이 남아 있으면 원문은 전송할 수 없으므로 block."""
    if any(a in (Action.BLOCK, Action.MASK) for a in actions):
        decision = Decision.BLOCK
    elif Action.WARN in actions:
        decision = Decision.WARN
    else:
        decision = Decision.ALLOW
    return max(decision, min_decision, key=_DECISION_RANK.__getitem__)
