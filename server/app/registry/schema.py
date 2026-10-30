"""대시보드에서 편집하는 탐지 구성(ruleset).

- 내장 규칙(rules.py)과 기본 정책(default.yaml)은 코드·파일로 관리하고 여기서 끌 수 없다.
- 여기서는 '사용자 규칙'(키워드·정규식)과 '문맥 탐지기'(로컬 모델 기준)를 추가·수정한다.
- 각 항목의 id 가 곧 탐지 유형(finding type)이다. 내장 유형과 이름이 겹칠 수 없다
  (대시보드에서 주민번호·인증정보 같은 내장 유형의 조치를 약하게 덮어쓰는 것을 막기 위함).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.registry.validate import RegexRejected, check_custom_regex
from app.schemas import Action, Severity

ID_PATTERN = r"^[a-z][a-z0-9_]{1,40}$"
TOKEN_PATTERN = r"^[A-Z][A-Z0-9_]{1,30}$"


class TypePolicyFields(BaseModel):
    """탐지 유형별 정책. 기본 정책(default.yaml)의 types 항목과 같은 의미."""

    id: str = Field(pattern=ID_PATTERN)
    label: str = Field(min_length=1, max_length=60)
    category: str = Field(default="custom", pattern=ID_PATTERN)
    severity: Severity = Severity.HIGH
    action: Action = Action.MASK
    token: str = Field(pattern=TOKEN_PATTERN)
    enabled: bool = True


class CustomRule(TypePolicyFields):
    """키워드 목록 또는 정규식 하나로 찾는 사용자 규칙. 일치한 전체 구간이 탐지 구간이다."""

    kind: Literal["keywords", "regex"]
    keywords: list[str] = Field(default_factory=list, max_length=200)
    pattern: str | None = Field(default=None, max_length=4000)
    case_sensitive: bool = False
    reason: str = Field(default="", max_length=100)
    # false 면 서버에서만 쓰고 클라이언트 배포 묶음에서 뺀다(예: 키워드 자체가 기밀인 코드명 목록).
    distribute: bool = True

    @model_validator(mode="after")
    def _check(self) -> CustomRule:
        if self.kind == "keywords":
            words = [w for w in self.keywords if w.strip()]
            if not words or any(len(w) > 100 for w in words) or self.pattern:
                raise ValueError("keywords 규칙은 1~100자 키워드 1개 이상이 필요하고 pattern 은 비워야 합니다")
            self.keywords = list(dict.fromkeys(w.strip() for w in words))
        else:
            if not self.pattern or self.keywords:
                raise ValueError("regex 규칙은 pattern 이 필요하고 keywords 는 비워야 합니다")
            try:
                check_custom_regex(self.pattern, self.case_sensitive)
            except RegexRejected as exc:
                raise ValueError(f"사용할 수 없는 정규식: {exc}") from None
        return self


class ContextDetector(TypePolicyFields):
    """정규식으로 판단할 수 없는 기준. Decider 는 입력 전체 분류, 생성형 모델은 후보 구간 추출."""

    criteria: str = Field(min_length=5, max_length=1000)          # 판단 기준 설명
    examples: list[str] = Field(min_length=1, max_length=20)      # 탐지해야 하는 문장
    counter_examples: list[str] = Field(default_factory=list, max_length=20)  # 탐지하면 안 되는 문장

    @model_validator(mode="after")
    def _check(self) -> ContextDetector:
        for s in [*self.examples, *self.counter_examples]:
            if not s.strip() or len(s) > 300:
                raise ValueError("예문은 1~300자여야 합니다")
        return self


class Modules(BaseModel):
    """웹에서 조합하는 탐지 모듈. 내장 규칙 모듈은 항상 켜져 있어 여기 없다."""

    custom_rules: bool = True
    context_model: bool = True


class RuleSetBody(BaseModel):
    modules: Modules = Field(default_factory=Modules)
    custom_rules: list[CustomRule] = Field(default_factory=list, max_length=200)
    context_detectors: list[ContextDetector] = Field(default_factory=list, max_length=30)
    prompt_template: str | None = Field(default=None, max_length=4000)

    def validate_against(self, builtin_types: set[str]) -> None:
        ids = [r.id for r in self.custom_rules] + [d.id for d in self.context_detectors]
        dup = {i for i in ids if ids.count(i) > 1}
        if dup:
            raise ValueError(f"id 가 중복됩니다: {sorted(dup)}")
        clash = set(ids) & builtin_types
        if clash:
            raise ValueError(f"내장 탐지 유형과 같은 id 는 쓸 수 없습니다: {sorted(clash)}")
        if self.prompt_template is not None and "{detectors}" not in self.prompt_template:
            raise ValueError("prompt_template 에는 {detectors} 자리표시자가 있어야 합니다")


class RuleSet(RuleSetBody):
    version: int
    updated_at: str
