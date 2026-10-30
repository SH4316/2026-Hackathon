"""조직 관리 모드: 대시보드 태그 정규식·Jev 판정, 조직 설정, 판정 기록 전송. 합성 데이터만 사용."""

import json

import httpx
import pytest

from app.config import ModelMode
from app.detection.model import ContextModelDetector, JevScore, ModelUnavailable
from app.org.dashboard import DashboardClient
from app.org.rules import compile_org

from tests.conftest import ADMIN_KEY, body, make_client

ADMIN = {"X-Admin-Key": ADMIN_KEY}


def config(revision=1, version="v1"):
    return {
        "id": version, "name": "조직 설정", "status": "PUBLISHED", "isActive": True, "revision": revision,
        "tags": [
            {"id": "emp-id", "name": "사번", "pythonRegex": r"(?i)\bEMP-\d{6}\b", "jevThreshold": None},
            {"id": "research", "name": "미공개 연구", "pythonRegex": "", "jevThreshold": 0.7},
            {"id": "pii-email", "name": "이메일", "pythonRegex": "", "jevThreshold": None},
            {"id": "email", "name": "이메일(내장과 같은 ID)", "pythonRegex": r"\bsales@corp\.example\b"},
            {"id": "bad", "name": "위험 패턴", "pythonRegex": "(a+)+"},
        ],
        "jevPrompts": [{"id": "jp1", "name": "연구 판정", "prompt": "미공개 연구 결과인지 판단하라.",
                        "tagIds": ["research"]}],
        "policyStates": [],
    }


class FakeDashboard:
    def __init__(self):
        self.config = config()
        self.people = {"person-1": {"id": "person-1", "name": "홍길동"}}
        self.events: list[dict] = []
        self.mismatch_once = False
        self.down = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("down")
        path = request.url.path
        if path == "/api/v1/classifier-config":
            return httpx.Response(200, json=self.config) if self.config else httpx.Response(
                404, json={"code": "NO_ACTIVE_VERSION"})
        if path.startswith("/api/v1/people/"):
            p = self.people.get(path.rsplit("/", 1)[1])
            return httpx.Response(200, json=p) if p else httpx.Response(404, json={"code": "PERSON_NOT_FOUND"})
        if path == "/api/v1/detector-events":
            payload = json.loads(request.content)
            if self.mismatch_once:
                self.mismatch_once = False
                return httpx.Response(409, json={"code": "VERSION_MISMATCH"})
            self.events.append(payload)
            return httpx.Response(201, json={"id": len(self.events)})
        return httpx.Response(404)


class FakeModel:
    version = "fake:jev"

    def __init__(self, scores=None, fail=False):
        self.scores = scores or []
        self.fail = fail
        self.calls = 0

    async def judge(self, text, prompt, outputs):
        self.calls += 1
        if self.fail:
            raise ModelUnavailable("down")
        return [s(text) if callable(s) else s for s in self.scores]


def org_client(dash=None, model=None, mode=ModelMode.OPTIONAL, **overrides):
    dash = dash or FakeDashboard()
    c = make_client(dashboard=DashboardClient("http://dash", refresh_s=0, transport=httpx.MockTransport(dash.handler)),
                    **{"model_mode": mode, "model_name": "fake",
                       "model_base_url": "http://model.invalid", **overrides})
    c.app.state.org.model = model
    # 기존 문맥 탐지 모듈(실제 모델 호출)은 끄고 조직 규칙만 본다.
    c.put("/v1/admin/modules", json={"custom_rules": True, "context_model": False}, headers=ADMIN)
    return c, dash


def research_hit(text):
    i = text.find("수율 93%")
    return JevScore("research", 0.9, ((i, i + 6),) if i >= 0 else ())


def enroll(c, person_id="person-1"):
    code = c.post("/v1/admin/enrollments", json={"person_id": person_id}, headers=ADMIN).json()["code"]
    e = c.post("/v1/auth/enroll", json={"code": code, "client_type": "browser_extension"}).json()
    return {"X-API-Key": e["token"]}, e


