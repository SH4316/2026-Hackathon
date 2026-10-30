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

## 자동 E2E 테스트

검사 서버(8000, 인증 끔)와 테스트 페이지(5500)를 띄운 상태에서:

```powershell
cd extension
npm install
npx playwright install chromium   # 처음 한 번
npm run e2e
```

Playwright 의 Chromium 에 확장프로그램을 올려 위 시나리오 17개를 확인하고, 화면 캡처를 `tests/shots/` 에 저장합니다.
(일반 Chrome 은 명령줄 확장 로드를 막아 두었기 때문에 Playwright Chromium 을 씁니다.)

## 지원 사이트와 한계

`manifest.json` 의 `content_scripts.matches`: ChatGPT, Claude, Gemini, Copilot, DeepSeek, Kimi, Mistral, Perplexity, Grok, Qwen, Meta AI, 그리고 테스트용 localhost.

- 실제 사이트에서는 **아직 검증하지 않았습니다.** 입력창(textarea·contenteditable)과 전송 버튼(`data-testid="send-button"`, `aria-label` 의 Send·전송·보내기)을 넓게 찾지만, 사이트 개편 시 `src/sites.js` 의 선택자를 고쳐야 합니다.
- 사이트가 isTrusted 이벤트만 받거나 별도 단축키·음성 입력·파일 첨부로 보내는 경로는 막지 못합니다.
- 서버 판정은 "검사 결과"이고, 실제 전송·차단 이벤트를 서버로 보내는 계약은 아직 없습니다(`server/docs/api-contract.md`).
- 기본 서버 권한은 `127.0.0.1`, `localhost` 입니다. 다른 서버 주소는 설정에서 저장할 때 권한을 요청합니다. 원격 서버는 HTTPS 를 쓰세요.
- 아이콘 이미지는 아직 없습니다(Chrome 기본 아이콘).

## 파일

```text
extension/
├─ manifest.json
├─ src/
│  ├─ background.js   # 서버 호출(서비스 워커)
│  ├─ content.js      # 입력 감지·검사·전송 가로채기
│  ├─ ui.js           # 배지·경고 화면·정제 화면(Shadow DOM)
│  ├─ sites.js        # 사이트 → 목적지, 전송 버튼 선택자
│  ├─ labels.js       # 코드값 → 화면 문구
│  ├─ popup.js, options.js, pages.css
├─ popup.html, options.html
├─ test-page/index.html   # 시험용 채팅 페이지
└─ tests/e2e.mjs          # Playwright E2E
```
