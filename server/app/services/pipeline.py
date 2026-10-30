"""검사·정제 오케스트레이션.

내장 규칙 + 사용자 규칙 모듈 + 문맥(로컬 모델) 모듈 → 병합 → 정책(목적지 등급으로 강화) → 판단.
사용자 규칙·문맥 탐지기·모듈 조합은 대시보드에서 편집하는 ruleset 에서 온다(버전별로 컴파일해 캐시).
검사 오류·모델 오류·시간 초과는 절대 allow 로 귀결되지 않는다.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from app.audit.events import AuditEvent, AuditStore, count
from app.config import ModelMode, Settings
from app.detection.base import Candidate
from app.detection.merge import Merged, merge
from app.detection.custom import CustomRuleDetector
from app.detection.model import ContextModelDetector, ModelUnavailable
from app.detection.rules import RuleDetector
from app.policy.engine import Destination, Policy, Tier, TypePolicy, decide
from app.registry.schema import ContextDetector, RuleSet, RuleSetBody
from app.registry.store import StaticRuleSet, load_seed
from app.sanitize.replacer import Replacement, apply, assign_tokens
from app.schemas import (
    Action, Change, Decision, DestinationOut, Finding, InspectRequest, InspectResponse,
    SanitizeResponse, Signal, Span, Status,
)

_SIGNAL = {Decision.ALLOW: Signal.GREEN, Decision.WARN: Signal.YELLOW, Decision.BLOCK: Signal.RED}


@dataclass
class Analysis:
    status: Status
    decision: Decision
    signal: Signal
    merged: list[Merged]
    notices: list[str]
    tier: Tier


def utf16_index(text: str, idx: int) -> int:
    return len(text[:idx].encode("utf-16-le")) // 2


@dataclass(frozen=True)
class CompiledRuleSet:
    ruleset: RuleSet
    policy: Policy
    custom: CustomRuleDetector
    context: list[ContextDetector]  # 켜진 문맥 탐지기(모듈이 꺼져 있으면 빈 목록)


def compile_ruleset(base: Policy, rs: RuleSet) -> CompiledRuleSet:
    items = [*rs.custom_rules, *rs.context_detectors]
    policy = base.with_custom_types({
        i.id: TypePolicy(category=i.category, severity=i.severity, action=i.action, token=i.token)
        for i in items})
    custom = CustomRuleDetector(rs.custom_rules if rs.modules.custom_rules else [])
    context = [d for d in rs.context_detectors if d.enabled] if rs.modules.context_model else []
    return CompiledRuleSet(rs, policy, custom, context)


class Pipeline:
    def __init__(self, settings: Settings, policy: Policy, audit: AuditStore,
                 rules: RuleDetector | None = None, model: ContextModelDetector | None = None,
                 today: Callable[[], date] = date.today, ruleset_source=None) -> None:
        self.settings = settings
        self.base_policy = policy
        self.audit = audit
        self.rules = rules or RuleDetector()
        self.model = model
        self.today = today  # 목적지 근거 만료 판단용(테스트·골든 벡터에서 고정)
        if ruleset_source is None:
            seed = load_seed(policy.detectors_seed_path) if policy.detectors_seed_path else RuleSetBody()
            ruleset_source = StaticRuleSet(seed)
        self.ruleset_source = ruleset_source  # current() -> RuleSet
        self._compiled: CompiledRuleSet | None = None

    @property
    def compiled(self) -> CompiledRuleSet:
        rs = self.ruleset_source.current()
        if self._compiled is None or self._compiled.ruleset.version != rs.version:
            self._compiled = compile_ruleset(self.base_policy, rs)
        return self._compiled

    @property
    def policy(self) -> Policy:
        """내장 유형 + 현재 ruleset 의 사용자 유형을 합친 정책."""
        return self.compiled.policy

    @property
    def detector_versions(self) -> dict[str, str]:
        v = {"rules": self.rules.version, "ruleset": f"rs-{self.compiled.ruleset.version}"}
        if self.model is not None and self.settings.model_mode is not ModelMode.DISABLED:
            v["model"] = self.model.version
        return v

    def resolve_destination(self, req: InspectRequest) -> tuple[Destination, list[str]]:
        d = req.context.destination
        return self.policy.destinations.resolve(d.provider if d else None, d.channel if d else None,
                                                today=self.today())

    async def analyze(self, text: str, tier: Tier) -> Analysis:
        c = self.compiled
        candidates: list[Candidate] = self.rules.detect(text) + c.custom.detect(text)
        notices: list[str] = []
        status = Status.COMPLETE
        mode = self.settings.model_mode
        model_mandatory = mode is ModelMode.REQUIRED or self.policy.model_required

        if mode is ModelMode.DISABLED or self.model is None or not c.context:
            if self.policy.model_required:
                status = Status.INCOMPLETE
                notices.append("model_check_required_but_disabled")
        else:
            try:
                candidates += await self.model.detect(text, c.context, c.ruleset.prompt_template)
            except ModelUnavailable:
                status = Status.ERROR if model_mandatory else Status.INCOMPLETE
                notices.append("model_check_failed")

        merged = merge(candidates, self.policy.priority)
        decision = decide([self.policy.action_for(m.primary.type, tier) for m in merged],
                          tier.min_decision)
        if status is not Status.COMPLETE:
            # 회색: 검사 미완료. 규칙상 통과여도 allow 로 내보내지 않는다.
            if decision is Decision.ALLOW:
                decision = Decision.WARN
            return Analysis(status, decision, Signal.GRAY, merged, notices, tier)
        return Analysis(status, decision, _SIGNAL[decision], merged, notices, tier)

    def to_findings(self, text: str, merged: list[Merged], tier: Tier) -> list[Finding]:
        out = []
        for i, m in enumerate(merged, start=1):
            c = m.primary
            tp = self.policy.for_type(c.type)
            action = self.policy.action_for(c.type, tier)
            out.append(Finding(
                finding_id=f"f{i}", type=c.type, category=tp.category, rule_id=c.rule_id,
                detector="model" if c.detector == "model" else "rule",
                confidence=c.confidence, severity=tp.severity, action=action,
                span=Span(start=c.start, end=c.end, start_utf16=utf16_index(text, c.start),
                          end_utf16=utf16_index(text, c.end)),
                reason=c.reason,
                replacement=None if action in (Action.ALLOW, Action.BLOCK) else f"[{tp.token}_n]",
            ))
        return out

    async def inspect(self, req: InspectRequest) -> InspectResponse:
        t0 = time.perf_counter()
        dest, dest_notices = self.resolve_destination(req)
        a = await self.analyze(req.text, dest.tier)
        resp = InspectResponse(
            request_id=req.request_id, input_version=req.input_version, status=a.status,
            decision=a.decision, signal=a.signal,
            findings=self.to_findings(req.text, a.merged, dest.tier),
            policy_version=self.policy.version, destination=_dest_out(dest),
            detector_versions=self.detector_versions, notices=dest_notices + a.notices,
        )
        self._record("inspect", req, a, dest, masked=0, t0=t0)
        return resp

    async def sanitize(self, req: InspectRequest) -> SanitizeResponse:
        """클라이언트가 보낸 구간을 믿지 않고 서버가 직접 검사 → 치환 → 재검사한다."""
        t0 = time.perf_counter()
        dest, dest_notices = self.resolve_destination(req)
        first = await self.analyze(req.text, dest.tier)
        targets = [
            Replacement(m.primary.start, m.primary.end, m.primary.type,
                        self.policy.for_type(m.primary.type).token)
            for m in first.merged
            if self.policy.action_for(m.primary.type, dest.tier) in (Action.MASK, Action.WARN)
        ]
        tokens = assign_tokens(req.text, targets)
        sanitized = apply(req.text, tokens)

        second = await self.analyze(sanitized, dest.tier)
        status = _worst(first.status, second.status)
        decision, signal = second.decision, second.signal
        if status is not Status.COMPLETE:
            signal = Signal.GRAY
            if decision is Decision.ALLOW:
                decision = Decision.WARN

        changes_by_token: dict[tuple[str, str], int] = {}
        for r, token in tokens:
            changes_by_token[(r.type, token)] = changes_by_token.get((r.type, token), 0) + 1
        resp = SanitizeResponse(
            request_id=req.request_id, input_version=req.input_version, status=status,
            sanitized_text=sanitized, decision=decision, signal=signal,
            changes=[Change(type=t, token=tok, count=n) for (t, tok), n in changes_by_token.items()],
            remaining_findings=self.to_findings(sanitized, second.merged, dest.tier),
            policy_version=self.policy.version, destination=_dest_out(dest),
            detector_versions=self.detector_versions,
            notices=dest_notices + sorted(set(first.notices + second.notices)),
        )
        final = Analysis(status, decision, signal, second.merged, resp.notices, dest.tier)
        self._record("sanitize", req, final, dest, masked=len(tokens), t0=t0)
        return resp

    def _record(self, endpoint: str, req: InspectRequest, a: Analysis, dest: Destination,
                masked: int, t0: float) -> None:
        self.audit.record(AuditEvent.new(
            endpoint=endpoint, client_type=req.context.client_type.value,
            destination_provider=dest.provider, destination_channel=dest.channel,
            destination_tier=dest.tier.name,
            request_id=req.request_id, input_version=str(req.input_version),
            status=a.status.value, decision=a.decision.value,
            finding_counts=count([m.primary.type for m in a.merged]),
            actions=count([self.policy.action_for(m.primary.type, a.tier).value for m in a.merged]),
            rule_ids=sorted({c.rule_id for m in a.merged for c in m.members}),
            masked_count=masked, policy_version=self.policy.version,
            detector_versions=self.detector_versions,
            duration_ms=int((time.perf_counter() - t0) * 1000),
        ))


def _dest_out(d: Destination) -> DestinationOut:
    return DestinationOut(provider=d.provider, channel=d.channel, tier=d.tier.name,
                          verified=d.verified, basis=d.basis)


def _worst(a: Status, b: Status) -> Status:
    order = [Status.COMPLETE, Status.INCOMPLETE, Status.ERROR]
    return max(a, b, key=order.index)
