# AI 보안 관제 대시보드 V2

사람별 AI 사용 프롬프트와 감지 구간을 조회하고, 사용자 정의 태그 트리로 과거 기록을 다시 해석하며 검사 서버를 관리하는 한국어 로컬 시연 앱입니다. Spring Boot API와 React 화면을 하나의 JAR로 배포합니다. 검사·정제는 `server/`가 수행하고 확장프로그램·ai-proxy가 전송 전에 호출합니다.

백엔드는 Java 21·Spring Boot 3.5.16·JDBC·Flyway, 화면은 React·TypeScript·Vite·Recharts, DB는 MySQL 8.4를 사용합니다. 인증 없이 로컬에서 사용하는 범위입니다. Docker 전체 실행에는 Docker Engine와 Compose v2가 필요하며, 호스트 Java·Node.js는 필요하지 않습니다. 직접 빌드할 때는 Java 21과 Node.js 24 LTS(24.15 이상, 검증 24.22.1) 또는 Node.js 22.22.2 이상을 사용합니다.

`backend/`는 API·SQL 집계·마이그레이션·SPA 제공, `frontend/`는 같은 출처의 `/api/v1` 호출, `dev/sql/`은 개발용 SQL 콜백을 담당합니다. API의 전체 입출력 계약은 [CONTRACT.md](CONTRACT.md)에 있습니다.

백엔드 코드는 `com.example.securitydashboard` 아래 기능·역할별 패키지로 나눕니다. 루트의 `DashboardApplication`은 실행과 컴포넌트 검색을 담당합니다. 업무 기능은 HTTP 컨트롤러 → 서비스 → 저장소 → MySQL로 이어집니다. 컨트롤러는 요청·응답과 HTTP 상태를, 서비스는 업무 검증·처리 순서·트랜잭션을, 저장소는 SQL·JDBC 호출·행 매핑을 담당합니다. 컨트롤러는 저장소를 직접 호출하지 않고, 서비스에는 SQL을 두지 않으며, 저장소는 서비스나 컨트롤러에 의존하지 않습니다.

| 패키지 | 책임 |
| --- | --- |
| `api` | 공통 페이지 응답 `api.model.Page<T>` |
| `configuration` | 태그·정책·Jev 설정, 초안·게시·활성화와 버전 조회 |
| `person` | 사람 등록과 사람별 조회 연결 |
| `event` | 프롬프트·탐지 저장, 재전송 검증과 원자적 수집 |
| `detector` | 탐지기 계약 검증·구간 변환·이미지 디코딩, 원본 메타데이터 수집·조회 |
| `query` | 검색 조건·페이지 해석, SQL 조회·집계와 스냅샷 멤버십 수집 |
| `savedsearch` | 검색 조건과 결과 멤버십을 고정하는 저장 검색 |
| `common` | 공통 입력 검증·안전한 오류와 JDBC 행 처리 |
| `guard` | 검사 서버 관리 프록시·관리 키 보관, 태그 정규식 저장 전 원격 검증 |
| `web` | 본문 제한·오류 응답, JSON·OpenAPI 설정, 상태 확인과 SPA 경로 |

API 입출력 모델은 `person.model`, `configuration.model`, `event.model`, `detector.model`, `query.model`, `savedsearch.model`에 두고, 공통 페이지 응답만 `api.model`에서 공유합니다. 모든 Java `record`는 타입과 같은 이름의 파일로 분리합니다. SQL 조건을 담는 `DashboardQuery`, 행 매핑 결과 `DetectionRow`, 잠금 결과 `VersionState` 같은 내부 모델도 개별 파일로 두며 필요한 범위에서만 공개합니다.

설정의 `ConfigurationService`는 버전 검증과 초안·게시·활성화 전환을 조정하고 `ConfigurationRepository`가 카탈로그와 버전을 읽고 씁니다. 사람 등록은 `person`의 `PersonController` → `PersonService` → `PersonRepository`가 처리합니다. 사람별 통계 조회는 `PersonService`에서 `DashboardQueryService`로 위임합니다.

탐지기 수집은 `DetectorEventNormalizer`가 검증·변환한 결과를 `DetectorEventService`가 `EventService`에 전달하는 흐름입니다. `EventService`는 재전송과 활성 버전·등록 대상을 검증하고 `EventRepository`로 이벤트를 저장합니다. `DetectorEventRepository`의 원본 결과·첨부 저장도 같은 이벤트 트랜잭션에 참여합니다.

`DashboardQueryService`는 조회 버전을 확정하고 탐지·태그 조립, 정책 목록 병합, 시간 버킷 계산을 담당합니다. `DashboardRepository`는 필터 SQL과 조회·집계·전체 일치 이벤트의 멤버십 저장을 담당합니다. 저장 검색은 `SavedSearchService`의 트랜잭션에서 `SavedSearchRepository`로 필터와 고정 집계를 저장하고 `DashboardQueryService.captureSnapshotMembers`를 통해 멤버십을 수집합니다.

