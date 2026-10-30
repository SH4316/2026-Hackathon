# 전체 앱 Compose 검증 기록

검증일: 2026-10-30 UTC. 이 기록은 `backend` 서비스를 추가한 Compose 구성과 다단계 Dockerfile의 검증 범위입니다. 기존 API·화면·DB 검증 이력은 [README.md](README.md)에 있으며, 그 결과를 컨테이너 실행 검증으로 간주하지 않습니다.

## 실제 실행한 확인

Docker Compose 2.39.4로 다음 설정 해석이 통과했습니다. 실제 `.env` 파일을 만들거나 수정하지 않고 예제 파일을 명시했습니다.

```bash
/tmp/dashboard-runtime/bin/docker-compose \
  --env-file dashboard/.env.example -f dashboard/compose.yaml config --format json
```

위 JSON은 프로세스 안에서 파싱했으며 자격 증명 값은 출력하지 않았습니다. 예제 환경과 임시 셸 환경 변수로 계정을 바꾼 환경 모두에서 다음을 확인했습니다.

- 서비스가 `backend`, `mysql` 두 개이고 빌드 문맥이 `dashboard/`입니다.
- 앱의 DB 사용자·암호와 MySQL 초기 사용자·암호가 일치합니다. root 암호는 백엔드 환경에 전달하지 않습니다.
- 셸의 `DB_URL`, `SERVER_ADDRESS`, `SERVER_PORT`를 다른 값으로 지정해도 앱은 `mysql:3306`에 연결하고 컨테이너의 `0.0.0.0:8080`을 수신하도록 해석됩니다.
- 호스트 공개 주소는 앱 `127.0.0.1:8080`, MySQL `127.0.0.1:3306`입니다. 백엔드는 MySQL의 `service_healthy` 조건에 의존하고 DB 데이터는 이름 있는 `mysql-data` 볼륨에 저장합니다.
- MySQL 상태 검사의 암호 참조는 Compose 호스트가 아닌 컨테이너 환경에서 확장되도록 보존됩니다.

별도 `/tmp/dashboard-compose-graph-review-*` 디렉터리에 백엔드 소스만 복사하고 Java 21.0.12.1·Gradle Wrapper 8.14.3으로 다음 작업 그래프를 확인했습니다.

```bash
./gradlew --no-daemon --offline bootJar -x frontendBuild --dry-run
```

`bundleFrontend`와 `bootJar`가 남고 `frontendBuild`와 그 의존 작업인 `frontendInstall`은 모두 제외되었습니다. 따라서 이미 생성된 `frontend/dist`를 복사하는 JDK 빌드 단계는 npm을 호출하지 않습니다.

Docker 없이도 빌드 단계의 명령과 산출물을 확인하기 위해 별도 임시 디렉터리에서 다음을 실행했습니다.

1. Node.js 24.22.1로 깨끗한 프런트엔드 소스에서 `npm ci --no-audit --no-fund`, `npm run build`가 통과했습니다.
2. Java 21로 `./gradlew --no-daemon bootJar -x frontendBuild`가 통과했습니다.
3. JDK 단계와 같은 별도 디렉터리에 백엔드 소스와 형제 경로 `frontend/dist`만 두고 같은 Gradle 명령을 다시 실행해 통과했습니다. 이 경로에는 프런트엔드 소스·`package.json`·`node_modules`가 없고, `node`나 `npm`을 호출하면 실패하는 임시 명령을 PATH 앞에 두었습니다.
4. 생성된 JAR의 `BOOT-INF/classes/static`에서 프런트엔드 산출물 127개를 모두 원본과 바이트 단위로 비교해 일치했습니다. JAR 중복 경로가 없고 `application.yml`과 Flyway 초기 마이그레이션도 포함됨을 확인했습니다. 별도 검토에서도 127개 파일 일치와 위 항목을 다시 확인했으며 애플리케이션 클래스 버전은 Java 21인 65였습니다.

위 과정은 호스트의 Node·JDK를 사용한 빌드 재현이며, 컨테이너 이미지 빌드 성공을 의미하지 않습니다.

## Dockerfile·빌드 문맥 검토

- Node 24 단계가 잠금 파일로 프런트엔드를 설치하고 타입 검사·Vite 빌드를 실행합니다. 프로젝트가 선언한 Node 24 최소 버전은 24.15.0입니다.
- Java 21 JDK 단계가 Gradle Wrapper로 JAR를 생성합니다. 프런트엔드 산출물의 경로 `/build/frontend/dist`는 `build.gradle`의 `../frontend/dist`와 일치하며 `bundleFrontend`가 `BOOT-INF/classes/static`에 포함합니다.
- 최종 Java 21 JRE 단계는 UID/GID 10001 사용자로 실행하고 JAR 소유권도 해당 사용자에게 지정합니다. 앱 디렉터리와 JAR에 대한 읽기·탐색 권한, JVM의 기본 임시 디렉터리 사용에 모순이 없는지 검토했습니다.
- 이미지의 HTTP 상태 검사는 `127.0.0.1:8080/api/v1/health`를 호출합니다. 이미지 빌드 중 `curl` 존재 여부도 검사합니다.
- `.dockerignore`는 빌드에 필요한 소스·매니페스트를 허용하고 `.env`, 중첩된 환경 파일·npm/Gradle 로컬 설정·키 파일, `.git`, `node_modules`, `build`, `dist`, 로그와 검증 산출물을 제외하도록 작성했습니다. 패턴은 정적으로 검토했으며 Docker가 실제 전송한 빌드 문맥의 tar 내용은 확인하지 못했습니다.

## 실행 환경의 제한

이 환경에는 Docker Engine·Docker CLI와 Docker 소켓이 없습니다. 현재 프로세스는 UID 1000, `CapEff=0`, `NoNewPrivs=1`이며 `unshare --user --map-root-user true`도 `Operation not permitted`로 실패했습니다. 따라서 **실제 Docker 이미지 빌드, Compose 컨테이너 기동, 이미지 안의 HTTP 상태 검사와 볼륨 재시작은 검증하지 못했습니다**. Compose 설정 해석, 작업 그래프와 정적 검토가 통과한 사실과 구별합니다.

기존 시연 앱 `127.0.0.1:8080`과 기존 MySQL `127.0.0.1:33306`은 이 검증에서 변경하거나 재시작하지 않았습니다. Docker 실행이 가능한 환경의 최종 확인 명령은 `dashboard/`에서 `cp .env.example .env` 후 `docker compose up --build -d --wait`입니다.
