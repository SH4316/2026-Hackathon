# AI 보안 관제 대시보드

외부 감지 시스템이 보내는 AI 서비스 사용 이벤트를 사람·정책 상태·감지 항목별로 조회하는 한국어 로컬 시연 앱입니다. Spring Boot API와 React 화면을 하나의 실행 JAR로 배포하며, MySQL에 사용자와 이벤트를 저장합니다. 기존 감지기와 브라우저 확장은 수정하지 않습니다.

## 구성과 실행 조건

Docker로 전체 앱을 실행할 때는 **Docker Engine와 Docker Compose v2만 필요**합니다. 호스트에 Java나 Node.js를 설치할 필요는 없습니다. 이미지 빌드가 Node.js 24에서 React 화면을 만들고 Java 21에서 Spring Boot JAR에 포함합니다.

- 백엔드: Java 21, Gradle Wrapper 8.14.3, Spring Boot 3.5.16, JPA, Flyway
- 프런트엔드: React·TypeScript·Vite·React Router·Recharts
- DB: MySQL 8.4
- 호스트에서 직접 빌드·개발할 때: Java 21, Node.js 24 LTS 24.15 이상 권장(검증: 24.22.1), 또는 22.22.2 이상인 Node 22와 npm
- 샘플 등록과 HTTP 검증 스크립트: Python 3.9 이상, 표준 라이브러리만 사용

`backend/`는 API, 집계, DB 마이그레이션과 정적 화면 제공을 담당합니다. `frontend/`는 같은 출처의 `/api/v1`을 호출합니다. Compose는 `backend`와 `mysql`을 실행하며, React 화면은 백엔드 JAR에서 제공하므로 별도 프런트엔드 컨테이너가 필요하지 않습니다. 개발 중에는 Vite가 `/api` 요청을 `127.0.0.1:8080`으로 프록시합니다.

인증이 없는 로컬 시연 범위이며 호스트에 공개하는 주소는 앱 `127.0.0.1:8080`, MySQL `127.0.0.1:3306`입니다. 클라우드 배포, 로그인·권한, 감지 엔진, 확장 프로그램 연동, 실제 정책 변경은 포함하지 않습니다.

## 빠른 시작: Docker로 전체 앱 실행

아래 명령은 모두 저장소의 `dashboard/` 디렉터리에서 시작합니다.

```bash
cp .env.example .env
docker compose up --build -d --wait
docker compose ps
```

브라우저에서 <http://127.0.0.1:8080>을 엽니다. Compose는 MySQL이 준비된 뒤 백엔드를 시작하고, `--wait`는 두 서비스의 상태 검사가 통과할 때까지 기다립니다. Flyway가 앱 시작 시 스키마를 적용합니다. 첫 실행 화면은 실제 DB의 빈 상태이며 샘플 데이터는 자동 삽입하지 않습니다.

`.env`는 Compose가 읽고, `DB_USERNAME`·`DB_PASSWORD`를 MySQL 초기 계정과 백엔드 연결에 함께 사용합니다. 백엔드의 DB 주소는 컨테이너 네트워크의 `mysql:3306`으로 고정됩니다. 호스트용 `DB_URL`을 셸에 지정해도 Compose 백엔드 연결은 바뀌지 않습니다. 백엔드는 컨테이너 안에서 `0.0.0.0:8080`을 수신하고 호스트 포트는 `127.0.0.1`에만 공개합니다. 이미 초기화된 MySQL 볼륨의 계정은 `.env` 수정만으로 바뀌지 않습니다.

샘플을 표시하려면 별도 터미널의 `dashboard/`에서 직접 실행합니다.

```bash
python3 scripts/seed_demo.py
```

이름에 **데모**가 붙은 사용자 4명과 서울 기준 최근 완료된 6일의 이벤트 48개를 등록합니다. 같은 날짜의 같은 이벤트는 재실행 시 중복 생성되지 않습니다. 원문 대화나 실제 민감정보는 포함하지 않습니다. 화면의 새로고침 버튼으로 반영합니다.

전체 앱을 멈추려면 `docker compose stop`, 다시 시작하려면 `docker compose up -d --wait`를 실행합니다. `docker compose down` 후에도 `mysql-data` 볼륨은 유지됩니다. **`docker compose down -v`는 DB 데이터도 삭제**하므로 초기화가 필요할 때만 사용합니다.

