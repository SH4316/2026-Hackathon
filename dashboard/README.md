# AI 보안 관제 대시보드 V2

사람별 AI 사용 프롬프트와 감지 구간을 조회하고, 사용자 정의 태그 트리로 과거 기록을 다시 해석하는 한국어 로컬 시연 앱입니다. Spring Boot API와 React 화면을 하나의 JAR로 배포합니다. 외부 감지기와 확장 프로그램은 변경하지 않습니다.

백엔드는 Java 21·Spring Boot 3.5.16·JDBC·Flyway, 화면은 React·TypeScript·Vite·Recharts, DB는 MySQL 8.4를 사용합니다. 인증 없이 로컬에서 사용하는 범위입니다. Docker 전체 실행에는 Docker Engine와 Compose v2가 필요하며, 호스트 Java·Node.js는 필요하지 않습니다. 직접 빌드할 때는 Java 21과 Node.js 24 LTS(24.15 이상, 검증 24.22.1) 또는 Node.js 22.22.2 이상을 사용합니다.

`backend/`는 API·SQL 집계·마이그레이션·SPA 제공, `frontend/`는 같은 출처의 `/api/v1` 호출, `dev/sql/`은 개발용 SQL 콜백을 담당합니다. API의 전체 입출력 계약은 [CONTRACT.md](CONTRACT.md)에 있습니다.

## 일반 실행: 빈 DB

이 문서의 명령은 `dashboard/`에서 실행합니다.

```bash
cp .env.example .env
docker compose up --build -d --wait
```

<http://127.0.0.1:8080>에 접속합니다. 처음에는 태그·정책·버전·사람·이벤트가 모두 비어 있습니다. `/settings/metrics`에서 초안을 만들고 태그와 정책을 편집한 뒤 게시·활성화합니다. 사람을 등록하고 활성 버전 ID로 이벤트를 전송하면 집계가 시작됩니다. `/swagger-ui.html`에서 API 문서와 예시를 확인할 수 있습니다.

일반 `compose.yaml`은 앱 `127.0.0.1:8080`, MySQL `127.0.0.1:3306`을 공개하고 `mysql-data`를 사용합니다. `.env`의 DB 계정은 MySQL 초기 계정과 백엔드에 함께 전달됩니다. 컨테이너의 DB 주소는 `mysql:3306`으로 고정되어 호스트 셸의 `DB_URL`에 영향받지 않습니다. `.env`는 Java 앱이 자동으로 읽지 않습니다. 초기화된 DB 계정은 `.env` 수정만으로 바뀌지 않습니다.

V1에서 V2로 올릴 때는 `V2__versioned_prompt_dashboard.sql`이 기존 사람·이벤트·감지 데이터를 **한 번 삭제**하고 새 스키마를 만듭니다. 이는 승인된 V2 데이터 초기화이며 V1 마이그레이션은 유지했습니다. Flyway 이력이 적용된 다음 시작부터는 데이터를 삭제하지 않습니다. 일반 시작 경로에는 시드 SQL이 없습니다.

`docker compose stop`은 정지, `docker compose up -d --wait`는 재시작입니다. `docker compose down`은 컨테이너를 제거하고 DB 볼륨을 보존합니다. `down -v`는 해당 구성의 DB 볼륨도 삭제합니다.

## 개발 실행: SQL 데모 데이터

