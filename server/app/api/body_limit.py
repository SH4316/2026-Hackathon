"""헤더 유무와 무관하게 경로별 본문 크기를 제한한다."""

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int, max_report_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.max_report_body_bytes = max_report_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = (self.max_report_body_bytes if scope["path"] == "/v1/files/report"
                 else self.max_body_bytes)

        async def reject() -> None:
            await JSONResponse({"detail": "요청 본문이 너무 큽니다"}, status_code=413)(scope, receive, send)

        lengths = [v for k, v in scope["headers"] if k.lower() == b"content-length"]
        if any(v.isdigit() and int(v) > limit for v in lengths):
            await reject()
            return
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                await reject()
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        delivered = False

        async def replay() -> dict:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
