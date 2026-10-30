from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.audit.events import AuditStore
from app.clients.store import ClientStore
from app.org.settings import OrgSettingsStore
from app.config import Settings
from app.main import create_app
from app.policy.engine import Policy
from app.registry.store import RuleSetStore

ROOT = Path(__file__).resolve().parents[1]
API_KEY = "test-key"


ADMIN_KEY = "admin-key"


def memory_store() -> RuleSetStore:
    policy = Policy.load(ROOT / "policies/default.yaml")
    return RuleSetStore(Path(":memory:"), policy.detectors_seed_path, set(policy.types))


def make_client(dashboard=None, **overrides) -> TestClient:
    opts = {"api_keys": [API_KEY], "admin_keys": [ADMIN_KEY], "policy_path": ROOT / "policies/default.yaml"}
    settings = Settings(**{**opts, **overrides})
    app = create_app(settings, audit=AuditStore(Path(":memory:")), ruleset_store=memory_store(),
                     clients=ClientStore(Path(":memory:")), org_settings=OrgSettingsStore(Path(":memory:")),
                     dashboard=dashboard)
    return TestClient(app, headers={"X-API-Key": API_KEY})


@pytest.fixture
def client() -> TestClient:
    return make_client()


def body(text: str, client_type: str = "cli", version: int = 1) -> dict:
    return {"request_id": "r1", "input_version": version, "text": text,
            "context": {"client_type": client_type}}
