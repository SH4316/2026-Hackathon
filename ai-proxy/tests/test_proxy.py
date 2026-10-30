import asyncio
import copy
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import socket
import time

import httpx
import pytest

from ai_proxy.content import TextRequest
from ai_proxy.proxy import ProxyApp, ProxyConfig
from fakes import fake_server, proxy, reply, verdict

CHAT = "/v1/chat/completions"
RESPONSES = "/v1/responses"
MESSAGES = "/v1/messages"


def chat(text="합성 입력", **extra):
    return {"model": "synthetic-model", "messages": [{"role": "user", "content": text}], **extra}


@pytest.mark.parametrize("path,body,expected", [
    (CHAT, {"messages": [{"role": "system", "content": "지시"},
                         {"role": "user", "content": [{"type": "text", "text": "질문"},
                          {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}}]}]}, "지시\n질문"),
    (RESPONSES, {"instructions": "지시", "input": [{"role": "user", "content": [
        {"type": "input_text", "text": "질문"}]}]}, "지시\n질문"),
    (RESPONSES, {"input": "문자열 입력"}, "문자열 입력"),
    (MESSAGES, {"system": [{"type": "text", "text": "지시"}], "messages": [
        {"role": "user", "content": [{"type": "text", "text": "질문"},
         {"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": "결과"}]}]}]}, "지시\n질문\n결과"),
])
def test_green_checks_whole_request_and_preserves_body(proxy, path, body, expected):
    with proxy() as (url, guard, upstream):
        response = httpx.post(url + path, json=body)
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert len(guard.requests) == 1
        checked = guard.requests[0]["json"]
        assert checked["text"] == expected
        assert checked["context"] == {"client_type": "ai_proxy", "stage": "submit", "send_action": "normal"}
        assert upstream.requests[0]["json"] == body


@pytest.mark.parametrize("on_warn,status", [("allow", 200), ("block", 403)])
def test_yellow_warns_without_logging_original(proxy, capsys, on_warn, status):
    original = "synthetic-private-prompt"

    def inspector(handler, request):
        reply(handler, verdict("yellow", notices=[original], findings=[{"reason": original}]))

    with proxy(inspector=inspector, on_warn=on_warn) as (url, guard, upstream):
        response = httpx.post(url + CHAT, json=chat(original))
        assert response.status_code == status
        assert len(upstream.requests) == (1 if status == 200 else 0)
    output = capsys.readouterr()
    assert "경고" in output.err
    assert original not in output.out + output.err + response.text


@pytest.mark.parametrize("path,body,expected_text", [
    (CHAT, {"messages": [{"role": "system", "content": "지시"}, {"role": "user", "content": [
        {"type": "text", "text": "합성 비밀"}, {"type": "image_url", "image_url": {"url": "keep"}},
        {"type": "text", "text": "후속 비밀"}]}], "temperature": 0.2}, "지시\n합성 [SECRET_1]\n후속 [SECRET_1]"),
    (RESPONSES, {"instructions": "지시", "input": [{"role": "user", "content": [
        {"type": "input_text", "text": "합성 비밀"}, {"type": "input_text", "text": "후속 비밀"}]}]},
     "지시\n합성 [SECRET_1]\n후속 [SECRET_1]"),
    (MESSAGES, {"system": "지시", "messages": [{"role": "user", "content": [
        {"type": "text", "text": "합성 비밀"}, {"type": "text", "text": "후속 비밀"}]}]},
     "지시\n합성 [SECRET_1]\n후속 [SECRET_1]"),
])
def test_red_sanitizes_in_place_and_rechecks_actual_request(proxy, path, body, expected_text):
    sanitized = TextRequest(copy.deepcopy(body), path).text.replace("비밀", "[SECRET_1]")
    with proxy(initial="red", sanitized=sanitized) as (url, guard, upstream):
        response = httpx.post(url + path, json=body)
        assert response.status_code == 200
        assert [r["path"] for r in guard.requests] == ["/v1/inspect", "/v1/sanitize", "/v1/inspect"]
        forwarded = upstream.requests[0]["json"]
        assert forwarded == json.loads(json.dumps(body, ensure_ascii=False).replace("비밀", "[SECRET_1]"))
        assert TextRequest(forwarded, path).text == expected_text
        assert guard.requests[-1]["json"]["text"] == expected_text
        assert guard.requests[-1]["json"]["input_version"] == 2
        assert len({r["json"]["request_id"] for r in guard.requests}) == 1


