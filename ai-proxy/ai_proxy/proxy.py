"""검사 실패 시 전송하지 않는 ASGI 역방향 프록시."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import sys
import uuid
from urllib.parse import urlsplit

import httpx

from ai_proxy.content import InvalidContent, TextRequest

SUPPORTED = frozenset(("/v1/chat/completions", "/v1/responses", "/v1/messages"))
HOP_HEADERS = frozenset((
    b"connection", b"keep-alive", b"proxy-authenticate", b"proxy-authorization",
    b"te", b"trailer", b"transfer-encoding", b"upgrade",
))


@dataclass(frozen=True)
class ProxyConfig:
    upstream: str = "https://api.openai.com"
    server: str = "http://127.0.0.1:8000"
    api_key: str | None = None
    on_warn: str = "allow"
    passthrough: bool = False
    max_body_bytes: int = 1024 * 1024
    inspect_timeout: float = 30
    upstream_timeout: float = 300

    def __post_init__(self) -> None:
        for value in (self.upstream, self.server):
            url = urlsplit(value)
            if (url.scheme not in ("http", "https") or not url.hostname
                    or url.username is not None or url.password is not None
                    or url.query or url.fragment):
                raise ValueError("서버 주소는 인증정보 없는 HTTP(S) URL 이어야 합니다.")
            if not 0 < (url.port or 443) <= 65535:
                raise ValueError("서버 포트가 올바르지 않습니다.")
        if urlsplit(self.upstream).path not in ("", "/"):
            raise ValueError("--upstream 은 경로 없는 제공사 원점 URL 이어야 합니다.")
        if (self.on_warn not in ("allow", "block") or self.max_body_bytes <= 0
                or not 0 < self.inspect_timeout < float("inf")
                or not 0 < self.upstream_timeout < float("inf")):
            raise ValueError("본문 상한·시간 제한은 양수이고 경고 정책은 allow 또는 block 이어야 합니다.")

    @property
    def destination(self) -> dict | None:
        provider = {"api.openai.com": "openai", "api.anthropic.com": "anthropic"}.get(
            urlsplit(self.upstream).hostname)
        return {"provider": provider, "channel": "api"} if provider else None


class ProxyError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status, self.code, self.message = status, code, message


def _headers(headers: list[tuple[bytes, bytes]], *, response: bool = False) -> list:
    connection = set()
    for key, value in headers:
        if key.lower() == b"connection":
            connection.update(item.strip().lower() for item in value.split(b","))
    excluded = HOP_HEADERS | connection | {b"host", b"content-length"}
    if response:
        excluded |= {b"authorization", b"x-api-key"}
    return [(key.lower(), value) for key, value in headers if key.lower() not in excluded]


def _json(raw: bytes):
    def invalid_constant(value):
        raise ValueError()

    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError()
            result[key] = value
        return result

    return json.loads(raw, parse_constant=invalid_constant, object_pairs_hook=unique_keys)


class ProxyApp:
    def __init__(self, config: ProxyConfig) -> None:
        self.config = config
        # 제공사 자격증명과 검사 서버 인증을 다른 클라이언트에 격리한다.
        self.guard = httpx.AsyncClient(timeout=config.inspect_timeout, trust_env=False)
        self.upstream = httpx.AsyncClient(timeout=config.upstream_timeout, trust_env=False)

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "lifespan":
            while True:
                event = await receive()
                if event["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif event["type"] == "lifespan.shutdown":
                    await self.guard.aclose()
                    await self.upstream.aclose()
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        elif scope["type"] == "http":
            try:
                await self._request(scope, receive, send)
            except ProxyError as exc:
                await self._error(scope["path"], exc, send)

    async def _error(self, path: str, exc: ProxyError, send) -> None:
        kind = {403: "permission_error", 404: "not_found_error",
                413: "request_too_large", 502: "api_error"}.get(exc.status, "invalid_request_error")
        if path == "/v1/messages":
            body = {"type": "error", "error": {"type": kind, "message": exc.message}}
        else:
            body = {"error": {"message": exc.message, "type": (
                "api_error" if exc.status == 502 else "invalid_request_error"),
                "param": None, "code": exc.code}}
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        await send({"type": "http.response.start", "status": exc.status,
                    "headers": [(b"content-type", b"application/json; charset=utf-8"),
                                (b"content-length", str(len(raw)).encode())]})
        await send({"type": "http.response.body", "body": raw})

    async def _body(self, scope, receive) -> bytes:
        headers = dict(scope["headers"])
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            raise ProxyError(400, "invalid_body", "본문 길이가 올바르지 않습니다.") from None
        if length < 0:
            raise ProxyError(400, "invalid_body", "본문 길이가 올바르지 않습니다.")
        if length > self.config.max_body_bytes:
            raise ProxyError(413, "body_too_large", "요청 본문 상한을 초과했습니다.")
        chunks, size = [], 0
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                raise ProxyError(400, "client_disconnected", "클라이언트 연결이 종료되었습니다.")
            chunk = event.get("body", b"")
            size += len(chunk)
            if size > self.config.max_body_bytes:
                raise ProxyError(413, "body_too_large", "요청 본문 상한을 초과했습니다.")
            chunks.append(chunk)
            if not event.get("more_body", False):
                return b"".join(chunks)

    async def _check(self, endpoint: str, text: str, request_id: str, version: int) -> dict:
        context = {"client_type": "ai_proxy", "stage": "submit", "send_action": "normal"}
        if self.config.destination:
            context["destination"] = self.config.destination
        headers = {"X-API-Key": self.config.api_key} if self.config.api_key else {}
        try:
            # 응답도 상한을 둔다. 서버 오류 본문·reason·notices 는 출력하지 않는다.
            async with self.guard.stream("POST", f"{self.config.server.rstrip('/')}/v1/{endpoint}",
                                         headers=headers, json={"request_id": request_id,
                                         "input_version": version, "text": text, "context": context}) as resp:
                resp.raise_for_status()
                chunks, size = [], 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > max(self.config.max_body_bytes * 8, 1024 * 1024):
                        raise ValueError()
                    chunks.append(chunk)
                result = _json(b"".join(chunks))
                if not isinstance(result, dict):
                    raise ValueError()
                # 기록 결과가 없으면 기록됐다고 볼 수 없다. sanitize 응답에는 이 필드가 없다.
                status = result.get("report_status")
                if status == "failed" or (endpoint == "inspect" and status not in ("recorded", "skipped")):
                    raise ProxyError(502, "report_failed", "대시보드 기록에 실패해 전송을 차단했습니다.")
                return result
        except (httpx.HTTPError, ValueError, RecursionError):
            raise ProxyError(502, "inspection_unavailable", "검사 서버 응답을 확인할 수 없어 전송을 차단했습니다.") from None

    @staticmethod
    def _signal(result: dict) -> str:
        signal = result.get("signal")
        if signal == "gray":
            return "gray"
        if result.get("status") != "complete" or signal not in ("green", "yellow", "red"):
            return "gray"
        return signal

    def _warn(self) -> None:
        print("[ai-proxy] 경고: 요청에 확인이 필요한 내용이 있습니다.", file=sys.stderr)
        if self.config.on_warn == "block":
            raise ProxyError(403, "warning_blocked", "경고 정책에 따라 전송을 차단했습니다.")

    async def _filter(self, raw: bytes, path: str) -> bytes:
        try:
            body = _json(raw)
            if not isinstance(body, dict):
                raise InvalidContent()
            request = TextRequest(body, path)
        except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
            raise ProxyError(400, "invalid_body", "지원하는 JSON 메시지 형식이 아닙니다.") from None
        request_id = str(uuid.uuid4())
        result = await self._check("inspect", request.text, request_id, 1)
        signal = self._signal(result)
        if signal == "gray":
            raise ProxyError(502, "inspection_incomplete", "검사가 완료되지 않아 전송을 차단했습니다.")
        if signal == "yellow":
            self._warn()
        if signal != "red":
            return raw
        sanitized = await self._check("sanitize", request.text, request_id, 1)
        if self._signal(sanitized) in ("red", "gray") or not isinstance(sanitized.get("sanitized_text"), str):
            raise ProxyError(403, "sanitization_blocked", "안전하게 치환할 수 없어 전송을 차단했습니다.")
        try:
            request.replace(sanitized["sanitized_text"], result.get("findings", []), sanitized.get("changes", []))
        except InvalidContent:
            raise ProxyError(403, "sanitization_blocked", "치환 결과를 메시지에 적용할 수 없습니다.") from None
        # 경계를 가로지르는 치환도 있으므로 실제 전달할 필드를 다시 합쳐 검사한다.
        checked = await self._check("inspect", request.text, request_id, 2)
        if self._signal(checked) in ("red", "gray"):
            raise ProxyError(403, "sanitization_blocked", "치환 후에도 위험하거나 검사가 미완료여서 차단했습니다.")
        if self._signal(checked) == "yellow":
            self._warn()
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        if len(encoded) > self.config.max_body_bytes:
            raise ProxyError(413, "body_too_large", "치환한 요청이 본문 상한을 초과했습니다.")
        return encoded

    async def _request(self, scope, receive, send) -> None:
        supported = scope["method"] == "POST" and scope["path"] in SUPPORTED
        if not supported and not self.config.passthrough:
            raise ProxyError(404, "unsupported_path", "지원하지 않는 API 경로입니다.")
        raw = await self._body(scope, receive)
        if supported:
            if dict(scope["headers"]).get(b"content-encoding", b"identity").lower() != b"identity":
                raise ProxyError(415, "unsupported_encoding", "압축한 요청 본문은 지원하지 않습니다.")
            raw = await self._filter(raw, scope["path"])
        # 문자열 결합으로 고정 원점을 유지한다. 클라이언트 경로로 호스트를 바꾸지 않는다.
        path = scope.get("raw_path", scope["path"].encode()).decode("ascii")
        query = scope.get("query_string", b"").decode("ascii")
        target = f"{self.config.upstream.rstrip('/')}{path}" + (f"?{query}" if query else "")
        headers = _headers(scope["headers"])
        try:
            # 공유 연결 풀의 쿠키 저장소를 합치지 않는다. 각 도구의 요청만 전달한다.
            req = httpx.Request(scope["method"], target, headers=headers, content=raw)
            response = await self.upstream.send(req, stream=True, follow_redirects=False)
        except httpx.HTTPError:
            raise ProxyError(502, "upstream_unavailable", "업스트림에 연결할 수 없습니다.") from None
        try:
            await send({"type": "http.response.start", "status": response.status_code,
                        "headers": _headers(response.headers.raw, response=True)})

            async def relay():
                try:
                    async for chunk in response.aiter_raw():
                        await send({"type": "http.response.body", "body": chunk, "more_body": True})
                except httpx.HTTPError:
                    # 이미 헤더를 보낸 SSE 는 JSON 오류로 바꿀 수 없다. 연결을 끝낸다.
                    print("[ai-proxy] 업스트림 응답 연결이 중단되었습니다.", file=sys.stderr)
                await send({"type": "http.response.body", "body": b""})

            async def disconnected():
                while (await receive())["type"] != "http.disconnect":
                    pass

            tasks = [asyncio.create_task(relay()), asyncio.create_task(disconnected())]
            try:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            await response.aclose()
