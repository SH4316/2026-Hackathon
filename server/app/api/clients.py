"""대시보드 ↔ 개인 클라이언트 연결과 대시보드 조회 API.

개인(확장프로그램·CLI):
  POST /v1/auth/enroll   등록 코드 → 개인 토큰(한 번만 보여 줌). 인증 없이 호출(코드가 비밀)
  GET  /v1/auth/me       내 연결 정보
  POST /v1/auth/logout   내 토큰 해지
대시보드(X-Admin-Key):
  POST   /v1/admin/enrollments          사용자별 일회용 등록 코드 발급
  GET    /v1/admin/clients              연결된 클라이언트 목록
  PATCH  /v1/admin/clients/{id}         표시 이름 변경
  DELETE /v1/admin/clients/{id}         연결 해지(토큰 무효화)
  GET    /v1/admin/audit/events         원문 없는 감사 이벤트(사용자·기간 필터)
  GET    /v1/admin/audit/summary        기간·사용자별 집계
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.api.deps import get_clients, get_pipeline, require_admin, require_client
from app.clients.store import Client, ClientStore, EnrollmentInvalid
from app.org.dashboard import DashboardUnavailable
from app.schemas import ClientType
from app.services.pipeline import Pipeline

router = APIRouter(tags=["clients"])


# ── 개인 클라이언트 ──
class EnrollRequest(BaseModel):
    code: str = Field(min_length=8, max_length=20)
    client_type: ClientType
    device_name: str | None = Field(default=None, max_length=60)


class EnrollResponse(BaseModel):
    client_id: str
    label: str
    person_id: str | None = None
    managed: bool = False  # 조직 관리(대시보드 규칙 적용·기록) 여부
    token: str  # 이 응답에서만 볼 수 있다. 클라이언트는 X-API-Key 또는 Authorization: Bearer 로 쓴다.


@router.post("/v1/auth/enroll", response_model=EnrollResponse, status_code=status.HTTP_201_CREATED)
async def enroll(body: EnrollRequest, request: Request,
                 clients: ClientStore = Depends(get_clients)) -> EnrollResponse:
    """이 서버가 발급한 코드, 또는 (조직 서버면) 대시보드 사람 화면에서 발급한 코드."""
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, "등록 코드가 올바르지 않거나 만료되었습니다")
    try:
        client, token = clients.enroll(body.code, body.client_type.value, body.device_name)
    except EnrollmentInvalid:
        dashboard = request.app.state.org.client
        if dashboard is None:
            raise invalid from None
        try:
            person = await dashboard.redeem(body.code)
        except DashboardUnavailable:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "대시보드에 연결할 수 없습니다") from None
        if person is None:
            raise invalid from None
        client, token = clients.create_client(str(person.get("name") or person["personId"]),
                                              body.client_type.value, body.device_name, person["personId"])
    return EnrollResponse(client_id=client.client_id, label=client.label, token=token, person_id=client.person_id,
                          managed=request.app.state.org.enabled)


@router.get("/v1/auth/me")
def me(client: Client = Depends(require_client), pipeline: Pipeline = Depends(get_pipeline)) -> dict:
    org = pipeline.org
    return {**client.to_dict(), "policy_version": pipeline.policy.version,
            "ruleset_version": pipeline.compiled.ruleset.version,
            "managed": org is not None,
            "reporting": bool(org and client.person_id and org.settings.report_text != "off"),
            "report_text": org.settings.report_text if org else None}


@router.post("/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def logout(client: Client = Depends(require_client), clients: ClientStore = Depends(get_clients)) -> None:
    clients.revoke(client.client_id)


# ── 대시보드 ──
class EnrollmentRequest(BaseModel):
    # 대시보드 사람 ID(조직 관리). 조직 서버면 대시보드에 등록된 사람인지 확인하고, label 을 비우면 그 이름을 쓴다.
    person_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,80}$")
    label: str | None = Field(default=None, min_length=1, max_length=60)  # 사용자 이름·부서 등
    ttl_minutes: int | None = Field(default=None, ge=5, le=7 * 24 * 60)


@router.post("/v1/admin/enrollments", status_code=status.HTTP_201_CREATED)
async def create_enrollment(body: EnrollmentRequest, request: Request, actor: str = Depends(require_admin),
                            clients: ClientStore = Depends(get_clients)) -> dict:
    """일회용 등록 코드(XXXX-XXXX). 코드는 이 응답에서만 볼 수 있다."""
    label = body.label
    dashboard = request.app.state.org.client
    if body.person_id and dashboard is not None:
        try:
            person = await dashboard.person(body.person_id)
        except DashboardUnavailable:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "대시보드에 연결할 수 없습니다") from None
        if person is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "대시보드에 등록되지 않은 사람입니다")
        label = label or str(person.get("name") or body.person_id)[:60]
    if not label:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "label 또는 person_id 가 필요합니다")
    ttl = body.ttl_minutes or request.app.state.settings.enrollment_ttl_minutes
    return clients.create_enrollment(label, timedelta(minutes=ttl), actor, body.person_id)


@router.get("/v1/admin/clients")
def list_clients(include_revoked: bool = False, _: str = Depends(require_admin),
                 clients: ClientStore = Depends(get_clients)) -> dict:
    return {"clients": [c.to_dict() for c in clients.list_clients(include_revoked)]}


class ClientPatch(BaseModel):
    label: str = Field(min_length=1, max_length=60)


@router.patch("/v1/admin/clients/{client_id}")
def update_client(client_id: str, body: ClientPatch, _: str = Depends(require_admin),
                  clients: ClientStore = Depends(get_clients)) -> dict:
    client = clients.update_label(client_id, body.label)
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    return client.to_dict()


@router.delete("/v1/admin/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def revoke_client(client_id: str, _: str = Depends(require_admin),
                  clients: ClientStore = Depends(get_clients)) -> None:
    if not clients.revoke(client_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found or already revoked")


@router.get("/v1/admin/audit/events")
def admin_audit_events(limit: int = Query(100, ge=1, le=1000), since: str | None = None,
                       until: str | None = None, client_id: str | None = None,
                       _: str = Depends(require_admin), pipeline: Pipeline = Depends(get_pipeline)) -> dict:
    return {"events": pipeline.audit.list(limit=limit, since=since, until=until, client_id=client_id)}


@router.get("/v1/admin/audit/summary")
def admin_audit_summary(since: str | None = None, until: str | None = None, client_id: str | None = None,
                        _: str = Depends(require_admin), pipeline: Pipeline = Depends(get_pipeline),
                        clients: ClientStore = Depends(get_clients)) -> dict:
    """서버 검사 판정 집계(실제 전송·차단 수가 아님). by_client 에 대시보드 표시 이름을 붙인다."""
    s = pipeline.audit.summary(since=since, until=until, client_id=client_id)
    labels = {c.client_id: c.label for c in clients.list_clients(include_revoked=True)}
    for cid, row in s["by_client"].items():
        row["label"] = labels.get(cid)
    return {"since": since, "until": until, "client_id": client_id, **s}