def test_red_replacement_spanning_fragments_is_rechecked(proxy):
    body = chat([{"type": "text", "text": "시작 비"}, {"type": "text", "text": "밀 끝"}])
    with proxy(initial="red", sanitized="시작 [SECRET_1] 끝") as (url, guard, upstream):
        assert httpx.post(url + CHAT, json=body).status_code == 200
        forwarded = upstream.requests[0]["json"]
        assert forwarded["messages"][0]["content"] == [
            {"type": "text", "text": "시작 [SECRET_1]"}, {"type": "text", "text": " 끝"}]
        assert guard.requests[-1]["json"]["text"] == "시작 [SECRET_1]\n 끝"


@pytest.mark.parametrize("after", ["red", "gray"])
@pytest.mark.parametrize("path", [CHAT, MESSAGES])
def test_red_unresolved_is_provider_shaped_403(proxy, after, path):
    with proxy(initial="red", rechecked=after) as (url, guard, upstream):
        response = httpx.post(url + path, json=chat("synthetic-secret"))
        assert response.status_code == 403
        assert not upstream.requests
        assert response.json()["error"]["message"]
        if path == MESSAGES:
            assert response.json()["type"] == "error"
            assert response.json()["error"]["type"] == "permission_error"
        else:
            assert response.json()["error"]["code"] == "sanitization_blocked"
        assert "synthetic-secret" not in response.text


@pytest.mark.parametrize("after", ["red", "gray"])
def test_explicit_reinspection_blocks_unsafe_projected_text(proxy, after):
    def inspect(handler, request):
        if request["path"] == "/v1/sanitize":
            reply(handler, verdict("green", sanitized_text="[SECRET_1]"))
        else:
            reply(handler, verdict("red" if request["json"]["input_version"] == 1 else after))

    with proxy(inspector=inspect) as (url, guard, upstream):
        assert httpx.post(url + CHAT, json=chat()).status_code == 403
        assert len(guard.requests) == 3
        assert not upstream.requests


def test_reinspection_yellow_obeys_on_warn(proxy, capsys):
    with proxy(initial="red", rechecked="yellow", on_warn="block") as (url, guard, upstream):
        assert httpx.post(url + CHAT, json=chat()).status_code == 403
        assert len(guard.requests) == 3
        assert not upstream.requests
    assert "경고" in capsys.readouterr().err


@pytest.mark.parametrize("path", [CHAT, MESSAGES])
def test_gray_blocks_with_502(proxy, path):
    with proxy(initial="gray") as (url, guard, upstream):
        assert httpx.post(url + path, json=chat()).status_code == 502
        assert not upstream.requests


@pytest.mark.parametrize("failure", ["http", "json", "shape", "incomplete", "redirect", "timeout"])
def test_inspector_failure_never_falls_back(proxy, failure):
    def inspect(handler, request):
        if failure == "timeout":
            threading.Event().wait(0.15)
            return
        body = {"http": b"synthetic-secret", "json": b"not json", "shape": [],
                "incomplete": verdict("green", status="incomplete"), "redirect": b""}[failure]
        reply(handler, body, status={"http": 500, "redirect": 307}.get(failure, 200),
              headers={"Location": "/v1/sanitize"})

    with proxy(inspector=inspect, inspect_timeout=0.05 if failure == "timeout" else 5) as (url, guard, upstream):
        response = httpx.post(url + CHAT, json=chat())
        assert response.status_code == 502
        assert not upstream.requests
        assert len(guard.requests) == 1
        assert "synthetic-secret" not in response.text


def test_authorization_is_only_sent_to_upstream(proxy, capsys):
    with proxy(initial="red") as (url, guard, upstream):
        response = httpx.post(url + CHAT, json=chat("synthetic-private"), headers={
            "Authorization": "Bearer synthetic-provider-key", "X-API-Key": "synthetic-anthropic-key",
            "anthropic-version": "2023-06-01"})
        assert response.status_code == 200
        assert len(guard.requests) == 3
        for request in guard.requests:
            assert request["headers"]["x-api-key"] == "synthetic-guard-key"
            assert "authorization" not in request["headers"]
            assert "synthetic-provider-key" not in str(request)
            assert "synthetic-anthropic-key" not in str(request)
        headers = upstream.requests[0]["headers"]
        assert headers["authorization"] == "Bearer synthetic-provider-key"
        assert headers["x-api-key"] == "synthetic-anthropic-key"
        assert headers["anthropic-version"] == "2023-06-01"
        assert "synthetic-guard-key" not in str(upstream.requests)
    output = capsys.readouterr()
    for secret in ("synthetic-private", "synthetic-provider-key", "synthetic-anthropic-key", "synthetic-guard-key"):
        assert secret not in output.out + output.err + response.text


