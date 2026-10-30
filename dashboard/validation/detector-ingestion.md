# 탐지기 HTTP 수집·패키지 정리 검증

검증일: 2026-10-30 UTC. Java 21과 실제 MySQL을 사용해 별도 테스트 DB에서 실행했습니다. 패키지 HTTP 검증 주소는 `http://127.0.0.1:8084`, 보고 시각은 18:13 UTC입니다. 기존 V2 검증 기록은 [README](README.md)에 그대로 보존합니다.

Java 테스트는 총 **38개**, 실패·오류·건너뜀 모두 0입니다.

| 범위 | 개수 | 확인한 내용 |
| --- | --- | --- |
| 탐지기 수집 통합 | 15 | 원본 결과·파일 이름·이미지 보존, 재전송·동시 요청, Unicode 구간, 매핑·미매핑, 크기 제한·오류·원자성, OpenAPI 계약 |
| Flyway 마이그레이션 | 3 | V1→V2 일회성 초기화, V2→V3 기존 행 보존, 새 일반 DB의 빈 설정·사용자·이벤트 |
| 기존 대시보드 API 통합 | 13 | 버전·사용자·수집·검색·집계·스냅샷과 기존 오류·재전송 동작 |
| 단위 | 7 | 원문 구간 정규화 3개, 검색 조건 3개, 설정 트리 1개 |

생산자 계약은 `origin/main`의 `e2021dfc6f733a9b8b141c93557b5c8ddf02d60f`를 기준으로 했습니다. [서버 스키마](https://github.com/SH4316/2026-Hackathon/blob/e2021dfc6f733a9b8b141c93557b5c8ddf02d60f/server/app/schemas.py)와 [룰 형식](https://github.com/SH4316/2026-Hackathon/blob/e2021dfc6f733a9b8b141c93557b5c8ddf02d60f/docs/rule-formats.md)을 반영한 [InspectResponse 테스트 자료](../backend/src/test/resources/detector/inspect-response.json)와 [HTTP 예제](../examples/detector-event.json)를 사용했습니다.

[detector-http.json](detector-http.json)은 최종 JAR의 실제 HTTP 검증 결과입니다. 신규 `201`, 같은 요청 `200`, 변경된 내용 `409`, 상세·이미지 조회 `200`을 확인했습니다. 결과 JSON과 한글 파일 이름을 보존하고, 400자리 정수 `input_version`의 정밀도를 유지했습니다. 같은 숫자의 정수·문자열 버전은 서로 다른 이벤트로 저장됐습니다. 두 이벤트의 탐지·사용자·집계도 일치했습니다.

다운로드한 PNG는 입력 Base64를 디코딩한 **68바이트와 완전히 일치**했습니다. SHA-256은 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`입니다. OpenAPI 3.1의 `input_version`은 객체 참조 없이 정수·문자열 `oneOf`를 제공하며, 필수 nullable `basis`와 선택 nullable `replacement`를 구분했습니다.

백엔드는 `api`, `configuration`, `event`, `detector`, `query`, `savedsearch`, `common`, `web`의 8개 패키지로 정리했습니다. 컨트롤러를 기능별로 나누고 탐지 결과 검증·변환과 DB 저장을 분리했습니다. 같은 테스트 묶음으로 기존 API와 저장 검색의 트랜잭션 동작을 확인했습니다.

[detector-package.json](detector-package.json)은 9개 SPA 경로, JS·CSS 자산, 없는 리소스의 404, JSON API, Swagger UI, OpenAPI 상대 서버와 개발 SQL의 JAR 제외를 통과했습니다. 검증 JAR은 `backend/build/libs/ai-security-dashboard.jar`, SHA-256은 `f5b5e82fb893bbc3375f1445e1b0956fffdc6abada5d43db1eaa48c4e6f4850d`입니다.

Docker Engine를 사용할 수 없어 이번 결과에는 이미지 빌드·컨테이너 기동·볼륨 재시작 검증을 포함하지 않습니다. 로컬 Java/MySQL 실행 결과입니다. 재실행은 [README의 검증 명령](../README.md#검증-재실행)을 따르며, 탐지기 HTTP 스크립트는 합성 데이터를 만들고 새 설정을 게시·활성화하므로 별도 테스트 DB를 사용합니다.
