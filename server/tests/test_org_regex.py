"""조직 태그 정규식 저장 전 검증과 실제 활성 규칙의 누락 상태. 합성 데이터만 사용."""

import pytest

from tests.conftest import ADMIN_KEY, body, make_client
from tests.test_org import FakeDashboard, config, org_client

ADMIN = {"X-Admin-Key": ADMIN_KEY}
CHECK = "/v1/admin/org/regex/check"
STATUS = "/v1/admin/org/status"


def test_regex_check_reports_each_result_without_dashboard_or_saving(client):
    patterns = [
        ("emp-id", r"(?i)\bEMP-\d{6}\b", None),
        ("named", r"(?P<name>abc)", None),
        ("boundary", "가" * 4000, None),
        ("long", "가" * 4001, "too_long"),
        ("nested", "(a+)+$", "nested_quantifier"),
        ("syntax", "[unclosed", "syntax_error"),
        ("overflow", "a{4294967296}", "syntax_error"),
        ("deep", "(" * 600 + "a" + ")" * 600, "syntax_error"),
        ("empty-match", "a*", "matches_empty"),
        ("empty", "", "matches_empty"),
        ("emp-id", "fixed", None),
    ]
    before = client.get("/v1/admin/org/settings", headers=ADMIN).json()
    response = client.post(CHECK, json={"patterns": [{"tag_id": tag, "pattern": pattern}
                                                    for tag, pattern, _ in patterns]}, headers=ADMIN)
    assert response.status_code == 200
    assert response.json() == {"results": [{"tag_id": tag, "ok": reason is None, "reason": reason}
                                           for tag, _, reason in patterns]}
    assert client.get("/v1/admin/org/settings", headers=ADMIN).json() == before
    assert client.get(STATUS, headers=ADMIN).json() == {"managed": False}


def test_regex_check_works_when_dashboard_is_unavailable():
    dash = FakeDashboard()
    dash.down = True
    c, _ = org_client(dash)
    response = c.post(CHECK, json={"patterns": [{"tag_id": "emp-id", "pattern": r"EMP-\d{6}"}]},
                      headers=ADMIN)
    assert response.status_code == 200
    assert response.json() == {"results": [{"tag_id": "emp-id", "ok": True, "reason": None}]}
    assert c.app.state.org.client.last_error is None  # 검증은 대시보드에 요청하지 않는다.


