// 확장프로그램 E2E 테스트(Playwright Chromium).
// 사전 조건: 검사 서버 http://127.0.0.1:8000 (PG_AUTH_DISABLED=true), 테스트 페이지 http://localhost:5500
// 실행: npm install && npx playwright install chromium && npm run e2e
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const EXT = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(import.meta.dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const PAGE = "http://localhost:5500/index.html";

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pg-e2e-")), {
  channel: "chromium",
  headless: true,
  viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const page = await ctx.newPage();
const results = [];
const check = (name, cond, extra = "") => {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const logCount = () => page.locator("#log li").count();
const lastLog = () => page.locator("#log li").last().textContent();
const modal = page.locator(".overlay");

async function fill(sample, target = "#ta") {
  await page.click(target);
  await page.getByRole("button", { name: sample, exact: true }).click();
}

try {
await page.goto(PAGE);
await page.waitForTimeout(1500); // content script 로드

// 1. 일반 문장: 바로 Enter → 전송되어야 함
await fill("일반 문장");
await page.waitForTimeout(1200);
check("badge green for clean text", (await page.locator(".badge").getAttribute("data-state")) === "green");
await page.press("#ta", "Enter");
await page.waitForTimeout(1000);
check("clean text is sent", (await logCount()) === 1);
check("badge hidden after send", !(await page.locator(".badge").isVisible()));

// 2. AWS 키: Enter 즉시(검사 전) → 막히고 빨간 경고
await fill("AWS 키");
await page.press("#ta", "Enter");
await modal.waitFor({ timeout: 5000 });
check("AWS key blocked (not sent)", (await logCount()) === 1);
const title = await page.locator(".title").textContent();
check("red warning title", title.includes("보낼 수 없습니다"), title);
await page.screenshot({ path: `${OUT}/1-warning-aws.png` });
await page.getByRole("button", { name: "민감정보 치환하기" }).click();
await page.getByRole("button", { name: "입력창에 반영" }).waitFor({ timeout: 5000 });
await page.screenshot({ path: `${OUT}/2-sanitized.png` });
await page.getByRole("button", { name: "입력창에 반영" }).click();
check("applied text stays in editor (no auto-send)", (await logCount()) === 1);
await page.press("#ta", "Enter");
await page.waitForTimeout(1500);
const sent = await lastLog();
check("sanitized text sent", (await logCount()) === 2 && sent.includes("[AWS_KEY_1]") && !sent.includes("AKIA"), sent);

// 3. 개인정보 + 전송 버튼 클릭(contenteditable)
await fill("개인정보", "#ce");
await page.click('[aria-label="Send message"]');
await modal.waitFor({ timeout: 5000 });
check("contenteditable PII blocked", (await logCount()) === 2);
const items = await page.locator("ul.findings li .fname").allTextContents();
check("PII findings listed", ["전화번호", "이메일 주소", "주민등록번호"].every((x) => items.includes(x)), items.join(","));
await page.screenshot({ path: `${OUT}/3-warning-pii.png` });
await page.getByRole("button", { name: "민감정보 치환하기" }).click();
await page.getByRole("button", { name: "입력창에 반영" }).click();
await page.waitForTimeout(300);
const ceText = await page.locator("#ce").innerText();
check("sanitized applied to contenteditable", ceText.includes("[PHONE_1]") && !ceText.includes("010-"), ceText);
await page.click('[aria-label="Send message"]');
await page.waitForTimeout(1500);
check("applied text sent after re-inspection", (await logCount()) === 3 && (await lastLog()).includes("[RRN_1]"));

// 4. DeepSeek(제한 기준) + CVE → 노랑, 동의 후 전송
await page.selectOption("#dest", "deepseek/consumer");
await fill("CVE");
await page.press("#ta", "Enter");
await modal.waitFor({ timeout: 5000 });
const t4 = await page.locator(".title").textContent();
check("restricted destination → yellow confirm", t4.includes("확인이 필요"), t4);
const sendAnyway = page.getByRole("button", { name: "확인 후 전송" });
check("send-anyway disabled before ack", await sendAnyway.isDisabled());
await page.screenshot({ path: `${OUT}/4-warning-yellow.png` });
await page.locator(".ack input").check();
await sendAnyway.click();
await page.waitForTimeout(1000);
check("sent after explicit ack", (await logCount()) === 4 && (await lastLog()).includes("CVE-2024-3094"));

// 5. 인젝션 문구도 차단
await page.selectOption("#dest", "");
await fill("인젝션");
await page.press("#ta", "Enter");
await modal.waitFor({ timeout: 5000 });
check("injection text still blocked", (await logCount()) === 4);
await page.keyboard.press("Escape");

// 6. Shift+Enter 는 줄바꿈(가로채지 않음)
await page.fill("#ta", "");
await page.type("#ta", "첫 줄");
await page.keyboard.press("Shift+Enter");
check("shift+enter not intercepted", !(await modal.isVisible()));

// 6-1. 테스트 모드: 통과해도 보내지 않고 진단 패널에 기록
const sw0 = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
await sw0.evaluate(() => chrome.storage.local.set({ testMode: true }));
await page.selectOption("#dest", "openai/consumer");
await fill("일반 문장");
await page.waitForTimeout(1200);
const sentBefore = await logCount();
const diag = page.locator(".diag");
const countsOf = async () => JSON.parse((await diag.getAttribute("data-intercepts")) || "{}");
const before = await countsOf();
await page.press("#ta", "Enter");
await page.waitForTimeout(800);
check("test mode: clean text not sent", (await logCount()) === sentBefore);
check("test mode: toast shown", await page.locator(".toast").isVisible());
check("test mode: diag detects editor", (await diag.getAttribute("data-editor")).startsWith("textarea#ta"));
check("test mode: diag detects send button", (await diag.getAttribute("data-send-button")).includes("send-button"));
check("test mode: diag shows destination", (await diag.getAttribute("data-destination")) === "openai/consumer");
await page.click('[data-testid="send-button"]');
await page.waitForTimeout(800);
check("test mode: click not sent", (await logCount()) === sentBefore);
const after = await countsOf();
check("test mode: intercepts counted",
  after.enter - (before.enter ?? 0) === 1 && after.click - (before.click ?? 0) === 1, JSON.stringify(after));
await page.screenshot({ path: `${OUT}/7-test-mode.png` });
await fill("AWS 키");
await page.press("#ta", "Enter");
await modal.waitFor({ timeout: 5000 });
await page.getByRole("button", { name: "민감정보 치환하기" }).click();
await page.getByRole("button", { name: "입력창에 반영" }).click();
await page.press("#ta", "Enter");
await page.waitForTimeout(1500);
check("test mode: sanitized text not sent", (await logCount()) === sentBefore);
await sw0.evaluate(() => chrome.storage.local.set({ testMode: false }));
await page.waitForTimeout(300);
check("test mode off: diag hidden", !(await diag.isVisible()));
await page.selectOption("#dest", "");

// 6-2. 내부 상태가 늦게 갱신되는 편집기(ChatGPT 방식): 치환 후 전송되는 것은 반드시 치환된 텍스트
await page.locator("#pm").click();
await page.getByRole("button", { name: "AWS 키", exact: true }).click();
await page.waitForTimeout(100);
await page.press("#pm", "Enter");
await modal.waitFor({ timeout: 5000 });
await page.getByRole("button", { name: "민감정보 치환하기" }).click();
await page.getByRole("button", { name: "이전으로" }).waitFor({ timeout: 5000 });
check("no auto-send after programmatic replace",
  (await page.getByRole("button", { name: "반영하고 전송" }).count()) === 0);
await page.getByRole("button", { name: "입력창에 반영" }).click();
const sentBefore62 = await logCount();
await page.press("#pm", "Enter"); // 사용자가 치환 결과를 보고 직접 전송
await page.waitForTimeout(1500);
const sent62 = await lastLog();
check("async-state editor sends sanitized text only",
  (await logCount()) === sentBefore62 + 1 && sent62.includes("[AWS_KEY_1]") && !sent62.includes("AKIA"), sent62);
const countBefore7 = await logCount();

// 7. 서버 연결 불가 → 회색, 전송 보류 (서버 주소를 닫힌 포트로 변경)
await sw0.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:9" }));
await fill("일반 문장");
await page.press("#ta", "Enter");
await modal.waitFor({ timeout: 20000 });
const t7 = await page.locator(".title").textContent();
check("server down → held, gray", t7.includes("보류") && (await logCount()) === countBefore7, t7);
await page.screenshot({ path: `${OUT}/5-server-down.png` });

// 8. 신호등 위젯: 입력 즉시(서버 응답 전) 임시 빨간불, 서버가 확정한 뒤 Tier 1
await sw0.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:8000" }));
await page.reload();
await page.waitForTimeout(1500);
await page.click("#ta");
await page.getByRole("button", { name: "개인정보", exact: true }).click();
const badge = page.locator(".badge");
await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge[data-state='red']"), null, { timeout: 5000 });
const chip = await badge.locator(".chip-w").textContent();
check("widget shows Tier 1 with finding summary", chip.includes("Tier 1") && chip.includes("전화번호"), chip);
await page.screenshot({ path: `${OUT}/7-widget-red.png` });

// 9. 위젯에서 바로 정제 → 미리보기(토큰 칩) → 입력창은 아직 원문
await badge.getByRole("button", { name: "안전 다듬기" }).click();
await page.waitForFunction(() => /정제 완료/.test(document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge .chip-w")?.textContent || ""), null, { timeout: 8000 });
const tokens = await badge.locator(".pbody .tk").allTextContents();
check("preview lists replaced tokens", ["[PHONE_1]", "[EMAIL_1]", "[RRN_1]"].every((t) => tokens.includes(t)), tokens.join(","));
check("input untouched until applied", (await page.inputValue("#ta")).includes("010-1234-5678"));
await page.screenshot({ path: `${OUT}/8-widget-sanitized.png` });

// 10. 입력창에 넣기(자동 전송 없음) → 사용자가 직접 전송 → 사이트에는 토큰만, 답변의 토큰은 원래 값으로 복원
const n10 = await logCount();
await badge.getByRole("button", { name: "입력창에 넣기" }).click();
await page.waitForTimeout(1200); // 사이트 내부 상태 갱신 + 재검사
check("nothing sent automatically", (await logCount()) === n10);
check("sanitized text is in the input", (await page.inputValue("#ta")).includes("[PHONE_1]"));
await page.press("#ta", "Enter"); // 사용자가 확인 후 직접 전송
await page.waitForTimeout(800);
const sent10 = await lastLog();
check("only tokens reach the AI", (await logCount()) === n10 + 1 && sent10.includes("[PHONE_1]") && !sent10.includes("010-1234"), sent10.slice(0, 80));
await page.waitForTimeout(4500);
const reply = await page.locator("[data-pg-assistant]").last().innerText();
check("reply tokens restored to original values", reply.includes("010-1234-5678") && reply.includes("hong@example.com") && !reply.includes("[PHONE_1]"), reply.replace(/\n/g, " ").slice(0, 90));
check("restored values are marked", (await page.locator(".pg-restored").count()) >= 1);
await page.screenshot({ path: `${OUT}/9-restored.png` });

// 11. 정제 후 되돌리기
await page.click("#ta");
await page.getByRole("button", { name: "AWS 키", exact: true }).click();
await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge[data-state='red']"), null, { timeout: 5000 });
await page.waitForTimeout(800);
await badge.getByRole("button", { name: "안전 다듬기" }).click();
await badge.getByRole("button", { name: "입력창에 넣기" }).waitFor({ timeout: 8000 });
await badge.getByRole("button", { name: "입력창에 넣기" }).click();
check("applied sanitized text to input", (await page.inputValue("#ta")).includes("[AWS_KEY_1]"));
await badge.getByRole("button", { name: "원문으로 되돌리기" }).click();
await page.waitForTimeout(300);
check("revert restores original text", (await page.inputValue("#ta")).includes("AKIAIOSFODNN7EXAMPLE"));

// 12. 그래도 전송: 확인 체크 없이는 보낼 수 없다
await page.waitForTimeout(800);
const n12 = await logCount();
await badge.getByRole("button", { name: "그래도 전송" }).click();
const forceBtn = page.getByRole("button", { name: "그래도 전송" }).last();
check("force send needs acknowledgement", await forceBtn.isDisabled());
await page.locator(".ack input").check();
await forceBtn.click();
await page.waitForTimeout(1000);
check("force send sends original once", (await logCount()) === n12 + 1 && (await lastLog()).includes("AKIA"));

// 13. 파일 첨부(텍스트): 민감정보가 있으면 위치를 보여 주고 '그래도 진행할지' 묻는다. 깨끗하면 묻지 않는다.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pg-files-"));
const secret = path.join(tmp, "secret.env"); fs.writeFileSync(secret, "DB_HOST=db.local\nAWS_KEY=AKIAIOSFODNN7EXAMPLE\n");
const clean = path.join(tmp, "notes.txt"); fs.writeFileSync(clean, "회의록: API 문서 정리\n");
const png = path.join(tmp, "pic.png"); fs.writeFileSync(png, Buffer.from("iVBORw0KGgo=", "base64"));
const logsBefore = await logCount();
const ackBox = page.locator(".ack input");
await page.setInputFiles("#file", secret);
await modal.waitFor({ timeout: 10000 });
const fileModal = await modal.innerText();
check("secret file: asks, shows file name, line and the sensitive value",
  fileModal.includes("secret.env") && fileModal.includes("2줄") && fileModal.includes("AKIAIOSFODNN7EXAMPLE"), fileModal.replace(/\s+/g, " ").slice(0, 110));
check("nothing is attached while asking", (await logCount()) === logsBefore);
await page.screenshot({ path: `${OUT}/10-file-review.png` });
await page.getByRole("button", { name: "첨부 취소" }).click();
await page.waitForTimeout(600);
check("cancel keeps the file out", (await logCount()) === logsBefore && !(await modal.isVisible()));
await page.setInputFiles("#file", secret);
await modal.waitFor({ timeout: 10000 });
const goBtn = page.getByRole("button", { name: "그래도 진행" });
check("proceed needs acknowledgement", await goBtn.isDisabled());
await ackBox.check();
await goBtn.click();
await page.waitForTimeout(1200);
check("proceed attaches the file", (await logCount()) === logsBefore + 1 && (await lastLog()).includes("secret.env"));
await page.setInputFiles("#file", clean);
await page.waitForTimeout(1500);
check("clean text file attached without asking", !(await modal.isVisible()) && (await logCount()) === logsBefore + 2 && (await lastLog()).includes("notes.txt"));
await page.setInputFiles("#file", png);
await modal.waitFor({ timeout: 10000 });
const imgModal = await modal.innerText();
check("unreadable image: says it is unreadable and unknown-safety, asks",
  imgModal.includes("읽을 수 없는 파일") && imgModal.includes("안전한지 알 수 없습니다") && imgModal.includes("pic.png"), imgModal.replace(/\s+/g, " ").slice(0, 100));
check("unreadable file needs no acknowledgement", !(await goBtn.isDisabled()));
await page.screenshot({ path: `${OUT}/10b-file-unreadable.png` });
await goBtn.click();
await page.waitForTimeout(1200);
check("unreadable image attached after confirming", (await logCount()) === logsBefore + 3);

// 14. 붙여넣기를 직접 처리하는 편집기(input 이벤트 없음): 다른 입력이 없어도 신호등이 갱신된다
await page.click("#cq");
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "연락처는 kim@example.com 입니다");
  document.getElementById("cq").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge[data-state='red']"), null, { timeout: 5000 }).catch(() => {});
const pasteChip = await badge.locator(".chip-w").textContent().catch(() => "");
check("paste without any other input updates the light", pasteChip.includes("Tier 1") && pasteChip.includes("이메일"), pasteChip);
await page.screenshot({ path: `${OUT}/11-paste-updated.png` });
await page.locator("#cq").evaluate((el) => { el.textContent = ""; });
await page.waitForTimeout(500);

// 14-2. Quill 방식: 붙여넣기를 숨은 편집 영역(.ql-clipboard)을 거쳐 처리한다(실제 Gemini 에서 신호등이 사라지던 원인)
await page.click("#qe");
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "연락처 lee@example.com 입니다");
  document.getElementById("qe").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForFunction(() => document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge[data-state='red']"), null, { timeout: 5000 }).catch(() => {});
const qChip = await badge.locator(".chip-w").textContent().catch(() => "");
check("hidden-helper editor paste keeps the light on", qChip.includes("Tier 1") && qChip.includes("이메일"), qChip);
await page.screenshot({ path: `${OUT}/11b-paste-quill.png` });
await page.locator("#qe").evaluate((el) => { el.textContent = ""; });
await page.waitForTimeout(500);

// 15. PDF: 글자를 뽑아 검사한다. 민감한 쪽을 알려 주고 묻는다, 깨끗하면 통과, 글자 없는 스캔본·음성은 '읽을 수 없는 파일' 질문
function makePdf(pages) {
  // pages: 쪽마다 줄 배열. 빈 배열이면 글자 없는(스캔본 같은) 쪽
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const font = 3;
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  pages.forEach((lines, i) => {
    const pid = 4 + i * 2, cid = 5 + i * 2;
    const body = lines.length
      ? `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`
      : "0.8 g 100 100 200 200 re f";
    kids.push(`${pid} 0 R`);
    objs[pid - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cid} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`;
    objs[cid - 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
const secretPdf = path.join(tmp, "report.pdf");
fs.writeFileSync(secretPdf, makePdf([["Weekly report", "Everything is fine"], ["Deploy notes", "aws_access_key_id = AKIAIOSFODNN7EXAMPLE"]]));
const cleanPdf = path.join(tmp, "minutes.pdf"); fs.writeFileSync(cleanPdf, makePdf([["Weekly meeting minutes", "Goal: finish API documentation"]]));
const scanPdf = path.join(tmp, "scan.pdf"); fs.writeFileSync(scanPdf, makePdf([[]]));
const mp3 = path.join(tmp, "voice.mp3"); fs.writeFileSync(mp3, Buffer.from("SUQzBAAAAAAA", "base64"));
const base15 = await logCount();

await page.setInputFiles("#file", secretPdf);
await modal.waitFor({ timeout: 20000 });
const pdfModal = await modal.innerText();
check("PDF with a secret: shows the page number and the sensitive value",
  pdfModal.includes("report.pdf") && pdfModal.includes("2쪽") && !pdfModal.includes("1쪽") && pdfModal.includes("AKIAIOSFODNN7EXAMPLE"), pdfModal.replace(/\s+/g, " ").slice(0, 110));
check("PDF is not attached while asking", (await logCount()) === base15);
await page.screenshot({ path: `${OUT}/12-pdf-review.png` });
await page.getByRole("button", { name: "첨부 취소" }).click();
await page.waitForTimeout(600);
check("PDF cancel keeps it out", (await logCount()) === base15);

await page.setInputFiles("#file", cleanPdf);
await page.waitForFunction(() => /검사 완료/.test(document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge .wnotice")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
const okNote = await badge.locator(".wnotice").textContent().catch(() => "");
check("clean PDF: analyzed, attached without asking", okNote.includes("PDF") && !(await modal.isVisible()) && (await logCount()) === base15 + 1, okNote.slice(0, 70));

await page.setInputFiles("#file", scanPdf);
await modal.waitFor({ timeout: 20000 });
const scanModal = await modal.innerText();
check("scanned PDF: unreadable question", scanModal.includes("스캔본") && scanModal.includes("안전한지 알 수 없습니다") && scanModal.includes("그래도 진행"), scanModal.replace(/\s+/g, " ").slice(0, 100));
await page.getByRole("button", { name: "그래도 진행" }).click();
await page.waitForTimeout(1200);
check("scanned PDF attached after confirming", (await logCount()) === base15 + 2);

await page.setInputFiles("#file", mp3);
await modal.waitFor({ timeout: 10000 });
const mp3Modal = await modal.innerText();
check("audio file: says it cannot be read, asks", mp3Modal.includes("음성") && mp3Modal.includes("읽을 수 없는 파일") && mp3Modal.includes("안전한지 알 수 없습니다"), mp3Modal.replace(/\s+/g, " ").slice(0, 100));
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
check("closing the question (Esc) means cancel", !(await modal.isVisible()) && (await logCount()) === base15 + 2);

// 한글 PDF(글꼴이 들어 있는 일반 PDF): 쪽 번호와 함께 한글 민감정보를 찾는다
const kp = await ctx.newPage();
await kp.setContent('<html><body style="font-family:sans-serif"><h1>인사 기록</h1><p>고객 홍길동 주민등록번호 900101-1234567</p></body></html>');
const korPdf = path.join(tmp, "korean.pdf");
await kp.pdf({ path: korPdf });
await kp.close();
await page.bringToFront();
await page.setInputFiles("#file", korPdf);
await modal.waitFor({ timeout: 20000 });
const korModal = await modal.innerText();
check("Korean PDF: finds the resident number with its page", korModal.includes("korean.pdf") && korModal.includes("1쪽") && korModal.includes("주민등록번호"), korModal.replace(/\s+/g, " ").slice(0, 100));
await page.getByRole("button", { name: "첨부 취소" }).click();
await page.waitForTimeout(500);

// 옵션을 켜면 읽을 수 없는 파일은 묻지 않고 바로 막는다
await sw0.evaluate(() => chrome.storage.local.set({ blockUnscannableFiles: true }));
await page.waitForTimeout(400);
await page.setInputFiles("#file", mp3);
await page.waitForFunction(() => /막았습니다/.test(document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge .wnotice")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
check("block-unreadable option: blocked without asking", !(await modal.isVisible()) && (await logCount()) === base15 + 2);
await sw0.evaluate(() => chrome.storage.local.set({ blockUnscannableFiles: false }));

// 팝업 확인은 서버가 꺼진 상태를 기준으로 하므로 다시 닫힌 포트로 돌려 둔다
await sw0.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:9" }));

// 팝업
const [sw] = ctx.serviceWorkers().length ? ctx.serviceWorkers() : [await ctx.waitForEvent("serviceworker")];
const extId = sw.url().split("/")[2];
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 340, height: 260 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(800);
await popup.screenshot({ path: `${OUT}/6-popup.png` });
check("popup shows server down", (await popup.locator("#status").textContent()).includes("연결 안 됨"));
check("popup shows the extension version", (await popup.locator("#ver").textContent()).includes("0.2.0"));
} catch (e) {
  results.push("ERROR " + e.message.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/error.png` });
}
console.log(results.join("\n"));
await ctx.close();
process.exit(results.some((r) => !r.startsWith("PASS")) ? 1 : 0);