def test_sse_first_event_arrives_before_upstream_finishes(proxy):
    received_first = threading.Event()
    observed = []

    def stream(handler, request):
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream")
        handler.send_header("X-Request-ID", "synthetic-request")
        handler.end_headers()
        handler.wfile.write(b'data: {"delta":"first"}\n\n')
        handler.wfile.flush()
        observed.append(received_first.wait(3))
        handler.wfile.write(b"data: [DONE]\n\n")
        handler.wfile.flush()

    with proxy(upstream_handler=stream) as (url, guard, upstream):
        with httpx.stream("POST", url + CHAT, json=chat(stream=True), timeout=5) as response:
            assert response.status_code == 200
            assert response.headers["content-type"] == "text/event-stream"
            assert response.headers["x-request-id"] == "synthetic-request"
            chunks = response.iter_raw()
            assert b"first" in next(chunks)
            received_first.set()
            assert b"[DONE]" in b"".join(chunks)
        assert observed == [True]


@pytest.mark.parametrize("path,method", [("/v1/models", "GET"), ("/arbitrary", "POST"), (CHAT, "PUT")])
def test_unsupported_path_never_contacts_servers(proxy, path, method):
    with proxy() as (url, guard, upstream):
        assert httpx.request(method, url + path, json=chat()).status_code == 404
        assert not guard.requests and not upstream.requests


def test_passthrough_is_explicit_and_keeps_supported_requests_filtered(proxy):
    with proxy(passthrough=True, initial="gray") as (url, guard, upstream):
        assert httpx.get(url + "/v1/models?synthetic=1").status_code == 200
        assert upstream.requests[0]["path"] == "/v1/models?synthetic=1"
        assert not guard.requests
        assert httpx.post(url + CHAT, json=chat()).status_code == 502
        assert len(upstream.requests) == 1


@pytest.mark.parametrize("chunked", [False, True])
def test_body_limit_including_chunked_uploads(proxy, chunked):
    with proxy(max_body_bytes=64) as (url, guard, upstream):
        body = b"x" * 65
        response = httpx.post(url + CHAT, content=iter((body[:30], body[30:])) if chunked else body)
        assert response.status_code == 413
        assert not guard.requests and not upstream.requests


@pytest.mark.parametrize("raw", [b"not json", b"[]", b'{"messages":"wrong"}', b'{"messages":[{"content":["wrong"]}]}',
                                  b'{"messages":[],"x":NaN}',
                                  b'{"messages":[{"content":"synthetic-secret","content":"safe"}]}'])
def test_malformed_request_does_not_reach_upstream(proxy, raw):
    with proxy() as (url, guard, upstream):
        assert httpx.post(url + CHAT, content=raw).status_code == 400
        assert not guard.requests and not upstream.requests


def test_compressed_requests_are_rejected(proxy):
    with proxy() as (url, guard, upstream):
        response = httpx.post(url + CHAT, content=gzip.compress(json.dumps(chat()).encode()),
                              headers={"Content-Encoding": "gzip"})
        assert response.status_code == 415
        assert not guard.requests and not upstream.requests


def test_upstream_compression_and_error_status_are_preserved(proxy):
    compressed = gzip.compress(b'{"error":"synthetic upstream"}')

    def upstream(handler, request):
        reply(handler, compressed, status=429, headers={"Content-Encoding": "gzip", "Retry-After": "2"})

    with proxy(upstream_handler=upstream) as (url, guard, _):
        response = httpx.post(url + CHAT, json=chat())
        assert response.status_code == 429
        assert response.json() == {"error": "synthetic upstream"}
        assert response.headers["retry-after"] == "2"


@pytest.mark.parametrize("host,expected", [("api.openai.com", {"provider": "openai", "channel": "api"}),
    ("api.anthropic.com", {"provider": "anthropic", "channel": "api"}),
    ("api.openai.com.example.org", None), ("127.0.0.1", None)])
def test_destination_is_inferred_from_exact_upstream_host(host, expected):
    assert ProxyConfig(upstream=f"https://{host}").destination == expected


