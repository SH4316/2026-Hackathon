# 탐지 룰 형식 목록

Prompt Guard 검사 서버(`server/`)와 JS 라이브러리(`packages/prompt-guard-rules`)가 같은 결과를 내는 탐지 규칙과, 대시보드에서 추가하는 규칙의 형식을 정리한 문서입니다.
기준: 룰셋 `rules-0.2.1`, 정책 `2026-10-31.draft4`.

## 1. 판정 흐름

```text
입력 → [내장 규칙] + [사용자 규칙] + [Jev(로컬 모델)] + [조직 태그 정규식·Jev] → 겹치는 구간 병합 → 유형별 정책(조치) → 내용 기준 판정
```

| 조치(action) | 의미 | 원문 판정 |
|---|---|---|
| `block` | 자동 치환하지 않음. 검사 완료 후 사용자 확인으로 강행 전송 가능 | 차단(빨강) |
| `mask` | 토큰으로 치환 후 재검사하거나, 확인 후 원문 강행 전송 가능 | 차단(빨강) + 치환 제안 |
| `warn` | 사용자 확인 필요(치환 대상에도 포함) | 확인(노랑) |
| `allow` | 탐지 사실만 알림, 치환하지 않음 | 통과(초록) |

- **판정은 내용 기준**입니다. `mask`·`block` 대상이 하나라도 있으면 빨강, 그 외 `warn`이면 노랑, 모두 `allow`이면 초록입니다. 검사 미완료·오류는 회색입니다. **전송 대상 등급**(`standard`·`elevated`·`restricted`), 모델별 학습·opt-in 상태는 판정에 영향을 주지 않으며 접속·모델 변경 시 안내 모달로만 알립니다. 등급 근거는 `server/policies/destinations.yaml`.
- 탐지 **신뢰도**(high·medium·low)는 형식 일치의 확실성이고, **위험도**(severity)와 **조치**는 정책이 정합니다. 서로 다른 값입니다.
- 형식이 맞아도 실존·유효·소유를 보장하지 않습니다(카드번호 Luhn 통과, JWT 형식 등).

## 2. 내장 규칙

코드: `server/app/detection/rules.py`, `packages/prompt-guard-rules/src/rules.js`(같은 순서·같은 의미). 대시보드에서 끌 수 없습니다.
정규식의 `\d \w \s \b` 는 Python Unicode 의미입니다(한글은 단어 문자: `CVE-2024-3094취약점` 은 경계가 없어 탐지하지 않음).

### 개인정보

| 규칙 ID | 유형 | 형식 | 추가 검증 | 탐지 예 | 탐지 안 함 |
|---|---|---|---|---|---|
| `kr_rrn` | rrn | 6자리-성별자리(1~8)+6자리, 구분자 `-`·공백·없음 | 생년월일 유효성 | `900101-1234567`, `900101 1234567` | `991399-1234567`(날짜 오류) |
| `kr_mobile` | phone | `01[016789]` + 3~4 + 4자리, 구분자 `- . 공백` | | `010-1234-5678` | |
| `kr_landline` | phone | `02`·`0[3-6][1-5]` - 3~4 - 4자리 | | `02-123-4567` | |
| `nanp_phone` | phone | 북미: `(+1)` 지역(2~9로 시작) 3 + 국번(2~9) 3 + 4자리, 내선 `x123`·`ext.123` | | `(820)913-3241x894`, `410.526.1667` | `010-…`(한국 번호와 겹치지 않음) |
| `intl_phone` | phone | `+국가번호` 뒤 숫자 묶음 2~5개 | 숫자 8~15자리 | `+44 20 7946 0958`, `+82 10-1234-5678` | `+1 2 3` |
| `email` | email | `local@domain.tld` | | `hong@example.com` | |
| `kr_passport` | passport | `[MSRODG]` + 8자리 또는 3자리+영문+4자리, 영숫자 경계 | | `M12345678` | |
| `kr_driver_license` | driver_license | `지역(11~28)-2-6-2` | | `11-22-123456-01` | |
| `id_number_ctx` | id_number | 키워드(학번·사번·군번·회원/고객/수험/학생번호, `ID`·`No.`·`Number`·`#`, 앞에 student·employee·roll·pin 등) + `:`/`#` + 영숫자 5~20자 | 값에 숫자 4개 이상 | `Roll No. : 932353568953`, `학번: 2024123456`, `Group id  :  027693` | `ID: ABCDEFG`, `사번 EMP-2231`(구분 기호 없음) |
| `long_digit_id` | id_number | 구분자 없는 8~16자리 숫자. 앞이 영숫자·`_`·`.`·`=`·`&`·`?`·`#`·`-`·통화 기호(`$ ₩ € £ ¥`), 뒤가 영숫자·`.`·`/`·`-` 이거나 **공백 + 단위**(원·달러·억·만·명·개·건·회·%·km·kg·users 등)면 제외 | 제외: 유효한 YYYYMMDD 날짜(1900~2099), 같은 숫자 반복(`11111111`), 연속 숫자(`123456789`·`987654321`), 끝이 `0000` 인 어림수, 유닉스 시각(10자리 1.4×10⁹~2×10⁹, 13자리 1.4×10¹²~2×10¹², 2014~2033년) | `943063077874`, `20241399`, `2023101512345` | `20240229`, `1500000000 원`, `51000000 명`, `100000000`, `1700000000`, `₩123456789`, URL 속 `Expires=1596153600` |
| `us_street_address` | street_address | 번지 1~6자리 + 대문자 단어 1~3개 + USPS 접미사(Street·Ave·Bypass·Centers 등) [+ Apt/Suite 호수] [+ `도시, 주 우편번호`] | | `591 Smith Centers Apt. 656, Joshuamouth, RI 95963` | `90 Thousand Sq. Kilometers` |
| `kr_road_address` | street_address | [시·도] + 시·군·구 + 도로명(…대로·로·길) + 건물번호 [+ 번길] | | `서울특별시 종로구 세종대로 110`, `강남구 테헤란로 152` | `경로 3`(시·군·구 없음) |
| `profile_url` | url_personal | 소셜·프로필 URL: facebook·instagram·twitter·x·tiktok·github·threads `.com/…`, `linkedin.com/in/`, `youtube.com/(channel·c·user·@)`, `medium.com/@`, behance, dribbble (스킴 생략·잘린 `tps://` 허용) | | `linkedin.com/in/mmartinez` | `youtube.com/watch?v=…`(영상 링크) |
| `username_ctx` | username | 키워드(username·user id·login id·handle·아이디·계정명) + `:` + 아이디 | | `username: fdixon`, `아이디: jacob59` | `@Darden`(@언급은 기관과 구별 불가 → 규칙 없음) |

