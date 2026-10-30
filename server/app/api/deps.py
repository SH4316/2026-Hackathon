from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Request, status

from app.services.pipeline import Pipeline


def get_pipeline(request: Request) -> Pipeline:
    return request.app.state.pipeline


def require_api_key(request: Request, x_api_key: str | None = Header(default=None)) -> None:
    """정적 API 키 인증(초기). CORS 는 인증을 대체하지 않는다."""
    settings = request.app.state.settings
    if settings.auth_disabled:
        return
    if not x_api_key or not any(hmac.compare_digest(x_api_key, k) for k in settings.api_keys):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")