## 일반 실행: 빈 DB

이 문서의 명령은 `dashboard/`에서 실행합니다.

```bash
cp .env.example .env
docker compose up --build -d --wait
```

<http://127.0.0.1:8080>에 접속합니다. 처음에는 태그·정책·버전·사람·이벤트가 모두 비어 있습니다. `/settings/metrics`에서 초안을 만들고 태그와 정책을 편집한 뒤 게시·활성화합니다. 사람을 등록하고 활성 버전 ID로 이벤트를 전송하면 집계가 시작됩니다. `/swagger-ui.html`에서 API 문서와 예시를 확인할 수 있습니다.

일반 `compose.yaml`은 앱 `127.0.0.1:8080`, MySQL `127.0.0.1:3306`을 공개하고 `mysql-data`를 사용합니다. `.env`의 DB 계정은 MySQL 초기 계정과 백엔드에 함께 전달됩니다. 컨테이너의 DB 주소는 `mysql:3306`으로 고정되어 호스트 셸의 `DB_URL`에 영향받지 않습니다. `.env`는 Java 앱이 자동으로 읽지 않습니다. 초기화된 DB 계정은 `.env` 수정만으로 바뀌지 않습니다.

> **경고:** 대시보드에는 인증이 없습니다. `GUARD_*`를 설정하면 백엔드가 보관한 관리 키로 `/api/v1/guard/**`에서 검사 서버 설정·규칙·사용자 연결을 변경할 수 있습니다. 루트 `compose.yml`과 대시보드 개발 `compose-dev.yml`은 기본 `0.0.0.0` 바인딩이므로 접근 가능한 다른 호스트도 대시보드와 관리 프록시를 사용할 수 있습니다. 루트·개발 구성의 `APP_BIND_IP=127.0.0.1` 또는 외부 인증·접근 제한을 적용하세요. 일반 `dashboard/compose.yaml`의 루프백 바인딩과 구분해야 합니다.

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

로그에서 `Successfully validated 12 migrations`와 V2~V12 적용 또는 현재 스키마 버전 `12`를 확인합니다. V3는 탐지 결과 메타데이터·파일 이름·이미지 원본 바이트를 보관하는 테이블을 추가하고 기존 데이터를 보존합니다. V4는 태그별 Jev 판단 프롬프트, V5는 Python 정규식 저장 필드를 추가하며 기존 태그의 값은 각각 빈 문자열입니다. V6는 감지 태그에 수집 시점의 이름·색을 보관하고, 기존 감지에는 해당 수집 버전의 이름·색을 채워 이력을 유지합니다. V7은 기존 태그의 비어 있지 않은 Jev 프롬프트를 독립 설정으로 옮기고 태그 임계값을 `null`로 초기화하며, 태그·이벤트·정책을 보존합니다. V8은 태그와 독립 Jev 판단에 `enabled`를 추가하고 기존 값을 모두 `true`로 보존하며 이벤트·저장 검색을 유지합니다. V9·V10은 연결·설정·등록 코드 저장소를 추가하고, V11은 `security_events.send_action`을 nullable로 추가해 기존 기록을 보존하며, V12는 정책 상태 매핑을 추가합니다. 이 오류를 해결하기 위해 `down -v`로 DB를 지우거나 Flyway 이력을 삭제할 필요는 없습니다. V1에서 올라오는 경우에는 앞서 설명한 V2의 일회성 데이터 초기화가 적용됩니다.

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
| `GUARD_SERVER_URL` | 기본 빈 값. 검사 서버 주소(예: `http://127.0.0.1:8000`) | 루트 Compose는 `http://server:8000` 고정. 대시보드 전용 Compose에는 전달 설정이 없어 별도 주입 필요 |
| `GUARD_ADMIN_KEY` | 기본 빈 값. 서버 `PG_ADMIN_KEYS` 중 첫 관리 키 | 루트 Compose는 `PG_ADMIN_KEYS`를 이 변수로 전달하고 백엔드가 첫 키 사용. 대시보드 전용 Compose는 별도 주입 필요 |

### 검사 서버 관리

`/settings/guard`는 **상태·사용자 규칙·Jev 판단 기준·조직 설정·사용자 연결** 탭으로 구성됩니다. 상태에서 모델 모드·모듈 사용 여부를 저장하고 모델 연결·준비·비활성, 조직 설정과 건너뛴 정규식을 확인합니다. 사용자 키워드·정규식과 서버 Jev 기준은 저장·삭제·시험할 수 있고, 조직 설정에서 원문 기록 방식·태그 조치·`tag_map`·`policy_state_map`을 편집합니다. 사용자 연결에서 등록 코드 발급·이름 변경·해지를 수행합니다. 조직 트리의 독립 Jev 프롬프트는 기존 `/settings/jev`에서 관리하며 서버 Jev 기준(내부 `context_detectors`)과 별개입니다.