### 금융·인증정보

| 규칙 ID | 유형 | 형식 | 추가 검증 | 탐지 예 |
|---|---|---|---|---|
| `credit_card` | credit_card | 13~19자리(공백·`-` 허용), 첫 자리 3~6 | Luhn 체크섬 | `4111 1111 1111 1111` |
| `kr_bank_account_ctx` | bank_account | `계좌(번호)`·`account (no/number)` + `:` + 계좌 형식 | | `계좌번호: 110-123-456789` |
| `aws_access_key_id` | aws_access_key_id | `AKIA·ASIA·ABIA·ACCA` + 대문자·숫자 16자 | | `AKIAIOSFODNN7EXAMPLE` |
| `github_token` | github_token | `gh[pousr]_` + 36자, `github_pat_` + 82자 | | `ghp_…` |
| `jwt` | jwt | `eyJ…`.`eyJ…`.서명 | 헤더가 `alg` 를 가진 JSON(서명 검증 아님) | |
| `pem_private_key` | private_key | `-----BEGIN … PRIVATE KEY-----` ~ END(잘린 경우 끝까지) | | |
| `password_assignment` | password | `password·passwd·pwd·비밀번호·비번·패스워드` + `:`/`=` + 4자 이상 값 | 치환 토큰(`[PASSWORD_1]`)은 제외 | `password=Sup3rSecret!` |
| `secret_assignment` | secret_config_value | `api_key·secret(_key)·access_token·auth_token·client_secret` + `:`/`=` + 8자 이상 값 | | `api_key = "abcd1234efgh5678"` |

### 인프라·보안정보

| 규칙 ID | 유형 | 형식 | 비고 |
|---|---|---|---|
| `url_with_credentials` | url_with_credentials | `scheme://user:pass@host…` | |
| `url` | url | `http(s)://…` | 기본 `allow`(알림만). 프로필 URL과 겹치면 `url_personal` 이 대표 |
| `internal_domain` | internal_domain | `….internal·local·corp·lan·intra` | |
| `ipv4` | internal_ip·internal_cidr·ip_address·cidr | 점 4개 숫자[/접두사] | Python `ipaddress` 기준 사설망 판단, 앞자리 0 거부, 루프백은 신뢰도 낮음 |
| `ipv6` | (위와 같음) | 콜론 표기[/접두사] | IPv4 매핑 주소는 IPv4 기준 |
| `mac_address` | mac_address | `aa:bb:cc:dd:ee:ff` | |
| `cve` | cve | `CVE-연도-번호` | 기본 `allow` |

### 겹침 처리

겹치는 탐지는 하나로 합치고(구간은 합집합), 대표 유형은 **조치 > 위험도 > 규칙 탐지(모델보다 우선) > 긴 구간** 순으로 정합니다.
예: 13자리 숫자가 주민번호이면 `rrn`(mask)이 `id_number`(warn)보다 우선하고, 카드번호면 `credit_card` 가 우선합니다.

