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
