# 태그·Jev 사용 여부 검증

2026-10-30 UTC에 Java 21·Node.js 24.22.1·실제 MySQL 8.4.7과 별도 테스트 DB의 패키지 서버 `http://127.0.0.1:8086`에서 확인했습니다. 기존 `8085` 서버와 시연 DB는 변경하지 않았습니다. 이전 [독립 Jev 설정 검증](jev-settings.md)과 결과 파일은 당시 기록으로 보존합니다.

## 변경 동작

메트릭 설정의 ‘태그 사용’과 Jev 설정의 ‘Jev 판단 사용’은 현재 편집 중인 폼의 값을 바꾸고 기존 저장 버튼으로 반영합니다. 태그·판단은 게시 후에도 수정할 수 있고 선택한 버전의 revision만 증가합니다. 새 항목과 V8 이전의 기존 항목은 `enabled: true`입니다. API 입력에서 생략·`null`은 기존 값 유지, 생성 시 기본 `true`를 의미하며 `false`를 명시적으로 저장할 수 있습니다. 부모와 자식의 사용 여부는 독립적입니다.

사용 안 함 상태도 정규식·프롬프트·임계값·출력 태그 연결을 보존합니다. 목록과 결과 태그는 ‘사용 안 함’을 표시하며 결과 연결 선택·임계값 편집·태그 설정 링크는 계속 사용할 수 있습니다. 이전 감시 연동 메뉴와 패널은 제거했고 `/settings/monitoring`은 쿼리를 그대로 유지해 `/settings/metrics`로 이동합니다.

전체 설정 응답은 비활성 항목도 포함합니다. 소비자는 사용 중인 태그의 정규식만 실행하고 Jev는 `prompt.enabled && outputTag.enabled`인 결과만 적용하며 사용 중인 출력 태그가 없으면 판단을 건너뛰어야 합니다. 이 작업은 실제 `server` 실행·설정 재조회 연결을 구현하지 않습니다. 과거 이벤트·필터·집계·저장 검색은 사용 여부 변경으로 숨기거나 다시 쓰지 않습니다.

## 실행 결과

- [백엔드 테스트](detection-enabled-backend-tests.json): **79개, 실패·오류·건너뜀 0개**. 새 `enabled_flags_api_test`·`enabled_flags_migration_test` DB를 사용했습니다. V8 기본값·기존 데이터 보존, 생략·null·false 처리, 엄격한 boolean 검증, 게시 후 수정, revision 충돌, 복제·버전 격리, 비활성 태그의 일반/탐지기 수집 및 과거 집계·스냅샷 보존을 확인했습니다.
- [프런트엔드 테스트](detection-enabled-frontend-tests.json): **108개·9개 파일, 실패·건너뜀 0개**. 게시 태그·판단의 양방향 변경, 저장 중 잠금, 409 이후 토글·문자열·임계값 유지, 다른 태그·트리·정책·버전 이름의 미저장 변경 유지, 생성 기본값, 비활성 결과 태그 편집과 이전 URL 이동을 확인했습니다. TypeScript 검사와 Vite 프로덕션 빌드도 통과했습니다. 기존 500kB 번들 크기 경고는 유지됩니다.
- [최종 브라우저 검사](detection-enabled-browser.json): 패키지의 실제 Chromium 화면에서 **7개 흐름 묶음**을 통과했습니다. 키보드 Space 조작과 명시적 저장, 게시 후 비활성화·재활성화, 저장 중 잠금, 새로고침 후 유지, 활성 설정 revision 갱신·이전 복제본 격리, 비활성 결과 선택·임계값 편집, 실제 동시 수정의 409와 미저장 입력 유지, 이력·집계·저장 검색 보존, 새 태그·판단 기본값과 감시 경로 이동을 확인했습니다.
- 두 비활성 화면에서 320·390·768·1280·1440px **10개 가로 넘침 측정은 모두 0개**, `.configuration-page` 대상 390·1440px **4개 axe 검사는 위반·미완료 판정 모두 0개**입니다. 처리되지 않은 JavaScript 오류는 0개입니다. 새 스위치와 도움말·상태 배지, 주변 설정 컨트롤이 이 범위에 포함됩니다. 최종 캡처는 `.impeccable/review/detection-enabled-{tag-off|jev-off}-{desktop|mobile}.png` 4개입니다.
- 전체 셸 axe 결과는 같은 보고서의 `broadAxe`에 별도로 보존했습니다. 기존 사이드바·현재 메뉴·상단 경로·환경 표시·푸터의 `color-contrast`가 화면별 모바일 3개 노드, 데스크톱 10개 노드에서 남아 있습니다. 설정 영역에는 해당 위반이 없습니다. 이 자동 검사는 수동 보조 기술 점검이나 전체 앱의 WCAG 적합성 판정을 포함하지 않습니다.
- [기존 전체 UI 회귀 검사](detection-enabled-regression-browser.json)도 최종 JAR에서 통과했습니다. 현황·탐지 상세·검색·저장 검색·태그/정책 편집·게시/활성화·복제/충돌 회복·사람 등록·네트워크 재시도·모바일 이동과, 제거한 감시 메뉴 대신 이전 URL의 쿼리 보존 이동을 확인했습니다. 처리되지 않은 JavaScript 오류는 0개입니다.
- [최종 패키지 검사](detection-enabled-package.json): SPA 10개 진입 경로와 이전 URL, 실제 JS·CSS, 없는 리소스의 404, API·Swagger·OpenAPI 상대 서버를 확인했습니다. `Tag`·`JevPrompt` 응답의 필수 boolean 및 세 입력 모델의 선택적 nullable boolean, JAR 안의 V8, DB 열의 `NOT NULL DEFAULT TRUE`, 최초 빈 설정과 `404 NO_ACTIVE_VERSION`, 개발 시드 SQL 제외를 확인했습니다. 마지막 CSS 수정 후 프런트엔드와 JAR를 다시 빌드하고 같은 격리 서버를 재시작해 최종 브라우저 검사를 실행했습니다.

최종 JAR은 `backend/build/libs/ai-security-dashboard.jar`이며 SHA-256은 `e12e836d8351814c06423ce148feb79e3549898a3bd8f46cb05d4f8f560ebc61`입니다. 최종 자산은 `index-BqV-mSTQ.js`·`index-BYg2pXso.css`입니다. Docker 이미지 빌드·컨테이너 실행, 외부 정규식·Jev 실행, 자동 설정 재로딩은 이 검증에 포함하지 않았습니다.

## 재실행

설정·사람·이벤트·저장 검색을 만드는 스크립트이므로 전용 테스트 DB의 로컬 서버를 사용합니다. `dashboard/`에서 실행하며 Playwright·axe는 `/tmp/dashboard-browser-tools/node_modules` 또는 `PLAYWRIGHT_MODULE`·`AXE_MODULE`의 경로를 사용합니다.

```bash
DASHBOARD_URL=http://127.0.0.1:8086 \
  BROWSER_REPORT=validation/detection-enabled-browser.json \
  node scripts/smoke_detection_enabled.mjs
python3 scripts/smoke_package.py --base-url http://127.0.0.1:8086 \
  --jar backend/build/libs/ai-security-dashboard.jar \
  --report /tmp/detection-enabled-package.json
```
