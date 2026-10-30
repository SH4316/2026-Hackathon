"""조직 설정: 대시보드로 보내는 기록의 원문 처리, 탐지 유형 → 대시보드 태그 매핑, 대시보드 태그 조치.

대시보드(PG_DASHBOARD_URL)와 연결된 조직 서버에서만 의미가 있다. 변경할 때마다 버전이 오른다.
"""

from __future__ import annotations

import re
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas import Action

_DASHBOARD_ID = r"^[A-Za-z0-9_-]{1,80}$"


class OrgSettingsBody(BaseModel):
    # full: 원문 그대로 / masked: 탐지 구간을 토큰으로 바꾼 문장 / off: 대시보드에 기록하지 않음
    report_text: Literal["full", "masked", "off"] = "masked"
    # 서버 탐지 유형(email, aws_access_key_id …) → 대시보드 태그 ID
    tag_map: dict[str, str] = Field(default_factory=dict, max_length=500)
    # 대시보드 태그(정규식·Jev)로 탐지됐을 때의 조치. 대시보드 태그에는 조치 개념이 없어 조직이 정한다.
    tag_action: Action = Action.MASK
    # Jev 프롬프트(로컬 모델 판정)를 실행할지. 끄면 대시보드 태그 정규식만 적용한다.
    jev_enabled: bool = True
    # 대시보드 기록의 source_id(생산자 이름공간)
    source_id: str = Field(default="prompt-guard", pattern=_DASHBOARD_ID)

    @field_validator("tag_map")
    @classmethod
    def _check_map(cls, v: dict[str, str]) -> dict[str, str]:
        for k, tag in v.items():
            if not k or len(k) > 80 or not re.fullmatch(_DASHBOARD_ID, tag):
                raise ValueError("tag_map 은 {탐지 유형: 대시보드 태그 ID} 형식입니다")
        return v


class OrgSettings(OrgSettingsBody):
    version: int
    updated_at: str | None
    # server: 이 서버의 관리 API로 정한 값 / dashboard: 연결된 대시보드의 '감시 연동' 설정(우선)
    source: Literal["server", "dashboard"] = "server"

    @property
    def key(self) -> tuple[str, int]:
        return (self.source, self.version)


def from_dashboard(data: dict, source_id: str) -> OrgSettings:
    """대시보드 GET /api/v1/detector-settings 응답(camelCase) → 조직 설정."""
    return OrgSettings(report_text=data["reportText"], tag_map=data.get("tagMap") or {},
                       tag_action=data["tagAction"], jev_enabled=bool(data["jevEnabled"]),
                       source_id=source_id, version=int(data["revision"]), updated_at=data.get("updatedAt"),
                       source="dashboard")


class OrgSettingsStore:
    def __init__(self, path: Path) -> None:
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute("CREATE TABLE IF NOT EXISTS org_settings ("
                           " version INTEGER PRIMARY KEY, updated_at TEXT NOT NULL, actor TEXT NOT NULL,"
                           " payload TEXT NOT NULL)")
        self._conn.commit()
        row = self._conn.execute("SELECT payload FROM org_settings ORDER BY version DESC LIMIT 1").fetchone()
        self._current = (OrgSettings.model_validate_json(row[0]) if row
                         else OrgSettings(version=0, updated_at="1970-01-01T00:00:00+00:00"))

    def current(self) -> OrgSettings:
        return self._current

    def update(self, body: OrgSettingsBody, actor: str) -> OrgSettings:
        with self._lock:
            s = OrgSettings(version=self._current.version + 1,
                            updated_at=datetime.now(UTC).isoformat(timespec="seconds"), **body.model_dump())
            self._conn.execute("INSERT INTO org_settings VALUES (?, ?, ?, ?)",
                               (s.version, s.updated_at, actor, s.model_dump_json()))
            self._conn.commit()
            self._current = s
            return s
