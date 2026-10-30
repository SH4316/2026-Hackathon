"""조직 설정·상태 관리 API(X-Admin-Key). 대시보드 '검사 서버 연결' 화면이 쓸 수 있다."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import require_admin
from app.org.dashboard import DashboardUnavailable
from app.org.rules import check_regex
from app.org.settings import OrgSettings, OrgSettingsBody

router = APIRouter(prefix="/v1/admin/org", tags=["org"])


class RegexPattern(BaseModel):
    tag_id: str
    pattern: str


class RegexCheckBody(BaseModel):
    patterns: list[RegexPattern] = Field(max_length=1000)


@router.post("/regex/check")
def check_org_regex(body: RegexCheckBody, _: str = Depends(require_admin)) -> dict:
    results = []
    for item in body.patterns:
        reason = None
        try:
            check_regex(item.pattern)
        except ValueError as exc:
            reason = str(exc)
        results.append({"tag_id": item.tag_id, "ok": reason is None, "reason": reason})
    return {"results": results}


@router.get("/settings", response_model=OrgSettings)
def get_settings(request: Request, _: str = Depends(require_admin)) -> OrgSettings:
    return request.app.state.org.settings


@router.put("/settings", response_model=OrgSettings)
def put_settings(body: OrgSettingsBody, request: Request, actor: str = Depends(require_admin)) -> OrgSettings:
    org = request.app.state.org
    if org.settings.source == "dashboard":
        raise HTTPException(status.HTTP_409_CONFLICT, "대시보드 '검사 서버 연결' 설정을 따르고 있습니다. 대시보드에서 바꾸세요")
    org.settings_store.update(body, actor)
    return org.settings


@router.get("/status")
async def org_status(request: Request, _: str = Depends(require_admin)) -> dict:
    org = request.app.state.org
    if org.enabled:
        try:
            await org.rules(set(request.app.state.pipeline.policy.types))
        except DashboardUnavailable:
            pass  # 연결 실패·활성 버전 해제도 dashboard_error 로 표시한다.
    return org.status()


@router.post("/refresh")
async def refresh(request: Request, _: str = Depends(require_admin)) -> dict:
    """대시보드 활성 설정을 바로 다시 받는다(설정 변경 직후 확인용)."""
    org = request.app.state.org
    if not org.enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "대시보드가 설정되지 않았습니다(PG_DASHBOARD_URL)")
    problem = await org.client.check()
    if problem:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"대시보드 연결을 확인할 수 없습니다: {problem}")
    try:
        await org.rules(set(request.app.state.pipeline.policy.types), force=True)
    except DashboardUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"대시보드 설정을 받을 수 없습니다: {exc}") from None
    return org.status()