## 3. 유형별 기본 정책 (`server/policies/default.yaml`)

| 유형 | 분류 | 위험도 | 기본 조치 | 치환 토큰 |
|---|---|---|---|---|
| rrn, passport, driver_license | personal_id | critical | mask | RRN, PASSPORT, DRIVER_LICENSE |
| phone, email | personal | medium | mask | PHONE, EMAIL |
| id_number | personal_id | medium | warn | ID_NUM |
| street_address | personal | high | mask | ADDRESS |
| url_personal, username | personal | medium | warn | URL_PERSONAL, USERNAME |
| credit_card | financial | critical | mask | CARD |
| bank_account | financial | high | mask | ACCOUNT |
| aws_access_key_id, github_token, jwt, private_key, password, url_with_credentials | credential | critical | mask | AWS_KEY, GITHUB_TOKEN, JWT, PRIVATE_KEY, PASSWORD, URL |
| secret_config_value | credential | high | mask | SECRET |
| internal_ip, internal_cidr, internal_domain | infrastructure | medium | warn | INTERNAL_IP, INTERNAL_CIDR, INTERNAL_HOST |
| mac_address | infrastructure | low | warn | MAC |
| ip_address, cidr | infrastructure | low | allow | IP, CIDR |
| url, cve | infrastructure, security | info | allow | URL, CVE |

치환은 같은 요청 안에서 같은 (유형, 값)에 같은 번호를 줍니다: `a@x.io, b@x.io, a@x.io` → `[EMAIL_1], [EMAIL_2], [EMAIL_1]`.

## 4. 사용자 규칙 (대시보드 `PUT /v1/admin/custom-rules/{id}`)

| 필드 | 필수 | 형식 | 설명 |
|---|---|---|---|
| `id` | ✓ | `^[a-z][a-z0-9_]{1,40}$` | 탐지 유형 이름. **내장 유형과 같은 이름 불가** |
| `kind` | ✓ | `keywords` \| `regex` | |
| `label` | ✓ | 1~60자 | 화면 표시 이름 |
| `token` | ✓ | `^[A-Z][A-Z0-9_]{1,30}$` | 치환 토큰 접두어 |
| `category` | | id 형식, 기본 `custom` | |
| `severity` | | critical·high·medium·low·info, 기본 high | |
| `action` | | block·mask·warn·allow, 기본 mask | |
| `keywords` | keywords 일 때 | 1~200개, 각 1~100자 | 대소문자 무시(기본). **영문·숫자로 시작/끝나는 키워드는 영단어 경계 적용**("Confidential" 은 "confidentially" 를 잡지 않음), 한글로 끝나면 조사가 붙어도 탐지("블루문은") |
| `pattern` | regex 일 때 | 4,000자 이하 | 아래 제한 참고. 일치한 전체 구간이 탐지 구간 |
| `case_sensitive` | | 기본 false | |
| `reason` | | 100자 이하 | 경고 화면에 표시 |
| `enabled` | | 기본 true | |
| `distribute` | | 기본 true | false 면 클라이언트 배포 묶음에서 빼고 서버에서만 탐지(키워드 자체가 기밀일 때) |

정규식 제한(Python·JS 양쪽에서 같은 의미 + 처리 시간 폭증 방지):

- 금지: 중첩 수량자 `(a+)+`·`(\w*)*`, 빈 문자열과 일치하는 패턴, `(?P<..>)`, `(?<name>)`, 인라인 플래그 `(?i)`, `\A \Z \z \G`, 역참조 `\1`, 소유 수량자 `*+`, `\p{..}`, 가변 길이 뒤보기.
- 중첩 수량자 검사는 보수적이라 `(?:[a-z]+\.)+corp` 같은 안전한 패턴도 거부합니다 → `[a-z.]+\.corp` 처럼 바꿔 씁니다.
- 저장 전 `POST /v1/admin/custom-rules/test` 로 샘플 텍스트에 시험할 수 있습니다.

위 항목은 대시보드 **검사 서버 관리 > 사용자 규칙**에서 편집합니다. 메트릭 설정의 조직 태그 `pythonRegex`는 별도 Python `re` 규칙이며 같은 4,000자 상한을 적용합니다. 검사 서버가 설정된 대시보드는 변경된 비어 있지 않은 패턴을 저장 전에 `POST /v1/admin/org/regex/check`로 검증합니다. `too_long`·`nested_quantifier`·`syntax_error`·`matches_empty`는 저장을 거부하며, 기존에 실행에서 건너뛴 규칙은 태그 이름·사유와 함께 화면에 표시합니다.

```json
{ "id": "project_codename", "kind": "keywords", "label": "프로젝트 코드명", "severity": "high",
  "action": "mask", "token": "PROJECT", "keywords": ["블루문", "Blue Moon"], "distribute": false }
```

