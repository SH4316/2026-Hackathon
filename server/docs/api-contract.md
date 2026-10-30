# API 계약 초안 (팀 합의 필요)

정식 스키마는 `app/schemas.py` 와 실행 중인 서버의 `/docs`(OpenAPI)를 기준으로 합니다.

## 공통

- 인증: `X-API-Key` 헤더(정적 API 키 또는 대시보드에서 연결한 개인 토큰 `pgc_…`). 개인 토큰은 `Authorization: Bearer` 로도 받는다. CORS 는 인증을 대체하지 않음.
- `context.client_type`: `browser_extension` | `cli`. 분류값일 뿐 권한·예외 근거가 아님.
- `context.stage`(선택): `draft`(입력 중 검사) | `submit`(전송 직전). 생략하면 `submit`. 조직 서버는 `draft` 를 대시보드에 기록하지 않는다.
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
    "destination": { "provider": "openai", "channel": "consumer" }
  }
}
```

`context.destination`(선택): 전송할 외부 AI. `provider`/`channel` 은 `^[a-z0-9_]{1,32}$`.
값은 `policies/destinations.yaml` 의 프로필 키(provider: anthropic, openai, google, meta, xai, deepseek,
moonshot, mistral, cohere, amazon, perplexity, microsoft, alibaba / channel: consumer, enterprise, api,
api_free, cloud, self_hosted). 생략하거나 모르는 값이면 기본 등급(elevated)을 적용한다.
기본 등급보다 낮은 등급(enterprise·api 등)은 서버의 `org_contracts` 에 등록된 경우에만 인정한다.

응답 주요 필드: `status`(complete|incomplete|error), `decision`(allow|warn|block),
`signal`(green|yellow|red|gray), `findings[]`, `policy_version`, `destination`, `detector_versions`, `notices[]`.

`destination`: `provider`, `channel`(해석 결과, 모르면 `unknown`), `tier`(standard|elevated|restricted),
`verified`(조직 계약으로 낮은 등급이 확인됐는지), `basis`(등급 근거 요약).
관련 `notices`: `destination_unknown`, `destination_channel_unknown`, `destination_channel_unverified`.

`findings[]`: `finding_id`, `type`, `category`, `rule_id`, `detector`(rule|model),
`confidence`(탐지 신뢰도), `severity`(정보 위험도), `action`(block|mask|warn|allow), `span`, `reason`, `replacement`.

## POST /v1/sanitize

요청은 inspect 와 동일. 서버가 직접 검사 → mask/warn 구간 치환 → 재검사.
응답: `sanitized_text`, `changes[]`(type, token, count), `remaining_findings[]`, 재검사 기준 `decision`/`signal`.
`action=block` 구간(예: 반출 금지 자료)은 치환하지 않으므로 정제 후에도 차단됨.

## GET /v1/rules/bundle

클라이언트 배포용 규칙 묶음(ETag, `If-None-Match` → 304). 대시보드 관리 API 와 함께 [detection-modules.md](detection-modules.md) 참고.
응답 `detector_versions.ruleset` 은 판정에 쓴 ruleset 버전(`rs-<n>`)입니다.

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
- 대시보드 웹이 브라우저에서 직접 관리 API 를 부르면 `PG_CORS_ORIGINS` 에 그 출처를 넣는다(관리 키는 계속 필요).
- 집계는 서버 '검사 판정' 수다. 타이핑 중 반복 검사도 포함되므로 실제 전송·차단 수로 표시하지 않는다.

## GET /healthz, GET /readyz

`/healthz` 는 프로세스 생존, `/readyz` 는 검사 가능 상태(모델 필수인데 미준비면 503).

## 합의할 것

- [ ] 오프셋 단위: 두 단위 병기 유지 vs 하나로 통일
- [ ] 원문에 mask 대상이 있을 때 decision 을 `block` 으로 둘지(현재), 별도 값(`sanitize_required`)을 둘지
- [ ] 클라이언트 → 서버 "실제 전송/차단" 이벤트 형식(검사 요청 수와 차단 수 분리, 타이핑 중 반복 검사 중복 제거)
- [ ] CLI 종료 코드 0/2/3/4 확정
- [ ] 인증 방식(정적 키·등록 코드 개인 토큰 → 조직 SSO/mTLS 여부)
- [ ] 확장프로그램의 사이트 → `destination` 매핑(예: chatgpt.com → openai/consumer). 요금제·계약은 브라우저가 알 수 없으므로 channel 은 소비자 경로로 보낸다
- [ ] 조직이 실제 계약한 목적지 목록(`org_contracts`) 관리 주체
