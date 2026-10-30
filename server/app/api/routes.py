from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status

from app.api.deps import get_pipeline, require_api_key
from app.config import ModelMode
from app.schemas import InspectRequest, InspectResponse, SanitizeResponse
from app.services.pipeline import Pipeline

router = APIRouter()


def _check_size(req: InspectRequest, request: Request) -> None:
    if len(req.text) > request.app.state.settings.max_text_chars:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "text too long")


@router.post("/v1/inspect", response_model=InspectResponse, dependencies=[Depends(require_api_key)])
async def inspect(req: InspectRequest, request: Request,
                  pipeline: Pipeline = Depends(get_pipeline)) -> InspectResponse:
    _check_size(req, request)
    return await pipeline.inspect(req)


@router.post("/v1/sanitize", response_model=SanitizeResponse, dependencies=[Depends(require_api_key)])
async def sanitize(req: InspectRequest, request: Request,
                   pipeline: Pipeline = Depends(get_pipeline)) -> SanitizeResponse:
    _check_size(req, request)
    return await pipeline.sanitize(req)


@router.get("/v1/audit/events", dependencies=[Depends(require_api_key)])
async def audit_events(limit: int = Query(100, ge=1, le=1000), since: str | None = None,
                       pipeline: Pipeline = Depends(get_pipeline)) -> dict:
    return {"events": pipeline.audit.list(limit=limit, since=since)}


def client_bundle(pipeline: Pipeline) -> dict:
    """클라이언트(확장프로그램·CLI·@prompt-guard/rules)에 배포하는 규칙 묶음.

    문맥 탐지기의 기준·예문·프롬프트는 서버 안에서만 쓰므로 유형 정책만 보낸다.
    distribute=false 인 사용자 규칙(키워드 자체가 기밀인 경우 등)은 빼고 보낸다.
    """
    rs = pipeline.compiled.ruleset
    policy_fields = {"id", "label", "category", "severity", "action", "token", "enabled"}
    return {
        "ruleset_version": rs.version,
        "policy_version": pipeline.policy.version,
        "updated_at": rs.updated_at,
        "modules": rs.modules.model_dump(),
        "custom_rules": [r.model_dump(mode="json", exclude={"distribute"})
                         for r in rs.custom_rules if r.distribute],
        "context_detectors": [d.model_dump(mode="json", include=policy_fields) for d in rs.context_detectors],
    }


@router.get("/v1/rules/bundle", dependencies=[Depends(require_api_key)])
def rules_bundle(response: Response, pipeline: Pipeline = Depends(get_pipeline),
                 if_none_match: str | None = Header(default=None)):
    """대시보드에서 규칙을 바꾸면 버전이 오른다. 클라이언트는 ETag 로 주기적으로 확인해 바뀐 경우만 받는다."""
    bundle = client_bundle(pipeline)
    etag = f'"rs-{bundle["ruleset_version"]}-{bundle["policy_version"]}"'
    if if_none_match == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return bundle


@router.get("/healthz")
async def healthz() -> dict:
    """프로세스 생존 확인."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(pipeline: Pipeline = Depends(get_pipeline)) -> dict:
    """검사 가능 상태 확인. 모델 필수인데 모델이 준비되지 않았으면 503."""
    mode = pipeline.settings.model_mode
    model_ready = None
    if mode is not ModelMode.DISABLED and pipeline.model is not None:
        model_ready = await pipeline.model.ready()
    body = {"policy_version": pipeline.policy.version, "ruleset_version": pipeline.compiled.ruleset.version,
            "model_mode": mode.value, "model_api": pipeline.settings.model_api, "model_ready": model_ready}
    mandatory = mode is ModelMode.REQUIRED or pipeline.policy.model_required
    if mandatory and not model_ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, body)
    return body
