# API 계약 초안 (팀 합의 필요)

정식 스키마는 `app/schemas.py` 와 실행 중인 서버의 `/docs`(OpenAPI)를 기준으로 합니다.

## 공통

- 인증: `X-API-Key` 헤더(정적 API 키 또는 대시보드에서 연결한 개인 토큰 `pgc_…`). 개인 토큰은 `Authorization: Bearer` 로도 받는다. CORS 는 인증을 대체하지 않음.
- `context.client_type`: `browser_extension` | `cli` | `ai_proxy`. `cli`는 호환용으로 유지하며 현재 프록시 클라이언트는 `ai_proxy`를 사용한다. 분류값일 뿐 권한·예외 근거가 아님.
- `context.stage`(선택): `draft`(입력 중 검사) | `submit`(전송 직전). 생략하면 `submit`. 조직 서버는 `draft` 를 대시보드에 기록하지 않는다.
- `context.send_action`(선택, 기본 null): `normal`(일반 전송) | `confirmed`(경고 확인 후 전송) | `forced`(빨강 강행 전송). 실제 전송 직전 선택을 기록하는 필드이며 외부 AI 수신 성공의 증거는 아니다.
- `context.files`(선택, 기본 `[]`): 최대 100개 `{name}`. 첨부에서 추출한 텍스트를 검사할 때의 파일 이름. 서버 입력 스키마는 이름 1~1000자를 받지만 대시보드 수집은 공백만 아닌 1~255자와 별도 금지 문자 기준을 적용하므로 수집 제한에 맞춰 보내야 한다.
- `input_version`: 클라이언트가 보낸 값을 그대로 반환. 클라이언트는 최신 버전이 아닌 응답을 버린다.
- 위치: 시작 포함·끝 제외. `span.start/end` 는 Unicode code point(Python),
  `span.start_utf16/end_utf16` 는 UTF-16 code unit(JavaScript `String.slice`).
- 응답에는 탐지된 실제 값을 넣지 않음(클라이언트는 자기 원문에서 위치로 잘라 쓴다).

## POST /v1/inspect

```json
{
  "request_id": "uuid",
  "input_version": 3,
  "text": "...",
  "context": {
    "task_type": "summarize",
    "client_type": "browser_extension",
    "stage": "submit",
    "send_action": "normal",
    "files": [{"name": "보고서.docx"}],
    "destination": { "provider": "openai", "channel": "consumer" }
  }
}
```

`context.destination`(선택): 전송할 외부 AI. `provider`/`channel` 은 `^[a-z0-9_]{1,32}$`.
값은 `policies/destinations.yaml` 의 프로필 키(provider: anthropic, openai, google, meta, xai, deepseek,
moonshot, mistral, cohere, amazon, perplexity, microsoft, alibaba / channel: consumer, enterprise, api,
api_free, cloud, self_hosted). 생략하거나 모르는 값이면 기본 등급(elevated)을 적용한다.
기본 등급보다 낮은 등급(enterprise·api 등)은 서버의 `org_contracts` 에 등록된 경우에만 인정한다.
이 등급과 `destination_*` 알림은 정보 제공용이며 내용 판정에는 영향을 주지 않는다. 모델별 학습·opt-in 상태도 안내 모달로만 알린다.

응답 주요 필드: `status`(complete|incomplete|error), `decision`(allow|warn|block),
`signal`(green|yellow|red|gray), `findings[]`, `policy_version`, `destination`, `detector_versions`, `notices[]`,
`report_status`(recorded|failed|skipped).

검사 완료 시 내용에 `mask` 또는 `block` 대상이 있으면 `decision=block, signal=red`, 그 외 `warn`이면 노랑, 모두 `allow`이면 초록이다. 검사 실패·미완료는 회색이며 `allow`로 반환하지 않는다. 확장프로그램은 검사 완료된 빨강도 사용자 확인 후 강행 전송할 수 있다.

`report_status`는 조직 대시보드 기록 결과이다. 조직 서버 + 대시보드 사람과 연결된 개인 토큰 + `stage != draft` + `report_text != off`이면 **응답 전에 기록 완료를 기다린다**. 성공 `recorded`, 실패 `failed`, 기록 대상이 아니면 `skipped`이다. 관리 상태 확장프로그램은 `failed` 또는 필드 누락 시 전송을 회색 보류한다(ai-proxy의 차이는 아래 참조). `report_status`는 대시보드 수집 봉투의 `result`에서 제외한다(대시보드는 알 수 없는 필드를 거부함).

