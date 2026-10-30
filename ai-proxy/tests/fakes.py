from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import socket
import threading
import time

import pytest
import uvicorn

from ai_proxy.proxy import ProxyApp, ProxyConfig


class FakeServer:
    def __init__(self, responder):
        self.requests = []
        self.responder = responder
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def handle_request(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                try:
                    body = json.loads(raw)
                except ValueError:
                    body = None
                request = {"method": self.command, "path": self.path, "raw": raw,
                           "json": body, "headers": {k.lower(): v for k, v in self.headers.items()}}
                fixture.requests.append(request)
                fixture.responder(self, request)

            do_GET = do_POST = do_PUT = do_DELETE = handle_request

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.thread = threading.Thread(target=lambda: self.httpd.serve_forever(poll_interval=0.02), daemon=True)
        self.thread.start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)


def reply(handler, body, status=200, headers=None):
    raw = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(raw)))
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(raw)
    handler.wfile.flush()


def verdict(signal="green", **extra):
    return {"status": "incomplete" if signal == "gray" else "complete", "signal": signal,
            "decision": {"green": "allow", "yellow": "warn", "red": "block", "gray": "warn"}[signal],
            "findings": [], "remaining_findings": [], "notices": [], "report_status": "skipped", **extra}


@contextmanager
def running_proxy(config):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(ProxyApp(config), access_log=False,
                                          proxy_headers=False, log_level="critical"))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            server.should_exit = True
            thread.join(timeout=3)
            sock.close()
            raise RuntimeError("테스트 프록시를 시작할 수 없습니다.")
        time.sleep(0.01)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        assert not thread.is_alive(), "테스트 프록시가 종료되지 않았습니다."


@pytest.fixture
def fake_server():
    servers = []

    def create(responder):
        server = FakeServer(responder)
        servers.append(server)
        return server

    yield create
    for server in reversed(servers):
        server.close()


@pytest.fixture
def proxy(fake_server):
    @contextmanager
    def create(initial="green", sanitized="[SECRET_1]", rechecked="green",
               inspector=None, upstream_handler=None, **options):
        def inspect(handler, request):
            if request["path"] == "/v1/sanitize":
                reply(handler, verdict(rechecked, sanitized_text=sanitized))
            else:
                reply(handler, verdict(initial if request["json"]["input_version"] == 1 else rechecked))

        guard = fake_server(inspector or inspect)
        upstream = fake_server(upstream_handler or (lambda handler, request: reply(handler, {"ok": True})))
        config = ProxyConfig(server=guard.url, upstream=upstream.url, api_key="synthetic-guard-key", **options)
        with running_proxy(config) as url:
            yield url, guard, upstream

    return create
