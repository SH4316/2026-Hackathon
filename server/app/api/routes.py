from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

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
    body = {"policy_version": pipeline.policy.version, "model_mode": mode.value,
            "model_ready": model_ready}
    mandatory = mode is ModelMode.REQUIRED or pipeline.policy.model_required
    if mandatory and not model_ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, body)
    return body
