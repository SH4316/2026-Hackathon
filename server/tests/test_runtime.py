from dataclasses import FrozenInstanceError, replace

import pytest

from app.config import ModelMode, Settings
from app.org.settings import OrgSettingsStore

from tests.conftest import ADMIN_KEY, body, make_client
from tests.test_org import FakeModel as OrgModel, org_client
from tests.test_registry import FakeModel

ADMIN = {"X-Admin-Key": ADMIN_KEY}


def test_runtime_requires_admin_and_validates_mode(client):
    assert client.get("/v1/admin/runtime").status_code == 401
    assert client.put("/v1/admin/runtime", json={"model_mode": "required"}).status_code == 401
    assert client.put("/v1/admin/runtime", json={"model_mode": "unknown"}, headers=ADMIN).status_code == 422


def test_runtime_changes_pipeline_without_mutating_frozen_settings():
    c = make_client(model_name="fake", model_base_url="http://model.invalid")
    p = c.app.state.pipeline
    fake = FakeModel()
    p.model = fake
    assert c.get("/v1/admin/runtime", headers=ADMIN).json()["model_status"] == "disabled"
    assert c.post("/v1/inspect", json=body("새 촉매 수율")).json()["decision"] == "allow"
    r = c.put("/v1/admin/runtime", json={"model_mode": "optional"}, headers=ADMIN).json()
    assert r["model_status"] == "active" and r["model_ready"] is True and r["model_endpoint_set"] is True
    assert r["modules"] == {"custom_rules": True, "context_model": True}
    assert r["policy_version"] and r["ruleset_version"] == 1 and r["org"] == {"managed": False}
    assert c.post("/v1/inspect", json=body("새 촉매 수율")).json()["decision"] == "block"
    assert p.settings.model_mode is ModelMode.DISABLED
    with pytest.raises(FrozenInstanceError):
        p.settings.model_mode = ModelMode.REQUIRED
    c.put("/v1/admin/runtime", json={"model_mode": "disabled"}, headers=ADMIN)
    n = len(fake.calls)
    assert c.post("/v1/inspect", json=body("새 촉매 수율")).json()["decision"] == "allow"
    assert len(fake.calls) == n


def test_runtime_model_is_constructed_even_when_initially_disabled():
    c = make_client(model_name="fake", model_base_url="http://model.invalid")
    assert c.app.state.pipeline.model is not None
    assert c.app.state.org.model is c.app.state.pipeline.model


def test_saved_mode_survives_restart_and_overrides_env(tmp_path):
    path = tmp_path / "org.sqlite3"
    c = make_client(org_settings=OrgSettingsStore(path), model_mode=ModelMode.OPTIONAL)
    assert c.get("/v1/admin/runtime", headers=ADMIN).json()["model_mode"] == "optional"
    saved = c.put("/v1/admin/runtime", json={"model_mode": "required"}, headers=ADMIN)
    assert saved.status_code == 200
    restarted = make_client(org_settings=OrgSettingsStore(path), model_mode=ModelMode.DISABLED)
    assert restarted.get("/v1/admin/runtime", headers=ADMIN).json()["model_mode"] == "required"
    assert restarted.app.state.settings.model_mode is ModelMode.DISABLED


@pytest.mark.parametrize("mode", list(ModelMode))
@pytest.mark.parametrize("url,name", [("", ""), ("http://model.invalid", ""), ("", "fake"), (" ", "fake")])
def test_endpoint_unset_disables_calls_without_gray_or_unready(mode, url, name, caplog):
    c, _ = org_client(model=OrgModel(fail=True), mode=mode, model_base_url=url, model_name=name)
    fake = FakeModel()
    p = c.app.state.pipeline
    p.model = fake
    p.base_policy = replace(p.base_policy, model_required=True)
    p._compiled = None
    for endpoint in ("inspect", "sanitize"):
        r = c.post(f"/v1/{endpoint}", json=body("평범한 문장")).json()
        assert (r["status"], r["decision"], r["signal"]) == ("complete", "allow", "green")
        assert r["notices"].count("model_endpoint_unset") == 1
        assert "org_jev_model_disabled" not in r["notices"] and "model" not in r["detector_versions"]
    assert fake.calls == [] and c.app.state.org.model.calls == 0
    ready = c.get("/readyz")
    assert ready.status_code == 200 and ready.json()["model_status"] == "endpoint_unset"
    state = c.get("/v1/admin/runtime", headers=ADMIN).json()
    assert state["model_endpoint_set"] is False and state["model_status"] == "endpoint_unset"
    assert state["model_mode"] == mode.value
    assert sum("모델 엔드포인트가 설정되지 않아" in r.message for r in caplog.records) == 1


@pytest.mark.parametrize("mode,code", [(ModelMode.OPTIONAL, 200), (ModelMode.REQUIRED, 503)])
def test_configured_but_unavailable_model_still_fails_readiness_when_required(mode, code):
    c = make_client(model_mode=mode, model_name="fake", model_base_url="http://127.0.0.1:9")
    state = c.get("/v1/admin/runtime", headers=ADMIN).json()
    assert state["model_status"] == "unavailable" and state["model_ready"] is False
    assert c.get("/readyz").status_code == code


def test_runtime_model_mode_controls_org_jev():
    model = OrgModel()
    c, _ = org_client(model=model)
    c.post("/v1/inspect", json=body("평범한 문장"))
    assert model.calls == 1
    c.put("/v1/admin/runtime", json={"model_mode": "disabled"}, headers=ADMIN)
    r = c.post("/v1/inspect", json=body("평범한 문장")).json()
    assert "org_jev_model_disabled" in r["notices"] and model.calls == 1


def test_model_base_url_default_is_empty(monkeypatch):
    monkeypatch.delenv("PG_MODEL_BASE_URL", raising=False)
    assert Settings().model_base_url == Settings.from_env().model_base_url == ""
