# 실행 검증 기록

검증일: 2026-10-30 UTC. 이 기록은 이 작업 환경에서 실제 실행한 검증 결과만 기술합니다.

## 환경

- Java: OpenJDK 21.0.12.1 (`/usr/lib/jvm/java-21-openjdk-amd64`)
- Node.js: 24.22.1
- MySQL: 공식 MySQL Community Server 8.4.7, 서버 시간대 `+00:00`
- DB 서버: `127.0.0.1:33306`, 전용 테스트 스키마 `ai_security_dashboard_test`, 시연 스키마 `ai_security_dashboard`
- Compose: Docker Compose 2.39.4로 `compose.yaml config --quiet` 통과

이 실행 환경에는 Docker Engine와 CLI가 없고, 비특권 사용자(UID 1000), 커널 capability 없음, `NoNewPrivs=1`입니다. 사용자 네임스페이스 생성도 `Operation not permitted`로 실패했습니다. 따라서 이 환경에서 Compose 컨테이너 실행과 Docker 볼륨 재시작은 검증하지 못했습니다. Compose 구문은 공식 Compose CLI로 검증했습니다.

DB 검증은 공식 `mysql-8.4.7-linux-glibc2.28-x86_64-minimal.tar.xz`를 `/tmp/dashboard-runtime/`에 내려받아 기존 시스템을 변경하지 않고 실행했습니다. 필요한 libaio/libnuma/ncurses 라이브러리도 같은 임시 디렉터리에 추출했습니다. H2나 MariaDB로 대체하지 않았습니다. 서버는 로컬 주소에만 바인딩했고, JUnit용 DB와 시연 DB를 분리했습니다.

## 결과

- [backend-tests.json](backend-tests.json): Java 21 백엔드 13개 테스트 통과, 실패·오류·건너뜀 0개. 이 중 9개는 실제 MySQL 통합 테스트입니다. UTC와 `Asia/Seoul` JVM 시간대에서 검증했으며 역사적 서울 일광절약시간 구간과 마이크로초 경계도 포함합니다.
- 프런트엔드 담당 검증: Node.js 24.22.1에서 Vitest 22개와 TypeScript·Vite 프로덕션 빌드 통과. API 오류/쿼리, 날짜·한국 시간 표시, 필터를 유지하는 개인 링크, 비동기 갱신·취소 동작을 확인했습니다.
- [api-smoke.json](api-smoke.json): 별도 HTTP 테스트 DB에서 실제 API 검증 통과. 12개 동시 중복 요청 중 최초 한 개만 `201`, 나머지는 `200`과 동일 ID를 반환했습니다. 재전송 정규화·충돌, 집계/필터, 날짜 경계, 페이지, 0건 사용자, 잘못된 입력을 확인했습니다.
- [persistence.json](persistence.json): MySQL을 정상 종료한 뒤 같은 데이터 디렉터리로 재시작했습니다. API의 사용자 페이지·이벤트 페이지·전체 집계가 전후 동일했고 기존 앱의 DB 연결 풀도 복구되었습니다. 4명·48건·감지 수량 213개·명시적 미확인 12건이 유지되었습니다.
- [package-smoke.json](package-smoke.json): Java 21로 최종 JAR를 실행하여 6개 SPA 경로와 해시 JS/CSS 파일을 검증했습니다. 없는 정적 파일·API·임의 경로는 실제 404를 반환하고 API는 JSON을 반환합니다. 프런트엔드 파일이 JAR 내부에도 포함됨을 확인했습니다.
- [browser-smoke.json](browser-smoke.json): 최종 JAR의 분리된 HTTP 테스트 DB에서 Chromium 기능 검증 통과. 수동 새로고침·자동 갱신 없음, 항목→이력→상세→개인 이동, 페이지 이동, 날짜 오류, 필터·빈 상태, 등록·중복 오류·검색, 7개 설정 입력과 저장 비활성/요청 없음, 네트워크 재시도·상세 404, 390px 모바일 내비게이션을 확인했습니다. 처리되지 않은 JavaScript 오류는 0개입니다.
- [demo-package-smoke.json](demo-package-smoke.json): 시연용 `8080` 프로세스도 최종 JAR로 교체한 뒤 같은 SPA/정적 파일/API 검증을 통과했습니다. 기존 시연 데이터 전체 스냅샷이 교체 전과 동일합니다.
- [accessibility.json](accessibility.json): 최종 JAR의 6개 화면에서 axe 위반 규칙·노드 0개, 실행 오류 0개. 각 화면을 320·390·768·1280·1440px에서 측정한 30개 반응형 검사에서 문서 전체의 가로 넘침 0건입니다. 표 내부의 의도된 가로 스크롤과 구별하여 검사했습니다.
  - 자동 명암비 판정이 `incomplete`인 노드는 전체 현황 15개, 탐지 이력 1개, 개인 상세 15개입니다. 이 결과는 자동 검사가 판단하지 못한 부분을 포함하며 전체 WCAG 수동 검증 완료를 의미하지 않습니다. 최종 화면 검토 담당자에게 해당 범위를 전달했습니다.
- 샘플 스크립트 첫 실행은 이벤트 48건 생성, 두 번째 실행은 신규 0건·기존 48건을 확인했습니다.
- Compose 2.39.4 설정 검증과 Python 스크립트 컴파일·브라우저 스크립트 문법 검사도 통과했습니다.

검증한 최종 JAR: `backend/build/libs/ai-security-dashboard.jar` (60,138,994바이트), SHA-256 `be6091686f558b2b6a20e1a33218d610fe8a05dddb11b2724decf296be170d09`.

현재 이 작업 환경의 시연 URL은 <http://127.0.0.1:8080>입니다. Java 21 단일 JAR와 실제 MySQL을 사용하며 테스트용 등록 데이터는 이 시연 DB에 섞이지 않았습니다. 작업 환경을 종료하면 임시 서버도 종료됩니다.

## 재실행

일반 개발 환경에서는 [README](../README.md)의 Compose와 별도 테스트 DB 생성 절차를 사용합니다. `TEST_DB_URL`, `TEST_DB_USERNAME`, `TEST_DB_PASSWORD`를 지정해 백엔드 테스트를 실행하고, 테스트 DB에 연결된 앱에 대해 `scripts/smoke_api.py`를 실행합니다. 앱과 MySQL을 멈췄다가 동일 데이터 디렉터리 또는 볼륨으로 다시 시작한 뒤 기존 사용자·이벤트 ID를 조회하면 재시작 후 영속성을 확인할 수 있습니다.
