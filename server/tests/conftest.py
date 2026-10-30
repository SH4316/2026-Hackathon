from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.audit.events import AuditStore
from app.config import Settings
from app.main import create_app

ROOT = Path(__file__).resolve().parents[1]
API_KEY = "test-key"


def make_client(**overrides) -> TestClient:
    settings = Settings(api_keys=[API_KEY], policy_path=ROOT / "policies/default.yaml", **overrides)
    app = create_app(settings, audit=AuditStore(Path(":memory:")))
    return TestClient(app, headers={"X-API-Key": API_KEY})


@pytest.fixture
def client() -> TestClient:
    return make_client()


def body(text: str, client_type: str = "cli", version: int = 1) -> dict:
    return {"request_id": "r1", "input_version": version, "text": text,
            "context": {"client_type": client_type}}