`destination`: `provider`, `channel`(해석 결과, 모르면 `unknown`), `tier`(standard|elevated|restricted),
`verified`(조직 계약으로 낮은 등급이 확인됐는지), `basis`(등급 근거 요약).
관련 `notices`: `destination_unknown`, `destination_channel_unknown`, `destination_channel_unverified`.

`findings[]`: `finding_id`, `type`, `category`, `rule_id`, `detector`(rule|model),
`confidence`(탐지 신뢰도), `severity`(정보 위험도), `action`(block|mask|warn|allow), `span`, `reason`, `replacement`.

## POST /v1/sanitize

요청은 inspect 와 동일. 서버가 직접 검사 → mask/warn 구간 치환 → 재검사.
응답: `sanitized_text`, `changes[]`(type, token, count), `remaining_findings[]`, 재검사 기준 `decision`/`signal`.
`action=block` 구간(예: 반출 금지 자료)은 치환하지 않으므로 정제 후에도 빨강이다. `sanitize` 자체는 대시보드 전송 기록을 만들지 않으며, 클라이언트는 실제 전송 직전 `/v1/inspect`로 결과·기록을 확인한다.

## POST /v1/files/report

개인 토큰 필수이며 정적 API 키·미등록 요청은 403이다. 파일 이름과 이미지 원본을 조직 대시보드에 기록한다. 본문 상한은 `PG_MAX_REPORT_BODY_BYTES`(기본 16MiB)이며 이 경로만 일반 `PG_MAX_BODY_BYTES` 제한에서 제외한다.

```json
{
  "request_id": "uuid",
  "input_version": "file:사진.png",
  "destination": {"provider": "openai", "channel": "consumer"},
  "send_action": "normal",
  "files": [{"name": "사진.png"}],
  "images": [{"name": "사진.png", "media_type": "image/png", "data_base64": "..."}]
}
```

응답은 202 `{"recorded": true, "reason": null}` 또는 `{"recorded": false, "reason": "not_managed" | "report_off" | "dashboard_unavailable"}`이다. 조직 서버·사람 연결이 없으면 `not_managed`, `report_text=off`이면 `report_off`이다. 관리 상태 클라이언트는 `dashboard_unavailable` 등 기록 실패 시 첨부를 보류한다.

서버는 빈 `text`, `status=complete, decision=allow, signal=green, findings=[]` 결과로 detector-events를 만든다. 이미지 내용을 검사했다는 뜻은 아니다. `files`는 최대 100개이며 이미지는 `image/*`, 표준 Base64, 개별 5MiB·합계 10MiB·최대 20개이다. 제한 초과·디코딩 불가 이미지는 원본을 제외하고 파일 이름만 남긴다.

## GET /v1/rules/bundle

클라이언트 배포용 규칙 묶음(ETag, `If-None-Match` → 304). 대시보드 관리 API 와 함께 [detection-modules.md](detection-modules.md) 참고.
묶음은 `ruleset_version`(정수), `policy_version`, `updated_at`, `modules`, `custom_rules`, `context_detectors`, `org_rules`, `destinations`를 반환한다. 검사 응답의 `detector_versions.ruleset`은 판정에 쓴 ruleset 버전(`rs-<n>`)이다.

```json
{
  "org_rules": {
    "version_id": "v1", "revision": 3, "tag_action": "mask",
    "regex": [{"tag_id": "pii-1", "type": "pii-1", "name": "사번", "token": "ORG_PII_1", "pattern": "EMP-[0-9]{6}"}]
  },
  "destinations": {"openai": {"consumer": {"tier": "elevated", "basis": "...", "verified_at": "2026-10-31"}}}
}
```

`org_rules`는 조직 서버가 아니거나 대시보드 설정을 읽지 못하면 `null`이다. ETag는 묶음 전체의 해시이므로 조직 버전·revision 변경도 반영한다. `distribute=false` 사용자 규칙은 제외하며 Jev의 기준·예문·프롬프트는 배포하지 않는다. 사용자 표시 이름은 Jev이고 내부 필드 `context_detectors`는 유지한다. `destinations`는 안내 모달용이다.

## 조직 설정·런타임 관리 (X-Admin-Key)

상태는 대시보드 **검사 서버 관리**(`/settings/guard`)에서 관리한다. 브라우저의 `/api/v1/guard/**` 요청을 대시보드 백엔드가 관리 키를 붙여 `/v1/admin/**`로 전달하므로 브라우저에 키를 배포하지 않는다. env·YAML은 초기값이며 저장된 모델 모드·ruleset이 우선한다.