## 단일 JAR로 직접 실행

이 경로는 호스트에 Java 21과 위 조건의 Node.js·npm이 필요합니다. `.env`가 없으면 먼저 `cp .env.example .env`로 Compose 설정을 준비합니다. 이전에 Compose 전체 앱을 실행했다면 먼저 `backend` 컨테이너를 멈춰 호스트의 `8080` 포트를 비웁니다. MySQL만 Compose로 실행합니다.

```bash
docker compose stop backend
docker compose up -d --wait mysql
cd backend
./gradlew bootJar
java -jar build/libs/ai-security-dashboard.jar
```

Java 21이 기본 Java가 아니면 `JAVA_HOME`을 Java 21 설치 경로로 지정합니다. `bootJar`는 `npm ci`, 프런트엔드 타입 검사·빌드, 프런트엔드 JAR 포함 작업을 수행합니다. 생성한 JAR는 Java 21과 연결 가능한 MySQL이 있는 곳에서 실행할 수 있으며 실행 시 Node.js는 필요하지 않습니다. 접속 주소는 <http://127.0.0.1:8080>입니다.

## 개발 실행

호스트에 Java 21과 위 조건의 Node.js·npm이 필요합니다. `.env`가 없으면 먼저 `cp .env.example .env`로 Compose 설정을 준비합니다. 첫 터미널의 `dashboard/`에서 Compose 백엔드를 멈추고 MySQL을 준비한 뒤 로컬 백엔드를 실행합니다. `bootRun`은 프런트엔드 빌드를 요구하지 않습니다.

```bash
docker compose stop backend
docker compose up -d --wait mysql
cd backend
./gradlew bootRun
```

두 번째 터미널의 `dashboard/`에서 개발 화면을 실행합니다.

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
```

Vite가 출력한 로컬 URL에 접속합니다. 직접 실행하는 앱은 `.env` 파일을 자동으로 읽지 않습니다. DB 연결을 바꾸려면 앱을 실행하는 셸에 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`를 지정합니다. `.env`의 MySQL 자격 증명을 바꾸면 로컬 앱 실행 환경도 같은 값으로 맞춰야 합니다. MySQL의 호스트 공개 포트를 바꾸면 로컬 앱의 `DB_URL`도 맞춰야 합니다.

| 변수 | 호스트에서 직접 실행할 때의 기본값 / 용도 | Compose 백엔드 |
| --- | --- | --- |
| `DB_URL` | `jdbc:mysql://127.0.0.1:3306/ai_security_dashboard?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true` | 같은 DB·옵션을 `mysql:3306`으로 연결 |
| `DB_USERNAME` | `dashboard` | `.env`의 값, MySQL 초기 계정과 공유 |
| `DB_PASSWORD` | `dashboard-local` (로컬 시연용) | `.env`의 값, MySQL 초기 계정과 공유 |
| `MYSQL_ROOT_PASSWORD` | `.env`에서 설정하는 MySQL 초기 root 암호 | 백엔드에는 전달하지 않음 |
| `SERVER_PORT` | `8080` | `8080` |
| `SERVER_ADDRESS` | `127.0.0.1` | `0.0.0.0` (호스트 공개는 `127.0.0.1`) |

## 화면과 집계 기준

화면 경로는 전체 현황 `/`, 탐지 이력 `/events`, 이력 상세 `/events/:id`, 사람 관리 `/people`, 개인 상세 `/people/:id`, 감시 설정 `/settings/monitoring`입니다.