## 5. Jev (로컬 모델, `PUT /v1/admin/context-detectors/{id}`)

정규식으로 판단할 수 없는 기준(예: 미공개 연구 결과, 학생 이름 vs 인용 저자)을 설명과 예문으로 정의합니다. 공통 필드(`id`·`label`·`token`·`category`·`severity`·`action`·`enabled`)에 더해:

사용자 표시 이름은 Jev이며 내부 API 필드 `context_detectors`와 경로는 호환을 위해 유지합니다. 이 기준 목록은 조직 트리의 독립 Jev 프롬프트와 별개입니다.

| 필드 | 형식 | 설명 |
|---|---|---|
| `criteria` | 5~1000자 | 판단 기준 |
| `examples` | 1~20개, 각 300자 이하 | 탐지해야 하는 문장 |
| `counter_examples` | 0~20개 | 탐지하면 안 되는 문장 |

기본 5종: `unpublished_research`(block), `internal_project`(mask), `trade_secret`(block), `sensitive_personal`(mask), `third_party_record`(block) — `server/policies/detectors.yaml`.
Decider는 입력 전체를 분류하며 기본 기준은 참일 확률 0.5 이상입니다. `ollama`·`openai`는 원문에 실제로 있는 후보 구간만 채택합니다. 모델은 규칙 탐지를 취소할 수 없으며 실패 시 회색(전송 보류)입니다. 엔드포인트(`PG_MODEL_BASE_URL` 또는 `PG_MODEL_NAME`) 미설정은 시작 시 경고 후 모델 기능을 비활성화하고 `model_endpoint_unset`을 알리며, 그 사유만으로 회색이 되지 않습니다.

## 6. 정확도 평가

아래 수치는 **rules-0.2.0 측정값**이며, 현재 **rules-0.2.1로 재측정하지 않았습니다**. Kaggle "The Learning Agency Lab – PII Data Detection" 학습 데이터(6,807개 문서)는 저장소와 이 머신에 없어 현재 재측정할 수 없습니다. 방법·실행법과 기존 결과는 [server/eval/README.md](../server/eval/README.md)에 있습니다.

측정은 문서 번호 `% 10 < 7`인 dev(4,744개)와 나머지 holdout(2,063개), 전체를 나눠 수행했습니다. `allow`가 아닌 예측을 대상으로 정답 구간과 겹치는 예측이 있으면 TP, 없으면 FN으로 셉니다. 표의 TP·FN은 EMAIL·PHONE_NUM·ID_NUM·STREET_ADDRESS에 한정합니다. FP는 어떤 정답 구간과도 겹치지 않는 모든 개인정보 예측을 세며, 개인정보가 아닌 기밀 표식(`confidential_marker`)은 제외합니다. 문서 오경고율은 개인정보가 전혀 없는 문서 중 경고한 비율입니다. 현재 규칙의 성능 보장이나 새 측정치로 해석하지 않습니다.

| 형식 기반 유형(EMAIL·PHONE·ID_NUM·ADDRESS) | dev(조정용) | holdout | 전체 |
|---|---|---|---|
| 오답률 (FP+FN)/(TP+FP+FN) | **4.65%** | 16.7% | 8.6% |
| 정밀도 / 재현율 | 98.8% / 96.5% | 94.6% / 87.5% | 97.5% / 93.6% |
| 개인정보 없는 문서 오경고 | 0% | 0% | 0% |

- 이메일·전화·주소는 전체 데이터에서 재현율 100%, 식별번호 90%(70/78).
- holdout 은 5% 목표에 못 미칩니다. 남은 누락은 강의 케이스 번호(`UVA-IV-8322`), `ROLL VZ:775Y…`, `Sub Code : 06EYD876` 등 개별 표기라 일반 규칙으로 만들면 이 데이터에만 맞춰지므로 넣지 않았습니다.
- 학생 이름(1,365건)·개인 URL(110건)·아이디(6건)는 형식만으로 구별되지 않아 **Jev(로컬 모델) 평가 대상**입니다. 위 규칙 평가에서는 확실한 일부(프로필 URL)만 잡았습니다(개인 URL 8/110). Jev 정확도 측정값은 아닙니다.

## 7. 규칙을 바꿀 때

1. `server/app/detection/rules.py` 수정(필요하면 `policies/default.yaml` 에 유형 정책 추가)
2. 같은 내용을 `packages/prompt-guard-rules/src/rules.js` 에 반영(순서 동일)
3. `server/scripts/export_rules_bundle.py` 의 사례 추가 후 실행 → 정책 모듈·골든 벡터 갱신
4. `pytest`(서버) + `npm test`(라이브러리, Python 과 판정 비교) + `python eval/run_eval.py --data … --split dev`
5. 룰셋 버전(`RULESET_VERSION`)과 정책 `version` 올리기
