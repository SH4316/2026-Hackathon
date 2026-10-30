# SafePrompt

온프레미스 기반 형태 보존형(Type-Safe) 프롬프트 신호등 & 보안 거버넌스 시스템

📖 [디자인 가이드라인 (DESIGN.md)](./DESIGN.md)
🎨 [인터랙티브 브랜드 키트 (brand-kit.html)](./docs/brand-kit.html)

## 대시보드 + 검사 서버 실행

저장소 루트의 `compose.yml`은 대시보드·검사 서버와 실제 **Decider 4B**를 함께 실행합니다. Docker Engine와 Compose v2, 최초 비밀값 생성에 Python 3이 필요합니다. Java·Node.js·Python 서버 의존성은 이미지 안에서 빌드합니다.

| 서비스 | 역할 |
| --- | --- |
| `dashboard` | React 화면과 Spring API |
| `mysql` | 대시보드 DB |
| `server` | Prompt Guard 검사 API와 대시보드 연동 |
| `decider-pull` | 고정 버전의 공식 모델 파일 다운로드·무결성 검사 후 종료 |
| `decider` | 공식 Decider SDK와 llama.cpp로 typed decision 추론 |

아래 명령은 **저장소 루트**에서 최초 설정할 때 실행합니다. API 키·관리 키와 DB 비밀번호를 서로 다른 난수로 생성해 `.env`에 저장하며 터미널에는 출력하지 않습니다.

```bash
cp .env.example .env
python3 - <<'PY'
from pathlib import Path
import secrets

path = Path(".env")
values = {
    name: secrets.token_urlsafe(32)
    for name in ("MYSQL_ROOT_PASSWORD", "DB_PASSWORD", "PG_API_KEYS", "PG_ADMIN_KEYS")
}
lines = []
for line in path.read_text().splitlines():
    name, separator, _ = line.partition("=")
    lines.append(f"{name}={values[name]}" if separator and name in values else line)
path.write_text("\n".join(lines) + "\n")
path.chmod(0o600)
PY
docker compose up -d --build
docker compose ps
```