def test_local_server_has_no_org_rules(client):
    r = client.post("/v1/inspect", json=body("사번 EMP-123456")).json()
    assert r["decision"] == "allow" and "org" not in r["detector_versions"]
    assert client.get("/readyz").json()["org"] == {"managed": False}


def test_dashboard_regex_tag_applies_and_reserved_ids_are_renamed():
    c, _ = org_client(model=FakeModel())
    r = c.post("/v1/inspect", json=body("사번 emp-123456, 문의 sales@corp.example")).json()
    types = {f["type"]: f for f in r["findings"]}
    assert types["emp-id"]["rule_id"] == "org-regex:emp-id" and types["emp-id"]["action"] == "mask"
    assert types["emp-id"]["replacement"] == "[ORG_EMP_ID_n]"
    # 내장 유형(email)과 같은 태그 ID → org_email 로 바꾸고, 겹친 구간은 병합
    assert "email" in types or "org_email" in types
    assert r["decision"] == "block" and r["detector_versions"]["org"] == "v1@1"
    s = c.post("/v1/sanitize", json=body("사번 EMP-123456")).json()
    assert s["sanitized_text"] == "사번 [ORG_EMP_ID_1]" and s["decision"] == "allow"
    status = c.get("/v1/admin/org/status", headers=ADMIN).json()
    assert status["skipped_regex"] == {"bad": "nested_quantifier"} and status["regex_tags"] == 2


def test_jev_threshold_decides():
    c, _ = org_client(model=FakeModel([research_hit]))
    hit = c.post("/v1/inspect", json=body("새 촉매 수율 93% 로 나왔고 논문 전이야")).json()
    [f] = hit["findings"]
    assert f["type"] == "research" and f["detector"] == "model" and hit["decision"] == "block"
    # 임계값 미만
    c2, _ = org_client(model=FakeModel([JevScore("research", 0.5, ((0, 2),))]))
    assert c2.post("/v1/inspect", json=body("새 촉매")).json()["decision"] == "allow"
    # 임계값 미설정 태그는 판정하지 않음
    c3, _ = org_client(model=FakeModel([JevScore("pii-email", 1.0, ((0, 2),))]))
    assert c3.post("/v1/inspect", json=body("새 촉매")).json()["decision"] == "allow"


def test_jev_without_span_is_at_least_warn():
    c, _ = org_client(model=FakeModel([JevScore("research", 0.95, ())]))
    r = c.post("/v1/inspect", json=body("평범한 문장")).json()
    assert r["decision"] == "warn" and "org_jev_unlocated" in r["notices"]


def test_whole_input_classification_applies_policy_and_reports_unicode_scope():
    model = FakeModel([JevScore("research", 0.95, (), whole_input=True)])
    c, dash = org_client(model=model)
    tok, _ = enroll(c)
    text = "실험😀 결과는 미공개"
    c.put("/v1/admin/org/settings", json={"report_text": "full"}, headers=ADMIN)
    r = c.post("/v1/inspect", json=body(text), headers=tok).json()
    [finding] = r["findings"]
    assert r["decision"] == "block" and "org_jev_unlocated" not in r["notices"]
    assert finding["span"] == {"start": 0, "end": len(text), "start_utf16": 0, "end_utf16": len(text) + 1}
    assert "입력 전체 분류" in finding["reason"]
    assert dash.events[0]["result"]["findings"][0]["span"] == finding["span"]
    c.put("/v1/admin/org/settings", json={"report_text": "masked"}, headers=ADMIN)
    c.post("/v1/inspect", json=body(text), headers=tok)
    assert dash.events[-1]["text"] == "[ORG_RESEARCH_1]"
    sanitized = c.post("/v1/sanitize", json=body(text)).json()
    assert sanitized["sanitized_text"] == "[ORG_RESEARCH_1]"


@pytest.mark.parametrize("mode,status", [(ModelMode.OPTIONAL, "incomplete"), (ModelMode.REQUIRED, "error")])
def test_malformed_decider_response_cannot_allow(mode, status):
    model = ContextModelDetector("decider", "http://decider", "Mapika/decider-4b", 10, 1,
                                 transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"answers": {}})))
    c, _ = org_client(model=model, mode=mode)
    result = c.post("/v1/inspect", json=body("평범한 문장")).json()
    assert result["status"] == status and result["decision"] != "allow"
    assert "org_jev_failed" in result["notices"]


