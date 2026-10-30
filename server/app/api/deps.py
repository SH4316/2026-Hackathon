from __future__ import annotations

import hmac

from fastapi import Depends, Header, HTTPException, Request, status

from app.clients.store import Client, ClientStore
from app.registry.store import RuleSetStore, actor_id
from app.services.pipeline import Pipeline


def get_pipeline(request: Request) -> Pipeline:
    return request.app.state.pipeline


def get_store(request: Request) -> RuleSetStore:
    return request.app.state.ruleset_store


def get_clients(request: Request) -> ClientStore:
    return request.app.state.clients


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization[:7].lower() == "bearer ":
        return authorization[7:].strip()
    return None


def require_api_key(request: Request, x_api_key: str | None = Header(default=None),
                    authorization: str | None = Header(default=None)) -> Client | None:
    """정적 API 키 또는 대시보드에서 연결한 개인 토큰(X-API-Key 또는 Authorization: Bearer).

    개인 토큰이면 그 클라이언트를 돌려주고 request.state.client 에 둔다(감사 이벤트의 client_id).
    CORS 는 인증을 대체하지 않는다.
    """
    settings = request.app.state.settings
    key = x_api_key or _bearer(authorization)
    client = request.app.state.clients.authenticate(key) if key else None
    request.state.client = client
    if client or settings.auth_disabled:
        return client
    if not key or not any(hmac.compare_digest(key, k) for k in settings.api_keys):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")
    return None


def require_client(client: Client | None = Depends(require_api_key)) -> Client:
    """개인 토큰으로만 호출할 수 있는 엔드포인트(내 연결 정보·연결 해제)."""
    if client is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "client token required")
    return client


def require_report_client(request: Request, x_api_key: str | None = Header(default=None),
                          authorization: str | None = Header(default=None)) -> Client:
    key = x_api_key or _bearer(authorization)
    client = request.app.state.clients.authenticate(key) if key else None
    if client is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "파일 기록에는 등록된 개인 토큰이 필요합니다")
    return client


def require_admin(request: Request, x_admin_key: str | None = Header(default=None)) -> str:
    """대시보드용 관리 키. 일반 API 키로는 규칙을 바꿀 수 없다. 반환값은 변경 기록용 행위자 지문."""
    settings = request.app.state.settings
    if settings.auth_disabled:
        return actor_id(None)
    if not settings.admin_keys:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin API disabled (PG_ADMIN_KEYS 미설정)")
    if not x_admin_key or not any(hmac.compare_digest(x_admin_key, k) for k in settings.admin_keys):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid admin key")
    return actor_id(x_admin_key)
