# V2 개발 Compose 검증

2026-10-30 UTC. Docker Compose 2.39.4의 `config --format json`으로 기본·개발 구성을 각각 해석했습니다. [기계 판독 결과](compose-config.json), [검증 스크립트](../scripts/smoke_compose.py).

기본 `compose.yaml`의 앱 `127.0.0.1:8080`·MySQL `127.0.0.1:3306`·`mysql-data`가 유지됩니다. 개발 구성은 `APP_BIND_IP=192.0.2.20`, `APP_PORT=18081` 지정 시 단일 앱 포트로 치환되며 MySQL의 데이터 마운트도 단일 `dev-mysql-data`로 치환됩니다. 기본 볼륨을 개발 구성에서 참조하지 않습니다.

개발 백엔드는 `./dev/sql`을 `/app/dev-sql`에 읽기 전용으로 마운트하고 Flyway 위치에 `filesystem:/app/dev-sql`을 추가합니다. 기본 구성에는 이 위치와 마운트가 없습니다. 서비스는 `backend`·`mysql` 두 개이며 시드 초기화 컨테이너가 없습니다. 호스트 `DB_URL`을 다른 주소로 주어도 두 Compose 백엔드는 `mysql:3306`을 사용합니다.

시작 오류 수정 후 개발 백엔드의 `pull_policy: build`가 최종 Compose 구성에 유지되는지, 일반 구성에는 추가되지 않았는지 검사했습니다. 이 정책은 `up` 시 현재 소스로 이미지를 빌드하여 최신 SQL 콜백과 이전 이미지의 조합을 방지합니다.

실제 MySQL 8.4.7의 별도 테스트 스키마에서 V2 마이그레이션을 제거한 JAR 복사본으로 재현한 뒤, 기존 V1 빌드 JAR(SHA256 `f2b2fd687113277a128ceb1364ff244facbc5a44f8daa598442dfbfc5483c1c7`)과 현재 개발 콜백으로도 같은 결과를 확인했습니다. V1 적용 후 종료 코드 1, 콜백 10행의 `config_versions` 테이블 부재 오류가 재현되었습니다. 같은 DB에 원본 최신 JAR를 실행하자 V2만 추가 적용되고 콜백이 성공했습니다. `/api/v1/health`는 `{"status":"UP"}`, Flyway 이력은 V1·V2 모두 성공, 예시 버전은 2개·이벤트는 209개였습니다. 테스트용 DB만 사용했으며 기존 사용 DB는 수정하지 않았습니다. 이 결과는 이전 이미지와 최신 콜백의 불일치가 해당 오류를 일으킴을 확인한 것이며, 사용자 Docker 이미지 자체를 검사한 결과는 아닙니다.

실제 Docker Engine가 없어 이미지 빌드·컨테이너 기동·볼륨 재시작은 수행하지 않았습니다. SQL 콜백 자체와 Flyway 실행은 로컬의 실제 MySQL 8.4.7 및 Java 21에서 확인했습니다. 상세는 [SQL 실행 결과](sql-runtime.json)에 있습니다.
