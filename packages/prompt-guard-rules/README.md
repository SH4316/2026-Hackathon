# @prompt-guard/rules

Prompt Guard 서버(`server/`)의 **규칙 기반** 탐지·병합·정책·정제를 JS 로 옮긴 npm 라이브러리입니다.
의존성 없이 Node 20+ 와 브라우저(확장프로그램 포함)에서 같은 코드로 동작합니다.

```js
import { createGuard } from "@prompt-guard/rules";

const guard = createGuard();
const r = guard.inspect("배포 키 AKIAIOSFODNN7EXAMPLE", {
  destination: { provider: "openai", channel: "consumer" },
});
r.decision;          // "block"
r.findings[0].type;  // "aws_access_key_id"

guard.sanitize("담당자 kim@example.com").sanitized_text; // "담당자 [EMAIL_1]"
```

응답은 서버의 `/v1/inspect`, `/v1/sanitize` 와 **같은 구조**입니다(`request_id`, `input_version` 제외).
서버 요청 형식을 그대로 쓰려면 `guard.inspectRequest(req)`, `guard.sanitizeRequest(req)` 를 씁니다.

## API

| 이름 | 설명 |
|---|---|
| `createGuard({ policy?, today? })` | `policy`: 정책 번들(기본 `data/policy.js`) 또는 `Policy`. `today`: 목적지 근거 만료 판단 기준일을 돌려주는 함수(`Date` 또는 `"YYYY-MM-DD"`) |
| `guard.inspect(text, { destination? })` | 검사 결과(`status`, `decision`, `signal`, `findings`, `destination`, `notices` …) |
| `guard.sanitize(text, { destination? })` | 검사 → mask/warn 구간 치환 → 재검사 결과(`sanitized_text`, `changes`, `remaining_findings` …) |
| `guard.detect(text)` | 병합 전 규칙 후보 |
| `RULES`, `RULESET_VERSION`, `detect`, `merge`, `Policy`, `decide`, `ipAddress`, `ipNetwork` | 하위 구성 요소 |
| `@prompt-guard/rules/policy` | 서버 정책을 내보낸 기본 정책 번들 |

위치(`span`)는 code point(`start`/`end`, Python 기준)와 UTF-16(`start_utf16`/`end_utf16`, JS `slice` 기준)을 함께 줍니다.

## 서버와 같은 판정 유지

규칙은 두 언어에 있으므로 어긋나지 않게 아래 장치를 둡니다.

- **정책은 생성물**: `data/policy.js` 는 `server/policies/*.yaml` 을 `server/scripts/export_rules_bundle.py` 로 내보낸 파일입니다. 직접 고치지 않습니다.
- **골든 벡터**: 같은 스크립트가 Python 파이프라인으로 55개 사례의 inspect·sanitize 결과를 `test/golden-vectors.json` 에 기록하고, `npm test` 가 JS 결과와 완전히 같은지 비교합니다.
- **서버 테스트**: `server/tests/test_rules_bundle.py` 는 위 두 파일이 현재 서버 규칙·정책과 다르면 실패합니다.
- Python `re` 의 Unicode 동작(`\d` `\w` `\s` `\b`)과 `ipaddress`(3.13) 의 파싱·사설망 판단을 그대로 옮겼습니다. 예: `CVE-2024-3094취약점` 처럼 한글이 붙으면 Python 과 같이 탐지하지 않습니다.

규칙·정책을 바꿀 때:

```bash
# 1) server/app/detection/rules.py 또는 server/policies/*.yaml 수정
# 2) 번들·골든 벡터 재생성
cd server && python scripts/export_rules_bundle.py
# 3) 규칙을 바꿨다면 src/rules.js 도 같은 내용으로 수정 후
cd ../packages/prompt-guard-rules && npm test
```

## 주의

- **보안 경계가 아닙니다.** 브라우저·사용자 PC 에서 도는 코드는 우회할 수 있습니다. 최종 판정은 조직 검사 서버가 하고,
  이 라이브러리는 오프라인 사전 확인, 입력 중 빠른 피드백, CLI·다른 Node 서비스 연동에 씁니다.
- 로컬 모델 문맥 탐지는 포함하지 않습니다. 정책이 `model_required: true` 이면 항상 `status: "incomplete"`(회색)입니다.
- 감사 이벤트 기록은 하지 않습니다.
- 공개 npm 레지스트리에 배포하지 않도록 `"private": true` 입니다. 팀 내부 레지스트리를 쓰기로 하면 해제합니다.
