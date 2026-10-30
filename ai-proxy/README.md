# ai-proxy

AI 도구가 보내는 요청을 검사한 뒤 제공사 API로 전달하는 로컬 역방향 프록시입니다.
기존 `server/cli/prompt_guard`를 독립 패키지 `ai_proxy`로 옮겼습니다.
실행 이름은 `ai-proxy`이며 `python -m ai_proxy`도 같은 명령을 실행합니다.

## 설치

Python 3.10 이상이 필요합니다. 저장소 루트에서 실행합니다.

```sh
python3 -m venv ai-proxy/.venv
ai-proxy/.venv/bin/python -m pip install -r ai-proxy/requirements.txt -e ./ai-proxy
. ai-proxy/.venv/bin/activate
ai-proxy --help
```

런타임 의존성은 `httpx==0.28.1`, `uvicorn==0.34.2`입니다.
검사 서버와 별도로 설치·실행할 수 있습니다. `.env` 파일은 읽지 않습니다.

## 프록시 실행

검사 서버 인증값은 실행 환경의 `PG_API_KEY`에 설정합니다.
제공사 API 키는 AI 도구가 평소처럼 요청 헤더로 보냅니다.

```sh
ai-proxy serve \
  --listen 127.0.0.1:8787 \
  --upstream https://api.openai.com \
  --server http://127.0.0.1:8000
```

OpenAI 호환 도구의 base URL을 `http://127.0.0.1:8787/v1`로 변경합니다.
도구가 `/v1`을 직접 붙이는 설정이라면 `http://127.0.0.1:8787`을 사용합니다.
Anthropic 도구는 별도 프로세스에서 `--upstream https://api.anthropic.com`으로 실행하고
base URL을 `http://127.0.0.1:8787`로 지정합니다. 한 프로세스는 한 업스트림으로 전달합니다.

| 옵션 | 기본값 | 동작 |
| --- | --- | --- |
| `--listen` | `127.0.0.1:8787` | 수신 주소. IPv6는 `[::1]:8787` 형식 |
| `--upstream` | `https://api.openai.com` | 경로·쿼리·인증정보 없는 제공사 원점 URL |
| `--server` | `PG_SERVER_URL` 또는 `http://127.0.0.1:8000` | 검사 서버 |
| `--on-warn` | `allow` | `block`이면 yellow도 403으로 차단 |
| `--max-body-bytes` | `1048576` | 요청 본문 상한. 청크 업로드와 치환본에도 적용, 초과 시 413 |
| `--timeout` | `PG_CLI_TIMEOUT_S` 또는 `30` | 검사 서버 HTTP 작업의 시간 제한(초) |
| `--upstream-timeout` | `300` | 업스트림 HTTP 작업의 시간 제한(초). SSE 수신 대기에도 적용 |
| `--passthrough` | 사용 안 함 | 미지원 경로·메서드를 **검사 없이** 전달 |

기본 수신 주소는 루프백입니다. 외부 인터페이스를 명시하면 해당 네트워크에서도 접근할 수 있으며,
프록시 자체의 별도 클라이언트 인증은 없습니다.

## 검사와 전달

검사 대상은 다음 세 경로의 `POST` 요청입니다. 나머지 경로·메서드는 기본 404입니다.

| API | 검사할 텍스트 |
| --- | --- |
| `/v1/chat/completions` | `messages[].content` 문자열·텍스트 블록, 도구 호출 인자 문자열 |
| `/v1/responses` | `instructions`, 문자열 `input`, 메시지 입력의 텍스트 블록·도구 호출 인자·도구 출력 |
| `/v1/messages` | `system`, `messages[].content` 문자열·텍스트 블록, 중첩 `tool_result`, 도구 입력의 문자열 값 |

텍스트 조각 사이에 줄바꿈을 넣어 **요청 전체를 한 번 검사**합니다.
문자열 외 구조와 이미지 블록 등은 유지합니다. red이면 요청 전체를 정제하고,
검출 구간·토큰을 이용해 원래 필드에 치환을 적용합니다. 여러 조각을 가로지르는 치환은
첫 조각에 토큰을 넣고 해당 원문을 나머지 조각에서 제거합니다.
원래 조각 경계를 유지한 실제 전송 텍스트를 다시 검사한 뒤에만 전달합니다.
치환 위치를 안전하게 확정할 수 없으면 403으로 차단합니다.

검사 요청은 `/v1/inspect`와 `/v1/sanitize`에 다음 context를 보냅니다.

```json
{"client_type":"ai_proxy","stage":"submit","send_action":"normal"}
```

업스트림 호스트가 정확히 `api.openai.com`이면 `destination`에 `openai/api`,
`api.anthropic.com`이면 `anthropic/api`를 추가합니다. 다른 호스트에서는 생략합니다.
검사·정제·재검사에는 같은 `request_id`를 쓰고 재검사는 `input_version: 2`입니다.