브라우저는 같은 출처의 `/api/v1/guard/**`만 호출합니다. 백엔드가 `GUARD_ADMIN_KEY`를 `X-Admin-Key`로 붙여 `/v1/admin/**`에 메서드·본문·쿼리·`If-Match`를 전달하고 응답 상태·`ETag`를 돌려줍니다. 키는 브라우저 응답·로그에 노출하지 않습니다. 경로는 `ruleset`, `ruleset/history`, `modules`, `custom-rules`, `custom-rules/test`, `context-detectors`, `context-detectors/test`, `prompt`, `org/settings`, `org/status`, `org/refresh`, `org/regex/check`, `runtime`, `enrollments`, `clients`, `audit/events`, `audit/summary`와 허용된 규칙·Jev·클라이언트 ID 하위 경로로 제한합니다. 서버 주소·키 미설정 또는 연결 실패는 한국어 503 `GUARD_UNAVAILABLE`입니다.

런타임 모델 모드·ruleset은 대시보드에서 저장하며 env·YAML은 초기값입니다. 모델 BASE_URL 또는 NAME 미설정은 `endpoint_unset`으로 표시되고 호출을 생략합니다. 원문 기록 기본값은 `full`이며 `masked`·`off`도 선택할 수 있습니다. `policy_state_map`은 판정 `allow`·`warn`·`block` → 활성 버전의 정책 상태 ID를 명시적으로 연결하고 기본은 모두 null입니다.

## 데이터와 조회 기준

설정은 버전별 태그 트리·정책 목록·독립적인 Jev 프롬프트 목록입니다. 태그에는 ID·이름·사용 여부(`enabled`)·설명·예시·판단 참고사항·Jev 임계값·Python 정규식·색·부모·순서가 있습니다. 태그 추가·삭제·부모·순서와 버전 이름·정책 목록은 초안에서 편집하며, 게시하면 고정됩니다. 태그의 사용 여부·이름·색·설명·예시·판단 참고사항·Jev 임계값·Python 정규식과 독립 Jev 설정은 게시 후에도 편집할 수 있습니다. 게시 버전 하나만 활성화할 수 있고 `revision`으로 동시 수정을 확인합니다. 태그와 정책의 ID는 복제한 버전에도 유지되지만, 세부 정보 수정은 **현재 선택한 버전의 해당 태그에만** 적용됩니다. 같은 ID를 가진 다른 버전의 태그는 바뀌지 않습니다. 이름으로 코드나 의미를 추론하지 않습니다.

태그 편집 영역의 **세부 정보 저장**은 선택한 태그만 저장하고, 다른 태그나 트리·정책의 미저장 변경은 화면에 유지합니다. 새로 추가한 태그는 먼저 **초안 저장**으로 트리에 저장한 뒤 세부 정보만 저장할 수 있습니다. **초안 저장**은 태그 세부 정보를 포함한 초안 전체를 저장하며, 두 저장 방식 모두 최신 버전 `revision`을 사용합니다. 충돌 시 입력은 유지되므로 다른 창의 변경을 확인한 뒤 다시 편집할 수 있습니다.

사이드바의 **Jev 설정**(`/settings/jev`)에서 선택한 버전의 프롬프트를 만들고 이름·판단 프롬프트·출력 태그를 편집합니다. 프롬프트는 API의 `jevPrompts[]`에 독립적으로 저장하며, 한 프롬프트가 태그 트리의 여러 기존 태그를 출력할 수 있습니다. 새 출력 태그가 필요하면 메트릭 설정에서 초안 트리에 먼저 저장합니다. 새 프롬프트 생성은 버전당 100개까지 허용하며, 마이그레이션으로 그 수를 넘는 기존 설정도 보존하고 조회·편집·복제할 수 있습니다. 최대 12,000 Unicode 코드 포인트이며 이모지 하나는 한 글자로 셉니다. 줄바꿈과 앞뒤 공백을 그대로 보존하고 `guidance`는 별도 맥락 필드로 유지합니다.

각 출력 태그의 **Jev 임계값**은 `tags[].jevThreshold`로 저장하며 메트릭 설정에서도 편집할 수 있습니다. 0 이상 1 이하, 소수점 여섯 자리까지 허용하고 비우면 `null`(미설정)입니다. `0`은 유효한 설정값이며 자동 기본값이나 부모 상속은 없습니다. 여러 프롬프트가 같은 태그를 출력하면 해당 버전의 태그 임계값을 공유합니다. 연결된 탐지기는 임계값이 설정된 태그에 대해 `점수 >= 임계값`을 판정 기준으로 사용할 수 있습니다. Jev 저장은 프롬프트·출력 연결·선택한 태그 임계값을 한 번에 반영합니다. 출력 선택 해제나 프롬프트 삭제는 태그와 임계값을 보존합니다. 초안 트리에서 태그를 삭제하면 해당 출력 연결만 제거합니다. 복제 시 프롬프트·연결·임계값을 함께 복사하며 이후 버전별로 독립적으로 편집합니다.

