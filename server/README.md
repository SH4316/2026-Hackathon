# Prompt Guard 서버

외부 생성형 AI로 보내기 전에 프롬프트를 검사·정제하는 온프레미스 서버입니다.
브라우저 확장프로그램과 CLI가 같은 API·정책을 사용합니다.

> 현재 상태: 규칙 기반 탐지·정제·재검사, API 초안, 원문 없는 감사 이벤트, CLI 초안까지 동작합니다.
> 로컬 판단 모델은 `compose.local.yaml` 의 decider(기본 Qwen3 4B Instruct)로 띄웁니다. 정확도 평가·실행 장비는 아직 미정입니다.

## 구조

```text
server/
├─ app/
│  ├─ main.py             # 앱 팩토리, 본문 크기 제한, 원문 미노출 오류 처리
│  ├─ config.py           # PG_* 환경변수 설정
│  ├─ schemas.py          # API 계약(Pydantic)
│  ├─ api/                # 라우트(/v1/inspect, /v1/sanitize, /v1/audit/events, /healthz, /readyz), 인증
│  ├─ detection/
│  │  ├─ rules.py         # 정규식·형식 규칙(한국 형식 우선)
│  │  ├─ validators.py    # Luhn, 주민번호 날짜, IP 파서
│  │  ├─ model.py         # 로컬 모델 문맥 탐지(후보만 제안, 출력 검증)
│  │  └─ merge.py         # 겹치는 구간 병합
│  ├─ policy/engine.py    # YAML 정책 → 위험도·조치·요청 판단
│  ├─ sanitize/replacer.py# 일관 토큰 치환([EMAIL_1]), 뒤에서부터 적용
│  ├─ audit/events.py     # 원문 없는 감사 이벤트(SQLite)
│  └─ services/pipeline.py# 검사 → 정제 → 재검사 오케스트레이션
├─ policies/
│  ├─ default.yaml        # 유형별 category·severity·action·token
│  └─ destinations.yaml   # 전송 목적지(AI 제공사·경로)별 강화 등급
├─ cli/prompt_guard/      # 독립 검사 CLI
├─ tests/
├─ docs/                  # API 계약·미결 사항
├─ Dockerfile, compose.local.yaml(API+4B 모델), compose.api.yaml(API 만), .env.example
```

## 실행

### Docker (권장)

compose 파일이 두 개입니다.

| 파일 | 띄우는 것 | 모델 |
|---|---|---|
| `compose.local.yaml` | API + **decider**(4B 판단 모델, Ollama) | 같은 장비에서 실행. 처음 한 번 자동으로 내려받음 |
| `compose.api.yaml` | API 만 | 규칙만(`PG_MODEL_MODE=disabled`), 또는 `.env` 의 `PG_MODEL_*` 로 지정한 조직 내부 모델 서버 |

```bash
cd server
cp .env.example .env          # PG_API_KEYS 에 직접 생성한 키를 넣는다

docker compose -f compose.local.yaml up -d   # API + 4B 모델
docker compose -f compose.api.yaml up -d     # API 만
curl http://127.0.0.1:8000/readyz
```

`.env` 에 `COMPOSE_FILE=compose.local.yaml` 을 넣으면 `-f` 없이 `docker compose up -d` 로 실행됩니다.

API는 기본적으로 `127.0.0.1:8000` 에만 바인딩됩니다. 다른 PC에서 접근해야 하면 `PG_BIND` 를 바꾸고
반드시 TLS 리버스 프록시 뒤에 둡니다.

### 로컬 개발

```bash
cd server
python -m venv .venv && .venv/Scripts/activate     # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
PG_AUTH_DISABLED=true uvicorn app.main:create_app --factory --reload --no-access-log
pytest
```

API 문서: http://127.0.0.1:8000/docs

## CLI

```bash
cd server
export PYTHONPATH=cli PG_SERVER_URL=http://127.0.0.1:8000 PG_API_KEY=...
prompt_text | python -m prompt_guard inspect --stdin --json     # 판정 JSON → stdout
prompt_text | python -m prompt_guard sanitize --stdin           # 정제문 → stdout
prompt_text | python -m prompt_guard inspect --stdin --provider openai --channel consumer   # 목적지 지정
python -m prompt_guard inspect                                  # 대화형 입력
```

