"""대시보드용 관리 API: 탐지 모듈 조합, 사용자 규칙, 문맥 탐지기(기준·예문), 프롬프트.

모든 변경은 새 ruleset 버전을 만든다. 동시 편집 충돌을 막으려면 If-Match: <버전> 헤더를 보낸다.
테스트 엔드포인트에 넣는 샘플 텍스트는 저장하지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.api.deps import get_pipeline, get_store, require_admin
from app.config import ModelMode
from app.detection.custom import CustomRuleDetector
from app.detection.model import DEFAULT_PROMPT_TEMPLATE, ModelUnavailable, build_system_prompt
from app.registry.schema import ContextDetector, CustomRule, Modules, RuleSet, RuleSetBody
from app.registry.store import RuleSetStore, VersionConflict
from app.services.pipeline import Pipeline, utf16_index

router = APIRouter(prefix="/v1/admin", tags=["admin"])


class RuntimeBody(BaseModel):
    model_mode: ModelMode


@router.get("/runtime")
async def get_runtime(_: str = Depends(require_admin), pipeline: Pipeline = Depends(get_pipeline)) -> dict:
    return await pipeline.runtime_status()


@router.put("/runtime")
async def put_runtime(body: RuntimeBody, actor: str = Depends(require_admin),
                      pipeline: Pipeline = Depends(get_pipeline)) -> dict:
    pipeline.runtime.set_model_mode(body.model_mode, actor)
    return await pipeline.runtime_status()


def _update(store: RuleSetStore, actor: str, if_match: str | None,
            mutate: Callable[[RuleSetBody], RuleSetBody], response: Response) -> RuleSet:
    expected = None
    if if_match is not None:
        try:
            expected = int(if_match.strip('W/"rs-'))
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "If-Match 는 ruleset 버전 숫자입니다") from None
    try:
        rs = store.update(mutate, actor, expected)
    except VersionConflict as exc:
        raise HTTPException(status.HTTP_412_PRECONDITION_FAILED,
                            {"detail": "다른 변경이 먼저 저장되었습니다", "current_version": exc.args[0]}) from None
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc).splitlines()[0]) from None
    response.headers["ETag"] = f'"{rs.version}"'
    return rs


def _check_text(request: Request, text: str) -> None:
    if len(text) > request.app.state.settings.max_text_chars:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "text too long")


@router.get("/ruleset", response_model=RuleSet)
def get_ruleset(response: Response, _: str = Depends(require_admin),
                store: RuleSetStore = Depends(get_store)) -> RuleSet:
    rs = store.current()
    response.headers["ETag"] = f'"{rs.version}"'
    return rs


@router.get("/ruleset/history")
def ruleset_history(_: str = Depends(require_admin), store: RuleSetStore = Depends(get_store)) -> dict:
    return {"versions": store.history()}


# ── 모듈 조합 ──
@router.put("/modules", response_model=RuleSet)
def put_modules(modules: Modules, response: Response, actor: str = Depends(require_admin),
                if_match: str | None = Header(default=None), store: RuleSetStore = Depends(get_store)):
    def mutate(b: RuleSetBody) -> RuleSetBody:
        b.modules = modules
        return b
    return _update(store, actor, if_match, mutate, response)


# ── 사용자 규칙(키워드·정규식) ──
def _upsert(items: list, item) -> list:
    return [x for x in items if x.id != item.id] + [item]


@router.put("/custom-rules/{rule_id}", response_model=RuleSet)
def put_custom_rule(rule_id: str, rule: CustomRule, response: Response, actor: str = Depends(require_admin),
                    if_match: str | None = Header(default=None), store: RuleSetStore = Depends(get_store)):
    if rule.id != rule_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "경로의 id 와 본문의 id 가 다릅니다")

    def mutate(b: RuleSetBody) -> RuleSetBody:
        b.custom_rules = _upsert(b.custom_rules, rule)
        return b
    return _update(store, actor, if_match, mutate, response)


@router.delete("/custom-rules/{rule_id}", response_model=RuleSet)
def delete_custom_rule(rule_id: str, response: Response, actor: str = Depends(require_admin),
                       if_match: str | None = Header(default=None), store: RuleSetStore = Depends(get_store)):
    if all(r.id != rule_id for r in store.current().custom_rules):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")

    def mutate(b: RuleSetBody) -> RuleSetBody:
        b.custom_rules = [r for r in b.custom_rules if r.id != rule_id]
        return b
    return _update(store, actor, if_match, mutate, response)


class RuleTest(BaseModel):
    rule: CustomRule
    text: str


@router.post("/custom-rules/test")
def test_custom_rule(body: RuleTest, request: Request, _: str = Depends(require_admin)) -> dict:
    """저장하지 않고 규칙을 샘플 텍스트에 돌려 본다. 일치 위치만 돌려준다(값은 대시보드가 샘플에서 잘라 쓴다)."""
    _check_text(request, body.text)
    rule = body.rule.model_copy(update={"enabled": True})
    hits = CustomRuleDetector([rule]).detect(body.text)
    return {"matches": [{"start": c.start, "end": c.end, "start_utf16": utf16_index(body.text, c.start),
                         "end_utf16": utf16_index(body.text, c.end)} for c in hits]}


# ── 문맥 탐지기(정규식으로 판단할 수 없는 기준) ──
@router.put("/context-detectors/{detector_id}", response_model=RuleSet)
def put_context_detector(detector_id: str, detector: ContextDetector, response: Response,
                         actor: str = Depends(require_admin), if_match: str | None = Header(default=None),
                         store: RuleSetStore = Depends(get_store)):
    if detector.id != detector_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "경로의 id 와 본문의 id 가 다릅니다")

    def mutate(b: RuleSetBody) -> RuleSetBody:
        b.context_detectors = _upsert(b.context_detectors, detector)
        return b
    return _update(store, actor, if_match, mutate, response)


@router.delete("/context-detectors/{detector_id}", response_model=RuleSet)
def delete_context_detector(detector_id: str, response: Response, actor: str = Depends(require_admin),
                            if_match: str | None = Header(default=None), store: RuleSetStore = Depends(get_store)):
    if all(d.id != detector_id for d in store.current().context_detectors):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "detector not found")

    def mutate(b: RuleSetBody) -> RuleSetBody:
        b.context_detectors = [d for d in b.context_detectors if d.id != detector_id]
        return b
    return _update(store, actor, if_match, mutate, response)


class ContextTest(BaseModel):
    text: str
    # 비우면 저장된(켜진) 탐지기로, 넣으면 저장 전 초안으로 시험한다.
    detectors: list[ContextDetector] | None = Field(default=None, max_length=30)


@router.post("/context-detectors/test")
async def test_context_detectors(body: ContextTest, request: Request, _: str = Depends(require_admin),
                                 pipeline: Pipeline = Depends(get_pipeline),
                                 store: RuleSetStore = Depends(get_store)) -> dict:
    _check_text(request, body.text)
    if not pipeline.runtime.endpoint_set:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Jev 모델 엔드포인트가 설정되지 않았습니다")
    if pipeline.model is None or pipeline.runtime.model_mode is ModelMode.DISABLED:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Jev가 꺼져 있습니다")
    rs = store.current()
    detectors = body.detectors if body.detectors is not None else [d for d in rs.context_detectors if d.enabled]
    if not detectors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "시험할 탐지기가 없습니다")
    try:
        hits = await pipeline.model.detect(body.text, detectors, rs.prompt_template)
    except ModelUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"모델 호출 실패: {exc}") from None
    return {"model": pipeline.model.version,
            "candidates": [{"type": c.type, "start": c.start, "end": c.end,
                            "start_utf16": utf16_index(body.text, c.start),
                            "end_utf16": utf16_index(body.text, c.end)} for c in hits]}


# ── 프롬프트 ──
class PromptBody(BaseModel):
    template: str | None = Field(default=None, max_length=4000)  # null 이면 기본 프롬프트


@router.get("/prompt")
def get_prompt(_: str = Depends(require_admin), store: RuleSetStore = Depends(get_store)) -> dict:
    """현재 프롬프트 설정과, 켜진 탐지기로 실제 모델에 들어갈 시스템 프롬프트 미리보기."""
    rs = store.current()
    enabled = [d for d in rs.context_detectors if d.enabled]
    return {"ruleset_version": rs.version, "template": rs.prompt_template,
            "is_default": rs.prompt_template is None, "default_template": DEFAULT_PROMPT_TEMPLATE,
            "rendered_system_prompt": build_system_prompt(enabled, rs.prompt_template)}


@router.put("/prompt", response_model=RuleSet)
def put_prompt(body: PromptBody, response: Response, actor: str = Depends(require_admin),
               if_match: str | None = Header(default=None), store: RuleSetStore = Depends(get_store)):
    def mutate(b: RuleSetBody) -> RuleSetBody:
        b.prompt_template = body.template
        return b
    return _update(store, actor, if_match, mutate, response)
