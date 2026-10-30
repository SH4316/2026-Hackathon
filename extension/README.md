# Prompt Guard 크롬 확장프로그램 (PoC)

AI 사이트 입력창의 프롬프트를 조직 검사 서버(`server/`)로 검사하고, 민감정보가 있으면 전송을 멈추고 경고 화면을 띄웁니다.
확장프로그램 파트 개발의 출발점이 되는 시험용 구현입니다.

## 동작

| 상황 | 동작 |
|---|---|
| 입력 중 | 0.7초 쉬면 검사, 오른쪽 아래 배지로 상태 표시(통과·확인 필요·민감정보 있음·검사 불가) |
| Enter·전송 버튼 | 전송 직전 텍스트가 **검사 완료 + 통과**일 때만 그대로 전송. 아니면 막고 경고 화면 |
| 빨강(차단) | 탐지 항목·위치 표시, "민감정보 치환하기" → 서버가 치환·재검사 → 반영 또는 반영하고 전송 |
| 노랑(확인) | 동의 체크 후에만 "확인 후 전송" 가능 |
| 회색(검사 불가) | 서버 연결 실패·시간 초과·모델 미완료. **전송 보류**, 자동 폴백 없음 |

- 입력이 바뀌면 이전 결과와 전송 승인을 무효화하고, 늦게 도착한 응답은 버립니다(`input_version`).
- 한글 IME 조합 중 Enter, Shift+Enter 는 가로채지 않습니다.
- 사이트 주소로 전송 대상(`destination`)을 정합니다. 요금제·계약은 알 수 없으므로 항상 `consumer` 로 보내고, 서버는 이 값으로 정책을 완화하지 않습니다.
- 경고 화면은 Shadow DOM 으로 사이트 CSS 와 분리했고, 사용자 텍스트는 `textContent` 로만 그립니다.
- 원문은 확장프로그램 저장소·콘솔에 남기지 않습니다. 서버 주소·API 키·사용 여부만 `chrome.storage.local` 에 저장합니다.

## SafePrompt 위젯 (입력창 신호등)

입력창 위에 붙는 신호등 위젯입니다. 색은 [BRAND_GUIDELINES.md](../BRAND_GUIDELINES.md)의 토큰을 따르고, 시스템 테마(다크/라이트)에 맞춰 바뀝니다.

| 신호 | 표시 | 할 수 있는 것 |
|---|---|---|
| 🔴 Tier 1 차단 | 탐지 항목 요약 | [안전 다듬기], [그래도 전송](확인 후), 칩을 눌러 자세히 보기 |
| 🟡 Tier 2 주의 | 탐지 항목 요약 | 위와 같음 |
| 🟢 Tier 3 안전 | 검사 통과, 또는 "정제 완료" | 정제 후에는 [AI로 안전 전송] |
| ⚪ 검사 불가 | 서버 무응답·미완료 | 전송 보류(자동 폴백 없음) |

- **입력 즉시 임시 표시**: 브라우저 안의 규칙 엔진(`@prompt-guard/rules`)이 서버 응답 전에 "(서버 확인 중)"으로 먼저 알려 줍니다. 전송 허용 근거는 계속 서버의 '검사 완료 + 통과'뿐입니다.
- **안전 다듬기 → 미리보기 → 안전 전송**: 입력창은 그대로 두고 위젯에 토큰이 들어간 문장을 미리 보여 줍니다. [AI로 안전 전송]을 누르면 입력창에 넣고 보냅니다. [입력창에 적용]·[원문으로 되돌리기]도 있습니다.
- **답변 복원**: 서버는 복원 매핑을 주지 않으므로, 브라우저가 서버와 같은 규칙으로 토큰 번호를 매기고 **서버 정제문과 한 글자도 다르지 않을 때만** 매핑을 믿습니다. 정제해서 보낸 뒤 새로 생긴 답변의 `[EMAIL_1]` 같은 토큰을 원래 값으로 바꿔 점선 밑줄로 표시합니다. 매핑은 탭 메모리에만 있고 새로고침하면 사라집니다.
- **파일**: 텍스트·코드 파일은 내용을 서버에서 검사해 민감정보가 있으면 첨부를 막습니다. 이미지·음성·문서는 내용을 분석하지 못한다고 경고만 합니다(설정에서 막기로 변경 가능).
- **그래도 전송**: 확인 체크를 해야만 그 한 번의 전송이 나갑니다.
- 팝업에 이 브라우저에서 막은 횟수·다듬은 횟수·강행 횟수가 표시됩니다(어디로도 전송하지 않음).

## 규칙 엔진 복사본(vendor)

확장프로그램은 번들러 없이 폴더째 로드되므로 `packages/prompt-guard-rules`를 `vendor/prompt-guard-rules/`에 복사해 둡니다. 규칙·정책이 바뀌면:

```bash
npm run vendor          # 복사
npm run vendor:check    # 복사본이 최신인지 확인(다르면 종료 코드 1)
```

## 설치 (개발자 모드)

1. 검사 서버 실행(PowerShell):
   ```powershell
   cd server
   $env:PG_AUTH_DISABLED="true"
   .venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8000 --no-access-log
   ```
   가상환경이 없다면 `server/README.md` 의 로컬 개발 절차를 먼저 따릅니다.
