# API 계약 초안 (팀 합의 필요)

정식 스키마는 `app/schemas.py` 와 실행 중인 서버의 `/docs`(OpenAPI)를 기준으로 합니다.

## 공통

- 인증: `X-API-Key` 헤더. CORS 는 인증을 대체하지 않음.
- `context.client_type`: `browser_extension` | `cli`. 분류값일 뿐 권한·예외 근거가 아님.
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
  "context": { "task_type": "summarize", "client_type": "browser_extension" }
}
```

응답 주요 필드: `status`(complete|incomplete|error), `decision`(allow|warn|block),
`signal`(green|yellow|red|gray), `findings[]`, `policy_version`, `detector_versions`, `notices[]`.

`findings[]`: `finding_id`, `type`, `category`, `rule_id`, `detector`(rule|model),
`confidence`(탐지 신뢰도), `severity`(정보 위험도), `action`(block|mask|warn|allow), `span`, `reason`, `replacement`.

## POST /v1/sanitize

요청은 inspect 와 동일. 서버가 직접 검사 → mask/warn 구간 치환 → 재검사.
응답: `sanitized_text`, `changes[]`(type, token, count), `remaining_findings[]`, 재검사 기준 `decision`/`signal`.
`action=block` 구간(예: 반출 금지 자료)은 치환하지 않으므로 정제 후에도 차단됨.

## GET /v1/audit/events?limit=&since=

대시보드용 원문 없는 이벤트. 서버 판정 기록이며 실제 전송·차단 결과가 아님.

## GET /healthz, GET /readyz

`/healthz` 는 프로세스 생존, `/readyz` 는 검사 가능 상태(모델 필수인데 미준비면 503).

## 합의할 것

- [ ] 오프셋 단위: 두 단위 병기 유지 vs 하나로 통일
- [ ] 원문에 mask 대상이 있을 때 decision 을 `block` 으로 둘지(현재), 별도 값(`sanitize_required`)을 둘지
- [ ] 클라이언트 → 서버 "실제 전송/차단" 이벤트 형식(검사 요청 수와 차단 수 분리, 타이핑 중 반복 검사 중복 제거)
- [ ] CLI 종료 코드 0/2/3/4 확정
- [ ] 인증 방식(정적 키 → 조직 SSO/mTLS 여부)
