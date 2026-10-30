"""실제 build_event 출력을 대시보드 고정 예시·Java record와 비교한다(읽기 전용)."""

import asyncio
from dataclasses import replace
import json
from pathlib import Path
import re

import pytest

from app.org.report import build_event
from app.org.rules import compile_org
from app.org.settings import OrgSettings
from tests.conftest import body
from tests.test_org import ADMIN, FakeModel, enroll, org_client

DASHBOARD = Path(__file__).resolve().parents[2] / "dashboard/backend/src"
MODELS = DASHBOARD / "main/java/com/example/securitydashboard/detector/model"


def record_fields(name):
    source = (MODELS / f"{name}.java").read_text(encoding="utf-8")
    assert "@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)" in source
    components = source.split(f"public record {name}(", 1)[1]
    # 각 record 컴포넌트의 줄 끝 이름을 읽는다. 제네릭 타입·annotation 속성은 제외한다.
    names = re.findall(r"\b([a-zA-Z]\w*)\s*(?:,|\)\s*\{\})\s*$", components, re.MULTILINE)
    assert names, f"{name} record 필드를 찾을 수 없습니다."
    return {re.sub(r"[A-Z]", lambda m: "_" + m[0].lower(), n) for n in names}


def assert_known_fields(value, record):
    unknown = value.keys() - record_fields(record)
    assert not unknown, f"{record} unknown fields: {sorted(unknown)}"


def assert_event_contract(event):
    assert_known_fields(event, "CreateDetectorEvent")
    assert "send_action" in record_fields("CreateDetectorEvent"), "대시보드에 send_action이 없습니다."
    result = event["result"]
    assert_known_fields(result, "InspectResponse")
    assert "report_status" not in result
    assert_known_fields(result["destination"], "Destination")
    for finding in result["findings"]:
        assert_known_fields(finding, "Finding")
        assert_known_fields(finding["span"], "Span")
    for file in event["files"]:
        assert_known_fields(file, "FileName")
    for image in event["images"]:
        assert_known_fields(image, "ImageInput")


@pytest.mark.parametrize("report_status", ["recorded", "failed", "skipped"])
def test_build_event_matches_dashboard_producer_fixture_field_by_field(client, report_status):
    fixture = json.loads((DASHBOARD / "test/resources/detector/producer-inspect.json").read_text(encoding="utf-8"))
    pipeline = client.app.state.pipeline
    # 고정 예시의 버전명을 재현한다. 런타임 버전 증가와 wire 계약은 독립적이다.
    pipeline.base_policy = replace(pipeline.base_policy, version=fixture["result"]["policy_version"])
    pipeline.rules.version = fixture["result"]["detector_versions"]["rules"]
    response = client.post("/v1/inspect", json={**body(fixture["text"]),
        "request_id": fixture["result"]["request_id"], "input_version": fixture["result"]["input_version"]}).json()
    response["report_status"] = report_status
    analysis = asyncio.run(pipeline.analyze(fixture["text"]))
    event = build_event(rules=compile_org({"id": "fixture-v1", "tags": []}, set()),
        settings=OrgSettings(version=0, updated_at="2026-10-30T00:00:00Z"), person_id="synthetic-person", text=fixture["text"], response=response,
        merged=analysis.merged, token_of=lambda t: pipeline.policy.for_type(t).token,
        finding_of=lambda c: pipeline.to_finding(fixture["text"], 0, c, pipeline.policy).model_dump(mode="json"))
    assert event["text"] == fixture["text"]
    assert event["result"].keys() == fixture["result"].keys()
    for field, expected in fixture["result"].items():
        # 엔드포인트 미설정 안내는 통합 계약에서 추가됐고 수집 schema는 그대로다.
        if field == "notices":
            expected = [*expected, "model_endpoint_unset"]
        assert event["result"][field] == expected, field
    assert_event_contract(event)


@pytest.mark.parametrize("report_text", ["full", "masked"])
@pytest.mark.parametrize("action", ["normal", "confirmed", "forced"])
def test_actual_managed_report_has_no_unknown_dashboard_fields(report_text, action):
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    dash.config["policyStates"] = [{"id": "blocked", "name": "차단"}]
    c.put("/v1/admin/org/settings", json={"report_text": report_text,
        "tag_map": {"email": "pii-email"}, "policy_state_map": {"block": "blocked"}}, headers=ADMIN)
    request = body("😀 사번 EMP-123456 문의 hong@example.com")
    request["context"].update(stage="submit", send_action=action, files=[{"name": "합성.txt"}])
    assert c.post("/v1/inspect", json=request, headers=tok).json()["report_status"] == "recorded"
    [event] = dash.events
    assert event["send_action"] == action and event["policy_state_id"] == "blocked"
    assert event["tag_map"] == {"email": "pii-email"}
    assert_event_contract(event)


def test_actual_file_report_has_no_unknown_dashboard_fields():
    from tests.test_files_report import image, report_body

    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    assert c.post("/v1/files/report", json=report_body([image()]), headers=tok).json()["recorded"]
    [event] = dash.events
    assert event["files"] and event["images"]
    assert_event_contract(event)
