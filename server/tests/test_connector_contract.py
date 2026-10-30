"""커넥터 인증·대시보드 조직 설정에서도 추가 수집/관리 계약을 유지한다."""

import asyncio

import httpx
import pytest

from app.schemas import InspectRequest
from tests.conftest import body
from tests.test_files_report import image, report_body
from tests.test_org import ADMIN, CONNECTION, FakeDashboard, FakeModel, enroll, org_client


def connected(report_text="full", **overrides):
    dash = FakeDashboard(secret="sk_secretvalue")
    dash.settings = {"reportText": report_text, "tagMap": {}, "tagAction": "mask",
                     "jevEnabled": True, "policyStateMap": {"allow": "passed", "block": "blocked"},
                     "revision": 4, "updatedAt": "2026-10-30T00:00:00Z"}
    dash.config["policyStates"] = [{"id": "passed"}, {"id": "blocked"}]
    c, _ = org_client(dash, model=FakeModel(), url=CONNECTION, **overrides)
    token, _ = enroll(c)
    return c, dash, token


@pytest.mark.parametrize("action", ["normal", "confirmed", "forced"])
def test_connector_waits_for_record_and_preserves_action_and_policy_mapping(action):
    c, dash, token = connected()
    req = body("kim@example.com")
    req["context"].update(stage="submit", send_action=action, files=[{"name": "합성.txt"}])

    async def run():
        started, release = asyncio.Event(), asyncio.Event()

        async def handler(request):
            if request.url.path == "/api/v1/detector-events":
                started.set()
                await release.wait()
            return dash.handler(request)

        c.app.state.org.client._transport = httpx.MockTransport(handler)
        task = asyncio.create_task(c.app.state.pipeline.inspect(
            InspectRequest.model_validate(req), person_id="person-1"))
        try:
            await asyncio.wait_for(started.wait(), 1)
            assert not task.done() and not dash.events
        finally:
            release.set()
            result = await task
        assert result.report_status == "recorded"

    asyncio.run(run())
    event = dash.events[0]
    assert event["source_id"] == "c_abc123" and event["policy_state_id"] == "blocked"
    assert event["send_action"] == action and event["files"] == [{"name": "합성.txt"}]
    assert event["text"] == req["text"] and "report_status" not in event["result"]
    assert set(dash.auth_headers) == {"Bearer sk_secretvalue"}
    dash.secret = "sk_revoked"
    assert c.post("/v1/inspect", json=req, headers=token).json()["report_status"] == "failed"


def test_connector_file_report_honors_dashboard_off_on_first_request_and_after_change():
    c, dash, token = connected("off")
    assert c.app.state.org.client.remote_settings is None
    assert c.post("/v1/files/report", json=report_body([image()]), headers=token).json() == {
        "recorded": False, "reason": "report_off"}
    assert not dash.events
    dash.settings.update(reportText="full", revision=5)
    assert c.post("/v1/files/report", json=report_body([image()]), headers=token).json() == {
        "recorded": True, "reason": None}
    assert dash.events[0]["images"] == [image()]
    assert dash.events[0]["policy_state_id"] == "passed"
    assert dash.events[0]["source_id"] == "c_abc123"
    assert set(dash.auth_headers) == {"Bearer sk_secretvalue"}
    dash.secret = "sk_revoked"
    assert c.post("/v1/files/report", json=report_body(), headers=token).json() == {
        "recorded": False, "reason": "dashboard_unavailable"}


def test_connector_bundle_regex_status_and_unset_runtime_keep_admin_key_contract():
    c, dash, _ = connected(model_base_url="", model_name="")
    bundle = c.get("/v1/rules/bundle")
    assert bundle.status_code == 200
    assert any(rule["tag_id"] == "emp-id" for rule in bundle.json()["org_rules"]["regex"])
    etag = bundle.headers["ETag"]
    dash.config["revision"] += 1
    assert c.get("/v1/rules/bundle", headers={"If-None-Match": etag}).status_code == 200
    status = c.get("/v1/admin/org/status", headers=ADMIN).json()
    assert status["connector_id"] == "c_abc123" and status["settings_source"] == "dashboard"
    assert status["skipped_regex"] == {"bad": "nested_quantifier"}
    settings = c.get("/v1/admin/org/settings", headers=ADMIN).json()
    assert settings["policy_state_map"] == {"allow": "passed", "warn": None, "block": "blocked"}
    assert c.put("/v1/admin/org/settings", json={}, headers=ADMIN).status_code == 409
    assert c.get("/v1/admin/runtime").status_code == 401
    assert c.get("/v1/admin/runtime", headers=ADMIN).json()["model_status"] == "endpoint_unset"
    assert c.get("/readyz").status_code == 200
    assert "model_endpoint_unset" in c.post("/v1/inspect", json=body("합성 문장")).json()["notices"]
    dash.down = True
    result = c.post("/v1/admin/org/regex/check", headers=ADMIN, json={"patterns": [
        {"tag_id": "ok", "pattern": "가" * 4000},
        {"tag_id": "long", "pattern": "가" * 4001}]}).json()
    assert result["results"] == [{"tag_id": "ok", "ok": True, "reason": None},
                                  {"tag_id": "long", "ok": False, "reason": "too_long"}]
