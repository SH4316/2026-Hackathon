# 백엔드 책임 분리·record 파일 분리 검증

2026-10-30 UTC에 Java 21·실제 MySQL을 사용해 검증했습니다. 최종 JAR의 HTTP 검증 주소는 `http://127.0.0.1:8084`입니다. 비교 기준은 변경 전 커밋 `f03fec7`이며, 기존 검증 기록은 당시 결과로 보존합니다.

- [구조·호환성 검사](backend-refactor-structure.json): 모든 Java `record` 51개를 타입과 같은 이름의 개별 파일로 분리했습니다. 저장소 6개가 SQL·JDBC·행 매핑을 맡고, 서비스는 업무 검증·조합·트랜잭션, 컨트롤러는 HTTP 요청·응답을 담당합니다. 서비스·컨트롤러의 JDBC 의존, 컨트롤러의 저장소 참조, 저장소의 서비스·컨트롤러 의존과 API 경로는 없습니다. 메인 Java 소스의 import는 모두 명시적입니다.
- 같은 구조 검사에서 이전 `ApiModels`, `DetectorModels`, `EventWriter`, `DashboardQueries` 클래스가 JAR에 남지 않음을 확인했습니다. 기능별 `model`과 공통 `api.model.Page`, `EventService`, `DashboardQueryService`, 사람 등록 전용 `PersonService`·`PersonRepository`의 책임은 [README](../README.md)와 [계약 문서](../CONTRACT.md#ownership)에 반영했습니다.
- 변경 전·후 서버의 **전체 OpenAPI JSON이 깊은 비교로 동일**합니다. 경로 18개·스키마 38개뿐 아니라 필드, 검증 제약, 응답 상태, 예시를 포함한 전체 명세를 비교했습니다. 프런트엔드, 백엔드 리소스·설정·마이그레이션, 빌드 설정, Dockerfile과 Compose 파일은 기준 커밋과 같습니다.
- 백엔드 테스트 **50개가 실패·오류·건너뜀 없이 통과**했습니다. 실제 MySQL에서 초안 수정·활성화 잠금, 동일·상이한 이벤트의 동시 재전송, 이미지 저장 실패 시 이벤트·탐지·원본 결과·모든 이미지의 원자적 롤백, 버전별 중복 없는 집계, 저장 검색 멤버십·버전·집계 고정과 삭제 시 원본 보존을 확인했습니다. 조회 서비스의 탐지·정책·서울 날짜 버킷 조립과 저장 검색의 동일 필터 재사용도 검증했습니다.
- [실제 API 검사](backend-refactor-api.json): 동시 요청 12건에서 `201` 1건·`200` 11건, Unicode 구간 합집합과 재전송, 마이크로초·생략 기본값, 사람 0건 유지, 태그 트리·미매핑 집계, 전체 결과 스냅샷 고정을 통과했습니다.
- [탐지기 수집 검사](backend-refactor-detector.json): 생성 `201`·재전송 `200`·내용 충돌 `409`, 원본 `InspectResponse`와 정수 정밀도·파일·이미지 바이트 보존, 수집 후 집계를 통과했습니다. [패키지 검사](backend-refactor-package.json)는 SPA 9개 경로, 정적 파일, API·Swagger, 없는 리소스의 `404`, 개발 SQL의 JAR 제외를 통과했습니다.

최종 JAR은 `backend/build/libs/ai-security-dashboard.jar`이며 SHA-256은 `df9285a814b856000ff0362daae41225aac0f02b3cab2bbee9caa1ab3b40160f`입니다. Docker Engine을 사용할 수 없어 이미지 빌드·컨테이너 실행은 검증하지 않았습니다.
