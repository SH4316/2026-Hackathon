import asyncio
import base64
import json

import pytest

from app.api.body_limit import BodyLimitMiddleware
from app.org.report import file_attachments
from app.schemas import FileReportRequest

from tests.conftest import body, make_client
from tests.test_org import ADMIN, FakeDashboard, FakeModel, enroll, org_client


def report_body(images=None):
    return {"request_id": "file-report-1", "input_version": "file:사진.png",
            "destination": {"provider": "openai", "channel": "consumer"}, "send_action": "normal",
            "files": [{"name": "사진.png"}], "images": images or []}


def image(name="사진.png", size=10, media_type="image/png"):
    return {"name": name, "media_type": media_type, "data_base64": base64.b64encode(b"x" * size).decode()}


def test_file_report_requires_personal_token_even_when_auth_is_disabled():
    for disabled in (False, True):
        c = make_client(auth_disabled=disabled)
        assert c.post("/v1/files/report", json=report_body()).status_code == 403
        c.headers.pop("X-API-Key")
        assert c.post("/v1/files/report", json=report_body()).status_code == 403
        assert c.post("/v1/files/report", json=report_body(), headers={"X-API-Key": "unknown"}).status_code == 403


def test_file_report_sends_empty_green_result_and_attachments():
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    req = report_body([image()])
    r = c.post("/v1/files/report", json=req, headers=tok)
    assert r.status_code == 202 and r.json() == {"recorded": True, "reason": None}
    [ev] = dash.events
    assert ev["person_id"] == "person-1" and ev["version_id"] == "v1" and ev["text"] == ""
    assert ev["files"] == req["files"] and ev["images"] == req["images"] and ev["send_action"] == "normal"
    result = ev["result"]
    assert result["request_id"] == req["request_id"] and result["input_version"] == req["input_version"]
    assert (result["status"], result["decision"], result["signal"], result["findings"]) == (
        "complete", "allow", "green", [])
    assert result["destination"]["provider"] == "openai"


def test_file_report_skips_when_off_or_unmanaged_or_unavailable():
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    c.put("/v1/admin/org/settings", json={"report_text": "off"}, headers=ADMIN)
    assert c.post("/v1/files/report", json=report_body(), headers=tok).json() == {
        "recorded": False, "reason": "report_off"}
    assert dash.events == []
    c.put("/v1/admin/org/settings", json={}, headers=ADMIN)
    dash.down = True
    assert c.post("/v1/files/report", json=report_body(), headers=tok).json() == {
        "recorded": False, "reason": "dashboard_unavailable"}
    local = make_client()
    code = local.post("/v1/admin/enrollments", json={"label": "합성 사용자"}, headers=ADMIN).json()["code"]
    token = local.post("/v1/auth/enroll", json={"code": code, "client_type": "ai_proxy"}).json()["token"]
    tok = {"X-API-Key": token}
    r = local.post("/v1/files/report", json=report_body(), headers=tok)
    assert r.status_code == 202 and r.json() == {"recorded": False, "reason": "not_managed"}


def test_file_report_retries_version_mismatch():
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    dash.mismatch_once = True
    assert c.post("/v1/files/report", json=report_body(), headers=tok).json()["recorded"] is True
    assert len(dash.events) == 1


def test_invalid_and_excess_images_keep_their_file_names():
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    imgs = [image(f"{i}.png") for i in range(21)]
    imgs += [image("bad.txt", media_type="text/plain"),
             {**image("bad.png"), "data_base64": "not base64"}]
    assert c.post("/v1/files/report", json=report_body(imgs), headers=tok).json()["recorded"] is True
    [ev] = dash.events
    assert len(ev["images"]) == 20
    assert {f["name"] for f in ev["files"]} == {"사진.png", *(i["name"] for i in imgs)}


def test_image_byte_limits_are_inclusive_and_total_is_bounded():
    imgs = [image("first.png", 5 * 1024 * 1024), image("oversize.png", 5 * 1024 * 1024 + 1),
            image("second.png", 5 * 1024 * 1024), image("over-total.png", 1)]
    files, kept = file_attachments(FileReportRequest.model_validate(report_body(imgs)))
    assert [i["name"] for i in kept] == ["first.png", "second.png"]
    assert {f["name"] for f in files} == {"사진.png", *(i["name"] for i in imgs)}


@pytest.mark.parametrize("img", [
    {"name": "bad.png", "media_type": "image/png", "data_base64": "Zh=="},
    {"name": "bad.png", "media_type": "image/", "data_base64": "eA=="},
    {"name": "bad.png", "media_type": "image/png\n", "data_base64": "eA=="},
])
def test_malformed_images_are_omitted(img):
    files, kept = file_attachments(FileReportRequest.model_validate(report_body([img])))
    assert kept == [] and {"name": "bad.png"} in files


def test_file_report_has_larger_body_limit_than_other_routes():
    c, dash = org_client(model=FakeModel(), max_body_bytes=512, max_report_body_bytes=2048)
    tok, _ = enroll(c)
    assert c.post("/v1/files/report", json=report_body([image(size=800)]), headers=tok).status_code == 202
    for path in ("/v1/inspect", "/v1/sanitize", "/v1/admin/custom-rules/test"):
        assert c.post(path, json=body("x" * 800), headers=tok).status_code == 413
    assert c.post("/v1/files/report", json=report_body([image(size=2000)]), headers=tok).status_code == 413
    assert len(dash.events) == 1


def test_body_without_content_length_cannot_bypass_limit():
    c = make_client(max_body_bytes=256)
    payload = json.dumps(body("x" * 400)).encode()
    r = c.post("/v1/inspect", content=(payload[i:i + 50] for i in range(0, len(payload), 50)),
               headers={"Content-Type": "application/json"})
    assert "content-length" not in r.request.headers and r.status_code == 413


@pytest.mark.parametrize("path,limit", [("/v1/inspect", 8), ("/v1/files/report", 16),
                                         ("/v1/files/report/", 8)])
@pytest.mark.parametrize("extra,code", [(0, 204), (1, 413)])
def test_asgi_counts_every_chunk_even_with_forged_content_length(path, limit, extra, code):
    async def run():
        sent, calls = [], []
        chunks = iter([{"type": "http.request", "body": b"x" * 4, "more_body": True},
                       {"type": "http.request", "body": b"y" * (limit - 4 + extra), "more_body": False}])

        async def receive():
            return next(chunks)

        async def send(message):
            sent.append(message)

        async def app(scope, receive, send):
            message = await receive()
            calls.append(message["body"])
            await send({"type": "http.response.start", "status": 204, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        scope = {"type": "http", "path": path, "headers": [(b"content-length", b"1")]}
        await BodyLimitMiddleware(app, 8, 16)(scope, receive, send)
        assert sent[0]["status"] == code
        assert calls == ([b"xxxx" + b"y" * (limit - 4)] if code == 204 else [])

    asyncio.run(run())
