"""환경변수 기반 설정. 비밀값은 .env 로만 주입하고 저장소에 커밋하지 않는다."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class ModelMode(str, Enum):
    # disabled: 규칙만 사용. 정책이 모델 검사를 요구하지 않을 때만 complete 가 된다.
    # optional: 모델 실패 시 규칙 결과만 반환하되 status=incomplete 로 표시한다.
    # required: 모델 실패 시 status=error, 절대 allow 하지 않는다.
    DISABLED = "disabled"
    OPTIONAL = "optional"
    REQUIRED = "required"


def _env_list(name: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, "").split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    api_keys: list[str] = field(default_factory=list)
    auth_disabled: bool = False
    policy_path: Path = Path("policies/default.yaml")
    max_text_chars: int = 50_000
    max_body_bytes: int = 256 * 1024

    model_mode: ModelMode = ModelMode.DISABLED
    model_api: str = "ollama"  # ollama | openai(llama.cpp server·vLLM 등 OpenAI 호환 로컬 서버)
    model_api_key: str = ""    # OpenAI 호환 로컬 서버가 키를 요구할 때만
    model_base_url: str = "http://model:11434"
    model_name: str = ""
    model_timeout_s: float = 20.0
    model_max_concurrency: int = 2

    audit_db_path: Path = Path("data/audit.sqlite3")
    ruleset_db_path: Path = Path("data/ruleset.sqlite3")
    # 대시보드용 관리 키(규칙·탐지기 편집). 일반 API 키와 분리한다.
    admin_keys: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            api_keys=_env_list("PG_API_KEYS"),
            auth_disabled=os.getenv("PG_AUTH_DISABLED", "false").lower() == "true",
            policy_path=Path(os.getenv("PG_POLICY_PATH", "policies/default.yaml")),
            max_text_chars=int(os.getenv("PG_MAX_TEXT_CHARS", "50000")),
            max_body_bytes=int(os.getenv("PG_MAX_BODY_BYTES", str(256 * 1024))),
            model_mode=ModelMode(os.getenv("PG_MODEL_MODE", "disabled")),
            model_api=os.getenv("PG_MODEL_API", "ollama"),
            model_api_key=os.getenv("PG_MODEL_API_KEY", ""),
            model_base_url=os.getenv("PG_MODEL_BASE_URL", "http://model:11434"),
            model_name=os.getenv("PG_MODEL_NAME", ""),
            model_timeout_s=float(os.getenv("PG_MODEL_TIMEOUT_S", "20")),
            model_max_concurrency=int(os.getenv("PG_MODEL_MAX_CONCURRENCY", "2")),
            audit_db_path=Path(os.getenv("PG_AUDIT_DB_PATH", "data/audit.sqlite3")),
            ruleset_db_path=Path(os.getenv("PG_RULESET_DB_PATH", "data/ruleset.sqlite3")),
            admin_keys=_env_list("PG_ADMIN_KEYS"),
        )