- **이벤트 수**는 중복 없는 이벤트 건수입니다. 한 이벤트가 여러 감지 항목을 포함해도 한 건입니다.
- **감지 수**는 `findings[].quantity`의 합입니다. 항목 필터를 선택하면 해당 항목을 포함한 이벤트만 조회하고, 감지 수도 선택한 항목의 수량만 합산합니다.
- **정책 미확인 수**는 명시적으로 `UNKNOWN`인 이벤트 수입니다. 정책 필드가 없는 `null`은 미확인 KPI와 정책 차트 모두에서 제외됩니다. 정책 미수집 상태는 상세에서 별도로 구별합니다.
- 사람 목록에는 등록만 되었고 일치하는 이벤트가 없는 사람도 포함합니다. 각 사람의 통계와 최근 발생 시각은 현재 이벤트 필터를 따릅니다.
- 서비스 `chatgpt`, `claude`, `gemini` 외에도 소문자 영문·숫자·`-`·`_`로 된 1~64자 슬러그를 지원합니다. 서비스 값은 소문자로 정규화합니다.
- API 시각은 UTC ISO-8601로 반환하며, 화면 표시와 일별 버킷은 `Asia/Seoul` 기준입니다. 기본 조회는 서울 기준 6일 전 00시부터 내일 00시까지인 7개 날짜입니다.
- 기간은 **시작 포함, 종료 제외 `[from,to)`**입니다. API의 날짜 필터에는 `Z` 또는 `+09:00` 같은 시간대 오프셋이 필요합니다. 조회 기간은 최대 366일입니다.
- 데이터는 화면 진입·필터 변경·명시적 새로고침 시 조회하며 자동 주기 갱신은 하지 않습니다. 감시 설정 입력과 저장은 비활성입니다.

## API

기본 경로는 `/api/v1`이며 요청과 응답은 JSON camelCase입니다. 자세한 응답 구조는 [CONTRACT.md](CONTRACT.md)에 있습니다.

| 메서드와 경로 | 용도 |
| --- | --- |
| `GET /health` | 로컬 실행 상태 `{ "status": "UP" }` |
| `POST /people` | 사용자 등록, 성공 `201`, 중복 ID `409` |
| `GET /people` | 이름/ID 검색 `q`, 필터 및 페이지 조회 |
| `GET /people/{id}` | 사용자와 필터 기준 통계 |
| `POST /events` | 집계 가능한 이벤트 등록 |
| `GET /events` | 최신 발생 시각 우선 이벤트 페이지 |
| `GET /events/{id}` | 이벤트 상세 |
| `GET /metrics` | 요약·일별·항목별·정책별·서비스별 집계 |

사용자를 먼저 등록한 뒤 이벤트를 보냅니다. 예시 시각은 실행 시점보다 과거로 지정합니다.

```bash
curl -sS http://127.0.0.1:8080/api/v1/people \
  -H 'Content-Type: application/json' \
  -d '{"id":"demo-api-person","name":"데모 API 사용자"}'

curl -sS http://127.0.0.1:8080/api/v1/events \
  -H 'Content-Type: application/json' \
  -d '{
    "sourceId":"demo-api",
    "eventId":"demo-event-001",
    "personId":"demo-api-person",
    "occurredAt":"2026-10-29T02:30:00Z",
    "service":"chatgpt",
    "model":"demo-model",
    "policyState":"TRAINING_DISABLED",
    "findings":[
      {"category":"PERSONAL_DATA","quantity":2},
      {"category":"CREDENTIAL","quantity":1}
    ]
  }'

curl -sS --get http://127.0.0.1:8080/api/v1/events \
  --data-urlencode 'from=2026-10-29T00:00:00+09:00' \
  --data-urlencode 'to=2026-10-30T00:00:00+09:00' \
  --data-urlencode 'category=CREDENTIAL' \
  --data-urlencode 'personId=demo-api-person' \
  --data-urlencode 'page=0' --data-urlencode 'size=20'
```

공통 이벤트 필터는 `from`, `to`, `service`, `personId`, `category`, `policyState`입니다. 빈 값은 생략합니다. 페이지 번호는 0부터 시작하며 기본 크기는 20, 최대 100입니다. 사람 목록의 `q`는 이름 또는 ID에 대한 리터럴 검색입니다.

`category`는 `PERSONAL_DATA`, `CREDENTIAL`, `CONFIDENTIAL`, `policyState`는 `TRAINING_ALLOWED`, `TRAINING_DISABLED`, `UNKNOWN`을 받습니다. 감지 항목은 항목당 한 번, 최대 3종류이며 수량은 정수 1~1,000,000입니다. 감지 항목이 없더라도 정책 상태가 있으면 이벤트를 등록할 수 있습니다. 정책과 감지 항목 모두 없으면 `400`입니다.

`(sourceId,eventId)`는 DB 고유 키입니다. 같은 내용의 재전송은 `200`과 기존 이벤트를, 다른 내용의 재사용은 `409`를 반환합니다. 항목 순서·서비스 대소문자·동일 시각의 오프셋 표현은 정규화하여 비교합니다. 저장 시각 정밀도는 마이크로초이며 `receivedAt`은 중복 비교에서 제외됩니다. 미등록 사용자는 `422`, 5분 넘는 미래 시각과 잘못된 값은 `400`, 없는 상세는 `404`입니다.

