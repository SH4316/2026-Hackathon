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
await page.getByRole("button", { name: "반영하고 전송" }).waitFor({ timeout: 5000 });
await page.screenshot({ path: `${OUT}/2-sanitized.png` });
await page.getByRole("button", { name: "반영하고 전송" }).click();
await page.waitForTimeout(1000);
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

// 7. 서버 연결 불가 → 회색, 전송 보류 (서버 주소를 닫힌 포트로 변경)
const sw0 = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
await sw0.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:9" }));
await fill("일반 문장");
await page.press("#ta", "Enter");
await modal.waitFor({ timeout: 20000 });
const t7 = await page.locator(".title").textContent();
check("server down → held, gray", t7.includes("보류") && (await logCount()) === 4, t7);
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
check("input untouched until send", (await page.inputValue("#ta")).includes("010-1234-5678"));
await page.screenshot({ path: `${OUT}/8-widget-sanitized.png` });

// 10. 안전 전송 → 사이트에는 토큰만, 답변의 토큰은 원래 값으로 복원
const n10 = await logCount();
await badge.getByRole("button", { name: "AI로 안전 전송" }).click();
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
await badge.getByRole("button", { name: "입력창에 적용" }).waitFor({ timeout: 8000 });
await badge.getByRole("button", { name: "입력창에 적용" }).click();
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

// 13. 파일 첨부: 비밀이 든 텍스트 파일은 막고, 평범한 파일·이미지는 통과
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pg-files-"));
const secret = path.join(tmp, "secret.env"); fs.writeFileSync(secret, "AWS_KEY=AKIAIOSFODNN7EXAMPLE\n");
const clean = path.join(tmp, "notes.txt"); fs.writeFileSync(clean, "회의록: API 문서 정리\n");
const png = path.join(tmp, "pic.png"); fs.writeFileSync(png, Buffer.from("iVBORw0KGgo=", "base64"));
const logsBefore = await logCount();
await page.setInputFiles("#file", secret);
await page.waitForFunction(() => /첨부를 막았습니다/.test(document.querySelector("#pg-root-host")?.shadowRoot?.querySelector(".badge .wnotice")?.textContent || ""), null, { timeout: 8000 });
check("secret text file blocked", (await logCount()) === logsBefore);
await page.setInputFiles("#file", clean);
await page.waitForTimeout(1200);
check("clean text file attached", (await logCount()) === logsBefore + 1 && (await lastLog()).includes("notes.txt"));
await page.setInputFiles("#file", png);
await page.waitForTimeout(1200);
const note = await badge.locator(".wnotice").textContent();
check("image warned but attached", note.includes("검사하지 못합니다") && (await logCount()) === logsBefore + 2, note.slice(0, 40));
await page.screenshot({ path: `${OUT}/10-file-notice.png` });

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
} catch (e) {
  results.push("ERROR " + e.message.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/error.png` });
}
console.log(results.join("\n"));
await ctx.close();
process.exit(results.some((r) => !r.startsWith("PASS")) ? 1 : 0);
