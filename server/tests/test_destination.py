from datetime import timedelta
from pathlib import Path

import pytest

from app.policy.engine import DestinationPolicy, Policy

from tests.conftest import ROOT, body

POLICY = Policy.load(ROOT / "policies/default.yaml")


def dest_body(text: str, provider: str | None = None, channel: str | None = None) -> dict:
    b = body(text, "browser_extension")
    b["context"]["destination"] = {"provider": provider, "channel": channel}
    return b


def test_every_profile_tier_exists():
    d = POLICY.destinations
    assert d.default_tier in d.tiers
    for channels in d.profiles.values():
        assert all(tier in d.tiers for tier, _ in channels.values())


@pytest.mark.parametrize("text", ["평범한 문장", "서버 10.1.2.3", "CVE-2024-12345", "kim@example.com"])
def test_destination_never_changes_content_verdict(client, text):
    baseline = client.post("/v1/inspect", json=body(text)).json()
    for provider, channel in [("openai", "consumer"), ("openai", "api"), ("deepseek", "api"),
                              ("moonshot", "consumer"), ("unknown", "unknown")]:
        r = client.post("/v1/inspect", json=dest_body(text, provider, channel)).json()
        for field in ("status", "decision", "signal", "findings"):
            assert r[field] == baseline[field]


def test_unknown_destination_uses_default_tier(client):
    r = client.post("/v1/inspect", json=body("서버 10.1.2.3")).json()
    assert r["destination"]["tier"] == "elevated" and "destination_unknown" in r["notices"]
    assert r["findings"][0]["action"] == "warn" and r["decision"] == "warn"


def test_consumer_destination_preserves_internal_ip_action(client):
    r = client.post("/v1/inspect", json=dest_body("서버 10.1.2.3", "openai", "consumer")).json()
    assert r["destination"] == {"provider": "openai", "channel": "consumer", "tier": "elevated",
                                "verified": False, "basis": r["destination"]["basis"]}
    assert r["findings"][0]["action"] == "warn"


def test_client_cannot_self_declare_lower_tier(client):
    # org_contracts 에 없으므로 api 주장은 인정하지 않는다.
    r = client.post("/v1/inspect", json=dest_body("서버 10.1.2.3", "openai", "api")).json()
    assert r["destination"]["tier"] == "elevated" and r["destination"]["verified"] is False
    # 근거가 만료된 시점에 실행되면 stale 알림이 대신 붙는다.
    assert {"destination_channel_unverified", "destination_policy_stale"} & set(r["notices"])


def test_org_contract_allows_standard_tier(tmp_path: Path):
    src = (ROOT / "policies/destinations.yaml").read_text(encoding="utf-8")
    p = tmp_path / "destinations.yaml"
    p.write_text(src.replace("org_contracts: []",
                             "org_contracts:\n  - { provider: openai, channel: api }"), encoding="utf-8")
    d = DestinationPolicy.load(p)
    dest, notices = d.resolve("openai", "api", today=d.verified_at["openai"])
    assert (dest.tier.name, dest.verified, notices) == ("standard", True, [])


def test_stale_profile_is_escalated_to_default_tier(tmp_path: Path):
    src = (ROOT / "policies/destinations.yaml").read_text(encoding="utf-8")
    p = tmp_path / "destinations.yaml"
    p.write_text(src.replace("org_contracts: []",
                             "org_contracts:\n  - { provider: openai, channel: api }"), encoding="utf-8")
    d = DestinationPolicy.load(p)
    fresh = d.verified_at["openai"]
    dest, _ = d.resolve("openai", "api", today=fresh)
    assert dest.tier.name == "standard"
    stale_day = fresh + timedelta(days=d.stale_after_days + 1)
    dest, notices = d.resolve("openai", "api", today=stale_day)
    assert (dest.tier.name, dest.verified, notices) == ("elevated", False, ["destination_policy_stale"])
    # 이미 기본 등급 이상인 프로필은 그대로(더 강화된 등급을 낮추지 않음)
    dest, _ = d.resolve("deepseek", "api", today=stale_day)
    assert dest.tier.name == "restricted"


def test_restricted_clean_text_allows(client):
    r = client.post("/v1/inspect", json=dest_body("문장을 다듬어 줘", "deepseek", "consumer")).json()
    assert r["destination"]["tier"] == "restricted"
    assert (r["decision"], r["signal"]) == ("allow", "green")


def test_restricted_preserves_allow_action(client):
    r = client.post("/v1/inspect", json=dest_body("CVE-2024-12345", "moonshot", "api")).json()
    assert r["findings"][0]["action"] == "allow"


def test_sanitize_uses_destination_tier(client):
    s = client.post("/v1/sanitize", json=dest_body("서버 10.1.2.3", "google", "consumer")).json()
    assert s["sanitized_text"] == "서버 [INTERNAL_IP_1]" and s["decision"] == "allow"


def test_invalid_destination_value_rejected(client):
    r = client.post("/v1/inspect", json=dest_body("x", "Open AI!", "consumer"))
    assert r.status_code == 422


def test_audit_records_destination_classification(client):
    client.post("/v1/inspect", json=dest_body("x", "anthropic", "consumer"))
    e = client.get("/v1/audit/events").json()["events"][0]
    assert (e["destination_provider"], e["destination_channel"], e["destination_tier"]) == (
        "anthropic", "consumer", "elevated")