| 결과 | 동작 |
| --- | --- |
| green | 원 요청 전달 |
| yellow | stderr 경고 후 전달. `--on-warn block`이면 403 |
| red | `/v1/sanitize`로 치환하고 실제 치환본을 `/v1/inspect`로 재검사. green/yellow만 전달 |
| 정제 결과 또는 치환본 재검사가 red/gray | 제공사 형식의 JSON 오류와 403 |
| 최초 gray·불완전 응답·검사 서버 HTTP 오류·연결 실패·시간 초과 | JSON 오류와 502. 원 요청으로 폴백하지 않음 |

`/v1/messages` 오류는 Anthropic의 `{"type":"error","error":{"type":...,"message":...}}`,
나머지는 OpenAI의 `{"error":{"message":...,"type":...,"param":null,"code":...}}` 형태입니다.
안전한 요청의 업스트림 상태 코드·오류 본문은 그대로 전달합니다. 리다이렉트는 따라가지 않습니다.

`Authorization`과 `x-api-key` 요청 헤더는 업스트림에만 전달합니다.
검사 서버는 `PG_API_KEY`만 `X-API-Key`로 받습니다. 프록시는 요청 원문, 헤더, 키,
검사 서버가 보낸 상세 사유를 로그에 쓰지 않으며 접근 로그도 끕니다.
업스트림 연결에 운영체제의 HTTP 프록시·인증 환경변수를 자동 적용하지 않습니다.

응답은 SSE를 포함해 받은 청크부터 즉시 중계하며 전체를 버퍼링하지 않습니다.
클라이언트 연결이 끊기면 업스트림 응답도 닫습니다. SSE 응답 시작 후 업스트림이 끊기면
연결을 종료하며, 이미 시작한 응답을 새 HTTP 502로 바꿀 수는 없습니다.

## 기존 검사 명령

원문은 대화형 입력 또는 UTF-8 stdin으로만 받습니다. 원문을 위치 인자로 넘길 수 없습니다.
경고는 stderr, `--json` 결과는 stdout에 쓰며 `sanitize`는 기본적으로 정제문만 stdout에 씁니다.

```sh
cat prompt.txt | ai-proxy inspect --stdin --json
cat prompt.txt | ai-proxy sanitize --stdin
cat prompt.txt | python -m ai_proxy inspect --stdin --provider openai --channel api
ai-proxy inspect
```

`--server`, `--timeout`, `PG_API_KEY`, `PG_SERVER_URL`, `PG_CLI_TIMEOUT_S`도 사용할 수 있습니다.
`inspect`·`sanitize`는 외부 AI에 요청하지 않습니다.

| 종료 코드 | 의미 |
| --- | --- |
| 0 | 통과 |
| 2 | 확인 필요·검사 미완료. 잘못된 CLI 인자도 argparse 관례대로 2 |
| 3 | 차단 |
| 4 | 검사·연결·입력 오류 |

## 한계

- HTTPS 투명 프록시가 아닙니다. TLS 가로채기나 `HTTP_PROXY` 설정으로 기존 도구를 자동 보호하지 않습니다.
- **base URL 변경이 가능한 도구만** 사용할 수 있습니다. 프록시를 거치지 않는 요청은 검사할 수 없습니다.
- 답변의 `[EMAIL_1]` 같은 **토큰 복원은 제공하지 않습니다**. 제공사 응답을 그대로 중계합니다.
- 이미지·오디오·첨부 파일의 실제 내용, 서명된 thinking 블록, 도구 정의·메타데이터는 검사하지 않습니다.
  제공사에 저장된 대화나 `previous_response_id`로 참조하는 과거 내용도 가져오지 않습니다.
- 압축한 검사 대상 요청 본문은 415로 거절합니다. 응답 압축은 그대로 중계합니다.
- 검사 서버가 `client_type: ai_proxy`를 지원해야 합니다. 미지원 서버의 422도 검사 실패로 보고 502로 막습니다.
- 검사 서버의 조직 정책에 따라 원문이 대시보드에 기록될 수 있습니다. 프록시 로그와 검사 서버의 수집 정책은 별개입니다.

## 독립 테스트

저장소 루트에서 실행합니다. FastAPI 검사 서버, 제공사 계정, 실제 API 키가 필요하지 않습니다.

```sh
ai-proxy/.venv/bin/python -m pip install -r ai-proxy/requirements-dev.txt -e ./ai-proxy
ai-proxy/.venv/bin/python -m pytest --noconftest -c ai-proxy/pyproject.toml \
  ai-proxy/tests server/tests/test_cli.py -q
```

`--noconftest`로 서버 앱을 불러오는 `server/tests/conftest.py`를 제외합니다.
가짜 검사 서버·가짜 업스트림·실제 로컬 프록시 소켓을 사용하며 합성 데이터만 전송합니다.
색상별 전달·차단, 치환 위치, 재검사, SSE의 첫 이벤트 즉시 도착, 인증 헤더 분리,
미지원 경로, 본문 제한, 오류 응답, CLI 실행을 검증합니다.

요청 형식 참고: [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create),
[Anthropic Messages](https://platform.claude.com/docs/en/api/http/messages),
[Anthropic 오류 형식](https://platform.claude.com/docs/en/api/errors).
