# Prompt Guard 서버

외부 생성형 AI로 보내기 전에 프롬프트를 검사·정제하는 온프레미스 서버입니다.
브라우저 확장프로그램과 CLI가 같은 API·정책을 사용합니다.

> 현재 상태: 규칙 기반 탐지·정제·재검사, API 초안, 원문 없는 감사 이벤트, CLI 초안까지 동작합니다.
> 로컬 모델은 인터페이스(Ollama)만 연결돼 있고 **모델·양자화·하드웨어는 미정**입니다.

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
├─ policies/default.yaml  # 유형별 category·severity·action·token
├─ cli/prompt_guard/      # 독립 검사 CLI
├─ tests/
├─ docs/                  # API 계약·미결 사항
├─ Dockerfile, compose.yaml, .env.example
```

## 실행

### Docker (권장)

```bash
cd server
cp .env.example .env          # PG_API_KEYS 에 직접 생성한 키를 넣는다
docker compose up -d          # API 만 실행(규칙 기반)
curl http://127.0.0.1:8000/readyz
```

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

## 로컬 모델(미정)

1. `.env` 에서 `PG_MODEL_MODE=optional|required`, `PG_MODEL_NAME=<모델명>` 설정
2. `docker compose --profile model up -d`
3. 모델 컨테이너는 `internal` 네트워크에만 붙어 **인터넷 접근이 없습니다.** 모델은 사전 반입합니다.
   - 인터넷 가능한 PC에서 `ollama pull <모델>` 후 `~/.ollama/models` 를 `model-data` 볼륨으로 복사
   - 또는 GGUF 파일 + Modelfile 로 `docker compose exec model ollama create <이름> -f /path/Modelfile`
4. `/readyz` 가 `model_ready: true` 를 반환해야 준비 완료입니다(컨테이너 기동 ≠ 모델 준비).

모델 실패·시간 초과 시 `optional` 은 `incomplete`, `required` 는 `error` 로 반환하며 어느 경우에도 `allow` 하지 않습니다.

## 개인정보·운영 원칙

- 원문·탐지 값·위치는 저장하지 않습니다. 감사 이벤트에는 유형·건수·조치·규칙 ID·버전·처리 시간만 남습니다.
- uvicorn 액세스 로그를 끄고, 422 응답의 입력 에코와 예외 메시지 로깅을 제거했습니다.
- 서버 판정 이벤트는 "검사 결과"이며 실제 전송 차단 수가 아닙니다(클라이언트 이벤트 합의 필요).
- 테스트에는 합성 데이터만 사용합니다.
