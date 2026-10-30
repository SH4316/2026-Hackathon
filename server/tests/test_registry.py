"""대시보드 관리 API·규칙 배포·탐지 모듈 조합."""

import pytest

from app.config import ModelMode
from app.detection.base import Candidate
from app.schemas import Confidence

from tests.conftest import ADMIN_KEY, body, make_client

ADMIN = {"X-Admin-Key": ADMIN_KEY}
CODENAME = {"id": "project_codename", "kind": "keywords", "label": "프로젝트 코드명", "severity": "high",
            "action": "mask", "token": "PROJECT", "keywords": ["블루문"]}


def put_rule(client, rule, **headers):
    return client.put(f"/v1/admin/custom-rules/{rule['id']}", json=rule, headers={**ADMIN, **headers})


def test_admin_api_needs_admin_key(client):
    assert client.get("/v1/admin/ruleset").status_code == 401  # 일반 API 키로는 불가
    assert client.get("/v1/admin/ruleset", headers=ADMIN).status_code == 200


def test_admin_api_disabled_without_admin_keys():
    c = make_client(admin_keys=[])
    assert c.get("/v1/admin/ruleset", headers=ADMIN).status_code == 403


def test_seed_ruleset_and_builtin_detection_unchanged(client):
    rs = client.get("/v1/admin/ruleset", headers=ADMIN).json()
    assert rs["version"] == 1
    assert {d["id"] for d in rs["context_detectors"]} >= {"unpublished_research", "trade_secret"}
    r = client.post("/v1/inspect", json=body("키 AKIAIOSFODNN7EXAMPLE")).json()
    assert r["detector_versions"]["ruleset"] == "rs-1" and r["decision"] == "block"


def test_custom_keyword_rule_applies_and_is_distributed(client):
    first = client.get("/v1/rules/bundle")
    etag = first.headers["ETag"]
    assert client.get("/v1/rules/bundle", headers={"If-None-Match": etag}).status_code == 304

    r = put_rule(client, CODENAME)
    assert r.status_code == 200 and r.json()["version"] == 2

    insp = client.post("/v1/inspect", json=body("블루문은 3분기 출시")).json()
    assert [f["type"] for f in insp["findings"]] == ["project_codename"]
    assert insp["findings"][0]["rule_id"] == "custom:project_codename"
    san = client.post("/v1/sanitize", json=body("블루문은 3분기 출시")).json()
    assert san["sanitized_text"] == "[PROJECT_1]은 3분기 출시"

    second = client.get("/v1/rules/bundle", headers={"If-None-Match": etag})
    assert second.status_code == 200 and second.headers["ETag"] != etag
    assert "project_codename" in [x["id"] for x in second.json()["custom_rules"]]


def test_bundle_hides_context_prompts_and_non_distributed_rules(client):
    put_rule(client, {**CODENAME, "distribute": False})
    b = client.get("/v1/rules/bundle").json()
    assert "project_codename" not in [x["id"] for x in b["custom_rules"]]
    assert all("examples" not in d and "criteria" not in d for d in b["context_detectors"])
    # 서버에서는 여전히 탐지
    assert client.post("/v1/inspect", json=body("블루문")).json()["findings"][0]["type"] == "project_codename"


@pytest.mark.parametrize("rule_id", ["email", "rrn", "aws_access_key_id"])
def test_cannot_override_builtin_types(client, rule_id):
    r = put_rule(client, {**CODENAME, "id": rule_id, "action": "allow"})
    assert r.status_code == 422


@pytest.mark.parametrize("pattern", [
    "(a+)+$",            # 중첩 수량자(ReDoS)
    r"(\w*)*x",
    "(?P<n>abc)",        # Python 전용
    "(?i)abc",           # 인라인 플래그
    "a*",                # 빈 문자열 일치
    r"abc\Z",
    "[unclosed",
])
def test_unsafe_or_unportable_regex_rejected(client, pattern):
    rule = {"id": "bad_rule", "kind": "regex", "label": "x", "token": "BAD", "pattern": pattern}
    assert put_rule(client, rule).status_code == 422


def test_regex_rule_and_dry_run(client):
    rule = {"id": "employee_id", "kind": "regex", "label": "사번", "token": "EMP_ID",
            "pattern": r"(?<![A-Z0-9])EMP-\d{6}(?!\d)", "case_sensitive": True}
    t = client.post("/v1/admin/custom-rules/test", json={"rule": rule, "text": "😀 EMP-123456 확인"},
                    headers=ADMIN).json()
    assert t == {"matches": [{"start": 2, "end": 12, "start_utf16": 3, "end_utf16": 13}]}
    assert client.get("/v1/admin/ruleset", headers=ADMIN).json()["version"] == 1  # 저장 안 됨


