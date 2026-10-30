from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response, status

from app.api.deps import get_pipeline, require_api_key, require_report_client
from app.clients.store import Client
from app.config import ModelMode
from app.schemas import FileReportRequest, FileReportResponse, InspectRequest, InspectResponse, SanitizeResponse
from app.services.pipeline import Pipeline

router = APIRouter()


def _check_size(req: InspectRequest, request: Request) -> None:
    if len(req.text) > request.app.state.settings.max_text_chars:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "text too long")


@router.post("/v1/inspect", response_model=InspectResponse)
async def inspect(req: InspectRequest, request: Request, background: BackgroundTasks,
                  client: Client | None = Depends(require_api_key),
                  pipeline: Pipeline = Depends(get_pipeline)) -> InspectResponse:
    _check_size(req, request)
    # 대시보드 기록은 응답을 보낸 뒤 보낸다(검사 지연·실패에 영향 없음).
    return await pipeline.inspect(req, client_id=client.client_id if client else None,
                                  person_id=client.person_id if client else None,
                                  schedule=background.add_task)


@router.post("/v1/sanitize", response_model=SanitizeResponse)
async def sanitize(req: InspectRequest, request: Request, client: Client | None = Depends(require_api_key),
                   pipeline: Pipeline = Depends(get_pipeline)) -> SanitizeResponse:
    _check_size(req, request)
    return await pipeline.sanitize(req, client_id=client.client_id if client else None)


@router.post("/v1/files/report", response_model=FileReportResponse, status_code=status.HTTP_202_ACCEPTED)
async def report_files(req: FileReportRequest, client: Client = Depends(require_report_client),
                       pipeline: Pipeline = Depends(get_pipeline)) -> FileReportResponse:
    return await pipeline.report_files(req, client.person_id)


@router.get("/v1/audit/events")
async def audit_events(limit: int = Query(100, ge=1, le=1000), since: str | None = None,
                       client: Client | None = Depends(require_api_key),
                       pipeline: Pipeline = Depends(get_pipeline)) -> dict:
    # 개인 토큰으로는 자기 이벤트만 본다. 전체·사용자별 조회는 대시보드 관리 API(/v1/admin/audit/*).
    return {"events": pipeline.audit.list(limit=limit, since=since,
                                          client_id=client.client_id if client else None)}


def client_bundle(pipeline: Pipeline, org_rules: dict | None = None) -> dict:
    """클라이언트(확장프로그램·CLI·@prompt-guard/rules)에 배포하는 규칙 묶음.

    문맥 탐지기의 기준·예문·프롬프트는 서버 안에서만 쓰므로 유형 정책만 보낸다.
    distribute=false 인 사용자 규칙(키워드 자체가 기밀인 경우 등)은 빼고 보낸다.
    """
    rs = pipeline.compiled.ruleset
    destinations = pipeline.policy.destinations
    policy_fields = {"id", "label", "category", "severity", "action", "token", "enabled"}
    return {
        "ruleset_version": rs.version,
        "policy_version": pipeline.policy.version,
        "updated_at": rs.updated_at,
        "modules": rs.modules.model_dump(),
        "custom_rules": [r.model_dump(mode="json", exclude={"distribute"})
                         for r in rs.custom_rules if r.distribute],
        "context_detectors": [d.model_dump(mode="json", include=policy_fields) for d in rs.context_detectors],
        "org_rules": org_rules,
        "destinations": {
            provider: {channel: {"tier": tier, "basis": basis,
                                 "verified_at": destinations.verified_at[provider].isoformat()}
                       for channel, (tier, basis) in channels.items()}
            for provider, channels in destinations.profiles.items()},
    }


@router.get("/v1/rules/bundle", dependencies=[Depends(require_api_key)])
async def rules_bundle(response: Response, pipeline: Pipeline = Depends(get_pipeline),
                       if_none_match: str | None = Header(default=None)):
    """대시보드에서 규칙을 바꾸면 버전이 오른다. 클라이언트는 ETag 로 주기적으로 확인해 바뀐 경우만 받는다."""
    rules = await pipeline.request_rules()
    org_rules = (rules.org.bundle(pipeline.org.settings.tag_action)
                 if rules.org and pipeline.org and not pipeline.org.client.last_error else None)
    bundle = client_bundle(pipeline, org_rules)
    digest = hashlib.sha256(json.dumps(bundle, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    etag = f'"rs-{digest}"'
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
    mode = pipeline.runtime.model_mode
    body = {**await pipeline.runtime_status(), "model_api": pipeline.settings.model_api}
    mandatory = mode is ModelMode.REQUIRED or pipeline.policy.model_required
    if pipeline.runtime.endpoint_set and mandatory and not body["model_ready"]:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, body)
    return body
