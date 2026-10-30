# 루트 Compose 검증 기록

검증일: 2026-10-30. 대상은 루트 `compose.yml`·`compose-dev.yml`·`compose.gpu.yml`·`compose.cpu.yml`, 서버의 Decider 어댑터와 `server/decider` 런타임입니다.

GPU 기본 실행 수정 후 Compose 구성 검사와 Decider 런타임 26개 검사, `git diff --check`를 다시 통과했습니다. 아래 초기화·확장·서버 결과는 기존 검증 기록입니다. Docker Engine과 NVIDIA GPU 도구가 없어 이미지 빌드와 실제 GPU 추론은 실행하지 못했습니다.

## 결과와 재현

| 검사 | 결과 | 검증 범위 |
| --- | --- | --- |
| Compose 구성 파싱 | 통과, Compose 2.39.4 | 기본·개발 설정, 확장 필터 초기화 의존성·Jev 설정 플래그·읽기 전용 입력, 별도 개발 볼륨, 예시 환경·사용자 포트·CPU/CUDA 병합, 내부 주소·네트워크·서비스별 환경변수 |
| 초기화 스크립트 테스트 | 13 passed | HTTP API 계약·기본/개발 태그·Jev 출력·활성 설정 보존·재실행·중단 복구·실패 종료 |
| 확장 공용 규칙 테스트 | 194 passed | 탐지·정제의 서버 일치, 규칙 묶음과 사용자 규칙 동작; vendor 복사본 최신 확인 |
| 서버 테스트 | 306 passed | Decider 응답 검증·전체 입력 분류·마스킹·비활성 태그/판단 제외와 기존 서버 동작 |
| Decider 런타임 테스트 | 26 passed | SDK 대역으로 CPU/GPU 인자·GPU 미탐지 및 0 레이어 시작 거부·시작 워밍업·입력 경계·오류 응답·캐시 처리 검증 |
| README 초기 설정 명령 | 통과 | 임시 `.env`에서 서로 다른 비밀값 4개 생성, 권한 `0600`, 출력 없음 |
| `git diff --check` | 통과 | 공백 오류 확인 |

모든 명령은 저장소 루트 기준입니다. Compose 검사는 Docker Engine 없이 단독 Compose 바이너리로 실행했습니다.

```bash
python3 scripts/check_compose.py --compose-command /tmp/compose-gpu-fix-validation/docker-compose
# Docker CLI와 Compose 플러그인이 있는 환경:
python3 scripts/check_compose.py
```

스크립트는 임시 합성 비밀값과 정리된 프로세스 환경을 사용하며 실제 `.env`를 읽거나 출력하지 않습니다. 필수 DB root 비밀번호·검사 API 키가 없으면 기본·개발 구성 모두 실패하는지, 관리 키는 선택 사항인지도 확인합니다. 개발 구성의 서비스는 기본 구성을 상속하고, 초기화 서비스의 `SEED_JEV_FILTERS`만 `true`로 바꾸는지 확인합니다. 초기화 입력 3개는 읽기 전용이며 초기화 성공 전에 검사 서버가 시작하지 않아야 합니다. 기본·개발 구성이 CUDA 이미지·GPU 장치 요청·전체 레이어·GPU 필수 조건을 선택하는지, 기존 GPU 오버레이가 동일하게 병합되는지, 명시적 CPU 오버레이가 GPU 장치 요청과 필수 조건을 제거하는지도 검사합니다.

초기화 스크립트의 API 계약·재실행·중단 후 복구와 기본 태그·Jev 설정 검사는 Node 24에서 다음 명령으로 실행합니다. 이 검사는 실제 MySQL·Decider 분류 결과를 검증하지 않습니다.

```bash
node --test scripts/seed-dashboard.test.mjs
```

서버 테스트 재현:

```bash
python3 -m venv /tmp/safeprompt-server-tests-venv
/tmp/safeprompt-server-tests-venv/bin/pip install -r server/requirements-dev.txt
cd server
/tmp/safeprompt-server-tests-venv/bin/python -m pytest tests -q
cd ..
```

런타임 테스트는 실제 모델 의존성·가중치를 설치하지 않고 공식 SDK와 전송 계층을 대역으로 바꿉니다. 최종 26개 검사는 실제 런타임과 같은 FastAPI 0.128.0으로 통과했습니다. 상위 Starlette/AnyIO의 deprecation warning 1건이 있습니다.

