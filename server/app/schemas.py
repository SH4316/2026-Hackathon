"""API 계약(초안). 팀 합의 전까지 확정 명세가 아니다. docs/api-contract.md 참고."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ClientType(str, Enum):
    BROWSER_EXTENSION = "browser_extension"
    CLI = "cli"


class Decision(str, Enum):
    ALLOW = "allow"
    WARN = "warn"
    BLOCK = "block"


class Status(str, Enum):
    COMPLETE = "complete"      # 정책이 요구하는 모든 검사 완료
    INCOMPLETE = "incomplete"  # 일부 검사(예: 선택 모델)가 빠짐 → allow 불가
    ERROR = "error"            # 필수 검사 실패 → 전송 보류


class Signal(str, Enum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"
    GRAY = "gray"


class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class Action(str, Enum):
    BLOCK = "block"
    MASK = "mask"
    WARN = "warn"
    ALLOW = "allow"


class RequestContext(BaseModel):
    task_type: str | None = Field(default=None, max_length=64)
    # 분류값일 뿐 권한·예외 근거가 아니다.
    client_type: ClientType


class InspectRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=128)
    input_version: int | str
    text: str
    context: RequestContext


class Span(BaseModel):
    # 시작 포함, 끝 제외. code point(Python) 와 UTF-16(JavaScript) 위치를 모두 제공한다.
    start: int
    end: int
    start_utf16: int
    end_utf16: int


class Finding(BaseModel):
    finding_id: str
    type: str
    category: str
    rule_id: str
    detector: Literal["rule", "model"]
    confidence: Confidence
    severity: Severity
    action: Action
    span: Span
    reason: str
    replacement: str | None = None


class InspectResponse(BaseModel):
    request_id: str
    input_version: int | str
    status: Status
    decision: Decision
    signal: Signal
    findings: list[Finding]
    policy_version: str
    detector_versions: dict[str, str]
    notices: list[str] = []


class Change(BaseModel):
    type: str
    token: str
    count: int


class SanitizeResponse(BaseModel):
    request_id: str
    input_version: int | str
    status: Status
    sanitized_text: str | None
    decision: Decision
    signal: Signal
    changes: list[Change]
    remaining_findings: list[Finding]
    policy_version: str
    detector_versions: dict[str, str]
    notices: list[str] = []