def test_regex_check_requires_admin_key(client):
    payload = {"patterns": [{"tag_id": "emp-id", "pattern": "EMP"}]}
    assert client.post(CHECK, json=payload).status_code == 401
    assert client.post(CHECK, json=payload, headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert make_client(admin_keys=[]).post(CHECK, json=payload, headers=ADMIN).status_code == 403


@pytest.mark.parametrize("count", [0, 1000, 1001])
def test_regex_check_batch_limit(client, count):
    patterns = [{"tag_id": f"tag-{i}", "pattern": "x"} for i in range(count)]
    response = client.post(CHECK, json={"patterns": patterns}, headers=ADMIN)
    if count > 1000:
        assert response.status_code == 422
    else:
        assert response.status_code == 200
        assert response.json() == {"results": [{"tag_id": p["tag_id"], "ok": True, "reason": None}
                                               for p in patterns]}


@pytest.mark.parametrize("payload", [
    {}, {"patterns": None}, {"patterns": {}}, {"patterns": [None]},
    {"patterns": [{"pattern": "x"}]}, {"patterns": [{"tag_id": "emp-id"}]},
    {"patterns": [{"tag_id": "emp-id", "pattern": None}]},
    {"patterns": [{"tag_id": "emp-id", "pattern": 123}]},
    {"patterns": [{"tag_id": 123, "pattern": "x"}]},
])
def test_regex_check_validates_request_shape(client, payload):
    assert client.post(CHECK, json=payload, headers=ADMIN).status_code == 422


def test_status_loads_active_regex_before_any_inspection():
    dash = FakeDashboard()
    dash.config["tags"] = [
        {"id": "valid", "pythonRegex": "EMP"},
        {"id": "legacy", "pythonRegex": "(a+)+"},  # enabled 생략 시 활성
        {"id": "long", "enabled": True, "pythonRegex": "x" * 4001},
        {"id": "syntax", "enabled": True, "pythonRegex": "["},
        {"id": "overflow", "pythonRegex": "a{4294967296}"},
        {"id": "deep", "pythonRegex": "(" * 600 + "a" + ")" * 600},
        {"id": "empty-match", "enabled": True, "pythonRegex": "a*"},
        {"id": "disabled", "enabled": False, "pythonRegex": "(a+)+"},
        {"id": "blank", "pythonRegex": " \t "},
        {"id": "empty", "pythonRegex": ""},
        {"id": "unset", "pythonRegex": None},
        {"id": "missing"},
    ]
    c, _ = org_client(dash)
    assert c.app.state.org._compiled is None
    response = c.get(STATUS, headers=ADMIN)
    assert response.status_code == 200
    active = response.json()
    assert (active["version_id"], active["revision"], active["regex_tags"]) == ("v1", 1, 1)
    assert active["dashboard_error"] is None
    assert active["skipped_regex"] == {"legacy": "nested_quantifier", "long": "too_long",
                                       "syntax": "syntax_error", "overflow": "syntax_error",
                                       "deep": "syntax_error", "empty-match": "matches_empty"}
    bundle = c.get("/v1/rules/bundle").json()["org_rules"]
    assert [r["tag_id"] for r in bundle["regex"]] == ["valid"]


@pytest.mark.parametrize("change", ["revision", "version"])
def test_status_updates_skipped_regex_when_active_config_changes(change):
    c, dash = org_client()
    assert c.get(STATUS, headers=ADMIN).json()["skipped_regex"] == {"bad": "nested_quantifier"}
    dash.config = config(revision=2 if change == "revision" else 1,
                         version="v2" if change == "version" else "v1")
    dash.config["tags"] = [{"id": "bad", "pythonRegex": "EMP"},
                           {"id": "new-bad", "pythonRegex": "["}]
    active = c.get(STATUS, headers=ADMIN).json()
    assert (active["version_id"], active["revision"]) == (dash.config["id"], dash.config["revision"])
    assert active["skipped_regex"] == {"new-bad": "syntax_error"} and active["regex_tags"] == 1
    dash.config["revision"] += 1
    dash.config["tags"][1]["enabled"] = False
    assert c.get(STATUS, headers=ADMIN).json()["skipped_regex"] == {}


def test_status_drops_previous_regex_when_active_version_is_removed():
    c, dash = org_client()
    assert c.post("/v1/inspect", json=body("EMP-123456")).status_code == 200
    assert c.get(STATUS, headers=ADMIN).json()["skipped_regex"] == {"bad": "nested_quantifier"}
    dash.config = None
    active = c.get(STATUS, headers=ADMIN).json()
    assert active["managed"] and active["dashboard_error"] == "NO_ACTIVE_VERSION"
    assert active["version_id"] is active["revision"] is None
    assert active["skipped_regex"] == {} and active["regex_tags"] == active["jev_prompts"] == 0
    result = c.post("/v1/inspect", json=body("EMP-123456")).json()
    assert "org_config_unavailable" in result["notices"]
    assert not any(f["rule_id"].startswith("org-regex:") for f in result["findings"])
    dash.config = config(version="v2")
    assert c.get(STATUS, headers=ADMIN).json()["skipped_regex"] == {"bad": "nested_quantifier"}


def test_status_retains_executed_cached_rules_during_dashboard_outage():
    c, dash = org_client()
    assert c.get(STATUS, headers=ADMIN).json()["skipped_regex"] == {"bad": "nested_quantifier"}
    dash.down = True
    active = c.get(STATUS, headers=ADMIN).json()
    assert active["dashboard_error"] == "ConnectError"
    assert (active["version_id"], active["revision"], active["regex_tags"]) == ("v1", 1, 2)
    assert active["skipped_regex"] == {"bad": "nested_quantifier"}
    result = c.post("/v1/inspect", json=body("EMP-123456")).json()
    assert any(f["rule_id"] == "org-regex:emp-id" for f in result["findings"])


def test_status_reports_dashboard_outage_without_cached_config():
    dash = FakeDashboard()
    dash.down = True
    c, _ = org_client(dash)
    response = c.get(STATUS, headers=ADMIN)
    assert response.status_code == 200
    active = response.json()
    assert active["dashboard_error"] == "ConnectError"
    assert active["version_id"] is None and active["skipped_regex"] == {} and active["regex_tags"] == 0


def test_status_requires_admin_without_loading_dashboard():
    c, _ = org_client()
    assert c.get(STATUS).status_code == 401
    assert c.app.state.org.client.cached_config is None
