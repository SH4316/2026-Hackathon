# 탐지 모듈·대시보드 규칙 관리·로컬 모델

팀 피드백(정규식으로 판단할 수 없는 기준, 모듈 조합, 로컬 모델, 라이브러리 엔드포인트, 프롬프트 설정, 대시보드 규칙 배포)을 반영한 구조입니다.

## 구조

```text
                대시보드(웹) ── 관리 API(/v1/admin/*, X-Admin-Key)
                                  │  규칙·탐지기·모듈·프롬프트 수정 → ruleset 버전 +1
                                  ▼
 ┌────────────── 검사 서버 ─────────────────────────────────────────┐
 │ ruleset 저장소(SQLite, 버전별 기록)                               │
 │   ├ 모듈 1 내장 규칙(rules.py)        항상 켜짐                    │
 │   ├ 모듈 2 사용자 규칙(키워드·정규식)  modules.custom_rules         │
 │   └ 모듈 3 문맥 탐지기(로컬 모델)      modules.context_model        │
 │        기준(criteria) + 탐지 예문(examples) + 제외 예문 → 프롬프트   │
 │        모델은 env 로 선택(PG_MODEL_API / PG_MODEL_NAME)              │
 │ → 병합 → 정책(유형별 조치 + 전송 목적지 등급) → /v1/inspect, /v1/sanitize │
 └──────────────────────────────────────────────────────────────────┘
                                  │ GET /v1/rules/bundle (ETag)
                                  ▼
        확장프로그램·CLI·@prompt-guard/rules — 바뀐 경우에만 받아 로컬 사전 검사에 사용
```

- **내장 규칙은 끌 수 없습니다.** 주민번호·인증정보 같은 기본 보호가 대시보드 실수로 꺼지지 않게 하기 위함입니다.
- **대시보드 항목의 id 가 탐지 유형**이며, 내장 유형(email, rrn …)과 같은 이름은 거부합니다. 내장 유형의 조치를 약하게 덮어쓸 수 없습니다.
- 최종 판정은 항상 서버입니다. 클라이언트 배포는 빠른 사전 확인용입니다.

## 정규식으로 판단할 수 없는 기준 = 문맥 탐지기

```json
{
  "id": "unpublished_research", "label": "미공개 연구 결과",
  "category": "confidential", "severity": "high", "action": "block", "token": "RESEARCH",
  "criteria": "아직 논문·특허로 공개되지 않은 실험 결과, 수치, 결론",
  "examples": ["이번 실험에서 새 촉매의 수율이 93%로 나왔고 아직 논문 투고 전이야."],
  "counter_examples": ["2019년 Nature 논문의 결과를 요약해 줘."]
}
```

- 서버가 켜진 탐지기들로 시스템 프롬프트를 만듭니다. 관리자는 앞부분 템플릿(`{detectors}` 자리표시자 필수)만 바꿀 수 있고,
  **응답 형식(JSON)·문서 속 지시 무시 규칙은 서버가 항상 덧붙입니다.**
- 모델 응답은 허용된 type 이고 원문에 실제로 있는 구간만 받아들입니다. 모델은 규칙 탐지 결과를 취소할 수 없습니다.
- 모델 실패·시간 초과 시 `optional` 은 incomplete(회색), `required` 는 error 이며 allow 로 처리하지 않습니다.
- 기본 탐지기 5종은 `policies/detectors.yaml` 에 있고, 처음 실행 때 저장소에 들어갑니다.

## 로컬 모델 설정(env)

| 변수 | 설명 |
|---|---|
| `PG_MODEL_MODE` | `disabled` \| `optional` \| `required` |
| `PG_MODEL_API` | `ollama`(기본, `/api/chat`) \| `openai`(llama.cpp server·vLLM 등 OpenAI 호환 `/v1/chat/completions`) |
| `PG_MODEL_BASE_URL` | 예: `http://model:11434`(Ollama), `http://llama:8080`(llama.cpp) |
| `PG_MODEL_NAME` | 모델 이름. 정하지 않으면 모델 검사를 하지 않음 |
| `PG_MODEL_API_KEY` | OpenAI 호환 로컬 서버가 키를 요구할 때만 |
| `PG_MODEL_TIMEOUT_S`, `PG_MODEL_MAX_CONCURRENCY` | 시간 초과, 동시 호출 수 |

