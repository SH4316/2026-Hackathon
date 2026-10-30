"""대시보드 ↔ 개인 클라이언트 연결(등록 코드 → 개인 토큰)과 대시보드 조회 API."""

from datetime import timedelta

from app.clients.store import ClientStore

from tests.conftest import ADMIN_KEY, body, make_client

ADMIN = {"X-Admin-Key": ADMIN_KEY}


def enroll(client, label="홍길동", **extra):
    code = client.post("/v1/admin/enrollments", json={"label": label, **extra}, headers=ADMIN).json()["code"]
    r = client.post("/v1/auth/enroll", json={"code": code, "client_type": "browser_extension",
                                            "device_name": "회사 노트북"}, headers={"X-API-Key": ""})
    assert r.status_code == 201, r.text
    return r.json()


def test_enrollment_code_is_admin_only_and_one_time(client):
    assert client.post("/v1/admin/enrollments", json={"label": "a"}).status_code == 401
    code = client.post("/v1/admin/enrollments", json={"label": "홍길동"}, headers=ADMIN).json()["code"]
    assert len(code) == 9 and code[4] == "-"
    req = {"code": code.lower().replace("-", " "), "client_type": "browser_extension"}  # 대소문자·구분자 무관
    assert client.post("/v1/auth/enroll", json=req).status_code == 201
    r = client.post("/v1/auth/enroll", json=req)
    assert r.status_code == 400 and code not in r.text


def test_personal_token_authenticates_and_tags_audit_events(client):
    e = enroll(client)
    assert e["token"].startswith("pgc_") and e["label"] == "홍길동"
    client.headers.pop("X-API-Key")
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {e['token']}"}).json()
    assert me["client_id"] == e["client_id"] and me["device_name"] == "회사 노트북"

    tok = {"X-API-Key": e["token"]}
    assert client.post("/v1/inspect", json=body("키 AKIAIOSFODNN7EXAMPLE"), headers=tok).json()["decision"] == "block"
    events = client.get("/v1/admin/audit/events", params={"client_id": e["client_id"]}, headers=ADMIN).json()["events"]
    assert [ev["client_id"] for ev in events] == [e["client_id"]]
    assert "AKIA" not in str(events)


def test_static_key_events_have_no_client_and_personal_token_sees_only_own(client):
    e = enroll(client)
    client.post("/v1/inspect", json=body("평범한 문장"))  # 정적 API 키
    client.post("/v1/inspect", json=body("평범한 문장"), headers={"X-API-Key": e["token"]})
    all_events = client.get("/v1/audit/events").json()["events"]
    assert sorted(str(ev["client_id"]) for ev in all_events) == sorted(["None", e["client_id"]])
    own = client.get("/v1/audit/events", headers={"X-API-Key": e["token"]}).json()["events"]
    assert [ev["client_id"] for ev in own] == [e["client_id"]]


def test_me_needs_personal_token(client):
    assert client.get("/v1/auth/me").status_code == 401  # 정적 키로는 불가


def test_revoke_and_logout_invalidate_token():
    c = make_client()
    a, b = enroll(c, "a"), enroll(c, "b")
    c.headers.pop("X-API-Key")
    assert c.delete(f"/v1/admin/clients/{a['client_id']}", headers=ADMIN).status_code == 204
    assert c.post("/v1/inspect", json=body("x"), headers={"X-API-Key": a["token"]}).status_code == 401
    assert c.post("/v1/auth/logout", headers={"X-API-Key": b["token"]}).status_code == 204
    assert c.get("/v1/auth/me", headers={"X-API-Key": b["token"]}).status_code == 401
    listed = c.get("/v1/admin/clients", headers=ADMIN).json()["clients"]
    assert listed == []
    assert len(c.get("/v1/admin/clients", params={"include_revoked": True}, headers=ADMIN).json()["clients"]) == 2


def test_rename_client(client):
    e = enroll(client)
    r = client.patch(f"/v1/admin/clients/{e['client_id']}", json={"label": "홍길동(연구1팀)"}, headers=ADMIN)
    assert r.json()["label"] == "홍길동(연구1팀)"
    assert client.patch("/v1/admin/clients/nope", json={"label": "x"}, headers=ADMIN).status_code == 404


def test_summary_by_client(client):
    e = enroll(client)
    tok = {"X-API-Key": e["token"]}
    client.post("/v1/inspect", json=body("kim@example.com"), headers=tok)
    client.post("/v1/inspect", json=body("평범한 문장"), headers=tok)
    client.post("/v1/sanitize", json=body("평범한 문장"))
    s = client.get("/v1/admin/audit/summary", headers=ADMIN).json()
    assert s["events"] == 3 and s["by_endpoint"] == {"inspect": 2, "sanitize": 1}
    assert s["finding_types"] == {"email": 1}
    assert s["by_client"][e["client_id"]] == {"events": 2, "decision": {"block": 1, "allow": 1}, "label": "홍길동"}
    one = client.get("/v1/admin/audit/summary", params={"client_id": e["client_id"]}, headers=ADMIN).json()
    assert one["events"] == 2


def test_expired_code_rejected(tmp_path):
    store = ClientStore(tmp_path / "c.sqlite3")
    code = store.create_enrollment("x", timedelta(seconds=-1), "dev")["code"]
    c = make_client()
    c.app.state.clients = store
    assert c.post("/v1/auth/enroll", json={"code": code, "client_type": "cli"}).status_code == 400


def test_auth_disabled_still_attributes_personal_token():
    c = make_client(auth_disabled=True)
    e = enroll(c)
    c.headers.pop("X-API-Key")
    c.post("/v1/inspect", json=body("x"), headers={"X-API-Key": e["token"]})
    c.post("/v1/inspect", json=body("x"))
    ids = [ev["client_id"] for ev in c.get("/v1/admin/audit/events", headers=ADMIN).json()["events"]]
    assert sorted(map(str, ids)) == sorted(["None", e["client_id"]])


def test_cors_only_for_configured_origins():
    c = make_client(cors_origins=["https://dash.example.org"])
    pre = {"Origin": "https://dash.example.org", "Access-Control-Request-Method": "GET",
           "Access-Control-Request-Headers": "x-admin-key"}
    r = c.options("/v1/admin/clients", headers=pre)
    assert r.headers.get("access-control-allow-origin") == "https://dash.example.org"
    r = c.options("/v1/admin/clients", headers={**pre, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers
