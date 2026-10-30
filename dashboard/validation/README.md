# V2 실행 검증 기록

최신 추가 검증: [태그·Jev 사용 여부](detection-enabled.md). 실제 MySQL의 백엔드 79개·프런트엔드 108개 테스트와 격리 패키지 서버 `8086`의 브라우저 흐름을 통과했습니다. V8 기본값·버전별 저장·게시 후 토글·409 입력 보존·이력 보존·이전 감시 URL 이동을 확인했으며, 두 설정 화면의 넘침 측정 10회와 집중 axe 검사 4회에서 위반·넘침·실행 오류는 0개입니다. 기존 셸 대비 문제는 별도 결과에 남겨 전체 앱 적합성으로 표현하지 않습니다. 이전 기록은 아래에 보존합니다.

이전 추가 검증: [독립 Jev 프롬프트와 결과 태그 설정](jev-settings.md). 백엔드 71개·프런트엔드 95개 테스트와 실제 MySQL/JAR·브라우저 검사에서 여러 결과 태그·공유 임계값·V7 이전·발행 후 편집·복제 격리를 확인했습니다. 최종 브라우저의 15개 가로 넘침 측정과 6개 axe 검사에서 넘침·자동 위반·미완료 판정·처리되지 않은 JavaScript 오류는 모두 0개입니다. 이전 [발행 후 태그 세부 정보 편집](tag-details.md) 기록은 당시 결과로 보존합니다.

이전 추가 검증: [발행 후 태그 세부 정보 편집](tag-details.md). 현재 선택한 버전에만 적용되는 세부 정보 저장, 발행 트리·정책 고정, 수집 당시 태그 이름·색과 저장 검색 구성 보존을 백엔드 60개·프런트엔드 56개 테스트 및 실제 MySQL/JAR·브라우저·개발 SQL 반복 실행으로 확인했습니다. 이전 [백엔드 책임 분리·record 파일 분리](backend-refactor.md), [태그별 Jev·Python 정규식](tag-rules.md), [탐지기 HTTP 수집·패키지 정리](detector-ingestion.md)와 아래 V2 기록은 당시 결과로 보존합니다.

검증일: 2026-10-30 UTC. 실제 실행한 결과만 기록하며, V1 검증은 [legacy-v1](legacy-v1/README.md)에 보관합니다. V1의 수량 기반 집계 결과를 V2의 근거로 사용하지 않습니다.

## 환경과 범위

Java OpenJDK 21.0.12.1, Node.js 24.22.1, 공식 MySQL Community Server 8.4.7을 사용했습니다. 실제 MySQL은 임시 경로 `/tmp/dashboard-runtime`의 기존 데이터 디렉터리를 이용해 로컬 `127.0.0.1:33306`에서 실행했습니다. 필요한 라이브러리도 같은 임시 경로에 있으며 시스템 패키지를 변경하지 않았습니다.

일반 HTTP 검증은 `sending_http_v2_test`, JUnit은 `sending_test`, 업그레이드는 `sending_upgrade_v2_test`, SQL 반복 검증은 `sending_empty_v2_test`, 개발 화면은 `sending_demo_v2`로 분리했습니다. SQL 반복 검증 DB 이름의 `empty`는 최초 스키마 검증 용도이며 최종 상태는 시드가 적용된 테스트 DB입니다. 기존 V1 시연 DB는 변경하지 않았습니다.

Docker Engine를 사용할 수 없어 Compose 이미지 빌드·컨테이너 기동·볼륨 재시작은 실행하지 않았습니다. Compose 2.39.4로 최종 구성 해석과 불변 조건만 검증했습니다. 로컬 MySQL/JAR 검증을 Docker 런타임 검증으로 표현하지 않습니다. 관리형 환경 상태 도구와 `/etc/codex/network-policy.json`은 이 세션에 없었습니다. Browser/Node REPL 도구도 발견되지 않아 Browser 스킬을 읽은 뒤 기존 임시 Playwright 설치를 사용했습니다.

## 완료된 검증

- [backend-tests.json](backend-tests.json): 백엔드 21개 테스트, 실패·오류·건너뜀 모두 0. 단위 7개, 실제 MySQL API 13개, 실제 Flyway 업그레이드 1개입니다. 동시 초안 수정과 활성화, 동일·상이한 재전송 경쟁도 포함합니다.
- [api-smoke.json](api-smoke.json), [빈 DB 첫 실행](fresh-start-api-smoke.json): 별도 HTTP 서버의 실제 MySQL 검증. 빈 일반 DB와 활성 버전 없음, 사용자 정의 설정·게시·활성화, 코드 포인트 이모지 구간과 동일 범위 태그 합집합, 마이크로초, 기본값 재전송, 12개 동시 요청의 `201` 한 건·`200` 11건, 필터와 SQL 집계, 버전 재해석·미매핑·당시 라벨, 전체 결과 스냅샷 고정, 오류 응답을 확인했습니다.
- [sql-runtime.json](sql-runtime.json): 실제 Flyway로 V1을 적용하고 사람 1명·이벤트 1개·감지 1개를 넣은 뒤 V2로 올려 모두 초기화됨을 확인했습니다. V2에 새 사람을 추가하고 다시 시작했을 때 보존되며 마이그레이션 이력도 두 개로 유지됩니다. V1 SQL 파일은 기존 커밋과 동일합니다.
- 같은 SQL 기록에서 개발 콜백 두 번 적용 후 2개 게시 버전·96개 버전별 태그 노드·6개 정책·6명·209개 이벤트·246개 감지·492개 태그 연결이 동일함을 확인했습니다. 수정한 버전·태그 이름과 선택한 활성 `demo-v2`가 유지되고, 모든 구간의 코드 포인트 부분 문자열이 원문과 일치했습니다. 실제 애플리케이션에서도 파일 시스템 콜백을 발견해 정상 실행했습니다.
- [compose-config.json](compose-config.json), [compose-dev.md](compose-dev.md): 일반·개발 볼륨 분리, 읽기 전용 SQL 마운트, 개발 전용 Flyway 위치, 단일 앱 포트 치환, 호스트 `DB_URL` 차단, 추가 시드 컨테이너 없음을 확인했습니다.