V7은 기존 태그의 비어 있지 않은 `jev_prompt`를 원문 그대로 독립 프롬프트로 옮겨 원래 태그에 연결합니다. 공백·탭·줄바꿈만 있는 기존 값도 원문을 보존하며, 길이가 0인 빈 값은 프롬프트를 만들지 않고 임계값은 모두 미설정으로 둡니다. 이전 DB 열은 이력으로 남지만 `tags[].jevPrompt`는 API에서 제거되어 해당 입력은 거부합니다.

`/settings/metrics`의 **Python 정규식**은 태그별 `pythonRegex`로 저장하며 최대 4,000 Unicode 코드 포인트입니다. Python `re` 문법의 역슬래시·인라인 플래그·이름 있는 그룹·줄바꿈을 그대로 보존합니다. 예를 들어 `(?i)\b(?P<label>internal|confidential)\b`를 입력할 수 있습니다. JSON에서는 역슬래시를 `\\`로 인코딩합니다. 비워 두면 빈 문자열이며 상위 태그에서 자동으로 상속하지 않습니다. Jev 프롬프트와 독립적으로 편집·복제·게시합니다. 대시보드는 패턴을 직접 실행하지 않으며 검사 서버의 Python 검증 결과를 사용합니다.

검사 서버 URL이 설정돼 있으면 **초안 저장·태그 세부 저장 전에 저장값과 달라진 비어 있지 않은 정규식만** `/v1/admin/org/regex/check`로 검증합니다. 길이 초과·중첩 수량자·문법 오류·빈 문자열 일치는 400 `INVALID_INPUT`과 `tags.<태그 ID>.pythonRegex`의 한국어 사유로 거부하며 부분 저장하지 않습니다. `GUARD_SERVER_URL`이 없으면 원격 검증 없이 저장하고, 설정됐는데 연결·검증 응답에 문제가 있으면 503 `GUARD_UNAVAILABLE`로 거부합니다. 활성 설정을 읽을 때 건너뛴 규칙(`skipped_regex`)은 메트릭 설정의 해당 태그, 검사 서버 관리 상태, 전체 현황 배너에 태그 이름과 사유를 표시합니다. 서버 사용자 규칙·확장 개인 규칙도 상한은 4,000자이지만 허용 문법은 조직 Python 정규식보다 좁습니다.

태그의 ‘태그 사용’과 독립 Jev 판단의 ‘Jev 판단 사용’은 현재 선택한 버전에 저장합니다. 기존 ‘세부 정보 저장’·‘초안 저장’·‘판단 저장’으로 반영하며 게시 후에도 변경할 수 있습니다. 새 태그·판단과 V8 이전의 기존 항목은 기본적으로 사용합니다. API 응답의 `tags[].enabled`·`jevPrompts[].enabled`는 항상 boolean입니다. 요청에서 `enabled`를 생략하거나 `null`로 보내면 기존 항목은 유지하고 새 항목은 `true`로 만듭니다. 사용하지 않는 항목도 내용·출력 태그·임계값은 보존됩니다. 부모를 사용하지 않아도 자식의 사용 여부는 바뀌지 않습니다. Jev 결과 태그 영역의 ‘사용 안 함’ 표시는 태그 상태를 알려주며 연결 선택·임계값 편집은 계속 가능합니다.

연결하는 쪽은 게시·활성화된 설정을 `GET /api/v1/classifier-config`로 읽어 독립 `jevPrompts`와 출력 태그의 `jevThreshold`, 각 태그의 `pythonRegex`를 사용합니다. 설정은 사용 여부와 관계없이 모든 태그·판단을 반환합니다. 소비자는 `tag.enabled`인 태그의 정규식만 실행하고, Jev 결과는 `prompt.enabled && outputTag.enabled`일 때만 사용해야 합니다. 사용할 출력 태그가 하나도 없는 Jev 판단은 건너뜁니다. 검사 서버는 이 설정으로 조직 태그 정규식과 Jev를 실행합니다. 초안이나 비활성 버전을 저장해도 활성 설정은 바뀌지 않습니다. **활성 게시 버전의 태그 세부 정보나 Jev 설정을 저장하면 같은 버전 ID의 다음 설정 조회부터 즉시 반영되고 `revision`이 증가합니다.** 연결된 분류기는 설정을 다시 조회해 해당 revision을 적용해야 합니다. 검사 서버는 기본 30초 간격으로 설정을 다시 확인하며, 관리 화면에서 조직 설정을 즉시 새로 받을 수 있습니다. 검사·정제와 규칙 묶음 배포는 서버가 담당하고 대시보드 백엔드는 관리·시험 요청을 프록시합니다. 일반 DB를 처음 만들 때 태그나 프롬프트·정규식 예시를 자동 생성하지 않습니다.

