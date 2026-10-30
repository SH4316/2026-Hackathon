"""조직 전송은 대시보드 기록 응답을 기다리며 기록 결과를 클라이언트에 알린다."""

import asyncio

import httpx
import pytest

from app.config import Settings
from app.schemas import InspectRequest
from tests.conftest import body, make_client
from tests.test_org import ADMIN, FakeDashboard, FakeModel, enroll, org_client


def test_inspect_waits_for_dashboard_before_returning():
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)

    async def run():
        started, release = asyncio.Event(), asyncio.Event()

        async def handler(request):
            if request.url.path == "/api/v1/detector-events":
                started.set()
                await release.wait()
            return dash.handler(request)

        c.app.state.org.client._transport = httpx.MockTransport(handler)
        task = asyncio.create_task(c.app.state.pipeline.inspect(
            InspectRequest.model_validate(body("합성 전송")), person_id="person-1"))
        try:
            await asyncio.wait_for(started.wait(), 1)
            assert not task.done() and not dash.events
        finally:
            release.set()
            result = await task
        assert result.report_status == "recorded"

    asyncio.run(run())
    assert len(dash.events) == 1
    assert "report_status" not in dash.events[0]["result"]
    assert c.post("/v1/inspect", json=body("합成 전송"), headers=tok).json()["report_status"] == "recorded"


@pytest.mark.parametrize("stage", [None, "submit", "draft"])
@pytest.mark.parametrize("report_text", ["full", "masked", "off"])
def test_report_status_targets_only_managed_submissions(stage, report_text):
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    c.put("/v1/admin/org/settings", json={"report_text": report_text}, headers=ADMIN)
    req = body("합성 문장")
    if stage is not None:
        req["context"]["stage"] = stage
    result = c.post("/v1/inspect", json=req, headers=tok).json()
    expected = "skipped" if stage == "draft" or report_text == "off" else "recorded"
    assert result["report_status"] == expected
    assert len(dash.events) == (expected == "recorded")
    assert c.post("/v1/inspect", json=req).json()["report_status"] == "skipped"


def test_unmanaged_or_unlinked_client_skips_reporting(client):
    assert client.post("/v1/inspect", json=body("합성 문장")).json()["report_status"] == "skipped"
    code = client.post("/v1/admin/enrollments", json={"label": "합성 개인"}, headers=ADMIN).json()["code"]
    token = client.post("/v1/auth/enroll", json={"code": code, "client_type": "cli"}).json()["token"]
    result = client.post("/v1/inspect", json=body("합성 문장"), headers={"X-API-Key": token}).json()
    assert result["report_status"] == "skipped"


@pytest.mark.parametrize("failure", [400, 503, "timeout", "network"])
@pytest.mark.parametrize("action", ["normal", "confirmed", "forced"])
def test_report_failure_is_returned_without_hiding_inspection(failure, action):
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)

    def handler(request):
        if request.url.path == "/api/v1/detector-events":
            if failure == "timeout":
                raise httpx.ReadTimeout("synthetic timeout")
            if failure == "network":
                raise httpx.ConnectError("synthetic disconnect")
            return httpx.Response(failure, json={"code": "SYNTHETIC_FAILURE"})
        return dash.handler(request)

    c.app.state.org.client._transport = httpx.MockTransport(handler)
    req = body("합성 문장")
    req["context"].update(stage="submit", send_action=action)
    response = c.post("/v1/inspect", json=req, headers=tok)
    result = response.json()
    assert response.status_code == 200
    assert (result["status"], result["decision"], result["signal"]) == ("complete", "allow", "green")
    assert result["report_status"] == "failed" and not dash.events
    assert sum(c.app.state.org.report_failures.values()) == 1


@pytest.mark.parametrize("recover", [True, False])
def test_report_status_waits_for_version_mismatch_retry(recover):
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    attempts = []

    def handler(request):
        if request.url.path == "/api/v1/detector-events":
            attempts.append(request)
            if len(attempts) == 1 or not recover:
                dash.config["id"] = "v2"
                return httpx.Response(409, json={"code": "VERSION_MISMATCH"})
        return dash.handler(request)

    c.app.state.org.client._transport = httpx.MockTransport(handler)
    result = c.post("/v1/inspect", json=body("합성 문장"), headers=tok).json()
    assert result["report_status"] == ("recorded" if recover else "failed")
    assert len(attempts) == 2
    if recover:
        assert dash.events[0]["version_id"] == "v2"
        assert "report_status" not in dash.events[0]["result"]


def test_reporting_uses_dashboard_timeout_env(monkeypatch):
    monkeypatch.setenv("PG_DASHBOARD_TIMEOUT_S", "0.125")
    timeout = Settings.from_env().dashboard_timeout_s
    c = make_client(dashboard_url="http://synthetic-dashboard", dashboard_timeout_s=timeout)
    dash = FakeDashboard()
    seen = []

    def handler(request):
        if request.url.path == "/api/v1/detector-events":
            seen.append(request.extensions["timeout"])
            raise httpx.ReadTimeout("synthetic timeout")
        return dash.handler(request)

    c.app.state.org.client._transport = httpx.MockTransport(handler)
    tok, _ = enroll(c)
    result = c.post("/v1/inspect", json=body("합성 문장"), headers=tok).json()
    assert result["report_status"] == "failed"
    assert seen == [dict.fromkeys(["connect", "read", "write", "pool"], 0.125)]