개발용 `compose-dev.yml`은 [Compose 2.24.4 이상](https://docs.docker.com/reference/compose-file/merge/#replace-value)이 필요합니다. 앱 공개 IP·포트 설정을 유지하면서 일반 DB와 다른 `dev-mysql-data` 볼륨을 사용합니다. 두 구성은 동일한 앱·MySQL 포트를 사용하므로 전환할 때 실행 중인 구성을 먼저 내립니다. 아래 `down`은 일반 DB 볼륨을 지우지 않습니다.

```bash
docker compose down
docker compose -f compose-dev.yml up --build -d --wait
```

개발용 기본 앱 주소는 `0.0.0.0:8080`입니다. 브라우저에서는 `http://127.0.0.1:8080` 또는 호스트의 LAN IP를 사용합니다. `.env`의 `APP_BIND_IP`·`APP_PORT`를 바꾸거나 다음처럼 지정할 수 있습니다. 지정한 IP는 호스트에 할당되어 있어야 합니다.

```bash
APP_BIND_IP=192.168.0.20 APP_PORT=8081 \
  docker compose -f compose-dev.yml up --build -d --wait
```

개발 구성은 `./dev/sql`을 `/app/dev-sql:ro`로 마운트하고 `SPRING_FLYWAY_LOCATIONS=classpath:db/migration,filesystem:/app/dev-sql`을 설정합니다. Flyway가 스키마 마이그레이션을 완료한 뒤 `afterMigrate__demo.sql`을 실행합니다. 별도 초기화 컨테이너와 API 시드 요청은 없습니다. 이 디렉터리는 배포 JAR에 포함되지 않습니다.

개발 백엔드는 [`pull_policy: build`](https://docs.docker.com/reference/compose-file/services/#pull_policy)를 사용해 `up`마다 현재 소스로 이미지를 빌드합니다. 변경되지 않은 빌드 단계는 캐시를 재사용합니다. 따라서 `--build`를 생략해도 최신 SQL 콜백이 이전 이미지의 스키마와 섞이지 않습니다. `restart`는 이미지를 갱신하지 않으므로 코드 변경 후에는 `up`을 사용합니다.

`afterMigrate__demo.sql`에서 `Table 'ai_security_dashboard.config_versions' doesn't exist`가 발생하면, V2 마이그레이션이 없는 이전 이미지에 최신 개발 SQL이 마운트된 경우인지 먼저 확인합니다. 현재 소스로 다음 명령을 실행하면 DB 볼륨을 유지하면서 백엔드를 교체합니다.

```bash
docker compose -f compose-dev.yml up --build --force-recreate -d --wait backend
docker compose -f compose-dev.yml logs --tail=100 backend
```

로그에서 `Successfully validated 2 migrations`와 V2 적용 또는 현재 스키마 버전 `2`를 확인합니다. 이 오류를 해결하기 위해 `down -v`로 DB를 지우거나 Flyway 이력을 삭제할 필요는 없습니다. V1에서 올라오는 경우에는 앞서 설명한 V2의 일회성 데이터 초기화가 적용됩니다.

SQL은 게시 버전 `demo-v1`, `demo-v2`, 14개 원본 분류와 개인정보 하위 태그, 사용자 정의 정책 3종, 이름에 `데모`가 붙은 가상 사람 6명, 서울 기준 최근 완료된 30일의 이벤트를 만듭니다. V2는 같은 태그 ID를 기술정보·업무정보 묶음으로 재구성합니다. 각 분류의 하위 예시와 판단 지침을 포함하며 초안으로 복제한 뒤 모두 편집할 수 있습니다. 프롬프트는 합성 자료로 표시되고 이름·전화번호·이메일도 가상 값입니다. 시간대·날짜별 이벤트 수, 서비스, 정책, 감지 0건, 여러 태그를 가진 동일 구간과 같은 텍스트의 서로 다른 구간을 포함합니다.

고정 버전 ID와 날짜별 이벤트 ID를 사용합니다. 재시작 또는 SQL 재실행은 기존 버전·태그·정책·사람·이벤트를 덮어쓰지 않습니다. 활성 버전이 없을 때만 `demo-v1`을 활성화하므로 사용자가 고른 활성 버전을 보존합니다. 날짜가 바뀌면 최근 30일 중 없는 날짜의 샘플만 추가하며 오래된 이벤트를 삭제하지 않습니다. 직접 다시 적용하려면 개발 MySQL이 실행 중인 상태에서 다음 명령을 사용합니다.

```bash
python3 scripts/seed_demo.py
# SQL 확인만 하기
python3 scripts/seed_demo.py --print-sql
```

상태·로그·정지에도 같은 파일을 지정합니다. 일반 구성으로 돌아가려면 다음 명령을 사용합니다. 두 DB 볼륨은 각각 보존됩니다.

```bash
docker compose -f compose-dev.yml logs -f backend
docker compose -f compose-dev.yml down
docker compose up -d --wait
```

## 호스트 개발과 단일 JAR

MySQL을 먼저 준비합니다. `.env`를 준비한 뒤 `docker compose up -d --wait mysql`로 DB만 실행할 수 있습니다. `bootRun`은 프런트엔드 빌드를 요구하지 않습니다.

```bash
cd backend
./gradlew bootRun
```

다른 터미널에서 Vite를 실행합니다. 기본 API 프록시는 `127.0.0.1:8080`입니다. 분리된 백엔드가 다른 포트면 `VITE_API_PROXY_TARGET=http://127.0.0.1:8082 npm run dev`처럼 지정합니다.

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
```

호스트에서 개발 SQL도 실행하려면 Java 실행 환경에 `SPRING_FLYWAY_LOCATIONS="classpath:db/migration,filesystem:/절대경로/dashboard/dev/sql"`을 명시하고 별도의 개발 DB를 연결합니다. 이 설정을 생략하면 스키마만 적용됩니다.

```bash
cd backend
./gradlew bootJar
java -jar build/libs/ai-security-dashboard.jar
```

`bootJar`가 `npm ci`, 타입 검사, Vite 빌드, 정적 파일 JAR 포함을 수행합니다. 실행 시에는 Node.js 없이 Java 21과 MySQL 연결만 필요합니다. 기본 Java가 다르면 `JAVA_HOME`을 지정합니다.

| 변수 | 호스트 Java 기본값 / 용도 | Compose |
| --- | --- | --- |
| `DB_URL` | `jdbc:mysql://127.0.0.1:3306/ai_security_dashboard?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true` | 컨테이너 주소 `mysql:3306`으로 고정 |
| `DB_USERNAME` | `dashboard` | `.env`와 MySQL 초기 계정 공유 |
| `DB_PASSWORD` | `dashboard-local` | `.env`와 MySQL 초기 계정 공유 |
| `MYSQL_ROOT_PASSWORD` | MySQL 초기 root 암호 | 백엔드에 전달하지 않음 |
| `SERVER_ADDRESS` / `SERVER_PORT` | `127.0.0.1` / `8080` | `0.0.0.0` / `8080` |
| `SPRING_FLYWAY_LOCATIONS` | 기본 `classpath:db/migration` | 개발용에만 SQL 경로 추가 |
| `APP_BIND_IP` / `APP_PORT` | Java에 직접 적용하지 않음 | 개발 Compose의 호스트 공개 주소 |

## 데이터와 조회 기준

설정은 버전별 태그 트리와 정책 목록입니다. 태그에는 ID·이름·설명·예시·판단 지침·색·부모·순서가 있습니다. 초안만 편집·삭제할 수 있고 `revision`으로 동시 수정을 확인합니다. 게시는 내용을 고정하며 게시 버전 하나만 활성화할 수 있습니다. 태그와 정책의 ID는 복제한 버전에도 유지됩니다. 이름으로 코드나 의미를 추론하지 않습니다.

이벤트는 원문 프롬프트와 감지 구간을 저장합니다. 구간은 Unicode 코드 포인트의 `[start,end)`이며 JavaScript 문자열 인덱스와 이모지에서 차이가 날 수 있습니다. 같은 범위의 입력은 태그 합집합을 가진 감지 한 건으로 합칩니다. 서로 다른 겹치는 범위는 별개입니다. 감지 없는 이벤트도 유효합니다. 등록된 사람과 현재 활성 버전이 필요합니다. `(sourceId,eventId)`가 같은 동일 요청은 `200`, 새 이벤트는 `201`, 다른 내용의 재사용은 `409`입니다. 같은 요청 재전송은 나중에 활성 버전이 바뀌어도 기존 이벤트를 반환합니다.

`versionId` 필터는 **과거 전체 이벤트를 해석할 게시 버전**을 선택합니다. 수집 버전으로 이벤트를 제한하지 않습니다. 이력 상세에는 수집 당시의 태그·정책 이름이 유지됩니다. 선택한 트리에서 제거된 태그만 가진 구간은 미매핑으로 집계합니다. 태그 필터는 자신과 모든 하위 태그를 포함합니다. 여러 태그가 붙어도 감지 구간 한 개는 한 번만 셉니다. 부모 수치는 자식 수치의 합이 아니라 구간의 합집합입니다.

기본 기간은 서울 기준 최근 7개 날짜, 범위는 시작 포함·종료 제외입니다. 일별 버킷은 서울 날짜, 시간별 버킷은 UTC ISO 시각으로 응답하며 빈 버킷을 채웁니다. 최대 조회는 366일, 시간별 집계는 31일입니다. 프롬프트 `q`는 `%`·`_`도 그대로 찾는 부분 문자열 검색이고, 사람 이름·ID 검색은 별도 `personQuery`입니다. 정책 미수집 `null`은 정책 분포에서 제외합니다. 사람 목록은 등록된 사람을 유지하며 `personQuery`·`personId`만 목록 대상을 제한합니다. 기간·프롬프트·태그 등 이벤트 필터는 각 사람의 통계와 최근 시각에만 적용하므로 일치 이벤트가 없는 사람도 0건으로 표시됩니다.

저장한 검색은 저장 시점의 절대 기간·게시 버전·전체 일치 이벤트 ID를 고정합니다. 새 이벤트 수집이나 활성 버전 변경으로 바뀌지 않습니다. 다시 조회는 저장 필터를 이력으로 가져오는 동작이며 기존 스냅샷을 덮어쓰지 않습니다. 저장 검색 삭제는 원본 이벤트를 삭제하지 않습니다.

화면 경로는 `/`, `/events`, `/events/:id`, `/people`, `/people/:id`, `/settings/metrics`, `/settings/monitoring`, `/saved-searches`, `/saved-searches/:id`입니다. 자동 갱신 없이 진입·필터 변경·명시적 새로고침 때 조회합니다.

## API

[Swagger UI](http://127.0.0.1:8080/swagger-ui.html), [OpenAPI JSON](http://127.0.0.1:8080/v3/api-docs), [정확한 계약](CONTRACT.md)에서 예시와 응답을 확인할 수 있습니다. Swagger의 상대 서버 `/`는 현재 호스트와 포트를 사용합니다.

| API 경로 (`/api/v1`) | 역할 |
| --- | --- |
| `/config-versions`·`/{id}`·`/{id}/publish`·`/{id}/activate` | 초안 생성·편집·게시·활성화 |
| `/classifier-config` | 예시·지침을 포함한 활성 설정, 없으면 `404 NO_ACTIVE_VERSION` |
| `/people`·`/{id}` | 사람 등록과 필터별 통계 |
| `/events`·`/{id}` | 이벤트 등록·페이지·원문 상세 |
| `/metrics` | 요약·시계열·트리·미매핑·정책·서비스 집계 |
| `/saved-searches`·`/{id}`·`/{id}/events`·`/{id}/metrics` | 고정 검색 생성·조회·삭제 |

필터는 `from`, `to`, `versionId`, `service`, `personId`, `tagId`, `policyStateId`, `hasDetections`, `q`, `interval`, `unmapped`입니다. `tagId`와 `unmapped=true`는 함께 사용할 수 없습니다. 페이지는 0부터, 기본 크기 20·최대 100입니다. 이벤트의 `prompt`는 최대 200,000 코드 포인트, HTTP 본문은 1MiB, 감지는 최대 1,000개입니다. 오류는 한국어 `{code,message,fieldErrors?}`이며 원문 프롬프트와 스택을 포함하지 않습니다.

## 검증 재실행

```bash
cd frontend
npm test
npm run build
```

실제 DB 테스트에는 이름이 `_test`로 끝나는 전용 DB를 사용합니다. 테스트는 데이터를 변경하므로 시연 DB와 분리합니다.

```bash
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' <<'SQL'
CREATE DATABASE IF NOT EXISTS sending_test CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS sending_migration_test CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'sending_test'@'%' IDENTIFIED BY 'sending-test-local';
GRANT ALL ON sending_test.* TO 'sending_test'@'%';
GRANT ALL ON sending_migration_test.* TO 'sending_test'@'%';
SQL
cd backend
TEST_DB_URL='jdbc:mysql://127.0.0.1:3306/sending_test?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true' \
  TEST_MIGRATION_DB_URL='jdbc:mysql://127.0.0.1:3306/sending_migration_test?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true' \
  TEST_DB_USERNAME=sending_test TEST_DB_PASSWORD=sending-test-local ./gradlew test
```

`TEST_MIGRATION_DB_URL`은 비워도 되며, 지정하면 해당 폐기 가능한 `_test` DB를 초기화해 V1→V2 초기화와 이후 보존을 검증합니다. HTTP 검증도 별도 테스트 DB를 연결한 JAR를 포트 `8083` 등으로 실행한 뒤 진행합니다. 다음 스크립트는 게시 버전·사람·이벤트를 생성하고 스냅샷의 불변성, 버전 재해석, 동시 재전송, 이모지 구간, 오류 응답을 확인합니다.

```bash
python3 scripts/smoke_api.py --base-url http://127.0.0.1:8083 --report /tmp/api-smoke.json
python3 scripts/smoke_package.py --base-url http://127.0.0.1:8083 \
  --jar backend/build/libs/ai-security-dashboard.jar --report /tmp/package-smoke.json
```

브라우저 검증은 Playwright를 임시 경로에 설치한 뒤 실행할 수 있습니다. 개발 SQL을 적용한 **테스트 전용 DB**와 화면이 포함된 JAR에 연결합니다.

```bash
npm install --prefix /tmp/dashboard-browser-tools playwright
/tmp/dashboard-browser-tools/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/dashboard-browser-tools/node_modules/playwright/index.mjs \
  DASHBOARD_URL=http://127.0.0.1:8083 BROWSER_REPORT=/tmp/browser-smoke.json \
  node scripts/smoke_browser.mjs
```

자동 접근성·가로 넘침 검증은 `scripts/smoke_accessibility.mjs`로 실행할 수 있습니다. 별도 임시 경로에 `@axe-core/playwright`를 설치하고 `AXE_MODULE`을 해당 `dist/index.mjs` 경로로 지정합니다. 이 결과는 자동 검사 범위이며 수동 WCAG 전체 검증을 대신하지 않습니다.

실제 수행 결과와 실행하지 못한 범위는 [validation/README.md](validation/README.md)에 기록합니다. Compose 구성 검증과 실제 컨테이너 실행 검증을 구별합니다.
