# SafePrompt — 탐지 엔진 & 신호등 판정 체계

> 이 문서는 SafePrompt의 프롬프트 검사 흐름, 신호등 판정 규칙, 그리고 대시보드에서 가능한 커스터마이징 범위를 설명합니다.

---

## 1. 신호등 판정 개요

SafePrompt는 프롬프트를 검사해 네 가지 신호로 결과를 반환합니다.

| 신호 | 색상 | 의미 | 발생 조건 |
|------|------|------|-----------|
| `GREEN` | 🟢 | 통과 | 모든 탐지기가 `allow` 판정 |
| `YELLOW` | 🟡 | 확인 필요 | 하나 이상의 탐지기가 `warn` 판정 |
| `RED` | 🔴 | 차단 | `block` 또는 치환 불가 `mask` 판정 |
| `GRAY` | ⬜ | 검사 미완료 | 필수 탐지기 실패 / 모델 오류 |

판정값은 `server/app/schemas.py`의 `Decision` · `Signal` enum으로 정의되어 있으며, `pipeline.py`에서 탐지 결과를 합산해 최종 신호로 변환합니다.

---

## 2. 탐지 엔진 계층 구조

검사는 세 단계로 순서대로 실행됩니다.

```
프롬프트 입력
    │
    ▼
① 내장 정규식 탐지 (항상 실행, 비활성화 불가)
    └─ 26종 규칙: 주민번호·여권·카드번호·JWT·AWS 키·비밀번호 등
    └─ 단순 패턴 매칭 외 추가 검증(Luhn 체크섬, 주민번호 날짜 유효성)
    │
    ▼
② 사용자 추가 규칙 (대시보드 > 메트릭 설정에서 편집 가능)
    ├─ 키워드 규칙: 금지 단어 목록 매칭
    └─ 정규식 규칙: Python/JS 호환 정규식, 최대 300자
    │
    ▼
③ 문맥 탐지기 (로컬 모델, detectors.yaml로 활성화)
    └─ 정규식으로 판단하기 어려운 의미 기반 기준
       예) "미공개 연구 결과", "내부 프로젝트명"
    │
    ▼
최종 신호 합산
    └─ 가장 심각한 action이 전체 신호 결정
       (block > mask > warn > allow)
```

---

## 3. 판정 기준(action) 설명

각 탐지 규칙에는 `action`이 있습니다.

| action | 동작 | 신호등 |
|--------|------|--------|
| `block` | 원문·정제문 모두 전송 불가 | 🔴 RED |
| `mask` | 해당 구간을 `[TOKEN_N]`으로 치환 후 재검사 통과 시 전송 | 🔴 RED (치환 전) |
| `warn` | 사용자 확인 후 전송, 정제 시 치환 대상 | 🟡 YELLOW |
| `allow` | 탐지 사실만 기록, 전송 허용 | 🟢 GREEN |

---

## 4. 내장 규칙 분류 (`server/policies/default.yaml`)

내장 26종 규칙은 아래 카테고리로 분류됩니다. 코드 수정 없이 이 파일에서 `action`과 `severity`를 변경할 수 있습니다.

| 카테고리 | 포함 규칙 | 기본 action |
|----------|-----------|-------------|
| `personal_id` | 주민번호, 여권, 운전면허 | `mask` |
| `personal` | 전화번호, 이메일, 주소, URL 개인정보 | `mask` / `warn` |
| `financial` | 카드번호, 계좌번호 | `mask` |
| `credential` | AWS 키, GitHub 토큰, JWT, 개인키, 비밀번호 | `mask` |
| `infrastructure` | 내부 IP/도메인 (공개 IP는 `allow`) | `warn` / `allow` |
| `security` | CVE 번호 | `allow` |

> **변경 방법:** `server/policies/default.yaml`의 해당 유형에서 `action` 값을 수정하고 서버를 재시작합니다.

---

## 5. 전송 목적지별 정책 강화 (`server/policies/destinations.yaml`)

목적지(외부 AI 서비스)의 데이터 학습 정책에 따라 기본 판정이 자동으로 강화됩니다.

| 등급 | 예시 | 강화 규칙 |
|------|------|-----------|
| `standard` | 기업 계약, ZDR 적용 | 강화 없음 |
| `elevated` | 학습 opt-out 방식, 소비자 경로 | `warn` → `mask`로 강화 |
| `restricted` | 학습 정책 불명확, 국외 저장 | `allow` → `warn`, `warn` → `mask` |

목적지를 알 수 없을 경우 기본값은 `elevated`입니다.

---

## 6. 대시보드에서 가능한 커스터마이징

대시보드(`메트릭 설정` 탭)에서 아래 항목을 편집할 수 있습니다.

### 6-1. 사용자 추가 규칙
- **키워드 규칙**: 금지 단어 목록을 직접 입력
- **정규식 규칙**: Python/JS 호환 정규식 패턴 (최대 300자, 중첩 수량자 금지)
- `distribute: false` 옵션으로 서버 전용(키워드 자체가 기밀인 경우) 배포 가능

### 6-2. 태그 트리 계층화
- 태그를 부모-자식 구조(`parentId`)로 분류하여 감지 영역을 계층화
- 최상위 태그는 자신과 하위 태그의 감지 영역을 중복 없이 집계
- 트리 편집: 메트릭 설정 > 태그 탭에서 부모 지정/순서 변경 가능

### 6-3. 정책 상태(PolicyState)
- 프롬프트 이벤트에 붙는 거버넌스 분류 레이블
- 색상과 이름을 자유롭게 설정하여 신호등 색상과 연계 표시 가능

---

## 7. 로드맵 — 구현 예정

| 항목 | 현재 상태 | 예정 내용 |
|------|-----------|-----------|
| 태그별 정규식 파이프라인 연결 | DB 저장만, 탐지 미실행 | 태그 `pythonRegex`를 사용자 규칙으로 자동 등록 |
| JEV(LLM 기반 문맥 판단) | UI·DB 있음, 서버 미연결 | `jevPrompt`를 문맥 탐지기에 연결 |
| 대시보드에서 내장 규칙 action 편집 | YAML 직접 수정만 가능 | 관리자 UI에서 per-type action 변경 |

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `server/app/schemas.py` | `Decision` · `Signal` · `Status` enum 정의 |
| `server/app/services/pipeline.py` | 탐지 결과 합산 → 최종 신호 변환 |
| `server/app/detection/rules.py` | 내장 26종 정규식 규칙 |
| `server/app/detection/custom.py` | 사용자 추가 키워드·정규식 규칙 실행 |
| `server/app/detection/model.py` | 로컬 모델 기반 문맥 탐지 |
| `server/policies/default.yaml` | 내장 규칙 action/severity 설정 |
| `server/policies/destinations.yaml` | 목적지별 정책 강화 기준 |
| `server/policies/detectors.yaml` | 초기 사용자 규칙·문맥 탐지기 seed |
| `dashboard/frontend/src/types.ts` | 태그·정책 상태 타입 정의 |