모델·하드웨어("4GB" 의미)는 아직 미정입니다(`docs/open-questions.md`). 모델 서버는 내부 네트워크에만 두고 원문을 외부로 보내지 않습니다.

## 관리 API (대시보드용)

`X-Admin-Key` 헤더(`PG_ADMIN_KEYS`)가 필요합니다. 일반 API 키로는 호출할 수 없습니다. 변경 시 `If-Match: <ruleset 버전>` 을 보내면 동시 편집 충돌을 412 로 막습니다.

| 메서드·경로 | 용도 |
|---|---|
| `GET /v1/admin/ruleset` | 현재 구성 전체(ETag = 버전) |
| `GET /v1/admin/ruleset/history` | 버전·시각·변경자 지문(키 자체는 저장하지 않음) |
| `PUT /v1/admin/modules` | 모듈 조합 `{custom_rules, context_model}` |
| `PUT·DELETE /v1/admin/custom-rules/{id}` | 사용자 규칙(키워드·정규식) |
| `POST /v1/admin/custom-rules/test` | 저장 전 규칙을 샘플 텍스트에 시험(일치 위치만 반환) |
| `PUT·DELETE /v1/admin/context-detectors/{id}` | 문맥 탐지기(기준·예문) |
| `POST /v1/admin/context-detectors/test` | 저장된 또는 초안 탐지기로 모델 시험 |
| `GET·PUT /v1/admin/prompt` | 프롬프트 템플릿 조회·수정, 실제 시스템 프롬프트 미리보기 |

사용자 규칙 예:

```json
{ "id": "project_codename", "kind": "keywords", "label": "프로젝트 코드명",
  "severity": "high", "action": "mask", "token": "PROJECT",
  "keywords": ["블루문", "Blue Moon"], "distribute": false }

{ "id": "employee_id", "kind": "regex", "label": "사번", "action": "mask", "token": "EMP_ID",
  "pattern": "(?<![A-Z0-9])EMP-\\d{6}(?!\\d)", "case_sensitive": true }
```

- 키워드는 경계 없이 찾습니다(한국어 조사가 붙어도 탐지: "블루문은").
- `distribute: false` — 키워드 자체가 기밀(코드명 목록 등)이면 클라이언트에 배포하지 않고 서버에서만 씁니다.
- 정규식 제한: 300자 이하, 빈 문자열과 일치 금지, 중첩 수량자(`(a+)+` 등) 금지, Python·JS 의미가 다른 문법
  (`(?P<..>)`, `(?<name>)`, `(?i)`, `\A \Z`, 역참조, 소유 수량자, `\p{..}`) 금지.
  중첩 수량자 검사는 보수적이라 `(?:[a-z]+\.)+corp` 처럼 안전한 패턴도 거부합니다. 반복 대신 `[a-z.]+\.corp` 등으로 바꿔 씁니다.
  휴리스틱이므로 모든 위험 패턴을 막지는 못합니다(장기적으로 RE2 같은 선형 시간 엔진 검토).

## 규칙 배포: `GET /v1/rules/bundle`

일반 API 키로 받습니다. 대시보드에서 규칙을 바꾸면 ETag 가 바뀌고, 클라이언트는 `If-None-Match` 로 주기적으로 확인해 304 가 아닐 때만 받습니다.

```json
{ "ruleset_version": 4, "policy_version": "2026-10-31.draft3", "updated_at": "…",
  "modules": {"custom_rules": true, "context_model": true},
  "custom_rules": [ … distribute=true 인 규칙 … ],
  "context_detectors": [ {"id", "label", "category", "severity", "action", "token", "enabled"} ] }
```

문맥 탐지기의 기준·예문·프롬프트는 서버 내부에서만 쓰므로 묶음에 넣지 않습니다.

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

- 대시보드 화면(규칙 편집·시험·이력)은 대시보드 파트에서 위 API 로 구현
- 확장프로그램이 묶음을 받아 입력 중 로컬 사전 검사에 쓰는 연동(현재는 서버 검사만 사용)
- 실제 로컬 모델로 기본 탐지기 5종의 정확도 평가(합성 평가셋)
- 관리 키 → 조직 SSO·역할 기반 권한
