"""검사·정제 오케스트레이션.

내장 규칙 + 사용자 규칙 모듈 + 문맥(로컬 모델) 모듈 (+ 조직 서버면 대시보드 태그 정규식·Jev)
→ 병합 → 정책(목적지 등급으로 강화) → 판단.
사용자 규칙·문맥 탐지기·모듈 조합은 대시보드에서 편집하는 ruleset 에서 온다(버전별로 컴파일해 캐시).
검사 오류·모델 오류·시간 초과는 절대 allow 로 귀결되지 않는다.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date

from app.audit.events import AuditEvent, AuditStore, count
from app.config import ModelMode, Settings
from app.detection.base import Candidate
from app.detection.merge import Merged, merge
from app.detection.custom import CustomRuleDetector
from app.detection.model import ContextModelDetector, ModelUnavailable
from app.detection.rules import RuleDetector
from app.org.dashboard import DashboardUnavailable
from app.org.report import build_event
from app.org.rules import OrgRules
from app.org.service import OrgService
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


@dataclass(frozen=True)
class RequestRules:
    """요청 하나에 적용할 규칙. 조직 서버면 대시보드 활성 설정까지 포함한다."""

    policy: Policy
    org: OrgRules | None = None
    org_unavailable: bool = False


Schedule = Callable[[Callable[[], Awaitable[None]]], None]


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
                 today: Callable[[], date] = date.today, ruleset_source=None,
                 org: OrgService | None = None) -> None:
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
        self.org = org if org is not None and org.enabled else None
        self._org_policy: tuple[tuple, Policy] | None = None

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

    def detector_versions(self, r: RequestRules | None = None) -> dict[str, str]:
        v = {"rules": self.rules.version, "ruleset": f"rs-{self.compiled.ruleset.version}"}
        if self.model is not None and self.settings.model_mode is not ModelMode.DISABLED:
            v["model"] = self.model.version
        if r is not None and r.org is not None:
            v["org"] = f"{r.org.version_id}@{r.org.revision}"
        return v

    async def request_rules(self) -> RequestRules:
        """조직 서버면 대시보드 활성 설정을 붙인다. 받을 수 없으면 조직 규칙 미적용(검사 미완료)으로 표시한다."""
        base = self.policy
        if self.org is None:
            return RequestRules(base)
        try:
            org = await self.org.rules(set(base.types))
        except DashboardUnavailable:
            return RequestRules(base, org_unavailable=True)
        key = (self.compiled.ruleset.version, org.key, self.org.settings.version)
        if self._org_policy is None or self._org_policy[0] != key:
            self._org_policy = (key, base.with_custom_types(org.type_policies(self.org.settings.tag_action)))
        return RequestRules(self._org_policy[1], org)

    def resolve_destination(self, req: InspectRequest) -> tuple[Destination, list[str]]:
        d = req.context.destination
        return self.policy.destinations.resolve(d.provider if d else None, d.channel if d else None,
                                                today=self.today())

    async def analyze(self, text: str, tier: Tier, r: RequestRules | None = None) -> Analysis:
        r = r or RequestRules(self.policy)
        policy = r.policy
        c = self.compiled
        candidates: list[Candidate] = self.rules.detect(text) + c.custom.detect(text)
        notices: list[str] = []
        status = Status.COMPLETE
        min_decision = tier.min_decision
        mode = self.settings.model_mode
        model_mandatory = mode is ModelMode.REQUIRED or policy.model_required

        if mode is ModelMode.DISABLED or self.model is None or not c.context:
            if policy.model_required:
                status = Status.INCOMPLETE
                notices.append("model_check_required_but_disabled")
        else:
            try:
                candidates += await self.model.detect(text, c.context, c.ruleset.prompt_template)
            except ModelUnavailable:
                status = Status.ERROR if model_mandatory else Status.INCOMPLETE
                notices.append("model_check_failed")

        # 조직 규칙(대시보드 태그 정규식·Jev). 적용하지 못하면 allow 로 끝나지 않게 미완료로 둔다.
        if r.org_unavailable:
            status = _worst(status, Status.INCOMPLETE)
            notices.append("org_config_unavailable")
        elif r.org is not None and self.org is not None:
            od = await self.org.detect(text, r.org)
            candidates += od.candidates
            notices += od.notices
            if od.incomplete:
                status = _worst(status, Status.ERROR if od.error else Status.INCOMPLETE)
            if od.unlocated:  # 위치 없는 Jev 판정: 치환할 수 없으니 최소 확인 필요
                min_decision = max(min_decision, Decision.WARN, key=[Decision.ALLOW, Decision.WARN,
                                                                     Decision.BLOCK].index)

        merged = merge(candidates, policy.priority)
        decision = decide([policy.action_for(m.primary.type, tier) for m in merged], min_decision)
        if status is not Status.COMPLETE:
            # 회색: 검사 미완료. 규칙상 통과여도 allow 로 내보내지 않는다.
            if decision is Decision.ALLOW:
                decision = Decision.WARN
            return Analysis(status, decision, Signal.GRAY, merged, notices, tier)
        return Analysis(status, decision, _SIGNAL[decision], merged, notices, tier)

    def to_finding(self, text: str, i: int, c: Candidate, tier: Tier, policy: Policy) -> Finding:
        tp = policy.for_type(c.type)
        action = policy.action_for(c.type, tier)
        return Finding(
            finding_id=f"f{i}", type=c.type, category=tp.category, rule_id=c.rule_id,
            detector="model" if c.detector == "model" else "rule",
            confidence=c.confidence, severity=tp.severity, action=action,
            span=Span(start=c.start, end=c.end, start_utf16=utf16_index(text, c.start),
                      end_utf16=utf16_index(text, c.end)),
            reason=c.reason,
            replacement=None if action in (Action.ALLOW, Action.BLOCK) else f"[{tp.token}_n]",
        )

    def to_findings(self, text: str, merged: list[Merged], tier: Tier,
                    policy: Policy | None = None) -> list[Finding]:
        policy = policy or self.policy
        return [self.to_finding(text, i, m.primary, tier, policy) for i, m in enumerate(merged, start=1)]

    async def inspect(self, req: InspectRequest, client_id: str | None = None, person_id: str | None = None,
                      schedule: Schedule | None = None) -> InspectResponse:
        """person_id·schedule 이 있으면(대시보드 사람과 연결된 개인 토큰) 전송 시점 검사를 대시보드에 기록한다."""
        t0 = time.perf_counter()
        r = await self.request_rules()
        dest, dest_notices = self.resolve_destination(req)
        a = await self.analyze(req.text, dest.tier, r)
        resp = InspectResponse(
            request_id=req.request_id, input_version=req.input_version, status=a.status,
            decision=a.decision, signal=a.signal,
            findings=self.to_findings(req.text, a.merged, dest.tier, r.policy),
            policy_version=self.policy.version, destination=_dest_out(dest),
            detector_versions=self.detector_versions(r), notices=dest_notices + a.notices,
        )
        self._record("inspect", req, a, dest, masked=0, t0=t0, client_id=client_id, policy=r.policy)
        if (schedule and person_id and self.org is not None and req.context.stage != "draft"
                and self.org.settings.report_text != "off"):
            schedule(self._report_job(req, resp, a, dest.tier, r.policy, person_id))
        return resp

    def _report_job(self, req: InspectRequest, resp: InspectResponse, a: Analysis, tier: Tier,
                    policy: Policy, person_id: str) -> Callable[[], Awaitable[None]]:
        org = self.org
        assert org is not None
        response = resp.model_dump(mode="json")

        def build(rules: OrgRules) -> dict:
            return build_event(
                rules=rules, settings=org.settings, person_id=person_id, text=req.text, response=response,
                merged=a.merged, token_of=lambda t: policy.for_type(t).token,
                finding_of=lambda c: self.to_finding(req.text, 0, c, tier, policy).model_dump(mode="json"))

        async def job() -> None:
            await org.report(build, set(self.policy.types))
        return job

    async def sanitize(self, req: InspectRequest, client_id: str | None = None) -> SanitizeResponse:
        """클라이언트가 보낸 구간을 믿지 않고 서버가 직접 검사 → 치환 → 재검사한다."""
        t0 = time.perf_counter()
        rq = await self.request_rules()
        policy = rq.policy
        dest, dest_notices = self.resolve_destination(req)
        first = await self.analyze(req.text, dest.tier, rq)
        targets = [
            Replacement(m.primary.start, m.primary.end, m.primary.type,
                        policy.for_type(m.primary.type).token)
            for m in first.merged
            if policy.action_for(m.primary.type, dest.tier) in (Action.MASK, Action.WARN)
        ]
        tokens = assign_tokens(req.text, targets)
        sanitized = apply(req.text, tokens)

        second = await self.analyze(sanitized, dest.tier, rq)
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
            remaining_findings=self.to_findings(sanitized, second.merged, dest.tier, policy),
            policy_version=self.policy.version, destination=_dest_out(dest),
            detector_versions=self.detector_versions(rq),
            notices=dest_notices + sorted(set(first.notices + second.notices)),
        )
        final = Analysis(status, decision, signal, second.merged, resp.notices, dest.tier)
        self._record("sanitize", req, final, dest, masked=len(tokens), t0=t0, client_id=client_id,
                     policy=policy)
        return resp

    def _record(self, endpoint: str, req: InspectRequest, a: Analysis, dest: Destination,
                masked: int, t0: float, client_id: str | None = None, policy: Policy | None = None) -> None:
        policy = policy or self.policy
        self.audit.record(AuditEvent.new(
            endpoint=endpoint, client_type=req.context.client_type.value,
            destination_provider=dest.provider, destination_channel=dest.channel,
            destination_tier=dest.tier.name,
            request_id=req.request_id, input_version=str(req.input_version),
            status=a.status.value, decision=a.decision.value,
            finding_counts=count([m.primary.type for m in a.merged]),
            actions=count([policy.action_for(m.primary.type, a.tier).value for m in a.merged]),
            rule_ids=sorted({c.rule_id for m in a.merged for c in m.members}),
            masked_count=masked, policy_version=self.policy.version,
            detector_versions=self.detector_versions(),
            duration_ms=int((time.perf_counter() - t0) * 1000),
            client_id=client_id,
        ))


def _dest_out(d: Destination) -> DestinationOut:
    return DestinationOut(provider=d.provider, channel=d.channel, tier=d.tier.name,
                          verified=d.verified, basis=d.basis)


def _worst(a: Status, b: Status) -> Status:
    order = [Status.COMPLETE, Status.INCOMPLETE, Status.ERROR]
    return max(a, b, key=order.index)
