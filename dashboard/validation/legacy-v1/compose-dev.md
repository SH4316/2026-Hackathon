# 개발용 Compose 설정 검증 기록

검증일: 2026-10-30 UTC. `compose-dev.yml`의 호스트 공개 주소 설정만 검증했으며, 기존 앱·이미지 빌드 검증 결과는 [compose-backend.md](compose-backend.md)에 있습니다.

## 실제 실행한 확인

Docker Compose 2.39.4로 `dashboard/`에서 다음 명령의 JSON을 프로세스 안에서 파싱했습니다. 실제 `.env`를 만들거나 수정하지 않았고 자격 증명 값은 출력하지 않았습니다.

```bash
/tmp/dashboard-runtime/bin/docker-compose \
  --env-file .env.example -f compose-dev.yml config --format json
```

셸 환경 변수를 바꿔 다음 7개 구성을 확인했습니다. 미지정 기본값 확인에는 `.env.example` 대신 `/dev/null`과 검증용 root 암호 환경 변수를 사용했습니다.

| 구성 | 앱 호스트 공개 주소 |
| --- | --- |
| `.env.example` 기본값 | `0.0.0.0:8080` |
| `APP_BIND_IP=192.168.0.20` | `192.168.0.20:8080` |
| `APP_PORT=8081` | `0.0.0.0:8081` |
| IP·포트 동시 지정 | `192.168.0.20:8081` |
| 두 변수에 빈 문자열 지정 | `0.0.0.0:8080` |
| 두 변수 미지정 | `0.0.0.0:8080` |
| IP·포트와 호스트용 DB·서버 변수 지정 | `127.0.0.1:18080` |

모든 구성에서 다음 항목이 통과했습니다.

- `backend`와 `mysql` 두 서비스가 해석되고, 백엔드 호스트 포트는 정확히 한 개입니다. 기본 구성의 `127.0.0.1:8080` 바인딩이 추가로 남지 않습니다.
- 백엔드의 DB 연결은 `mysql:3306`, 컨테이너 수신 주소는 `0.0.0.0:8080`으로 유지됩니다. 셸의 `DB_URL`·`SERVER_ADDRESS`·`SERVER_PORT`는 이를 바꾸지 않습니다.
- MySQL 호스트 공개 주소 `127.0.0.1:3306`, 빌드 문맥, 환경 설정, 상태 검사, 시작 의존성, 재시작 정책과 `mysql-data` 볼륨은 같은 환경 변수로 해석한 기본 구성과 같습니다. DB 사용자·암호는 두 서비스가 공유하며 root 암호는 백엔드에 전달되지 않습니다.
- MySQL 상태 검사의 암호 참조는 컨테이너에서 확장되도록 유지됩니다. `extends`에 필요한 `mysql` 서비스와 이름 있는 볼륨도 개발용 파일에 선언되어 있습니다.
- `compose.yaml`은 Git HEAD와 바이트 단위로 같으며, `APP_BIND_IP`·`APP_PORT`를 지정해도 기본 구성의 해석 결과는 같습니다.

개발용 파일의 `!override`는 포트 목록 전체를 교체합니다. [공식 Compose 문서](https://docs.docker.com/reference/compose-file/merge/#replace-value)가 명시한 최소 버전은 2.24.4이며, 이번 실행에 사용한 버전은 2.39.4입니다.

## 검증 범위

Docker Engine·CLI·소켓이 없는 기존 실행 환경의 제한은 그대로입니다. 이번에는 설정 해석만 확인했으며 **컨테이너 기동, 실제 IP 바인딩·LAN 접속, 이미지 빌드와 볼륨 재시작은 실행하지 않았습니다**. 기존 시연 앱과 MySQL 프로세스도 변경하거나 재시작하지 않았습니다.

Docker 실행이 가능한 환경에서는 `.env`를 준비한 뒤 `docker compose -f compose-dev.yml up --build -d --wait`로 실행하고, 호스트의 실제 IP와 설정한 포트로 접속합니다. `0.0.0.0`은 브라우저 접속 주소가 아닙니다.
