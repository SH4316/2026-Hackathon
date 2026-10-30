"""대시보드(dashboard/, Spring Boot) 연동.

- 활성 설정: GET  /api/v1/classifier-config  (태그·pythonRegex·jevThreshold·jevPrompts)
- 사람 확인: GET  /api/v1/people/{id}
- 판정 기록: POST /api/v1/detector-events   (CONTRACT.md "Detector HTTP ingestion")
- 조직 설정: GET  /api/v1/detector-settings  (대시보드 '검사 서버 연결' 화면에서 편집)
- 연결 코드: POST /api/v1/enrollments/redeem (대시보드 사람 화면에서 발급한 확장 연결 코드 사용 처리)

연결: 대시보드 '검사 서버 연결'에서 발급한 연결 URL(<대시보드 주소>/api/v1/connectors/<id>#<secret>)을 PG_DASHBOARD_CONNECTION 에
넣는다. 주소와 비밀값을 나눠 Authorization: Bearer <secret> 으로 요청한다(비밀값이 경로·로그에 남지 않게).

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


_CONNECTOR_PATH = "/api/v1/connectors/"


@dataclass(frozen=True)
class Connection:
    base_url: str          # 대시보드 주소(컨텍스트 경로 포함, 끝 / 없음)
    connector_id: str | None
    secret: str | None


def parse_connection(value: str) -> Connection:
    """연결 URL 또는 (이전 방식) 대시보드 주소."""
    value = value.strip()
    if _CONNECTOR_PATH not in value:
        return Connection(value.rstrip("/"), None, None)
    head, _, secret = value.partition("#")
    base, _, connector_id = head.partition(_CONNECTOR_PATH)
    if not base.startswith(("http://", "https://")) or not connector_id or "/" in connector_id \
            or not secret.startswith("sk_"):
        raise ValueError("PG_DASHBOARD_CONNECTION 은 대시보드에서 발급한 연결 URL 이어야 합니다")
    return Connection(base.rstrip("/"), connector_id, secret)


@dataclass(frozen=True)
class PostResult:
    status: int
    code: str | None  # 대시보드 오류 코드(VERSION_MISMATCH, PERSON_NOT_REGISTERED …)


class DashboardClient:
    def __init__(self, base_url: str, timeout_s: float = 5.0, refresh_s: float = 30.0,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        """base_url: 연결 URL 또는 대시보드 주소."""
        self.connection = parse_connection(base_url)
        self.base_url = self.connection.base_url + "/api/v1"
        self.remote_settings: dict | None = None
        self.timeout_s = timeout_s
        self.refresh_s = refresh_s
        self._transport = transport  # 테스트용
        self._config: dict | None = None
        self._fetched_at = 0.0
        self._lock = asyncio.Lock()
        self.last_error: str | None = None

    def _client(self) -> httpx.AsyncClient:
        headers = {"Authorization": f"Bearer {self.connection.secret}"} if self.connection.secret else {}
        return httpx.AsyncClient(timeout=self.timeout_s, transport=self._transport, headers=headers)

    @staticmethod
    def _error(r: httpx.Response) -> str:
        try:
            return r.json().get("code") or f"http_{r.status_code}"
        except ValueError:
            return f"http_{r.status_code}"

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
                    if r.status_code == 401:
                        self._config = None  # 연결이 해지됐으면 이전 설정을 계속 쓰지 않는다
                        raise DashboardUnavailable(self._error(r))
                    r.raise_for_status()
                    self._config = r.json()
                    # 조직 설정은 대시보드가 있으면 따른다. 못 받으면 이전 값(또는 서버 설정)을 쓴다.
                    s = await c.get(self.base_url + "/detector-settings")
                    if s.status_code == 200:
                        self.remote_settings = s.json()
                self.last_error = None
            except DashboardUnavailable as exc:
                self.last_error = str(exc)
                self._config = None  # 활성 버전이 해제·연결 해지됐으면 이전 설정을 쓰지 않는다
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

    async def redeem(self, code: str) -> dict | None:
        """대시보드가 발급한 사람별 연결 코드를 사용 처리한다. 유효하면 {personId, name}, 아니면 None."""
        if not self.connection.connector_id:
            return None  # 연결 URL 없이(주소만) 연결된 대시보드는 코드 확인을 할 수 없다
        try:
            async with self._client() as c:
                r = await c.post(self.base_url + "/enrollments/redeem", json={"code": code})
        except httpx.HTTPError as exc:
            raise DashboardUnavailable(type(exc).__name__) from None
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise DashboardUnavailable(self._error(r))
        return r.json()

    async def check(self) -> str | None:
        """연결 URL 확인. 문제가 없으면 None, 있으면 오류 코드."""
        if not self.connection.connector_id:
            return None
        try:
            async with self._client() as c:
                r = await c.get(f"{self.base_url}/connectors/{self.connection.connector_id}")
        except httpx.HTTPError as exc:
            return type(exc).__name__
        return None if r.status_code == 200 else self._error(r)