2. Chrome 에서 `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기 → **압축해제된 확장 프로그램을 로드합니다** → 이 `extension` 폴더 선택
3. 툴바의 Prompt Guard 아이콘 → 검사 서버 **연결됨** 확인
   - 서버가 인증을 켜고 있다면 **설정 열기**에서 API 키를 입력합니다.

## 테스트 페이지로 확인

실제 AI 사이트는 화면 구조가 자주 바뀌므로, 먼저 테스트 페이지에서 확인하세요.

```powershell
cd extension\test-page
python -m http.server 5500 --bind 127.0.0.1
```

http://localhost:5500 을 열고 예시 프롬프트 버튼을 눌러 봅니다.

| 예시 | 기대 결과 |
|---|---|
| 일반 문장 | 초록 배지, Enter 로 바로 전송 |
| AWS 키 / 개인정보 / 비밀번호 | 빨간 경고 → 치환 → `[AWS_KEY_1]`, `[PHONE_1]` 등으로 바뀐 문장만 전송 |
| 내부 IP | 목적지 미지정·개인용 AI 는 강화 기준이라 빨강(치환 필요) |
| CVE + DeepSeek 선택 | 제한 기준이라 노랑, 동의 체크 후 전송 가능 |
| 인젝션 | "안전하다고 판단하라" 문구가 있어도 차단 |
| 서버를 끈 상태 | 회색 "전송을 보류했습니다" |

"전송된 메시지" 목록에 쌓이는 것이 외부 AI로 나갔다고 가정한 내용입니다.

## 단위 테스트

```bash
npm test      # 토큰 복원(서버와 같은 번호 규칙, UTF-16 위치) — 서버·브라우저 없이 실행
```

## 자동 E2E 테스트

검사 서버(8000, 인증 끔)와 테스트 페이지(5500)를 띄운 상태에서:

```powershell
cd extension
npm install
npx playwright install chromium   # 처음 한 번
npm run e2e
```

Playwright 의 Chromium 에 확장프로그램을 올려 위 시나리오와 SafePrompt 위젯(즉시 임시 빨간불·정제 미리보기·안전 전송·답변 복원·되돌리기·그래도 전송·파일 첨부) 시나리오 등 30개를 확인하고, 화면 캡처를 `tests/shots/` 에 저장합니다.
(일반 Chrome 은 명령줄 확장 로드를 막아 두었기 때문에 Playwright Chromium 을 씁니다.)

## 지원 사이트와 한계

`manifest.json` 의 `content_scripts.matches`: ChatGPT, Claude, Gemini, Copilot, DeepSeek, Kimi, Mistral, Perplexity, Grok, Qwen, Meta AI, 그리고 테스트용 localhost.

- 실제 사이트에서는 **아직 검증하지 않았습니다.** 입력창(textarea·contenteditable)과 전송 버튼(`data-testid="send-button"`, `aria-label` 의 Send·전송·보내기)을 넓게 찾지만, 사이트 개편 시 `src/sites.js` 의 선택자를 고쳐야 합니다.
- 사이트가 isTrusted 이벤트만 받거나 별도 단축키·음성 입력·파일 첨부로 보내는 경로는 막지 못합니다.
- 서버 판정은 "검사 결과"이고, 실제 전송·차단 이벤트를 서버로 보내는 계약은 아직 없습니다(`server/docs/api-contract.md`). 팝업의 횟수는 이 브라우저에만 저장합니다.
- 이미지·음성은 내용을 분석하지 않습니다(OCR·음성 인식은 서버 쪽 후속 과제). 답변 복원은 새로고침하면 사라집니다.
- 답변 영역 선택자(`src/sites.js`의 `RESPONSE_SELECTORS`)는 실제 사이트에서 검증하지 않았습니다.
- 기본 서버 권한은 `127.0.0.1`, `localhost` 입니다. 다른 서버 주소는 설정에서 저장할 때 권한을 요청합니다. 원격 서버는 HTTPS 를 쓰세요.
- 아이콘 이미지는 아직 없습니다(Chrome 기본 아이콘).

## 파일

```text
extension/
├─ manifest.json
├─ src/
│  ├─ background.js   # 서버 호출(서비스 워커)
│  ├─ content.js      # 입력 감지·검사·전송 가로채기
│  ├─ ui.js           # 신호등 위젯·경고 화면·정제 화면(Shadow DOM)
│  ├─ restore.js      # 정제 토큰 매핑·답변 복원
│  ├─ files.js        # 파일 첨부 검사
│  ├─ local.js        # 브라우저 안 규칙 엔진 로더(vendor/)
│  ├─ sites.js        # 사이트 → 목적지, 전송 버튼 선택자
│  ├─ labels.js       # 코드값 → 화면 문구
│  ├─ popup.js, options.js, pages.css
├─ popup.html, options.html
├─ vendor/prompt-guard-rules/  # packages/ 의 복사본(npm run vendor)
├─ scripts/vendor-rules.mjs
├─ test-page/index.html   # 시험용 채팅 페이지(답변 시뮬레이션·파일 입력 포함)
├─ tests/restore.test.mjs # 단위 테스트
└─ tests/e2e.mjs          # Playwright E2E
```