@pytest.mark.parametrize("parent_enabled,child_enabled", [(False, True), (True, False)])
def test_dashboard_tag_enabled_is_independent_for_parent_and_child(parent_enabled, child_enabled):
    cfg = {"id": "v-enabled", "tags": [
        {"id": "parent", "name": "부모", "enabled": parent_enabled, "pythonRegex": "부모", "jevThreshold": 0.7},
        {"id": "child", "name": "자식", "parentId": "parent", "enabled": child_enabled,
         "pythonRegex": "자식", "jevThreshold": 0.8},
    ], "jevPrompts": [{"id": "jp", "prompt": "분류 기준", "tagIds": ["parent", "child"]}]}
    rules = compile_org(cfg, set())
    enabled = "parent" if parent_enabled else "child"
    assert set(rules.tag_names) == set(rules.thresholds) == set(rules.type_of) == {enabled}
    assert list(rules.jev[0].outputs) == [enabled]
    assert [c.type for c in rules.detect_regex("부모 자식")] == [enabled]


@pytest.mark.parametrize("disable", ["prompt", "tag"])
def test_disabled_prompt_or_all_output_tags_prevents_model_call(disable):
    dash = FakeDashboard()
    if disable == "prompt":
        dash.config["jevPrompts"][0]["enabled"] = False
    else:
        dash.config["tags"][1]["enabled"] = False
    model = FakeModel(fail=True)
    c, _ = org_client(dash=dash, model=model)
    result = c.post("/v1/inspect", json=body("평범한 문장")).json()
    assert result["decision"] == "allow" and result["status"] == "complete"
    assert model.calls == 0


def test_jev_failure_or_disabled_model_is_never_allow():
    c, _ = org_client(model=FakeModel(fail=True))
    r = c.post("/v1/inspect", json=body("평범한 문장")).json()
    assert (r["status"], r["signal"]) == ("incomplete", "gray") and "org_jev_failed" in r["notices"]
    c2, _ = org_client(model=FakeModel(fail=True), mode=ModelMode.REQUIRED)
    assert c2.post("/v1/inspect", json=body("평범한 문장")).json()["status"] == "error"
    c3, _ = org_client(model=None, mode=ModelMode.DISABLED)
    r3 = c3.post("/v1/inspect", json=body("평범한 문장")).json()
    assert r3["decision"] != "allow" and "org_jev_model_disabled" in r3["notices"]
    # 조직 설정으로 Jev 를 끄면 정규식만 적용
    c3.put("/v1/admin/org/settings", json={"jev_enabled": False}, headers=ADMIN)
    assert c3.post("/v1/inspect", json=body("평범한 문장")).json()["decision"] == "allow"


def test_dashboard_unavailable_holds():
    dash = FakeDashboard()
    dash.down = True
    c, _ = org_client(dash, model=FakeModel())
    r = c.post("/v1/inspect", json=body("평범한 문장")).json()
    assert r["signal"] == "gray" and r["decision"] != "allow" and "org_config_unavailable" in r["notices"]
    dash.config = None
    dash.down = False
    assert "org_config_unavailable" in c.post("/v1/inspect", json=body("x")).json()["notices"]


def test_enrollment_with_dashboard_person():
    c, _ = org_client(model=FakeModel())
    assert c.post("/v1/admin/enrollments", json={"person_id": "nobody"}, headers=ADMIN).status_code == 422
    assert c.post("/v1/admin/enrollments", json={}, headers=ADMIN).status_code == 422
    tok, e = enroll(c)
    assert e["label"] == "홍길동" and e["person_id"] == "person-1" and e["managed"] is True
    me = c.get("/v1/auth/me", headers=tok).json()
    assert me["managed"] and me["reporting"] and me["report_text"] == "full"