| 종료 코드 | 의미 |
|---|---|
| 0 | 정책 통과 |
| 2 | 사용자 확인 필요(또는 검사 미완료) |
| 3 | 차단 |
| 4 | 검사·연결 오류 |

- 원문은 셸 인자로 받지 않습니다(셸 기록·프로세스 목록 노출 방지).
- 경고는 stderr, JSON/정제문은 stdout. 원문은 다시 출력하지 않습니다.
- 이 CLI는 **검사만** 합니다. 다른 AI 도구가 결과를 무시하고 보내는 것은 막지 못합니다.
  `prompt-guard ... && ai-tool` 같은 파이프만으로 차단이 보장되지 않으며, 전송 통합 어댑터는 별도 작업입니다.
- 컨테이너 안에서 실행하면 서버 주소가 `http://api:8000` 처럼 달라집니다.

## 판단 규칙

| signal | 조건 |
|---|---|
| red | `decision=block` — 원문에 mask/block 대상이 있음 |
| yellow | `decision=warn` — 사용자 확인 필요 |
| green | `status=complete` 이고 `decision=allow`. 현재 정책 통과일 뿐 절대 안전 보장이 아님 |
| gray | `status` 가 `incomplete`/`error` — 전송 보류. 이때 `decision` 은 절대 `allow` 가 아님 |

## 대시보드 ↔ 개인 연결

