from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Request, status

from app.registry.store import RuleSetStore, actor_id
from app.services.pipeline import Pipeline


def get_pipeline(request: Request) -> Pipeline:
    return request.app.state.pipeline


def get_store(request: Request) -> RuleSetStore:
    return request.app.state.ruleset_store


def require_api_key(request: Request, x_api_key: str | None = Header(default=None)) -> None:
    """정적 API 키 인증(초기). CORS 는 인증을 대체하지 않는다."""
    settings = request.app.state.settings
    if settings.auth_disabled:
        return
    if not x_api_key or not any(hmac.compare_digest(x_api_key, k) for k in settings.api_keys):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")


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
