from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.admin import router as admin_router
from app.api.routes import router
from app.audit.events import AuditStore
from app.config import ModelMode, Settings
from app.detection.model import ContextModelDetector
from app.policy.engine import Policy
from app.registry.store import RuleSetStore
from app.services.pipeline import Pipeline

log = logging.getLogger("prompt_guard")


def create_app(settings: Settings | None = None, audit: AuditStore | None = None,
               ruleset_store: RuleSetStore | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if not settings.auth_disabled and not settings.api_keys:
        raise RuntimeError("PG_API_KEYS 가 비어 있습니다. 개발 중이면 PG_AUTH_DISABLED=true 를 사용하세요.")

    model = None
    if settings.model_mode is not ModelMode.DISABLED:
        model = ContextModelDetector(settings.model_api, settings.model_base_url, settings.model_name,
                                     settings.model_timeout_s, settings.model_max_concurrency,
                                     settings.model_api_key)

    app = FastAPI(title="Prompt Guard", version="0.1.0",
                  docs_url="/docs", redoc_url=None)
    policy = Policy.load(settings.policy_path)
    if ruleset_store is None:
        ruleset_store = RuleSetStore(settings.ruleset_db_path, policy.detectors_seed_path, set(policy.types))
    app.state.settings = settings
    app.state.ruleset_store = ruleset_store
    app.state.pipeline = Pipeline(settings, policy, audit or AuditStore(settings.audit_db_path),
                                  model=model, ruleset_source=ruleset_store)

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_body_bytes:
            return JSONResponse({"detail": "request body too large"}, status_code=413)
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        # FastAPI 기본 422 응답은 입력값(input)을 그대로 되돌려준다 → 원문 노출 방지를 위해 제거.
        errors = [{"loc": e.get("loc"), "type": e.get("type"), "msg": e.get("msg")}
                  for e in exc.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        # 스택트레이스·예외 메시지에 원문이 포함될 수 있어 타입명만 기록한다.
        log.error("unhandled error: %s", type(exc).__name__)
        return JSONResponse({"detail": "internal error", "status": "error"}, status_code=500)

    app.include_router(router)
    app.include_router(admin_router)
    return app