대시보드가 사용자별 일회용 **등록 코드**(`POST /v1/admin/enrollments`)를 발급하고, 사용자가 확장프로그램 설정의
"대시보드 연결"에 코드를 넣으면 개인 토큰(`pgc_…`)이 발급됩니다. 이후 검사 요청의 감사 이벤트에 `client_id` 가 붙어
대시보드에서 사용자별로 조회·집계(`/v1/admin/audit/events`, `/v1/admin/audit/summary`)하고 연결을 해지할 수 있습니다.
엔드포인트 목록은 [docs/api-contract.md](docs/api-contract.md#대시보드--개인-연결).

## 로컬 모드와 조직 관리 모드

| | 로컬 | 조직 관리 |
|---|---|---|
| 조건 | `PG_DASHBOARD_CONNECTION` 없음, 또는 확장이 등록 코드로 연결되지 않음 | 대시보드 연결 URL(`PG_DASHBOARD_CONNECTION`)이 있는 서버에 대시보드 사람 ID 로 등록 |
| 자체 판단 | 내장 규칙 + 사용자 규칙 + 문맥 탐지기(서버), 기기 내 AI·개인 정규식(확장) | 같음 |
| 대시보드 규칙 | 없음 | 대시보드 활성 설정의 태그 `pythonRegex`, Jev 프롬프트(`jevThreshold`)를 모든 검사에 적용 |
| 기록 | 서버 감사 이벤트(원문 없음)만 | + 전송 시점 검사를 대시보드 `/api/v1/detector-events` 로 전송 |

조직 서버는 대시보드 계약(dashboard/CONTRACT.md)의 "연결된 탐지기" 역할을 합니다.

### 대시보드 연결

1. 대시보드 **감시 연동** → **연결 URL 만들기**. `http://대시보드/api/v1/connectors/c_…#sk_…` 가 한 번만 표시됩니다.
2. 이 서버를 `PG_DASHBOARD_CONNECTION=<연결 URL>` 로 실행합니다. `#` 뒤 비밀값은 `Authorization: Bearer` 로만 보냅니다.
3. `POST /v1/admin/org/refresh`(관리 키)로 연결과 활성 설정을 확인합니다. `/v1/admin/org/status` 의 `connector_id`, `settings_source` 로 상태를 봅니다.
4. 대시보드에서 연결을 해지하면 401 이 되어 조직 규칙을 적용할 수 없으므로 검사는 회색(전송 보류)입니다.

대시보드 기록의 `source_id` 는 연결 ID 입니다. `PG_DASHBOARD_URL`(주소만, 인증 없음)은 대시보드가 아직 연결을 발급하지 않았을 때만 동작하는 이전 방식입니다.

- **태그 정규식:** Python `re` 로 실행합니다. 4000자 이하, 빈 문자열 일치·중첩 수량자(`(a+)+`)는 건너뜁니다(`/v1/admin/org/status` 의 `skipped_regex`).
- **Jev:** 프롬프트마다 로컬 모델(decider)이 출력 태그별 점수(0~1)와 근거 구간을 냅니다. 태그의 `jevThreshold` 가 설정된 경우에만
  `점수 >= 임계값` 이면 탐지입니다. 근거 구간을 원문에서 찾지 못하면 위치 없이 최소 `warn` 입니다(`org_jev_unlocated`).
- 대시보드 태그 탐지의 조치는 조직 설정 `tag_action`(기본 `mask`, 토큰 `[ORG_<태그>_n]`)이며 목적지 등급으로 강화됩니다.
  태그 ID 가 내장 유형과 같으면 유형 이름은 `org_<태그 ID>` 이고 기록할 때 원래 태그로 되돌립니다.
- 기존 규칙 결과는 취소하지 않고 합쳐서 더 엄격한 쪽을 적용합니다.
- **대시보드에 연결할 수 없거나 활성 버전이 없으면** 조직 규칙을 적용하지 못했으므로 회색(`org_config_unavailable`)입니다.
  Jev 모델이 꺼져 있거나 실패해도 회색(`org_jev_model_disabled`, `org_jev_failed`, 모델 필수면 error)이며 allow 하지 않습니다.
- 활성 설정은 `PG_DASHBOARD_REFRESH_S`(기본 30초)마다 다시 받습니다. 바로 반영하려면 `POST /v1/admin/org/refresh`.

### 조직 설정

대시보드 **감시 연동 → 검사 서버 설정**이 기준입니다(대시보드 `GET /api/v1/detector-settings` 를 활성 설정과 함께 받음).
대시보드 설정을 받을 수 없을 때만 이 서버의 `GET·PUT /v1/admin/org/settings`(관리 키) 값을 쓰고,
대시보드 설정을 따르는 중에는 서버 PUT 이 409 입니다. 항목은 같습니다.

```json
{ "report_text": "masked", "tag_map": {"email": "pii-3", "phone": "pii-2"},
  "tag_action": "mask", "jev_enabled": true, "source_id": "prompt-guard" }
```

| 항목 | 의미 |
|---|---|
| `report_text` | 대시보드로 보내는 원문 처리. `masked`(기본): 탐지 구간을 모두 `[TOKEN_n]` 으로 바꾼 문장 / `full`: 원문 그대로 / `off`: 기록 안 함 |
| `tag_map` | 서버 탐지 유형 → 대시보드 태그 ID. 현재 활성 버전에 없는 태그는 빼고 보냄 |
| `tag_action` | 대시보드 태그 탐지 시 조치(`warn`·`mask`·`block`) |
| `jev_enabled` | 끄면 태그 정규식만 적용 |
| `source_id` | 대시보드 기록의 생산자 이름공간 |

### 대시보드에 기록되는 것

- 대시보드 사람 ID 로 등록한 개인 토큰의 **전송 시점** 검사(`context.stage` 가 `draft` 가 아닌 것)만 보냅니다.
  확장은 입력 중 검사를 `draft`, 전송·파일 첨부 직전 검사를 `submit` 으로 보냅니다. 정적 API 키 요청은 보내지 않습니다.
- 응답을 돌려준 뒤 보내므로 검사 시간에 영향이 없습니다. 활성 버전이 바뀌었으면(409) 설정을 다시 받아 한 번 재시도하고,
  실패 건수는 `/v1/admin/org/status` 의 `report_failures` 에 오류 코드별로 남습니다(원문은 로그에 남기지 않음).
- 겹쳐서 하나로 병합된 탐지도 병합 전 후보마다 보내 각 태그가 집계되게 합니다.

### 사용자 등록

**대시보드에서(권장):** 사람 상세 화면 → **확장프로그램 연결 → 연결 코드 발급**. 대시보드가 일회용 코드를 발급하고,
사용자가 확장에 넣으면 이 서버가 대시보드에 코드 사용을 요청(`POST /api/v1/enrollments/redeem`, 연결 인증)해
그 사람으로 개인 토큰을 발급합니다. 연결 URL(`PG_DASHBOARD_CONNECTION`)로 연결된 경우에만 동작합니다.

**이 서버의 관리 API로:**

```bash
# 대시보드에 등록된 사람(person_id)으로 등록 코드 발급. label 을 비우면 대시보드의 이름을 씀
curl -X POST $SERVER/v1/admin/enrollments -H "X-Admin-Key: $ADMIN" -H "Content-Type: application/json" \
  -d '{"person_id": "person-01"}'
```

사용자가 확장 설정의 "대시보드 연결"에 코드를 넣으면 조직 관리 모드가 됩니다. 대시보드에 없는 사람이면 422 입니다.

## 탐지 모듈·대시보드 규칙 관리

내장 규칙 외에 대시보드에서 **사용자 규칙(키워드·정규식)**과 **문맥 탐지기(정규식으로 판단할 수 없는 기준을 로컬 모델로 판단)**를
추가·조합하고, 바뀐 규칙은 `/v1/rules/bundle` 로 각 클라이언트에 배포합니다. 관리 API, 프롬프트 설정, 모델 env 는
[docs/detection-modules.md](docs/detection-modules.md) 를 보세요. 전체 탐지 룰 형식은 [../docs/rule-formats.md](../docs/rule-formats.md), 정확도 평가는 [eval/README.md](eval/README.md).

## 전송 목적지 등급

`policies/destinations.yaml` 은 [AI 모델별 데이터 정책 정리](../docs/ai-model-data-policy.md)(정정판 JSON: `docs/ai-model-data-policy.json`)를 근거로
목적지별 등급을 정합니다. 등급은 기본 정책을 **강화만** 합니다.

| 등급 | 근거 | 효과 |
|---|---|---|
| standard | 상업 계약 경로에서 문서상 기본 학습 안 함 | 기본 정책 그대로 |
| elevated | 기본 학습·opt-out 방식·장기 보관, 또는 학습 정책 확인 불가 | `warn` → `mask` (예: 내부 IP 치환 필요) |
| restricted | 학습·보관·저장 국가가 문서 간 충돌, 또는 승인 범위 밖 국가 저장 명시 | `allow` → `warn`, `warn` → `mask`, 깨끗한 문장도 최소 `warn` |

- 목적지를 모르거나 프로필에 없으면 `elevated` 입니다.
- 브라우저·CLI 는 요금제·계약(ZDR 등)을 알 수 없으므로, `enterprise`·`api` 같은 낮은 등급은
  관리자가 `org_contracts` 에 등록한 목적지만 인정합니다.
- standard 도 안전 보장이 아닙니다. 제공사 정책이 바뀌면 YAML 과 `version` 을 함께 갱신합니다.
- 제공사마다 `verified_at`(근거 확인일)이 있고, `stale_after_days`(기본 90일)가 지나면 서버가 그 제공사를
  기본 등급 이상으로 자동 강화합니다(`destination_policy_stale` 알림).

### 제공사 정책 변경 감지

`.github/workflows/policy-watch.yml` 이 매주 월요일 `tools/policy_watch/sources.yaml` 의 공식 페이지를 가져와
스냅샷(`tools/policy_watch/snapshots/`)과 비교합니다. **등급은 자동으로 바꾸지 않습니다.**

| 결과 | 동작 |
|---|---|
| 페이지 변경·신규 | `bot/policy-watch` 브랜치로 PR(diff 포함) → 사람이 읽고 `destinations.yaml` 등급·`verified_at`·정책 `version` 갱신 |
| 가져오기 실패, 재확인 기한 14일 이내 | `policy-watch` 라벨 이슈 생성 또는 댓글 |
| `manual: true` 페이지(봇 차단·JS 렌더링) | 보고서에 수동 확인 대상으로만 표시 |

- 첫 실행은 모든 페이지가 "신규"로 잡혀 기준 스냅샷 PR 이 열립니다.
- 스케줄은 기본 브랜치에 병합된 뒤부터 동작합니다. Actions 탭에서 수동 실행도 됩니다.
- 저장소 설정 → Actions → General → "Allow GitHub Actions to create and approve pull requests" 를 켜야 합니다.
- 로컬 실행: `python tools/policy_watch/watch.py --report report.md [--only openai,google]`
- 매번 바뀌는 문구로 거짓 변경이 생기면 `sources.yaml` 의 `ignore` 정규식에 추가합니다.

## 로컬 모델: decider (4B)

`compose.local.yaml` 은 문맥 탐지기(정규식으로 판단할 수 없는 기준)를 판단하는 4B 모델을 함께 띄웁니다.

| 서비스 | 네트워크 | 역할 |
|---|---|---|
| `decider-pull` | edge(인터넷 O) | `DECIDER_MODEL` 이 `model-data` 볼륨에 없으면 내려받고 종료. 원문은 지나지 않음 |
| `decider` | internal(인터넷 X) | Ollama 모델 서버. 호스트 포트 미공개, api 만 접근 |
| `api` | edge + internal | `PG_MODEL_API=ollama`, `PG_MODEL_BASE_URL=http://decider:11434` 로 고정 |

- 기본 모델: `qwen3:4b-instruct-2507-q4_K_M`(4B 파라미터, 약 2.5GB, 사고(thinking) 출력 없는 instruct 판).
  `.env` 의 `DECIDER_MODEL` 로 바꿉니다(예: `qwen3:4b-instruct-2507-q8_0` 4.3GB). 모델 정확도는 아직 평가 전입니다(`eval/`).
- 기본 `PG_MODEL_MODE=optional`(모델 실패 시 회색). 필수로 하려면 `.env` 에 `PG_MODEL_MODE=required`.
- CPU 만 쓰면 응답이 느릴 수 있어 `PG_MODEL_TIMEOUT_S` 기본값을 60초로 둡니다. GPU 는 `decider` 의 `deploy` 주석을 해제합니다(NVIDIA Container Toolkit 필요).
- `decider` 는 모델이 볼륨에 있어야 healthy 가 되고, api 는 그 뒤에 시작합니다. 그래도 `/readyz` 의 `model_ready: true` 로 확인하세요.
- 폐쇄망: `.env` 에 `DECIDER_OFFLINE=true` 를 두고 모델을 볼륨에 미리 반입합니다.
  - 인터넷 가능한 PC에서 `ollama pull <모델>` 후 `~/.ollama/models` 를 `model-data` 볼륨으로 복사
  - 또는 GGUF 파일 + Modelfile 로 `docker compose -f compose.local.yaml exec decider ollama create <이름> -f /path/Modelfile`
- 모델을 다른 장비에 두려면 그 장비에서 `compose.local.yaml` 을, 검사 서버에서는 `compose.api.yaml` 을 쓰고
  `PG_MODEL_BASE_URL` 을 그 장비 주소로 지정합니다(decider 는 기본적으로 호스트 포트가 없으므로 `ports` 를 추가하되 조직 내부망에만 공개).

모델 실패·시간 초과 시 `optional` 은 `incomplete`, `required` 는 `error` 로 반환하며 어느 경우에도 `allow` 하지 않습니다.

## 개인정보·운영 원칙

- 원문·탐지 값·위치는 저장하지 않습니다. 감사 이벤트에는 유형·건수·조치·규칙 ID·버전·처리 시간만 남습니다.
- uvicorn 액세스 로그를 끄고, 422 응답의 입력 에코와 예외 메시지 로깅을 제거했습니다.
- 서버 판정 이벤트는 "검사 결과"이며 실제 전송 차단 수가 아닙니다(클라이언트 이벤트 합의 필요).
- 테스트에는 합성 데이터만 사용합니다.
