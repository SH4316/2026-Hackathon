"""조직 관리 모드: 대시보드 규칙 실행과 판정 기록 전송.

PG_DASHBOARD_URL 이 있으면 이 서버는 조직 서버로 동작한다.
- 모든 검사에 대시보드 활성 설정의 태그 정규식·Jev 판정을 더한다(기존 규칙 결과는 취소하지 않고 더 엄격한 쪽 적용).
- 대시보드 활성 설정을 받을 수 없으면 조직 규칙을 적용하지 못했으므로 검사 미완료(회색)로 돌려준다.
- 대시보드 사람 ID 와 연결된 개인 토큰의 '전송 시점' 검사만 대시보드에 기록한다(조직 설정 report_text).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from app.config import ModelMode
from app.detection.base import Candidate
from app.detection.model import ContextModelDetector, ModelUnavailable
from app.org.dashboard import DashboardClient, DashboardUnavailable
from app.org.rules import OrgRules, compile_org
from app.org.settings import OrgSettings, OrgSettingsStore
from app.runtime import RuntimeState
from app.schemas import Confidence

log = logging.getLogger("prompt_guard.org")


@dataclass
class OrgDetection:
    candidates: list[Candidate] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)
    incomplete: bool = False   # 조직 규칙을 끝까지 적용하지 못함
    error: bool = False        # 모델 필수인데 Jev 실패
    unlocated: bool = False    # 임계값을 넘었지만 근거 구간이 없는 Jev 판정(최소 warn)


class OrgService:
    def __init__(self, client: DashboardClient | None, settings: OrgSettingsStore,
                 model: ContextModelDetector | None, runtime: RuntimeState) -> None:
        self.client = client
        self.settings_store = settings
        self.model = model
        self.runtime = runtime
        self._compiled: tuple[tuple, OrgRules] | None = None
        self.reported = 0
        self.report_failures: dict[str, int] = {}

    @property
    def enabled(self) -> bool:
        return self.client is not None

    @property
    def settings(self) -> OrgSettings:
        return self.settings_store.current()

    async def rules(self, reserved_types: set[str], force: bool = False) -> OrgRules:
        """대시보드 활성 설정을 컴파일한 조직 규칙. 받을 수 없으면 DashboardUnavailable."""
        assert self.client is not None
        try:
            config = await self.client.config(force=force)
        except DashboardUnavailable:
            self._compiled = None
            raise
        s = self.settings
        key = (config.get("id"), config.get("revision"), s.version, frozenset(reserved_types))
        if self._compiled is None or self._compiled[0] != key:
            rules = compile_org(config, reserved_types, jev_enabled=s.jev_enabled)
            if rules.skipped:
                log.warning("dashboard regex skipped: %s", sorted(rules.skipped.items()))
            self._compiled = (key, rules)
        return self._compiled[1]

    async def detect(self, text: str, rules: OrgRules) -> OrgDetection:
        out = OrgDetection(candidates=rules.detect_regex(text))
        if not rules.jev:
            return out
        if not self.runtime.endpoint_set:
            out.notices.append("model_endpoint_unset")
            return out
        mode = self.runtime.model_mode
        if self.model is None or mode is ModelMode.DISABLED:
            out.incomplete = True
            out.notices.append("org_jev_model_disabled")
            return out
        results = await asyncio.gather(*(self.model.judge(text, p.prompt, p.outputs) for p in rules.jev),
                                       return_exceptions=True)
        for p, res in zip(rules.jev, results):
            if isinstance(res, ModelUnavailable):
                out.incomplete = True
                out.error = out.error or mode is ModelMode.REQUIRED
                if "org_jev_failed" not in out.notices:
                    out.notices.append("org_jev_failed")
                continue
            if isinstance(res, BaseException):
                raise res
            for score in res:
                threshold = rules.thresholds.get(score.tag_id)
                if threshold is None or score.score < threshold:
                    continue  # 임계값 미설정 태그는 판정하지 않는다
                spans = ((0, len(text)),) if score.whole_input and text else score.spans
                if not spans:
                    out.unlocated = True
                    if "org_jev_unlocated" not in out.notices:
                        out.notices.append("org_jev_unlocated")
                scope = "입력 전체 분류" if score.whole_input else "조직 Jev 판정"
                for start, end in spans:
                    out.candidates.append(Candidate(
                        type=rules.type_of[score.tag_id], rule_id=f"org-jev:{p.id}:{score.tag_id}",
                        start=start, end=end, confidence=Confidence.MEDIUM, detector="model",
                        reason=f"{rules.tag_names[score.tag_id]}({scope} {score.score:.2f})"))
        return out

    def _fail(self, code: str) -> None:
        self.report_failures[code] = self.report_failures.get(code, 0) + 1
        log.warning("dashboard report failed: %s", code)

    async def report(self, build, reserved_types: set[str]) -> bool:
        """build(rules) → detector-events 본문. 활성 버전이 바뀌었으면(409) 설정을 다시 받아 한 번 재시도한다."""
        assert self.client is not None
        for attempt in range(2):
            try:
                rules = await self.rules(reserved_types, force=attempt > 0)
            except DashboardUnavailable as exc:
                self._fail(str(exc))
                return False
            res = await self.client.post_event(build(rules))
            if res.status in (200, 201):
                self.reported += 1
                return True
            if res.code != "VERSION_MISMATCH":
                break
        self._fail(res.code or f"http_{res.status}")
        return False

    def status(self) -> dict:
        if not self.enabled:
            return {"managed": False}
        compiled = self._compiled[1] if self._compiled else None
        return {"managed": True, "dashboard_error": self.client.last_error,
                "version_id": compiled.version_id if compiled else None,
                "revision": compiled.revision if compiled else None,
                "regex_tags": len(compiled.regex) if compiled else 0,
                "jev_prompts": len(compiled.jev) if compiled else 0,
                "skipped_regex": compiled.skipped if compiled else {},
                "report_text": self.settings.report_text, "reported": self.reported,
                "report_failures": self.report_failures}