- [package-smoke.json](package-smoke.json): 패키지의 9개 SPA 경로, 실제 JS·CSS 파일, 없는 API·정적 파일·임의 경로의 404, Swagger UI 두 경로와 OpenAPI 상대 서버 `/`를 확인했습니다. 개발 시드 SQL이 JAR에 들어가지 않았습니다. [개발 DB의 패키지 실행](demo-package-smoke.json)도 같은 검사를 통과했습니다.
- [browser-smoke.json](browser-smoke.json): 실제 패키지의 Chromium 흐름을 확인했습니다. 그래프 중심 현황과 수동 갱신, 시간별 조회·트리 이동, 이모지 포함 원문과 위치 강조, 감지 0건·프롬프트 검색, 저장 후 추가 이벤트에도 고정된 결과와 다시 조회, 부모·자식·예시·지침·정책 편집 및 저장·발행·활성화·복제·수정 충돌 회복, 사람 등록·검색, 활성 트리에 따른 읽기 전용 감시 연동, 네트워크 재시도·없는 상세·모바일 이동을 통과했습니다. 처리되지 않은 JavaScript 오류는 0개입니다.

- [frontend-tests.json](frontend-tests.json): 최종 프런트엔드 44개 테스트·6개 파일과 타입 검사·프로덕션 빌드를 통과했습니다. 데이터·쿼리·비동기 갱신과 버전 전환·예시 줄바꿈·복제 이름 등 UI 회귀 검증을 포함합니다.
- [v2-accessibility.json](v2-accessibility.json): 9개 상태에서 1440·390px의 axe 검사 18회, 5개 너비(320·390·768·1280·1440px)의 문서 크기 측정 45회를 수행했습니다. 자동 위반·문서 가로 넘침·실행 오류는 모두 0개입니다. 감시 항목 영역은 키보드 Tab으로 접근하고 PageDown으로 스크롤되며 비활성 입력 47개가 유지됨을 별도로 확인했습니다. `incomplete` 판정은 보고서에 그대로 보존했으며 수동 보조 기술 검증과 WCAG 전체 적합성 판정을 포함하지 않습니다.

최종 JAR: `backend/build/libs/ai-security-dashboard.jar`, 34,265,324바이트. SHA-256 `5cd84561e22d9664340273de6ff4dbc1f55459ef7bb208a4747c8d75f4498004`. 최종 JAR의 새 일반 DB에서 API와 전체 브라우저 흐름을 다시 통과했습니다. Python 스크립트 컴파일과 브라우저 스크립트 문법 검사도 통과했습니다.

## 재실행

[README](../README.md)의 테스트 DB 생성 및 실행 명령을 사용합니다. 테스트 데이터는 게시 후 수정·삭제되지 않는 이벤트와 설정을 포함하므로 시연 DB와 분리해야 합니다. `scripts/smoke_api.py`는 API, `scripts/smoke_package.py`는 SPA·Swagger·JAR 경계, `scripts/smoke_browser.mjs`는 UI 흐름, `scripts/smoke_compose.py`는 Compose 구성을 검사합니다. 자동 접근성 검사는 `scripts/smoke_accessibility.mjs`를 사용하며 수동 WCAG 전체 검증을 의미하지 않습니다.


현재 시연 주소는 <http://127.0.0.1:8080>입니다. [최종 시연 실행 검증](demo-runtime.json)에서 같은 개발 DB의 게시 버전 2개·활성 `demo-v1`·사람 6명·이벤트 209개·감지 246개·감지된 이벤트 172개가 유지됨을 확인했습니다. 일반 스키마가 최신 상태여서 마이그레이션은 다시 실행되지 않았고, 개발 SQL 콜백은 중복·임시 테이블 경고 없이 실행됐습니다. 두 번째 트리로 조회해도 전체 이벤트 수가 유지됩니다. 최종 `8080`에서 SPA·Swagger·API 경계 검사도 다시 통과했습니다.

Vite 미리보기를 위한 `8082`는 유지했고 테스트 전용 HTTP 서버 `8083`은 종료했습니다. 시연은 로컬 Java 21과 실제 MySQL을 사용하며 Docker 컨테이너 실행 결과가 아닙니다. 작업 환경이 종료되면 임시 서버도 종료됩니다.