def test_inferred_destination_is_sent_to_inspector():
    seen = []

    async def run():
        app = ProxyApp(ProxyConfig(upstream="https://api.anthropic.com", api_key="synthetic-guard"))

        def inspect(request):
            seen.append(json.loads(request.content))
            return httpx.Response(200, json=verdict())

        await app.guard.aclose()
        app.guard = httpx.AsyncClient(transport=httpx.MockTransport(inspect))
        try:
            await app._check("inspect", "합성 입력", "r1", 1)
        finally:
            await app.guard.aclose()
            await app.upstream.aclose()

    asyncio.run(run())
    assert seen[0]["context"]["destination"] == {"provider": "anthropic", "channel": "api"}


def test_module_cli_uses_fake_server_and_never_prints_original(fake_server):
    guard = fake_server(lambda handler, request: reply(handler, verdict("green")))
    result = subprocess.run([sys.executable, "-m", "ai_proxy", "inspect", "--stdin", "--json", "--server", guard.url],
                            input="합성 원문", capture_output=True, text=True, timeout=5,
                            env={**os.environ, "PG_API_KEY": "synthetic-cli-guard-key"})
    assert result.returncode == 0
    assert json.loads(result.stdout)["signal"] == "green"
    assert "합성 원문" not in result.stdout + result.stderr
    assert guard.requests[0]["json"]["context"]["client_type"] == "ai_proxy"
    assert guard.requests[0]["headers"]["x-api-key"] == "synthetic-cli-guard-key"


def test_console_script_is_installed():
    script = Path(sys.executable).parent / "ai-proxy"
    result = subprocess.run([str(script), "--help"], capture_output=True, text=True, timeout=5)
    assert result.returncode == 0
    assert "serve" in result.stdout and "ai-proxy" in result.stdout


def test_serve_cli_accepts_base_url_requests_and_uses_pg_api_key(fake_server):
    guard = fake_server(lambda handler, request: reply(handler, verdict()))
    upstream = fake_server(lambda handler, request: reply(handler, {"ok": True}))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen([
        sys.executable, "-m", "ai_proxy", "serve", "--listen", f"127.0.0.1:{port}",
        "--upstream", upstream.url, "--server", guard.url], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, "PG_API_KEY": "synthetic-serve-guard"})
    try:
        url = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 5
        with httpx.Client(timeout=0.2, trust_env=False) as client:
            while True:
                assert process.poll() is None
                try:
                    if client.get(url + "/unsupported?private=synthetic-private-query").status_code == 404:
                        break
                except httpx.TransportError:
                    assert time.monotonic() < deadline
                    time.sleep(0.02)
            response = client.post(url + CHAT, json=chat("synthetic-private-body"),
                                   headers={"Authorization": "Bearer synthetic-serve-provider"})
        assert response.status_code == 200
        assert guard.requests[0]["headers"]["x-api-key"] == "synthetic-serve-guard"
        assert upstream.requests[0]["headers"]["authorization"] == "Bearer synthetic-serve-provider"
    finally:
        process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=5)
    output = stdout + stderr
    for secret in (b"synthetic-private-query", b"synthetic-private-body", b"synthetic-serve-guard", b"synthetic-serve-provider"):
        assert secret not in output


def test_upstream_set_cookie_is_not_reused_for_another_client(proxy):
    def upstream(handler, request):
        reply(handler, {"ok": True}, headers={"Set-Cookie": "synthetic-session=first-user; Path=/"})

    with proxy(upstream_handler=upstream) as (url, guard, upstream):
        assert httpx.post(url + CHAT, json=chat()).status_code == 200
        assert httpx.post(url + CHAT, json=chat()).status_code == 200
        assert "cookie" not in upstream.requests[1]["headers"]


def test_upstream_connection_failure_is_502(proxy):
    def close_connection(handler, request):
        handler.close_connection = True

    with proxy(upstream_handler=close_connection) as (url, guard, upstream):
        response = httpx.post(url + CHAT, json=chat())
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "upstream_unavailable"


def test_sanitize_server_failure_is_502_without_forwarding(proxy):
    def inspect(handler, request):
        reply(handler, verdict("red"), status=503 if request["path"] == "/v1/sanitize" else 200)

    with proxy(inspector=inspect) as (url, guard, upstream):
        assert httpx.post(url + CHAT, json=chat()).status_code == 502
        assert len(guard.requests) == 2
        assert not upstream.requests