이벤트는 원문 프롬프트와 감지 구간을 저장합니다. 구간은 Unicode 코드 포인트의 `[start,end)`이며 JavaScript 문자열 인덱스와 이모지에서 차이가 날 수 있습니다. 같은 범위의 입력은 태그 합집합을 가진 감지 한 건으로 합칩니다. 서로 다른 겹치는 범위는 별개입니다. 감지 없는 이벤트도 유효합니다. 등록된 사람과 현재 활성 버전이 필요합니다. `(sourceId,eventId)`가 같은 동일 요청은 `200`, 새 이벤트는 `201`, 다른 내용의 재사용은 `409`입니다. 같은 요청 재전송은 나중에 활성 버전이 바뀌어도 기존 이벤트를 반환합니다.

`versionId` 필터는 **과거 전체 이벤트를 해석할 게시 버전**을 선택합니다. 수집 버전으로 이벤트를 제한하지 않습니다. 이력 목록·상세에는 수집 당시의 태그 이름·색과 정책 이름이 유지됩니다. 그래프 제목·범례는 선택한 버전의 현재 태그 이름·색을 사용합니다. 사용 여부 변경은 과거 이벤트·필터·집계·저장 검색을 숨기거나 다시 쓰지 않습니다. 수집 API도 비활성 태그의 ID를 계속 허용합니다. 세부 정보 수정은 집계 수치와 저장 검색의 이벤트 구성·필터·트리를 바꾸지 않습니다. 선택한 트리에서 제거된 태그만 가진 구간은 미매핑으로 집계합니다. 태그 필터는 자신과 모든 하위 태그를 포함합니다. 여러 태그가 붙어도 감지 구간 한 개는 한 번만 셉니다. 부모 수치는 자식 수치의 합이 아니라 구간의 합집합입니다.

기본 기간은 서울 기준 최근 7개 날짜, 범위는 시작 포함·종료 제외입니다. 일별 버킷은 서울 날짜, 시간별 버킷은 UTC ISO 시각으로 응답하며 빈 버킷을 채웁니다. 최대 조회는 366일, 시간별 집계는 31일입니다. 프롬프트 `q`는 `%`·`_`도 그대로 찾는 부분 문자열 검색이고, 사람 이름·ID 검색은 별도 `personQuery`입니다. 정책 미수집 `null`은 정책 분포에서 제외합니다. 사람 목록은 등록된 사람을 유지하며 `personQuery`·`personId`만 목록 대상을 제한합니다. 기간·프롬프트·태그 등 이벤트 필터는 각 사람의 통계와 최근 시각에만 적용하므로 일치 이벤트가 없는 사람도 0건으로 표시됩니다.

저장한 검색은 저장 시점의 절대 기간·게시 버전·전체 일치 이벤트 ID를 고정합니다. 새 이벤트 수집이나 활성 버전 변경으로 바뀌지 않습니다. 다시 조회는 저장 필터를 이력으로 가져오는 동작이며 기존 스냅샷을 덮어쓰지 않습니다. 저장 검색 삭제는 원본 이벤트를 삭제하지 않습니다.

화면 경로는 `/`, `/events`, `/events/:id`, `/people`, `/people/:id`, `/settings/metrics`, `/settings/jev`, `/settings/guard`, `/saved-searches`, `/saved-searches/:id`입니다. 기존 `/settings/monitoring` 주소는 쿼리를 유지한 채 `/settings/metrics`로 이동합니다. 자동 갱신 없이 진입·필터 변경·명시적 새로고침 때 조회합니다.

## API

