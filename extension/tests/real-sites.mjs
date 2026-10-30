// 실제 AI 사이트에서 확장프로그램이 동작하는지 점검한다(Playwright Chromium + 테스트 모드).
//
//   node tests/real-sites.mjs --login            # 처음 한 번: 열린 창에서 각 사이트에 로그인 후 창을 닫는다
//   node tests/real-sites.mjs                    # probe: 입력창·전송 버튼 감지만 확인(키 입력·전송 없음)
//   node tests/real-sites.mjs --type             # probe + 무해한 문장을 입력만 하고(Enter·클릭 없음) 전송 버튼 감지 확인 후 지움
//   node tests/real-sites.mjs --full             # 무해한 문장으로 Enter·클릭 가로채기 → 가짜 키로 경고 화면 확인
//   옵션: --sites chatgpt,claude  --headless
//
// 안전장치
// - 시작 전에 확장프로그램 테스트 모드를 켜고 확인한다. 테스트 모드에서는 검사를 통과해도 보내지 않는다.
// - --full 은 먼저 무해한 문장으로 Enter 가로채기를 확인하고, 실패한 사이트는 가짜 비밀값 단계를 건너뛴다.
//   (가로채기에 실패하면 그 무해한 문장은 실제로 전송될 수 있다)
// - 가짜 비밀값은 AWS 문서의 예시 키(AKIAIOSFODNN7EXAMPLE)만 쓴다.
// 사전 조건: 검사 서버가 설정의 주소(기본 http://127.0.0.1:8000)에서 실행 중.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE = path.join(ROOT, ".real-sites-profile");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const { sites: allSites } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "real-sites.json"), "utf8"));
const only = opt("sites")?.split(",");
const sites = only ? allSites.filter((s) => only.includes(s.id)) : allSites;
const mode = flag("login") ? "login" : flag("full") ? "full" : "probe"; // --type 은 probe 의 확장

const HARMLESS = "Prompt Guard 확장프로그램 점검 문장입니다.";
const FAKE_SECRET = "배포 설정 확인 aws_access_key_id = AKIAIOSFODNN7EXAMPLE";
const SEND_SELECTORS = [
  '[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="Submit" i]',
  'button[aria-label*="전송"]', 'button[aria-label*="보내기"]', 'button[aria-label*="제출"]',
  ".send-button-container", '[class~="send-button"]',
];

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: "chromium",
  headless: flag("headless") && mode !== "login",
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));

if (mode === "login") {
  for (const s of sites) await (await ctx.newPage()).goto(s.url).catch(() => {});
  console.log("열린 탭에서 필요한 사이트에 로그인한 뒤 브라우저 창을 닫으세요. 로그인 상태는 .real-sites-profile 에 저장됩니다.");
  await ctx.waitForEvent("close", { timeout: 0 });
  process.exit(0);
}

// 테스트 모드 강제 + 확인
await sw.evaluate(() => chrome.storage.local.set({ testMode: true, enabled: true }));
const stored = await sw.evaluate(() => chrome.storage.local.get(["testMode", "serverUrl"]));
if (stored.testMode !== true) throw new Error("테스트 모드를 켜지 못해 중단합니다.");
const health = await sw.evaluate(async (url) => {
  try { return (await fetch(url.replace(/\/+$/, "") + "/readyz")).ok; } catch { return false; }
}, stored.serverUrl || "http://127.0.0.1:8000");
if (!health) {
  console.error("검사 서버에 연결할 수 없습니다. 서버를 먼저 실행하세요.");
  await ctx.close();
  process.exit(2);
}

const OUT = path.join(import.meta.dirname, "real-sites-out", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(OUT, { recursive: true });

const diagOf = async (page) => {
  const el = page.locator(".diag");
  if (!(await el.count())) return null;
  const d = (k) => el.getAttribute(`data-${k}`);
  return {
    editor: await d("editor"), sendButton: await d("send-button"), destination: await d("destination"),
    intercepts: JSON.parse((await d("intercepts")) || "{}"), lastOutcome: await d("last-outcome"),
    dryRuns: Number(await d("dry-runs")),
  };
};

async function waitDiag(page, timeout = 20000) {
  const end = Date.now() + timeout;
  let d = null;
  while (Date.now() < end) {
    d = await diagOf(page).catch(() => null);
    if (d?.editor) return d;
    await page.waitForTimeout(1000);
  }
  return d;
}

async function editorLocator(page) {
  const sel = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
  const all = page.locator(sel);
  let best = null, bestArea = 0;
  for (let i = 0; i < (await all.count()); i++) {
    const loc = all.nth(i);
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width * box.height > bestArea && box.width > 20 && box.height > 10) {
      best = loc; bestArea = box.width * box.height;
    }
  }
  return best;
}

async function clearEditor(page) {
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
}