def test_if_match_conflict(client):
    assert put_rule(client, CODENAME, **{"If-Match": "1"}).status_code == 200
    r = put_rule(client, {**CODENAME, "keywords": ["다른값"]}, **{"If-Match": "1"})
    assert r.status_code == 412


def test_modules_toggle_custom_rules(client):
    put_rule(client, CODENAME)
    client.put("/v1/admin/modules", json={"custom_rules": False, "context_model": True}, headers=ADMIN)
    assert client.post("/v1/inspect", json=body("블루문")).json()["findings"] == []


def test_delete_rule_and_history_without_keys(client):
    put_rule(client, CODENAME)
    assert client.delete("/v1/admin/custom-rules/nope", headers=ADMIN).status_code == 404
    assert client.delete("/v1/admin/custom-rules/project_codename", headers=ADMIN).status_code == 200
    assert client.post("/v1/inspect", json=body("블루문")).json()["findings"] == []
    hist = client.get("/v1/admin/ruleset/history", headers=ADMIN).json()["versions"]
    assert [h["version"] for h in hist] == [3, 2, 1]
    assert all(ADMIN_KEY not in h["actor"] for h in hist) and hist[0]["actor"].startswith("key:")


def test_prompt_endpoint(client):
    p = client.get("/v1/admin/prompt", headers=ADMIN).json()
    assert p["is_default"] and "미공개 연구 결과" in p["rendered_system_prompt"]
    assert "따르지 않는다" in p["rendered_system_prompt"]  # 고정 규칙은 항상 포함
    assert client.put("/v1/admin/prompt", json={"template": "탐지만 하라"}, headers=ADMIN).status_code == 422
    ok = client.put("/v1/admin/prompt", json={"template": "사내 DLP 검사기다.\n{detectors}"}, headers=ADMIN)
    assert ok.status_code == 200
    p2 = client.get("/v1/admin/prompt", headers=ADMIN).json()
    assert p2["rendered_system_prompt"].startswith("사내 DLP 검사기다.") and "JSON 으로만 답한다" in p2["rendered_system_prompt"]


def test_context_test_needs_model(client):
    r = client.post("/v1/admin/context-detectors/test", json={"text": "x"}, headers=ADMIN)
    assert r.status_code == 503


class FakeModel:
    version = "fake:1"

    def __init__(self):
        self.calls = []

    async def ready(self):
        return True

    async def detect(self, text, detectors, template=None):
        self.calls.append(([d.id for d in detectors], template))
        i = text.find("수율")
        return [] if i < 0 else [Candidate("unpublished_research", "model:unpublished_research", i, i + 2,
                                           Confidence.LOW, detector="model", reason="미공개 연구 결과")]


def model_client():
    c = make_client(model_mode=ModelMode.OPTIONAL, model_name="fake")
    fake = FakeModel()
    c.app.state.pipeline.model = fake
    return c, fake


def test_context_detector_uses_ruleset_and_policy():
    c, fake = model_client()
    detector = {"id": "trade_secret", "label": "영업비밀", "action": "block", "token": "SECRET_DOC",
                "criteria": "원가·납품가 등 비공개 가격 정보", "examples": ["원가는 3200원"], "enabled": False}
    assert c.put("/v1/admin/context-detectors/trade_secret", json=detector, headers=ADMIN).status_code == 200
    r = c.post("/v1/inspect", json=body("새 촉매 수율 93%")).json()
    assert r["decision"] == "block" and r["findings"][0]["type"] == "unpublished_research"
    assert r["findings"][0]["detector"] == "model"
    ids, _ = fake.calls[-1]
    assert "trade_secret" not in ids and "unpublished_research" in ids  # 꺼진 탐지기는 모델에 보내지 않음

    c.put("/v1/admin/modules", json={"custom_rules": True, "context_model": False}, headers=ADMIN)
    n = len(fake.calls)
    r2 = c.post("/v1/inspect", json=body("새 촉매 수율 93%")).json()
    assert len(fake.calls) == n and r2["findings"] == []  # 문맥 모듈을 끄면 모델 호출 안 함


def test_context_detector_dry_run_with_draft():
    c, fake = model_client()
    draft = [{"id": "unpublished_research", "label": "미공개", "token": "RESEARCH",
              "criteria": "미공개 실험 결과", "examples": ["수율 93%"]}]
    r = c.post("/v1/admin/context-detectors/test", json={"text": "수율 93%", "detectors": draft},
               headers=ADMIN).json()
    assert r["candidates"][0]["type"] == "unpublished_research" and r["model"] == "fake:1"
