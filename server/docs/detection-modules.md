# 탐지 모듈·대시보드 규칙 관리·로컬 모델

팀 피드백(정규식으로 판단할 수 없는 기준, 모듈 조합, 로컬 모델, 라이브러리 엔드포인트, 프롬프트 설정, 대시보드 규칙 배포)을 반영한 구조입니다.

## 구조

```text
 대시보드 검사 서버 관리(/settings/guard) ── 백엔드 /api/v1/guard/*
                                  │ 관리 키를 보관하고 /v1/admin/*로 프록시
                                  │  규칙·탐지기·모듈·프롬프트 수정 → ruleset 버전 +1
                                  ▼
 ┌────────────── 검사 서버 ─────────────────────────────────────────┐
 │ ruleset 저장소(SQLite, 버전별 기록)                               │
 │   ├ 모듈 1 내장 규칙(rules.py)        항상 켜짐                    │
 │   ├ 모듈 2 사용자 규칙(키워드·정규식)  modules.custom_rules         │
 │   └ 모듈 3 Jev(로컬 모델)             modules.context_model        │
 │        기준(criteria) + 탐지 예문(examples) + 제외 예문 → 프롬프트   │
 │        모델 연결은 env 초기 구성, 모델 모드는 관리 화면에서 저장   │
 │ 조직 규칙: 활성 태그 pythonRegex + 조직 Jev 프롬프트·임계값         │
 │ → 병합 → 내용 기준 정책(유형별 조치) → /v1/inspect, /v1/sanitize     │
 └──────────────────────────────────────────────────────────────────┘
                                  │ GET /v1/rules/bundle (ETag)
                                  ▼
        확장프로그램·@prompt-guard/rules — 변경된 묶음으로 로컬 사전 검사
        ai-proxy — /v1/inspect·/v1/sanitize로 서버 검사 후 제공사에 전달
```

- **내장 규칙은 끌 수 없습니다.** 주민번호·인증정보 같은 기본 보호가 대시보드 실수로 꺼지지 않게 하기 위함입니다.
- **대시보드 항목의 id 가 탐지 유형**이며, 내장 유형(email, rrn …)과 같은 이름은 거부합니다. 내장 유형의 조치를 약하게 덮어쓸 수 없습니다.
- 최종 판정은 항상 서버입니다. 클라이언트 배포는 빠른 사전 확인용입니다.

## 정규식으로 판단할 수 없는 기준 = Jev

검사 서버의 Jev 기준은 내부 필드 `context_detectors`와 `/v1/admin/context-detectors` API로 관리합니다. 조직 트리의 Jev 프롬프트와는 별도 기능입니다. 사용자 규칙·Jev·모듈·모델 모드는 대시보드에서 관리하며 env·YAML은 초기값입니다.

```json
{
  "id": "unpublished_research", "label": "미공개 연구 결과",
  "category": "confidential", "severity": "high", "action": "block", "token": "RESEARCH",
  "criteria": "아직 논문·특허로 공개되지 않은 실험 결과, 수치, 결론",
  "examples": ["이번 실험에서 새 촉매의 수율이 93%로 나왔고 아직 논문 투고 전이야."],
  "counter_examples": ["2019년 Nature 논문의 결과를 요약해 줘."]
}
```

- `PG_MODEL_API=decider` 는 켜진 탐지기별 기준·예문을 독립적인 Noul 질문으로 보내고, 참일 확률 **0.5 이상**이면 입력 전체를 분류 후보로 만듭니다.
  입력 전체 span 은 분류 단위이고 근거 추출 구간이 아닙니다. `action=mask` 면 전체 입력을 마스킹합니다.
- 기존 `ollama`·`openai` 는 시스템 프롬프트로 구간을 추출합니다. 관리자는 앞부분 템플릿(`{detectors}` 필수)을 바꿀 수 있고,
  응답 형식·문서 속 지시 무시 규칙은 서버가 덧붙입니다. 허용된 type 이고 원문에 실제로 있는 구간만 받아들입니다.
- Decider 에서도 사용자 템플릿은 탐지 기준에 포함되며, 응답은 생성형 JSON 이 아닌 typed 확률입니다. 모델은 규칙 탐지 결과를 취소할 수 없습니다.
- 모델 실패·시간 초과 시 `optional` 은 incomplete(회색), `required` 는 error 이며 allow 로 처리하지 않습니다.
- 모델 엔드포인트(`PG_MODEL_BASE_URL` 또는 `PG_MODEL_NAME`) 미설정은 시작 시 한 번 경고하고 호출을 생략합니다. `model_endpoint_unset` 알림과 대시보드 비활성 표시를 제공하며 그 사유만으로 회색·`/readyz` 503이 되지 않습니다.
- 기본 탐지기 5종은 `policies/detectors.yaml` 에 있고, 처음 실행 때 저장소에 들어갑니다.