```bash
python3 -m venv /tmp/safeprompt-decider-tests-venv
/tmp/safeprompt-decider-tests-venv/bin/pip install fastapi==0.128.0 httpx==0.28.1 pytest==8.3.5
/tmp/safeprompt-decider-tests-venv/bin/python -m pytest server/decider/tests -q
```

GPU 레이어를 요청했는데 llama.cpp가 GPU 백엔드를 찾지 못하면 모델 로드 전에 실패하고, GPU 필수 배포에서 0 레이어도 거부합니다. CPU 명시 실행은 GPU 탐지에 의존하지 않습니다. SDK에 `verbose=True`를 전달하여 실제 CUDA 장치·모델 레이어 오프로딩 로그를 보존합니다. `/health`의 `gpu_layers`는 실제 배치가 아닌 요청값이며, 배포 후 확인 명령은 [루트 README](../README.md)에 있습니다.

런타임 검사는 유한한 0~1 Noul 확률만 워밍업 성공으로 인정하고, SDK의 `Context:\n` 접두어를 포함한 상태 입력이 32,768 토큰을 넘으면 잘라서 추론하지 않고 거절하는지 확인합니다. 본문·질문 수 제한, 입력을 포함하지 않는 오류 응답, 오프라인 캐시·해시 검사·원자적 다운로드 교체도 포함합니다.

wheel 빌드 캐시 변경 후에도 런타임 22개 검사와 Compose 구성 검사가 통과했습니다. Dockerfile 파싱·전체 `RUN`의 셸 구문·`COPY` 입력의 `.dockerignore` 허용 여부와, 분리한 requirements를 확장했을 때 기존 직접 의존성 7개의 고정 버전이 유지되는지 확인했습니다. 별도 임시 pip 캐시에서 작은 `wheel==0.45.1` 패키지를 `--no-binary wheel`로 두 번 빌드해 두 번째 실행은 저장된 wheel을 재사용하는 것도 확인했습니다. 이는 pip 캐시 동작 검사이며 실제 llama.cpp 컴파일이나 BuildKit 캐시 적중 검사는 아닙니다. Docker Engine이 없어 실제 CPU/CUDA 이미지 빌드·캐시 적중·소요 시간은 검증하지 않았습니다.

## 고정 소스와 실행 한계

- 공식 모델: [Mapika/decider-4b-GGUF](https://huggingface.co/Mapika/decider-4b-GGUF), revision `d3a78581751d518bbfa9e871a6d84059554d53c5`, `decider-4b-v3-Q4_K_M.gguf`(2,708,804,000 bytes). 토크나이저·설정 파일을 포함한 크기·SHA-256은 [model_files.py](../server/decider/model_files.py)에 고정합니다.
- 공식 SDK: [Mapika/decider](https://github.com/Mapika/decider)의 `decider-ai==1.10.0`. `llama-cpp-python==0.3.35`, CPU `torch==2.10.0`, `transformers==5.0.0`을 사용합니다. CPU/GPU 빌드 정의는 [Dockerfile](../server/decider/Dockerfile), llama.cpp와 NumPy는 [requirements-native.txt](../server/decider/requirements-native.txt), 나머지 직접 의존성은 [requirements.txt](../server/decider/requirements.txt)에 있습니다. CUDA 빌드·런타임은 NVIDIA CUDA `12.8.1`의 Ubuntu 24.04 이미지를 사용합니다.
- 이미지 빌드, Docker 컨테이너 기동·볼륨 수명 주기, 실제 GGUF 다운로드·로드·추론, CPU 성능·메모리 사용량, NVIDIA GPU 동작은 이 환경에서 검증하지 않았습니다. Dockerfile의 CPU 빌드에는 SDK와 컴파일된 llama.cpp 모듈 import 검사를, CUDA 빌드에는 SDK import와 `llama-cpp-python` 패키지 메타데이터 검사를 정의합니다. 실제 CUDA 드라이버·추론 경로는 컨테이너 시작 시 SDK 워밍업으로 확인하도록 구성했으며, 이 빌드·실행 검사는 여기서 수행하지 않았습니다.
- 대시보드·서버·실제 모델을 연결한 종단 간 검사는 미실행입니다. 확장 필터 기본 버전의 실제 DB 게시·활성화, 개발용 Jev API 키·사람 이름 분류의 정확도, 사람 등록·등록 코드 연결과 운영 장비의 시간 제한·메모리 적합성은 실행 환경에서 확인해야 합니다.