원문 프롬프트, 비밀 값 등 정의하지 않은 필드는 거절합니다. 오류는 한국어 `code`, `message`, 선택적 `fieldErrors`로 반환하며 요청 원문과 스택 추적을 응답에 담지 않습니다. 이 앱의 수량은 외부 감지 결과를 나타내며 별도 위험 임계값이나 위험 점수를 계산하지 않습니다.

## 검증

프런트엔드의 비시각 로직과 빌드를 확인합니다.

```bash
cd frontend
npm test
npm run build
```

실제 MySQL 통합 검증에는 운영·시연용 DB와 분리된 이름이 `_test`로 끝나는 DB가 필요합니다. 기본 테스트에서 실제 DB가 필요한 검증은 환경 변수가 없으면 건너뜁니다. 아래는 Compose MySQL에 전용 DB와 계정을 만드는 예입니다.

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' <<'SQL'
CREATE DATABASE IF NOT EXISTS ai_security_dashboard_test CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'dashboard_test'@'%' IDENTIFIED BY 'dashboard-test-local';
GRANT ALL ON ai_security_dashboard_test.* TO 'dashboard_test'@'%';
SQL

cd backend
TEST_DB_URL='jdbc:mysql://127.0.0.1:3306/ai_security_dashboard_test?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true' \
TEST_DB_USERNAME=dashboard_test TEST_DB_PASSWORD=dashboard-test-local \
./gradlew test
```

HTTP 경계까지 검증하려면 전용 테스트 DB를 사용하는 앱을 별도 포트로 실행한 뒤 스크립트를 호출합니다. HTTP 스크립트는 이름에 `데모 검증`을 붙인 사용자와 고유 이벤트를 추가하고 삭제하지 않습니다.

```bash
cd backend
DB_URL='jdbc:mysql://127.0.0.1:3306/ai_security_dashboard_test?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true' \
DB_USERNAME=dashboard_test DB_PASSWORD=dashboard-test-local SERVER_PORT=8081 \
java -jar build/libs/ai-security-dashboard.jar
```

```bash
python3 scripts/smoke_api.py --base-url http://127.0.0.1:8081 --report /tmp/dashboard-api-smoke.json
```

스크립트는 12개 동시 중복 등록, 재전송 충돌, 사용자·이력 상세, 페이지 순서, 검색, 항목·서비스·정책 필터 집계, 서울 일별 구간, 종료 시각 제외, 빈 일별 버킷, 잘못된 입력과 응답 오류 형식을 검증합니다. 실제 수행한 환경과 결과는 [validation/README.md](validation/README.md)에 기록합니다. 전체 앱 Compose 추가 작업의 설정·빌드 검증 범위와 컨테이너 실행 제약은 [validation/compose-backend.md](validation/compose-backend.md)에 별도로 기록합니다.

JAR의 프런트엔드 포함 여부, 직접 URL 진입과 없는 리소스의 404 응답도 별도로 확인할 수 있습니다.

```bash
python3 scripts/smoke_package.py --base-url http://127.0.0.1:8081 \
  --jar backend/build/libs/ai-security-dashboard.jar --report /tmp/dashboard-package-smoke.json
```

브라우저 기능 검증은 선택적으로 Playwright를 별도 임시 디렉터리에 설치하여 실행합니다. 테스트 DB를 사용하는 **화면이 포함된 JAR**에 연결해야 하며, 이름이 `데모 UI 검증`인 사용자를 추가합니다.

```bash
npm install --prefix /tmp/dashboard-browser-tools playwright
/tmp/dashboard-browser-tools/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/dashboard-browser-tools/node_modules/playwright/index.mjs \
DASHBOARD_URL=http://127.0.0.1:8081 BROWSER_REPORT=/tmp/dashboard-browser-smoke.json \
node scripts/smoke_browser.mjs
```

화면 진입, 새로고침, 항목→이력→상세→개인 이동, 필터와 빈 상태, 사람 등록·중복 오류·검색, 비활성 설정, 네트워크 오류 재시도와 모바일 내비게이션을 확인합니다.
