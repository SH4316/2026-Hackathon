"""원문 없는 감사 이벤트.

저장하는 것: 유형·건수·조치·규칙 ID·정책/탐지기 버전·클라이언트 분류·처리 시간.
저장하지 않는 것: 원문, 탐지된 실제 값, 위치, 자유 텍스트(task_type 포함).
서버 이벤트는 '검사 판정'이며 클라이언트의 실제 전송·차단 결과가 아니다.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass(frozen=True)
class AuditEvent:
    event_id: str
    occurred_at: str
    endpoint: str              # inspect | sanitize
    client_type: str           # browser_extension | cli
    request_id: str
    input_version: str
    status: str
    decision: str
    finding_counts: dict[str, int]   # 유형별 병합 후 구간 수
    actions: dict[str, int]          # 조치별 구간 수
    rule_ids: list[str]
    masked_count: int
    policy_version: str
    detector_versions: dict[str, str]
    duration_ms: int

    @classmethod
    def new(cls, **kw) -> AuditEvent:
        return cls(event_id=str(uuid.uuid4()),
                   occurred_at=datetime.now(UTC).isoformat(timespec="milliseconds"), **kw)


def count(values: list[str]) -> dict[str, int]:
    return dict(Counter(values))


class AuditStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_events ("
            " event_id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        self._conn.commit()

    def record(self, event: AuditEvent) -> None:
        with self._lock:
            self._conn.execute("INSERT INTO audit_events VALUES (?, ?, ?)",
                               (event.event_id, event.occurred_at,
                                json.dumps(asdict(event), ensure_ascii=False)))
            self._conn.commit()

    def list(self, limit: int = 100, since: str | None = None) -> list[dict]:
        sql = "SELECT payload FROM audit_events"
        args: list = []
        if since:
            sql += " WHERE occurred_at > ?"
            args.append(since)
        sql += " ORDER BY occurred_at DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, args).fetchall()
        return [json.loads(r[0]) for r in rows]