const editorText = (loc) => loc.evaluate((el) => (el.tagName === "TEXTAREA" ? el.value : el.innerText).trim());

async function checkSite(site) {
  const r = { site: site.name, url: site.url, loaded: false, editor: null, sendButton: null, destination: null };
  const page = await ctx.newPage();
  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    r.loaded = true;
    const d = await waitDiag(page);
    Object.assign(r, { editor: d?.editor || null, sendButton: d?.sendButton || null, destination: d?.destination || null });
    await page.screenshot({ path: path.join(OUT, `${site.id}-1-probe.png`) });
    if (!r.editor || (mode === "probe" && !flag("type"))) return r;

    // 입력 후 전송 버튼 감지(많은 사이트가 텍스트가 있어야 전송 버튼을 보여 준다)
    const ed = await editorLocator(page);
    await ed.click();
    await clearEditor(page);
    await page.keyboard.type(HARMLESS, { delay: 15 });
    await page.waitForTimeout(1500);
    const typed = await diagOf(page);
    r.sendButtonAfterTyping = typed.sendButton || null;
    await page.screenshot({ path: path.join(OUT, `${site.id}-2-typed.png`) });
    if (mode !== "full") { await clearEditor(page); return r; }

    // 1) 무해한 문장으로 Enter 가로채기
    // 성공 기준: Enter 를 가로챘고 입력창 내용이 그대로(전송 안 됨).
    // 통과면 테스트 모드 보류, 제한 등급 사이트면 확인 화면이 뜬다 — 어느 쪽이든 전송되지 않아야 한다.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    const after = await diagOf(page);
    r.enterIntercepted = (after.intercepts.enter ?? 0) > (typed.intercepts.enter ?? 0) &&
      (await editorText(ed)).includes("점검 문장");
    r.harmlessOutcome = after.lastOutcome;
    if (await page.locator(".overlay").isVisible()) await page.keyboard.press("Escape");
    if (!r.enterIntercepted) {
      r.note = "Enter 가로채기 실패: 가짜 비밀값 단계 생략(무해한 문장이 전송됐을 수 있음)";
      await page.screenshot({ path: path.join(OUT, `${site.id}-3-enter-failed.png`) });
      return r;
    }

    // 2) 가짜 비밀값 → Enter → 경고 화면
    await clearEditor(page);
    await page.keyboard.type(FAKE_SECRET, { delay: 10 });
    await page.keyboard.press("Enter");
    r.warningOnEnter = await page.locator(".overlay").waitFor({ timeout: 10000 }).then(() => true, () => false);
    await page.screenshot({ path: path.join(OUT, `${site.id}-4-warning.png`) });
    if (r.warningOnEnter) await page.keyboard.press("Escape");

    // 3) 전송 버튼 클릭 → 경고 화면
    if (r.sendButtonAfterTyping) {
      await ed.click();
      let clicked = false;
      for (const sel of SEND_SELECTORS) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) { await btn.click({ timeout: 5000 }).catch(() => {}); clicked = true; break; }
      }
      r.warningOnClick = clicked && await page.locator(".overlay").waitFor({ timeout: 10000 }).then(() => true, () => false);
      if (r.warningOnClick) await page.keyboard.press("Escape");
    }
    await ed.click().catch(() => {});
    await clearEditor(page);
    return r;
  } catch (e) {
    r.error = e.message.split("\n")[0];
    return r;
  } finally {
    await page.close().catch(() => {});
  }
}

const results = [];
for (const s of sites) {
  process.stdout.write(`${s.name} … `);
  const r = await checkSite(s);
  results.push(r);
  console.log(r.error ? `오류: ${r.error}` : r.editor ? "입력창 감지" : "입력창 없음");
}
await ctx.close();

const mark = (v) => (v === undefined ? "-" : v ? "✓" : "✗");
const lines = [
  `# 실제 사이트 점검 (${mode}, ${new Date().toLocaleString()})`, "",
  "| 사이트 | 입력창 | 전송 버튼(입력 후) | 목적지 | Enter 가로챔 | 경고(Enter) | 경고(클릭) | 비고 |",
  "|---|---|---|---|---|---|---|---|",
  ...results.map((r) => {
    const btn = r.sendButtonAfterTyping ?? r.sendButton;
    const btnCell = btn ? "✓ " + btn : r.sendButtonAfterTyping === undefined ? "- (입력 전 확인 불가)" : "✗";
    const note = r.error || r.note || (r.loaded && !r.editor ? "로그인·사람 확인 필요 또는 선택자 확인" : "");
    return `| ${r.site} | ${r.editor ? "✓ " + r.editor : "✗"} | ${btnCell} | ${r.destination || "-"} | ${mark(r.enterIntercepted)} | ${mark(r.warningOnEnter)} | ${mark(r.warningOnClick)} | ${note} |`;
  }),
];
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
console.log("\n" + lines.join("\n") + `\n\n결과: ${OUT}`);