`GET·PUT /v1/admin/org/settings`의 설정 본문:

```json
{
  "report_text": "full", "tag_map": {}, "tag_action": "mask", "jev_enabled": true,
  "source_id": "prompt-guard", "policy_state_map": {"allow": null, "warn": null, "block": null}
}
```

`report_text` 기본값 `full`은 대시보드에 원문을 저장한다. `masked`(탐지 구간 치환)·`off`(기록 제외)도 지원한다. `policy_state_map`은 판정 → 대시보드 정책 상태 ID의 명시적 매핑이며, 활성 버전에 없는 ID는 기록에 보내지 않는다. 조회·저장 응답에는 `version`, `updated_at`도 포함한다.

| 메서드·경로 | 계약 |
|---|---|
| `POST /v1/admin/org/regex/check` | 요청 `{patterns:[{tag_id,pattern}]}` 최대 1000개. 실제 실행과 같은 `check_regex` 사용. 대시보드 연결 없이도 검증 가능 |
| `GET /v1/admin/runtime` | `{model_mode,model_status,model_endpoint_set,model_ready,modules,policy_version,ruleset_version,org}` |
| `PUT /v1/admin/runtime` | `{model_mode:"disabled"\|"optional"\|"required"}` 저장 후 현재 상태 반환. 모듈은 기존 `PUT /v1/admin/modules` 사용 |

정규식 검증 응답은 200 `{results:[{tag_id,ok,reason}]}`이며 사유는 `null`·`too_long`·`nested_quantifier`·`syntax_error`·`matches_empty`이다. 길이는 최대 4,000자다. 대시보드는 초안·태그 세부 저장 전에 변경된 비어 있지 않은 패턴을 검증해 실패 시 400 `INVALID_INPUT`과 태그별 `pythonRegex` fieldErrors로 거부한다. 검사 서버 URL이 없으면 원격 검증 없이 저장하고, 설정됐는데 연결 실패면 503 `GUARD_UNAVAILABLE`이다. 기존 `skipped_regex`는 메트릭 설정·검사 서버 상태·전체 현황 배너에 이름·사유를 표시한다.

`model_status`는 `active`·`disabled`·`endpoint_unset`·`unavailable`이다. BASE_URL 또는 NAME이 비어 있으면 시작 시 경고 한 번, 모델·조직 Jev 호출 생략, `notices`에 `model_endpoint_unset`을 넣으며 그 사유만으로 회색이 되지 않는다. `model_ready`는 미설정·비활성일 때 `null`이다.

## 검사 서버 → 대시보드 기록

