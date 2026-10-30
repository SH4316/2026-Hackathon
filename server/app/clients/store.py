"""대시보드 ↔ 개인 클라이언트(확장프로그램·CLI) 연결.

흐름: 대시보드가 사용자별 일회용 등록 코드를 발급 → 사용자가 확장프로그램 설정에 코드 입력
→ 서버가 개인 클라이언트 토큰을 발급 → 이후 검사 요청을 그 토큰으로 인증하고 감사 이벤트에 client_id 를 남긴다.

- 등록 코드·토큰 원문은 저장하지 않고 SHA-256 해시만 저장한다(토큰은 발급 응답에서 한 번만 보여 준다).
- label(사용자 이름·부서 등)은 대시보드 관리자가 입력한 값이다. 감사 이벤트에는 client_id 만 남긴다.
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

TOKEN_PREFIX = "pgc_"
# 헷갈리는 문자(0/O, 1/I/L)를 뺀 대문자·숫자. 8자 → 약 31^8 경우의 수, 일회용·만료 있음.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_SEEN_INTERVAL_S = 60  # last_seen_at 은 이 간격보다 자주 기록하지 않는다


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def normalize_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


class EnrollmentInvalid(Exception):
    """코드가 없거나 만료·사용됨. 어느 경우인지 구분해 알려 주지 않는다."""


@dataclass(frozen=True)
class Client:
    client_id: str
    label: str
    client_type: str
    device_name: str | None
    created_at: str
    last_seen_at: str | None
    revoked_at: str | None
    person_id: str | None = None  # 대시보드 사람 ID(조직 관리). 있으면 이 클라이언트의 검사를 대시보드에 기록한다.

    def to_dict(self) -> dict:
        return asdict(self)


class ClientStore:
    def __init__(self, path: Path) -> None:
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.executescript(
            "CREATE TABLE IF NOT EXISTS enrollments ("
            " code_hash TEXT PRIMARY KEY, label TEXT NOT NULL, created_by TEXT NOT NULL,"
            " created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);"
            "CREATE TABLE IF NOT EXISTS clients ("
            " client_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,"
            " client_type TEXT NOT NULL, device_name TEXT, created_at TEXT NOT NULL,"
            " last_seen_at TEXT, revoked_at TEXT);"
        )
        # 이전 버전 DB 에 대시보드 사람 ID 열 추가
        for table in ("enrollments", "clients"):
            cols = {r[1] for r in self._conn.execute(f"PRAGMA table_info({table})")}
            if "person_id" not in cols:
                self._conn.execute(f"ALTER TABLE {table} ADD COLUMN person_id TEXT")
        self._conn.commit()
        self._seen: dict[str, float] = {}

    # ── 대시보드(관리자) ──
    def create_enrollment(self, label: str, ttl: timedelta, actor: str, person_id: str | None = None) -> dict:
        raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        code = f"{raw[:4]}-{raw[4:]}"
        now = _now()
        with self._lock:
            self._conn.execute("INSERT INTO enrollments (code_hash, label, created_by, created_at, expires_at,"
                               " used_at, person_id) VALUES (?, ?, ?, ?, ?, NULL, ?)",
                               (_hash(raw), label, actor, _iso(now), _iso(now + ttl), person_id))
            self._conn.commit()
        return {"code": code, "label": label, "person_id": person_id, "expires_at": _iso(now + ttl)}

    def list_clients(self, include_revoked: bool = False) -> list[Client]:
        sql = "SELECT client_id, label, client_type, device_name, created_at, last_seen_at, revoked_at, person_id FROM clients"
        if not include_revoked:
            sql += " WHERE revoked_at IS NULL"
        with self._lock:
            rows = self._conn.execute(sql + " ORDER BY created_at DESC").fetchall()
        return [Client(*r) for r in rows]

    def get(self, client_id: str) -> Client | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT client_id, label, client_type, device_name, created_at, last_seen_at, revoked_at, person_id"
                " FROM clients WHERE client_id = ?", (client_id,)).fetchone()
        return Client(*row) if row else None

    def update_label(self, client_id: str, label: str) -> Client | None:
        with self._lock:
            self._conn.execute("UPDATE clients SET label = ? WHERE client_id = ?", (label, client_id))
            self._conn.commit()
        return self.get(client_id)

    def revoke(self, client_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("UPDATE clients SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL",
                                     (_iso(_now()), client_id))
            self._conn.commit()
        return cur.rowcount > 0

    # ── 개인 클라이언트 ──
    def enroll(self, code: str, client_type: str, device_name: str | None) -> tuple[Client, str]:
        """등록 코드를 한 번 소비하고 (클라이언트, 토큰)을 돌려준다. 토큰은 다시 볼 수 없다."""
        now = _now()
        with self._lock:
            row = self._conn.execute(
                "SELECT label, expires_at, person_id FROM enrollments WHERE code_hash = ? AND used_at IS NULL",
                (_hash(normalize_code(code)),)).fetchone()
            if not row or datetime.fromisoformat(row[1]) <= now:
                raise EnrollmentInvalid
            self._conn.execute("UPDATE enrollments SET used_at = ? WHERE code_hash = ?",
                               (_iso(now), _hash(normalize_code(code))))
            return self._insert_client(row[0], client_type, device_name, row[2], now)

    def create_client(self, label: str, client_type: str, device_name: str | None,
                      person_id: str | None) -> tuple[Client, str]:
        """대시보드가 발급·확인한 연결 코드로 등록할 때(코드는 대시보드가 이미 사용 처리함)."""
        with self._lock:
            return self._insert_client(label[:60], client_type, device_name, person_id, _now())

    def _insert_client(self, label: str, client_type: str, device_name: str | None, person_id: str | None,
                       now: datetime) -> tuple[Client, str]:
        token = TOKEN_PREFIX + secrets.token_urlsafe(32)
        client = Client(client_id=str(uuid.uuid4()), label=label, client_type=client_type,
                        device_name=device_name, created_at=_iso(now), last_seen_at=None, revoked_at=None,
                        person_id=person_id)
        self._conn.execute("INSERT INTO clients (client_id, token_hash, label, client_type, device_name,"
                           " created_at, person_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (client.client_id, _hash(token), client.label, client.client_type,
                            client.device_name, client.created_at, client.person_id))
        self._conn.commit()
        return client, token

    def authenticate(self, token: str) -> Client | None:
        """해지되지 않은 토큰이면 클라이언트. last_seen_at 은 주기적으로만 갱신한다."""
        if not token.startswith(TOKEN_PREFIX):
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT client_id, label, client_type, device_name, created_at, last_seen_at, revoked_at, person_id"
                " FROM clients WHERE token_hash = ? AND revoked_at IS NULL", (_hash(token),)).fetchone()
            if not row:
                return None
            client = Client(*row)
            mono = time.monotonic()
            if mono - self._seen.get(client.client_id, -_SEEN_INTERVAL_S) >= _SEEN_INTERVAL_S:
                self._seen[client.client_id] = mono
                self._conn.execute("UPDATE clients SET last_seen_at = ? WHERE client_id = ?",
                                   (_iso(_now()), client.client_id))
                self._conn.commit()
        return client