def test_report_masked_option_and_only_on_submit():
    c, dash = org_client(model=FakeModel([research_hit]))
    c.put("/v1/admin/org/settings", json={"report_text": "masked"}, headers=ADMIN)
    tok, _ = enroll(c)
    text = "kim@example.com 사번 EMP-123456 수율 93% 공유"
    draft = body(text)
    draft["context"]["stage"] = "draft"
    c.post("/v1/inspect", json=draft, headers=tok)
    assert dash.events == []  # 입력 중 검사는 기록하지 않음
    c.post("/v1/inspect", json=body(text), headers=tok)
    c.post("/v1/inspect", json=body(text))  # 정적 키(사람 없음)는 기록하지 않음
    [ev] = dash.events
    assert ev["person_id"] == "person-1" and ev["version_id"] == "v1" and ev["source_id"] == "prompt-guard"
    assert "kim@" not in ev["text"] and "EMP-123456" not in ev["text"] and "93%" not in ev["text"]
    assert ev["text"] == "[EMAIL_1] 사번 [ORG_EMP_ID_1] [ORG_RESEARCH_1] 공유"
    for f in ev["result"]["findings"]:
        s = f["span"]
        assert ev["text"][s["start"]:s["end"]].startswith("[")
    assert {f["type"] for f in ev["result"]["findings"]} == {"email", "emp-id", "research"}


def test_report_full_and_tag_map_and_off():
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    c.put("/v1/admin/org/settings", json={"report_text": "full", "tag_map": {"email": "pii-email",
                                                                              "phone": "no-such-tag"}},
          headers=ADMIN)
    text = "A😀 hong@example.com 와 sales@corp.example"
    c.post("/v1/inspect", json=body(text), headers=tok)
    [ev] = dash.events
    assert ev["text"] == text
    assert ev["tag_map"]["email"] == "pii-email" and "phone" not in ev["tag_map"]
    if any(f["type"] == "org_email" for f in ev["result"]["findings"]):
        assert ev["tag_map"]["org_email"] == "email"
    f = next(f for f in ev["result"]["findings"] if f["type"] == "email")
    assert (f["span"]["start"], f["span"]["start_utf16"]) == (3, 4)
    c.put("/v1/admin/org/settings", json={"report_text": "off"}, headers=ADMIN)
    c.post("/v1/inspect", json=body(text), headers=tok)
    assert len(dash.events) == 1
    assert c.get("/v1/auth/me", headers=tok).json()["reporting"] is False


def test_report_retries_after_version_change():
    c, dash = org_client(model=FakeModel())
    tok, _ = enroll(c)
    dash.mismatch_once = True
    dash.config = config(revision=2, version="v2")
    c.post("/v1/inspect", json=body("사번 EMP-123456"), headers=tok)
    [ev] = dash.events
    assert ev["version_id"] == "v2"
    assert c.get("/v1/admin/org/status", headers=ADMIN).json()["reported"] == 1


def test_org_settings_admin_only_and_validated():
    c, _ = org_client(model=FakeModel())
    assert c.get("/v1/admin/org/settings").status_code == 401
    assert c.put("/v1/admin/org/settings", json={"report_text": "everything"}, headers=ADMIN).status_code == 422
    assert c.put("/v1/admin/org/settings", json={"tag_map": {"email": "bad id!"}}, headers=ADMIN).status_code == 422
    s = c.put("/v1/admin/org/settings", json={"tag_action": "block"}, headers=ADMIN).json()
    assert s["version"] == 1 and s["tag_action"] == "block"
    r = c.post("/v1/inspect", json=body("사번 EMP-123456")).json()
    assert r["findings"][0]["action"] == "block" and r["findings"][0]["replacement"] is None


@pytest.mark.parametrize("stage", ["draft", "submit", None])
def test_stage_is_accepted(client, stage):
    b = body("x")
    if stage:
        b["context"]["stage"] = stage
    assert client.post("/v1/inspect", json=b).status_code == 200