기본 실행은 CPU를 사용하며 `DECIDER_THREADS`의 기본값은 `4`입니다. 처음에는 이미지 빌드와 약 2.7GB 모델 다운로드가 필요합니다. 이후에는 `decider-data`의 모델 캐시를 재사용합니다. 사용하는 파일은 공식 [Mapika/decider-4b-GGUF](https://huggingface.co/Mapika/decider-4b-GGUF)의 `decider-4b-v3-Q4_K_M.gguf`이며 revision과 파일 해시는 [model_files.py](./server/decider/model_files.py)에 고정합니다.

NVIDIA GPU를 쓰려면 GPU·호환 드라이버와 Docker용 [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)을 준비하고 다음 명령을 사용합니다. GPU 구성의 `gpus: all`은 [Compose 2.30.0 이상](https://docs.docker.com/reference/compose-file/services/#gpus)이 필요합니다.

```bash
docker compose -f compose.yml -f compose.gpu.yml up -d --build
```

GPU 구성은 CUDA 이미지와 전체 레이어 오프로딩(`DECIDER_GPU_LAYERS=-1`)을 사용합니다. VRAM에 맞게 `.env`에서 양수 레이어 수로 줄일 수 있습니다. 기본 CPU 구성은 이 값을 무시하고 항상 `0`을 사용합니다. GPU 구성의 상태·로그·정지에도 같은 두 `-f` 옵션을 지정합니다.

`.env`는 Git에서 제외됩니다. `PG_API_KEYS`는 검사 API 인증에, 별도의 `PG_ADMIN_KEYS`는 사용자 등록·조직 설정 등 관리 API에 사용합니다. 초기 설정 명령을 다시 실행하면 키·비밀번호가 새로 생성됩니다. 이미 초기화한 MySQL 계정은 `.env` 변경만으로 갱신되지 않습니다.

| 용도 | 기본 주소 |
| --- | --- |
| 대시보드 | <http://127.0.0.1:8080> |
| 대시보드 상태·API 문서 | <http://127.0.0.1:8080/api/v1/health> · <http://127.0.0.1:8080/swagger-ui.html> |
| 검사 서버 생존·준비 상태 | <http://127.0.0.1:8000/healthz> · <http://127.0.0.1:8000/readyz> |
| 검사 API 문서 | <http://127.0.0.1:8000/docs> |

기본 공개 주소는 두 앱 모두 `0.0.0.0`입니다. 브라우저에서는 `127.0.0.1` 또는 서버의 LAN IP를 사용합니다. `.env`의 `APP_BIND_IP`·`APP_PORT`(대시보드), `PG_BIND_IP`·`PG_PORT`(검사 서버)로 바꿀 수 있습니다. 해당 IP는 호스트에 할당되어 있어야 하며, 로컬에서만 접근하려면 두 `*_BIND_IP`를 `127.0.0.1`로 설정합니다. 대시보드는 현재 인증 없는 로컬 시연 앱이므로 접근을 허용할 네트워크에서 실행합니다. MySQL과 모델 서비스는 호스트 포트를 공개하지 않습니다.

MySQL의 상태 확인이 통과하면 대시보드가 시작합니다. 별도로 모델 다운로드가 완료되면 Decider가 모델을 로드하고 실제 워밍업 판단을 수행합니다. 대시보드와 Decider가 모두 healthy가 되면 검사 서버가 시작합니다. 컨테이너 간 DB 주소는 `mysql:3306`, `PG_DASHBOARD_URL`은 `http://dashboard:8080`, 모델 주소는 `http://decider:8000`으로 고정되어 있으며 호스트 공개 IP·포트를 바꿔도 유지됩니다. 모델 다운로드 서비스는 검사 서버와 네트워크를 공유하지 않으며, 추론 서비스는 내부 네트워크에서만 실행됩니다.

### 최초 조직 설정과 현재 연동 범위

새 DB에는 데모 데이터를 자동으로 넣지 않습니다. 대시보드의 **메트릭 설정**(`/settings/metrics`)에서 초안을 만들고 태그·정책을 저장한 뒤 **게시·활성화**합니다. 검사 서버는 이 활성 설정을 읽습니다. 활성 버전이 없거나 대시보드에 연결할 수 없으면 조직 규칙 검사 결과가 미완료(회색, `org_config_unavailable`)가 될 수 있습니다. `/healthz`와 컨테이너의 healthy 상태는 프로세스 생존 확인이며, `/readyz`도 활성 조직 설정의 정상 적용을 보장하지는 않습니다.

Decider는 태그별 **입력 전체 분류**에 사용합니다. Jev 설정의 프롬프트와 출력 태그별 질문을 `/v1/systemone`에 보내 `true` 확률을 받고, 태그의 `jevThreshold` 이상이면 입력 전체를 해당 태그의 분류 범위로 표시합니다. 이는 모델이 근거 구간을 추출했다는 뜻이 아닙니다. 조직 기본 조치가 `mask`이므로 정제 시 입력 전체가 토큰으로 바뀔 수 있습니다. Python 정규식은 계속 실제 일치 구간을 사용합니다. Decider는 선택지 확률을 반환하므로 이 구성은 Ollama 채팅 API 대신 공식 SDK를 사용합니다([공식 모델 사용 방식](https://huggingface.co/Mapika/decider-4b-GGUF#this-is-not-a-chat-model)).

서버는 활성 설정의 `tags[].enabled`와 `jevPrompts[].enabled`를 반영합니다. 비활성 태그의 정규식과 Jev 출력, 비활성 Jev 판단은 실행에서 제외하며 부모·자식의 사용 여부는 각각 독립적입니다. 서버 자체의 문맥 탐지기는 별도 규칙 모듈로 관리하며 Decider 분류 기준은 `0.5`입니다.

기본 `PG_MODEL_MODE=required`에서는 모델 실패·잘못된 응답·시간 초과를 검사 오류로 처리하며 허용하지 않습니다. `.env`의 `PG_MODEL_TIMEOUT_S`는 기본 `120`초이며 실행 장비에 맞게 조정할 수 있습니다. `optional`은 같은 실패를 미완료로 처리하고, `disabled`는 모델 검사를 끕니다. 모델을 꺼도 실행할 조직 Jev 판단이 있으면 `org_jev_model_disabled`로 미완료가 됩니다. 모델 입력은 최대 32,768 토큰으로 제한하며 넘으면 입력을 자르는 대신 검사를 실패 처리합니다.

대시보드에 검사 기록을 쌓으려면 사람을 등록하고 관리 API에서 그 사람 ID로 등록 코드를 발급한 뒤 확장프로그램을 연결합니다. 해당 개인 토큰의 전송 시점 검사만 대시보드로 전송되며, 정적 API 키를 사용한 검사 요청은 대시보드에 기록되지 않습니다. 등록과 API 계약은 [서버 README](./server/README.md#대시보드--개인-연결)와 [대시보드 계약](./dashboard/CONTRACT.md)을 참고합니다.

### 데이터 보존과 구성 검증

`mysql-data`는 대시보드 데이터, `server-data`는 서버의 감사 이벤트·사용자 등록·규칙·조직 설정 SQLite DB, `decider-data`는 모델 파일을 보존합니다. 정책 파일은 `server/policies`에서, 추론 모델 캐시는 `decider-data`에서 읽기 전용으로 연결합니다.

폐쇄망에서는 이미지와 모델 캐시를 미리 반입하고 `.env`에 `DECIDER_OFFLINE=true`를 설정합니다. 다운로드 서비스는 `/models/d3a78581751d518bbfa9e871a6d84059554d53c5/` 아래의 고정 파일·해시를 확인하며, 파일이 없거나 일치하지 않으면 다운로드 없이 실패합니다. 온라인 환경에서는 `docker compose run --rm --build decider-pull`로 모델 캐시만 먼저 준비할 수 있습니다.

```bash
docker compose logs --tail=100 dashboard server decider decider-pull
docker compose stop                 # 컨테이너 정지
docker compose up -d                # 재시작
docker compose down                # 컨테이너 제거, 데이터 볼륨 보존
```

`docker compose down -v`는 데이터와 모델 캐시 볼륨을 삭제합니다. 기존 `dashboard/`·`server/` 전용 Compose와 루트 구성은 별도 Compose 프로젝트이며 기존 데이터가 자동으로 이전되지 않습니다. 호스트 포트가 겹치는 구성은 함께 실행할 수 없습니다.

컨테이너 실행 없이 기본값·CPU/GPU 구성 병합·포트 변경·서비스 환경변수 분리·내부 주소·모델 네트워크 격리·상태 확인 의존성·볼륨·필수 비밀값을 검증하려면 다음 명령을 실행합니다. Python 표준 라이브러리와 Compose 2.30.0 이상을 사용하며 실제 `.env` 대신 임시 합성 값을 읽습니다. 이미지 빌드·실제 모델 추론·GPU 동작은 검증하지 않습니다.

```bash
python3 scripts/check_compose.py
# Compose 단독 실행 파일을 사용할 때:
python3 scripts/check_compose.py --compose-command /path/to/docker-compose
```

검증 결과와 서버·런타임 테스트 재현 명령은 [Compose 검증 기록](./docs/compose-validation.md)에 있습니다.

개별 개발 절차는 [대시보드 README](./dashboard/README.md)와 [서버 README](./server/README.md)에 있습니다.