## 로컬 모델 설정(env)

| 변수 | 설명 |
|---|---|
| `PG_MODEL_MODE` | `disabled` \| `optional` \| `required` 초기값. 이후 `/v1/admin/runtime`에 저장한 모드가 우선 |
| `PG_MODEL_API` | `decider`(`/v1/systemone`, Noul 확률) \| `ollama`(기본, `/api/chat`) \| `openai`(`/v1/chat/completions`) |
| `PG_MODEL_BASE_URL` | 예: `http://decider:8000`(루트 Compose), `http://decider:11434`(기존 compose.local.yaml) |
| `PG_MODEL_NAME` | 모델 이름. BASE_URL 또는 NAME이 비어 있으면 모델 기능 비활성 |
| `PG_MODEL_API_KEY` | OpenAI 호환 로컬 서버가 키를 요구할 때만 |
| `PG_MODEL_TIMEOUT_S`, `PG_MODEL_MAX_CONCURRENCY` | 시간 초과, 동시 호출 수 |

루트 `compose.yml` 은 실제 [Mapika Decider 4B](https://huggingface.co/Mapika/decider-4b)를 공식
[`/v1/systemone` 계약](https://github.com/Mapika/decider)으로 연결합니다. `answers.<태그>.type=noul` 과 유한한 0~1 `noul` 값이
요청한 모든 태그에 있어야 성공입니다. `/health` 의 `ok=true` 와 모델 ID 일치로 준비 상태를 확인합니다.
기존 `compose.local.yaml` 은 Ollama 의 Qwen3 Instruct 경로입니다. 모델 정확도 평가는 진행 전이며 모델 서버는 내부 네트워크에 둡니다.

대시보드 조직 Jev 판정은 각 태그의 `jevThreshold` 를 사용합니다. Decider 에서 임계값을 넘으면 입력 전체에 조직 `tag_action` 을 적용하고,
대시보드 기록도 전체 입력을 그 태그의 분류 단위로 씁니다. 기본 `mask` 기록은 전체 입력을 토큰 하나로 치환합니다.
태그·프롬프트의 `enabled=false` 는 각각 제외하며 부모·자식 태그는 독립적입니다. 필드가 없는 이전 설정은 기본 활성입니다.
비활성 태그를 출력에서 뺀 뒤 출력이 없으면 모델 호출을 생략합니다.

## 관리 API (대시보드용)

`X-Admin-Key` 헤더(`PG_ADMIN_KEYS`)가 필요합니다. 일반 API 키로는 호출할 수 없습니다. 변경 시 `If-Match: <ruleset 버전>` 을 보내면 동시 편집 충돌을 412 로 막습니다.

| 메서드·경로 | 용도 |
|---|---|
| `GET /v1/admin/ruleset` | 현재 구성 전체(ETag = 버전) |
| `GET /v1/admin/ruleset/history` | 버전·시각·변경자 지문(키 자체는 저장하지 않음) |
| `PUT /v1/admin/modules` | 모듈 조합 `{custom_rules, context_model}` |
| `PUT·DELETE /v1/admin/custom-rules/{id}` | 사용자 규칙(키워드·정규식) |
| `POST /v1/admin/custom-rules/test` | 저장 전 규칙을 샘플 텍스트에 시험(일치 위치만 반환) |
| `PUT·DELETE /v1/admin/context-detectors/{id}` | Jev(기준·예문) |
| `POST /v1/admin/context-detectors/test` | 저장된 또는 초안 탐지기로 모델 시험 |
| `GET·PUT /v1/admin/prompt` | 프롬프트 템플릿 조회·수정, 실제 시스템 프롬프트 미리보기 |
| `GET·PUT /v1/admin/runtime` | 모델 모드·연결·준비 상태 조회, `{model_mode}` 저장 |
| `POST /v1/admin/org/regex/check` | 조직 태그 정규식을 실제 실행과 같은 `check_regex`로 검증 |

사용자 규칙 예:

```json
{ "id": "project_codename", "kind": "keywords", "label": "프로젝트 코드명",
  "severity": "high", "action": "mask", "token": "PROJECT",
  "keywords": ["블루문", "Blue Moon"], "distribute": false }
```

```json
{ "id": "employee_id", "kind": "regex", "label": "사번", "action": "mask", "token": "EMP_ID",
  "pattern": "(?<![A-Z0-9])EMP-\\d{6}(?!\\d)", "case_sensitive": true }
```

- 영문·숫자로 시작하는 키워드는 앞에, 영문·숫자로 끝나는 키워드는 뒤에 `[A-Za-z0-9]` 경계를 적용합니다. `Confidential`은 `confidentially`에 일치하지 않습니다. 한글로 끝나면 끝 경계를 두지 않아 조사가 붙은 "블루문은"도 탐지합니다. 기본은 대소문자를 구분하지 않습니다.
- `distribute: false` — 키워드 자체가 기밀(코드명 목록 등)이면 클라이언트에 배포하지 않고 서버에서만 씁니다.
- 정규식 제한: 4,000자 이하, 빈 문자열과 일치 금지, 중첩 수량자(`(a+)+` 등) 금지, Python·JS 의미가 다른 문법
  (`(?P<..>)`, `(?<name>)`, `(?i)`, `\A \Z`, 역참조, 소유 수량자, `\p{..}`) 금지.
  중첩 수량자 검사는 보수적이라 `(?:[a-z]+\.)+corp` 처럼 안전한 패턴도 거부합니다. 반복 대신 `[a-z.]+\.corp` 등으로 바꿔 씁니다.
  휴리스틱이므로 모든 위험 패턴을 막지는 못합니다(장기적으로 RE2 같은 선형 시간 엔진 검토).

## 규칙 배포: `GET /v1/rules/bundle`

정적 API 키 또는 개인 토큰으로 받습니다. ETag는 묶음 전체의 해시이며 서버 ruleset뿐 아니라 조직 `version_id`·`revision`·규칙·목적지 안내 변경도 반영합니다. 클라이언트는 `If-None-Match`로 확인해 같으면 304를 받습니다.

```json
{ "ruleset_version": 4, "policy_version": "2026-10-31.draft4", "updated_at": "…",
  "modules": {"custom_rules": true, "context_model": true},
  "custom_rules": [],
  "context_detectors": [{"id": "internal_project", "label": "내부 프로젝트",
    "category": "confidential", "severity": "high", "action": "mask", "token": "PROJECT", "enabled": true}],
  "org_rules": {"version_id": "v1", "revision": 3, "tag_action": "mask",
    "regex": [{"tag_id": "pii-1", "type": "pii-1", "name": "사번", "token": "ORG_PII_1", "pattern": "EMP-[0-9]{6}"}]},
  "destinations": {"openai": {"consumer": {"tier": "elevated", "basis": "…", "verified_at": "2026-10-31"}}} }
```

Jev의 기준·예문·프롬프트는 서버 내부에서만 쓰므로 묶음에 넣지 않습니다. `org_rules`는 조직 서버가 아니거나 대시보드 설정을 읽지 못하면 `null`입니다. `destinations`는 안내 모달용이며 판정에는 쓰지 않습니다.
확장프로그램은 묶음을 받아 저장하고 5분 주기로 갱신하며, 배포 가능한 사용자 규칙·조직 정규식을 개인 규칙과 함께 로컬 사전 검사에 적용합니다. `distribute=false` 규칙은 계속 제외합니다. 최종 조직 검사는 서버가 수행합니다.

`@prompt-guard/rules` 에서:

```js
import { createGuard, fetchRuleBundle } from "@prompt-guard/rules";
let state = { etag: null, guard: createGuard() };
const r = await fetchRuleBundle(serverUrl, { apiKey, etag: state.etag });
if (r.status === "updated") state = { etag: r.etag, guard: createGuard({ ruleset: r.bundle }) };
```

## 같은 판정 유지

`server/scripts/export_rules_bundle.py` 가 기본 ruleset 을 라이브러리 기본값에 넣고, 사용자 규칙을 추가한 고정 ruleset 으로 만든
골든 벡터를 함께 기록합니다. JS 라이브러리 `npm test` 가 서버(Python)와 판정이 같은지 확인합니다.

## 남은 일

- 대시보드의 ruleset 변경 이력·감사 집계 전용 화면(API는 제공)
- 실제 로컬 모델로 기본 탐지기 5종의 정확도 평가(합성 평가셋)
- 관리 키 → 조직 SSO·역할 기반 권한