[Swagger UI](http://127.0.0.1:8080/swagger-ui.html), [OpenAPI JSON](http://127.0.0.1:8080/v3/api-docs), [정확한 계약](CONTRACT.md)에서 예시와 응답을 확인할 수 있습니다. Swagger의 상대 서버 `/`는 현재 호스트와 포트를 사용합니다.

| API 경로 (`/api/v1`) | 역할 |
| --- | --- |
| `/config-versions`·`/{id}`·`/{id}/publish`·`/{id}/activate` | 초안 생성·편집·게시·활성화 |
| `/config-versions/{id}/tags/{tagId}` | 선택한 버전의 태그 세부 정보 저장, 게시 버전도 가능 |
| `/config-versions/{id}/jev-prompts`·`/{promptId}` | 선택한 버전의 독립 Jev 프롬프트 생성·편집·삭제와 출력 태그 임계값 저장 |
| `/guard/**` | 검사 서버 관리 프록시(허용 경로만), 관리 키는 백엔드에 보관 |
| `/classifier-config` | 모든 `jevPrompts`·태그와 각 `enabled`, 예시·참고사항·태그별 `jevThreshold`·`pythonRegex`를 포함한 활성 설정, 없으면 `404 NO_ACTIVE_VERSION` |
| `/people`·`/{id}` | 사람 등록과 필터별 통계 |
| `/events`·`/{id}` | 이벤트 등록·페이지·원문 상세 |
| `/detector-events`·`/{id}`·`/{id}/images/{imageId}` | 탐지기 결과 수집·원본 결과 상세·이미지 바이트 다운로드 |
| `/metrics` | 요약·시계열·트리·미매핑·정책·서비스 집계 |
| `/saved-searches`·`/{id}`·`/{id}/events`·`/{id}/metrics` | 고정 검색 생성·조회·삭제 |

필터는 `from`, `to`, `versionId`, `service`, `personId`, `tagId`, `policyStateId`, `hasDetections`, `q`, `interval`, `unmapped`입니다. `tagId`와 `unmapped=true`는 함께 사용할 수 없습니다. 페이지는 0부터, 기본 크기 20·최대 100입니다. 원문은 최대 200,000 코드 포인트입니다. 기존 `/events` 등록의 감지는 최대 1,000개이며 탐지기 수집에는 별도 감지 개수 제한이 없습니다. HTTP 본문 제한은 탐지기 수집 POST만 16MiB이고 기존 API는 1MiB입니다. 오류는 한국어 `{code,message,fieldErrors?}`이며 원문 프롬프트와 스택을 포함하지 않습니다.

## 탐지기 HTTP 수집

`POST /api/v1/detector-events`는 검사 서버가 호출하는 수집 엔드포인트입니다. `result`에는 검사 응답에서 클라이언트 전용 `report_status`를 제외한 JSON을 넣고, `text`에는 조직의 `report_text` 설정에 따라 원문(기본 `full`) 또는 치환문을 전달합니다. 현재 [서버 스키마](../server/app/schemas.py)와 [서버 API 계약](../server/docs/api-contract.md)을 기준으로 하며 대시보드는 알 수 없는 `result` 필드를 거부합니다.

필수 봉투 필드는 `source_id`, `person_id`, `version_id`, `text`, `result`입니다. 선택 필드 `send_action`은 `normal`·`confirmed`·`forced` 또는 null이며 V11의 nullable 열에 저장합니다. 목록·상세의 `Event`에는 `sendAction`·`fileCount`·`imageCount`를 반환하고 `forced`를 **강행 전송** 배지로 표시합니다. 상세에서는 파일 이름과 이미지 미리보기·다운로드를 제공합니다. 다운로드는 `application/octet-stream`이므로 프런트엔드는 저장된 `media_type`으로 blob을 만들어 미리보기합니다. 사람은 먼저 등록하고, `version_id`는 대시보드의 현재 활성 게시 버전을 사용합니다. 탐지기의 `policy_version`·`detector_versions.ruleset`과 대시보드 설정 버전은 별개입니다. 수집은 초기 태그·정책·사용자·버전을 자동 생성하지 않습니다.

`finding.type`과 같은 ID의 태그가 활성 버전에 있으면 연결합니다. 다른 ID를 쓰려면 `tag_map: {"email":"my_email_tag"}`처럼 지정합니다. 연결할 태그가 없는 탐지도 구간과 메타데이터를 보존하고 미매핑으로 집계합니다. 명시한 매핑 대상이 활성 버전에 없으면 `422`입니다. `policy_state_id`도 명시한 경우에만 정책 목록과 연결하며, `decision`으로 사용자 정책 상태를 추론하지 않습니다.

다음은 빈 DB에서 실행하는 합성 예제입니다. `curl`과 `jq`가 필요하며, 사람 등록은 처음 한 번만 실행합니다. 기존 사람과 활성 버전이 있다면 해당 ID로 예제의 `person_id`·`version_id`를 바꿔 수집 단계부터 실행할 수 있습니다.

```bash
api=http://127.0.0.1:8080/api/v1
curl --fail-with-body -sS "$api/people" \
  -H 'Content-Type: application/json' \
  --data '{"id":"detector-demo-user","name":"탐지기 합성 데모 사용자"}'

draft=$(curl --fail-with-body -sS "$api/config-versions" \
  -H 'Content-Type: application/json' --data '{"name":"탐지기 연결 예제"}')
version_id=$(jq -r '.id' <<<"$draft")
updated=$(curl --fail-with-body -sS -X PUT "$api/config-versions/$version_id" \
  -H 'Content-Type: application/json' \
  --data '{"revision":0,"name":"탐지기 연결 예제","tags":[{"id":"email","name":"이메일","description":"합성 예제 이메일","examples":["hong@example.com"],"guidance":"이메일 구간","jevThreshold":null,"pythonRegex":"(?i)\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b","color":"#2563EB","parentId":null,"order":0}],"policyStates":[{"id":"blocked","name":"차단 판정","description":"검사 서버의 차단 판정을 수집한 예제","color":"#DC2626","order":0}]}')
updated=$(curl --fail-with-body -sS "$api/config-versions/$version_id/jev-prompts" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --argjson revision "$(jq '.revision' <<<"$updated")" \
    '{revision:$revision,name:"이메일 검사",prompt:"원문에 이메일 주소가 포함되어 있는지 판단하세요.\n예시: hong@example.com",outputs:[{tagId:"email",threshold:0.75}]}')")
jq '{revision}' <<<"$updated" > /tmp/dashboard-detector-publish.json
curl --fail-with-body -sS -X POST "$api/config-versions/$version_id/publish" \
  -H 'Content-Type: application/json' --data-binary @/tmp/dashboard-detector-publish.json
curl --fail-with-body -sS -X POST "$api/config-versions/$version_id/activate"

jq --arg version "$version_id" '.version_id = $version' \
  examples/detector-event.json > /tmp/dashboard-detector-event.json
curl --fail-with-body -sS -D /tmp/dashboard-detector-headers.txt \
  "$api/detector-events" -H 'Content-Type: application/json' \
  --data-binary @/tmp/dashboard-detector-event.json > /tmp/dashboard-detector-response.json
jq . /tmp/dashboard-detector-response.json

detector_id=$(jq -r '.id' /tmp/dashboard-detector-response.json)
curl --fail-with-body -sS "$api/detector-events/$detector_id" | jq .
image_path=$(jq -r '.images[0].download_path' /tmp/dashboard-detector-response.json)
curl --fail-with-body -sS "http://127.0.0.1:8080$image_path" \
  --output /tmp/dashboard-detector-image.png
```

[`examples/detector-event.json`](examples/detector-event.json)은 이모지가 있는 프롬프트, 합성 이메일, 한글 파일 이름, 68바이트 PNG를 포함합니다. `files`는 파일 이름만 저장하고 `images`는 이름·미디어 유형과 Base64를 디코딩한 원본 바이트를 저장합니다. 이미지 다운로드는 `application/octet-stream` 첨부로 제공하며 바이트를 변환하지 않습니다. `media_type`은 `image/png`처럼 `image/*` MIME 형식이고, `data_base64`는 데이터 URI 접두어·공백 없이 패딩을 포함한 표준 Base64입니다. 이름은 공백만으로 구성할 수 없는 1~255 코드 포인트이며 슬래시·역슬래시·제어 문자와 `.`·`..` 이름을 허용하지 않습니다. 일반 파일 최대 100개, 이미지 최대 20개·개별 5MiB·합계 10MiB입니다.

새 결과는 `201`, 같은 결과 재전송은 `200`, 같은 식별자에 다른 내용은 `409`입니다. `event_id`는 `source_id`·`result.request_id`·타입을 포함한 `result.input_version`으로 결정되므로 숫자 `3`과 문자열 `"3"`은 서로 다른 검사입니다. 같은 요청의 재전송은 활성 버전이 바뀌어도 기존 결과를 반환합니다. POST 응답은 상세 GET과 같은 봉투이며 숫자 `id`로 조회하고 `event` 안에 기존 대시보드 이벤트가 포함됩니다. 원문·결과 JSON·첨부는 함께 저장되고 결과의 신뢰도·위험도·조치·정책 버전을 유지합니다. `service`를 생략하면 `destination.provider`를 사용하고 목적지 LLM 모델명은 추론하지 않습니다.

이 기록은 **검사 판정과 전송 전 선택**입니다. `send_action`은 일반·확인·강행 전송의 선택을 나타내며 외부 AI의 수신 성공을 증명하지 않습니다. 조직 서버는 전송 시점 검사의 기록 응답을 기다리고, 확장프로그램은 기록 실패·응답 누락 시 전송·첨부를 보류합니다(`report_text=off` 등 기록 제외는 별도). 전체 필드와 검증 규칙은 [수집 계약](CONTRACT.md#detector-http-ingestion)을 참고하세요.

## 검사 서버 연결

사이드바 **검사 서버 연결**(`/settings/connections`)에서 검사 서버(`server/`)를 연결합니다. 폐기된 감시 연동 주소(`/settings/monitoring`)는 그대로 메트릭 설정으로 이동합니다.

1. **연결 URL 만들기**: 이름과(선택) 검사 서버에서 보이는 대시보드 주소를 넣으면 `http://…/api/v1/connectors/c_…#sk_…` 형식의 URL이 한 번만 표시됩니다. 비밀번호처럼 다룹니다.
2. 검사 서버를 `PG_DASHBOARD_CONNECTION=<연결 URL>`로 실행합니다. 서버는 `#` 뒤의 비밀값을 `Authorization: Bearer`로 보내므로 경로·접근 로그에 남지 않습니다.
3. 연결을 처음 만든 뒤부터 `/api/v1/classifier-config`와 `/api/v1/detector-events`는 유효한 연결로만 호출할 수 있습니다(401 `CONNECTOR_AUTH_REQUIRED`). 화면이 쓰는 나머지 API는 기존처럼 로컬 무인증입니다.
4. **해지**하면 그 서버는 즉시 규칙을 받지 못해 검사를 회색(전송 보류)으로 처리합니다.

연결 URL을 만들 때 **사용자가 확장에 넣을 검사 서버 주소**를 함께 적어 두면, 사람 상세 화면(`/people/:id`)의 **확장프로그램 연결 → 연결 코드 발급**이 `<검사 서버 주소>#<코드>` 한 줄(연결 정보)을 보여 줍니다. 사용자는 이 한 줄을 확장 설정의 "대시보드 연결"에 붙여 넣으면 서버 주소 저장과 연결이 한 번에 끝나고 조직 관리 모드가 됩니다. 코드는 일회용·기본 24시간이며 연결된 검사 서버만 사용할 수 있습니다.

같은 화면의 **검사 서버 설정**은 연결된 모든 서버가 30초 안에 반영합니다: 탐지 이력의 원문 처리(마스킹 문장·원문·기록 안 함), 대시보드 태그 탐지 시 조치, Jev 사용, 검사 서버 탐지 유형(email 등) → 태그 매핑. API 계약은 [CONTRACT.md](CONTRACT.md#detector-connections-and-settings)입니다.

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

`TEST_MIGRATION_DB_URL`은 비워도 되며, 지정하면 해당 폐기 가능한 `_test` DB를 초기화해 V1→V2의 일회성 초기화, V2→V3→V4→V5→V6→V7→V8의 기존 데이터 보존·이력 이름·색·독립 Jev·사용 여부 기본값과 새 일반 DB의 빈 상태를 검증합니다. HTTP 검증도 별도 테스트 DB를 연결한 JAR를 포트 `8083` 등으로 실행한 뒤 진행합니다. 다음 스크립트는 게시 버전·사람·이벤트를 생성하고 세부 정보 수정의 버전 격리, 이력 이름·색 보존, 저장 검색 구성 유지, 버전 재해석, 동시 재전송, 이모지 구간, 오류 응답을 확인합니다. `smoke_detector_api.py`는 합성 사람·설정·이벤트를 생성하고 새 설정을 게시·활성화하므로 시연 DB와 분리한 테스트 서버에서 실행합니다.

```bash
python3 scripts/smoke_api.py --base-url http://127.0.0.1:8083 --report /tmp/api-smoke.json
python3 scripts/smoke_detector_api.py --base-url http://127.0.0.1:8083 --report /tmp/detector-smoke.json
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

독립 Jev 설정 전용 검증은 다음 스크립트를 사용합니다. 명시한 로컬 테스트 서버에 합성 설정을 생성·게시·활성화하고 프롬프트·여러 출력 태그·공유 임계값을 편집합니다. 0과 미설정 구분, 원문 보존, 게시 후 편집, 선택 해제·삭제 시 태그 보존, 복제본 격리와 화면 가로 넘침을 확인합니다. 이전 `jev-browser.json`·`tag-details-browser.json`과 캡처는 당시 검증 기록으로 보존합니다.

```bash
DASHBOARD_URL=http://127.0.0.1:8085 \
  BROWSER_REPORT=validation/jev-settings-browser.json BROWSER_SCREENSHOT_PREFIX=jev-settings \
  node scripts/smoke_jev_settings.mjs
```

태그·Jev 사용 여부 전용 검증은 합성 설정·사람·이벤트·저장 검색을 만들고 게시 후 토글 저장, 활성 설정 반영, 복제본 격리, 이력·집계 보존, 실제 수정 충돌 후 입력 유지, 이전 감시 경로 이동을 확인합니다. 사용 안 함 상태 두 화면의 데스크톱·모바일 캡처 4개와 5개 너비의 넘침 측정, 변경한 설정 영역의 axe 검사 및 별도 전체 셸 검사 결과를 기록합니다. 이 스크립트도 전용 테스트 DB에서 실행합니다.

```bash
DASHBOARD_URL=http://127.0.0.1:8086 \
  BROWSER_REPORT=validation/detection-enabled-browser.json \
  node scripts/smoke_detection_enabled.mjs
```

자동 접근성·가로 넘침 검증은 `scripts/smoke_accessibility.mjs`로 실행할 수 있습니다. 별도 임시 경로에 `@axe-core/playwright`를 설치하고 `AXE_MODULE`을 해당 `dist/index.mjs` 경로로 지정합니다. 이 결과는 자동 검사 범위이며 수동 WCAG 전체 검증을 대신하지 않습니다.

실제 수행 결과와 실행하지 못한 범위는 [validation/README.md](validation/README.md)에 기록합니다. Compose 구성 검증과 실제 컨테이너 실행 검증을 구별합니다.
