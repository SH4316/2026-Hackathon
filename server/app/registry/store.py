"""탐지 구성(ruleset) 저장소. 변경할 때마다 버전이 오르고 모든 버전을 남긴다.

클라이언트는 /v1/rules/bundle 을 버전(ETag)으로 받아 간다. 기본값은 policies/detectors.yaml.
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import yaml

from app.registry.schema import RuleSet, RuleSetBody


class VersionConflict(Exception):
    """If-Match 버전이 현재 버전과 다르다(다른 관리자가 먼저 수정함)."""


def actor_id(admin_key: str | None) -> str:
    """관리 키 자체는 저장하지 않고 짧은 지문만 남긴다."""
    if not admin_key:
        return "dev"
    return "key:" + hashlib.sha256(admin_key.encode()).hexdigest()[:8]


def load_seed(path: Path) -> RuleSetBody:
    return RuleSetBody.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})


class StaticRuleSet:
    """고정 구성(테스트·골든 벡터용)."""

    def __init__(self, body: RuleSetBody, version: int = 1) -> None:
        self._rs = RuleSet(version=version, updated_at="1970-01-01T00:00:00+00:00", **body.model_dump())

    def current(self) -> RuleSet:
        return self._rs


class RuleSetStore:
    def __init__(self, path: Path, seed_path: Path, builtin_types: set[str]) -> None:
        self.builtin_types = builtin_types
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS ruleset_versions ("
            " version INTEGER PRIMARY KEY, updated_at TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL)"
        )
        self._conn.commit()
        row = self._conn.execute("SELECT payload FROM ruleset_versions ORDER BY version DESC LIMIT 1").fetchone()
        if row:
            self._current = RuleSet.model_validate_json(row[0])
        else:
            seed = load_seed(seed_path)
            seed.validate_against(builtin_types)
            self._current = self._insert(seed, 1, "seed")

    def _insert(self, body: RuleSetBody, version: int, actor: str) -> RuleSet:
        rs = RuleSet(version=version, updated_at=datetime.now(UTC).isoformat(timespec="seconds"),
                     **body.model_dump())
        self._conn.execute("INSERT INTO ruleset_versions VALUES (?, ?, ?, ?)",
                           (rs.version, rs.updated_at, actor, rs.model_dump_json()))
        self._conn.commit()
        return rs

    def current(self) -> RuleSet:
        return self._current

    def update(self, mutate: Callable[[RuleSetBody], RuleSetBody], actor: str,
               expected_version: int | None = None) -> RuleSet:
        """mutate 는 현재 구성의 복사본을 받아 새 구성을 돌려준다. 검증 실패 시 ValueError."""
        with self._lock:
            cur = self._current
            if expected_version is not None and expected_version != cur.version:
                raise VersionConflict(cur.version)
            body = RuleSetBody.model_validate(cur.model_dump(exclude={"version", "updated_at"}))
            new_body = RuleSetBody.model_validate(mutate(body).model_dump())  # 전체 재검증
            new_body.validate_against(self.builtin_types)
            self._current = self._insert(new_body, cur.version + 1, actor)
            return self._current

    def history(self, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT version, updated_at, actor FROM ruleset_versions ORDER BY version DESC LIMIT ?",
                (limit,)).fetchall()
        return [{"version": v, "updated_at": t, "actor": a} for v, t, a in rows]