`POST /api/v1/detector-events` 봉투에 `send_action`(위 값 또는 null), `files:[{name}]`, `images:[{name,media_type,data_base64}]`를 보낸다. `policy_state_id`는 `policy_state_map`으로 정하고 활성 버전에 있는 ID만 포함한다. `result`에는 `report_status`를 넣지 않는다. 대시보드는 `sendAction`·`fileCount`·`imageCount`를 목록·상세에 반환하며 `forced`를 **강행 전송**으로 표시한다. 자세한 계약은 [dashboard/CONTRACT.md](../../dashboard/CONTRACT.md#detector-http-ingestion).

## GET /v1/audit/events?limit=&since=

원문 없는 이벤트. 서버 판정 기록이며 실제 전송·차단 결과가 아님. 개인 토큰으로 호출하면 자기 이벤트만 돌려준다.
이벤트의 `client_id` 는 개인 토큰으로 인증한 요청에만 있고, 정적 API 키 요청은 `null`.

## 대시보드 ↔ 개인 연결

```text
대시보드(관리 키)               사용자(확장프로그램 설정)               서버
POST /v1/admin/enrollments ──▶ 등록 코드 ABCD-EFGH 전달(메신저 등)
                                POST /v1/auth/enroll {code} ──────────▶ 코드 1회 소비, 개인 토큰 발급(해시만 저장)
                                이후 X-API-Key: pgc_… 로 검사 ────────▶ 감사 이벤트에 client_id 기록
GET /v1/admin/audit/summary ◀──────────────────────────────────────── 사용자별 집계
```

| 메서드·경로 | 인증 | 용도 |
|---|---|---|
| `POST /v1/auth/enroll` `{code, client_type, device_name?}` | 없음(코드가 비밀) | 201 `{client_id, label, token, person_id, managed}`. 토큰은 이 응답에서만 보임. 틀리거나 만료·사용된 코드는 모두 400. `managed` 는 조직 서버 여부 |
| `GET /v1/auth/me` | 개인 토큰 | 내 연결 정보 + `policy_version`, `ruleset_version` |
| `POST /v1/auth/logout` | 개인 토큰 | 204, 내 토큰 해지 |
| `POST /v1/admin/enrollments` `{person_id?, label?, ttl_minutes?}` | 관리 키 | 201 `{code, label, person_id, expires_at}`. 일회용, 기본 24시간(`PG_ENROLLMENT_TTL_MINUTES`). 조직 서버면 대시보드 사람인지 확인(없으면 422), `label` 생략 시 대시보드 이름 |
| `GET·PUT /v1/admin/org/settings` | 관리 키 | 조직 설정(원문 처리·태그 매핑·태그 조치·Jev 사용). README "로컬 모드와 조직 관리 모드" |
| `GET /v1/admin/org/status` · `POST /v1/admin/org/refresh` | 관리 키 | 대시보드 연동 상태(활성 버전·revision·건너뛴 정규식·기록 수/실패) / 활성 설정 즉시 다시 받기 |
| `GET /v1/admin/clients?include_revoked=` | 관리 키 | 연결 목록(`client_id, label, client_type, device_name, created_at, last_seen_at, revoked_at`) |
| `PATCH /v1/admin/clients/{id}` `{label}` | 관리 키 | 표시 이름 변경 |
| `DELETE /v1/admin/clients/{id}` | 관리 키 | 204, 연결 해지(토큰 즉시 무효) |
| `GET /v1/admin/audit/events?limit=&since=&until=&client_id=` | 관리 키 | 전체·사용자별 이벤트 |
| `GET /v1/admin/audit/summary?since=&until=&client_id=` | 관리 키 | 집계: `by_endpoint`, `by_decision`, `by_status`, `by_client_type`, `by_destination_tier`, `finding_types`, `by_client{id: {events, decision, label}}` |

- 등록 코드·토큰은 SHA-256 해시만 저장한다. `label`(사용자 이름 등)은 관리자가 입력한 값이며 감사 이벤트에는 `client_id` 만 남는다.
- `last_seen_at` 은 1분 간격으로만 갱신한다.
- 기본 대시보드는 백엔드 관리 프록시를 사용하므로 관리 키는 백엔드에 둔다. 브라우저에서 직접 관리 API를 호출하는 별도 구성만 `PG_CORS_ORIGINS`가 필요하다.
- 집계는 서버 '검사 판정' 수다. 타이핑 중 반복 검사도 포함되므로 실제 전송·차단 수로 표시하지 않는다.

## GET /healthz, GET /readyz

`/healthz`는 프로세스 생존, `/readyz`는 런타임 상태(`model_status` 포함)를 반환한다. 엔드포인트가 설정됐고 모델이 필수인데 미준비면 503이다. 엔드포인트 미설정은 모델 기능 비활성으로 503을 내지 않는다. 조직 활성 설정의 정상 적용 여부는 `/v1/admin/org/status`에서 확인한다.

## ai-proxy 클라이언트

기존 검사 CLI는 [ai-proxy](../../ai-proxy/README.md)로 이동했다. `ai-proxy inspect`·`sanitize`는 검사 전용이며 종료 코드 0(통과)·2(확인 필요/미완료)·3(차단)·4(오류)를 쓴다. `ai-proxy serve`는 도구 요청을 검사·정제·재검사한 뒤 제공사로 전달하며 `context.client_type=ai_proxy, stage=submit, send_action=normal`을 보낸다. 현재 `report_status=failed`는 502로 막지만 필드 누락은 별도로 거부하지 않는다. 누락도 보류해야 한다는 관리 상태 계약과의 차이는 [ai-proxy 한계](../../ai-proxy/README.md#한계)에 명시한다. 외부 AI의 수신 성공을 대시보드에 확정하는 별도 이벤트 계약은 없다.

## 합의할 것

- [ ] 오프셋 단위: 두 단위 병기 유지 vs 하나로 통일
- [ ] 원문에 mask 대상이 있을 때 decision 을 `block` 으로 둘지(현재), 별도 값(`sanitize_required`)을 둘지
- [ ] 외부 AI 수신 성공·최종 차단을 확인하는 이벤트 형식(현재 `send_action`은 전송 직전 선택이며 draft는 조직 기록에서 제외)
- [ ] 인증 방식(정적 키·등록 코드 개인 토큰 → 조직 SSO/mTLS 여부)
- [ ] 조직이 실제 계약한 목적지 목록(`org_contracts`) 관리 주체
