"""대시보드(dashboard/, Spring Boot) 연동.

- 활성 설정: GET  /api/v1/classifier-config  (태그·pythonRegex·jevThreshold·jevPrompts)
- 사람 확인: GET  /api/v1/people/{id}
- 판정 기록: POST /api/v1/detector-events   (CONTRACT.md "Detector HTTP ingestion")

대시보드는 설정을 저장·제공만 하고, 정규식·Jev 실행과 `점수 >= 임계값` 판정은 이 서버가 한다.
예외 메시지·로그에 원문이 섞이지 않도록 상태 코드·오류 코드만 다룬다.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger("prompt_guard.dashboard")


class DashboardUnavailable(Exception):
    """대시보드에 연결할 수 없거나 활성 설정이 없다."""


@dataclass(frozen=True)
class PostResult:
    status: int
    code: str | None  # 대시보드 오류 코드(VERSION_MISMATCH, PERSON_NOT_REGISTERED …)


class DashboardClient:
    def __init__(self, base_url: str, timeout_s: float = 5.0, refresh_s: float = 30.0,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.base_url = base_url.rstrip("/") + "/api/v1"
        self.timeout_s = timeout_s
        self.refresh_s = refresh_s
        self._transport = transport  # 테스트용
        self._config: dict | None = None
        self._fetched_at = 0.0
        self._lock = asyncio.Lock()
        self.last_error: str | None = None

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout_s, transport=self._transport)

    @property
    def cached_config(self) -> dict | None:
        return self._config

    async def config(self, force: bool = False) -> dict:
        """활성 설정. refresh_s 마다 다시 받고, 실패하면 마지막으로 받은 설정을 계속 쓴다."""
        async with self._lock:
            fresh = time.monotonic() - self._fetched_at < self.refresh_s
            if self._config is not None and fresh and not force:
                return self._config
            try:
                async with self._client() as c:
                    r = await c.get(self.base_url + "/classifier-config")
                if r.status_code == 404:
                    raise DashboardUnavailable("NO_ACTIVE_VERSION")
                r.raise_for_status()
                self._config = r.json()
                self.last_error = None
            except DashboardUnavailable as exc:
                self.last_error = str(exc)
                self._config = None  # 활성 버전이 해제됐으면 이전 설정을 쓰지 않는다
            except (httpx.HTTPError, ValueError) as exc:
                self.last_error = type(exc).__name__
            self._fetched_at = time.monotonic()
            if self._config is None:
                raise DashboardUnavailable(self.last_error or "unavailable")
            return self._config

    async def person(self, person_id: str) -> dict | None:
        try:
            async with self._client() as c:
                r = await c.get(f"{self.base_url}/people/{person_id}")
        except httpx.HTTPError as exc:
            raise DashboardUnavailable(type(exc).__name__) from None
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise DashboardUnavailable(f"http_{r.status_code}")
        return r.json()

    async def post_event(self, payload: dict) -> PostResult:
        try:
            async with self._client() as c:
                r = await c.post(self.base_url + "/detector-events", json=payload)
        except httpx.HTTPError as exc:
            return PostResult(0, type(exc).__name__)
        code = None
        if r.status_code >= 400:
            try:
                code = r.json().get("code")
            except ValueError:
                code = None
        return PostResult(r.status_code, code)