@pytest.mark.parametrize("action", [None, "normal", "confirmed", "forced"])
def test_full_report_default_includes_send_action_files_and_valid_policy_state(action):
    dash = FakeDashboard()
    dash.config["policyStates"] = [{"id": "blocked", "name": "차단"}]
    c, _ = org_client(dash, model=FakeModel())
    tok, _ = enroll(c)
    settings = c.get("/v1/admin/org/settings", headers=ADMIN).json()
    assert settings["report_text"] == "full"
    assert settings["policy_state_map"] == {"allow": None, "warn": None, "block": None}
    c.put("/v1/admin/org/settings", json={"policy_state_map": {"block": "blocked", "allow": "missing"}},
          headers=ADMIN)
    req = body("kim@example.com", "ai_proxy")
    req["context"].update({"send_action": action, "files": [{"name": "보고서.docx"}]})
    c.post("/v1/inspect", json=req, headers=tok)
    ev = dash.events[-1]
    assert ev["text"] == req["text"] and ev["send_action"] == action
    assert ev["files"] == [{"name": "보고서.docx"}] and ev["policy_state_id"] == "blocked"
    c.post("/v1/inspect", json=body("평범한 문장"), headers=tok)
    assert "policy_state_id" not in dash.events[-1]  # 활성 버전에 없는 ID는 보내지 않는다.
    assert dash.events[-1]["result"]["decision"] == "allow"  # 통과도 조직 전송 기록에 남긴다.


def test_policy_state_map_revalidated_after_version_mismatch():
    dash = FakeDashboard()
    dash.config["policyStates"] = [{"id": "old-state", "name": "이전 상태"}]
    c, _ = org_client(dash, model=FakeModel())
    tok, _ = enroll(c)
    c.put("/v1/admin/org/settings", json={"policy_state_map": {"allow": "old-state"}}, headers=ADMIN)
    c.post("/v1/inspect", json=body("평범한 문장"), headers=tok)
    assert dash.events[-1]["policy_state_id"] == "old-state"
    dash.config = config(version="v2")
    dash.mismatch_once = True
    c.post("/v1/inspect", json=body("평범한 문장"), headers=tok)
    assert dash.events[-1]["version_id"] == "v2" and "policy_state_id" not in dash.events[-1]


@pytest.mark.parametrize("patch", [{"send_action": "invalid"}, {"files": [{"name": "x"}] * 101}])
@pytest.mark.parametrize("endpoint", ["inspect", "sanitize"])
def test_extended_context_is_validated(client, patch, endpoint):
    req = body("x", "ai_proxy")
    req["context"].update(patch)
    assert client.post(f"/v1/{endpoint}", json=req).status_code == 422


def test_bundle_includes_org_regex_and_destination_information_and_etag_updates():
    c, dash = org_client(model=FakeModel())
    first = c.get("/v1/rules/bundle")
    data, etag = first.json(), first.headers["ETag"]
    org = data["org_rules"]
    assert (org["version_id"], org["revision"], org["tag_action"]) == ("v1", 1, "mask")
    assert next(r for r in org["regex"] if r["tag_id"] == "emp-id") == {
        "tag_id": "emp-id", "type": "emp-id", "name": "사번", "token": "ORG_EMP_ID",
        "pattern": r"(?i)\bEMP-\d{6}\b"}
    assert next(r for r in org["regex"] if r["tag_id"] == "email")["type"] == "org_email"
    assert all(r["tag_id"] != "bad" for r in org["regex"])
    dest = data["destinations"]["openai"]["consumer"]
    assert dest["tier"] == "elevated" and dest["basis"] and dest["verified_at"] == "2026-10-31"
    assert c.get("/v1/rules/bundle", headers={"If-None-Match": etag}).status_code == 304
    for key, value in [("revision", 2), ("id", "v2")]:
        dash.config[key] = value
        changed = c.get("/v1/rules/bundle", headers={"If-None-Match": etag})
        assert changed.status_code == 200 and changed.headers["ETag"] != etag
        etag = changed.headers["ETag"]
    c.put("/v1/admin/org/settings", json={"tag_action": "warn"}, headers=ADMIN)
    changed = c.get("/v1/rules/bundle", headers={"If-None-Match": etag})
    assert changed.status_code == 200 and changed.json()["org_rules"]["tag_action"] == "warn"
    dash.down = True
    assert c.get("/v1/rules/bundle").json()["org_rules"] is None


def test_unmanaged_bundle_has_null_org_rules(client):
    assert client.get("/v1/rules/bundle").json()["org_rules"] is None
