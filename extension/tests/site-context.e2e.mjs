// 실제 확장 + 합성 페이지/API만 사용한다. 외부 서비스나 실제 개인정보는 사용하지 않는다.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGuard } from '../vendor/prompt-guard-rules/src/index.js';
import vendor from '../vendor/prompt-guard-rules/data/policy.js';
const ext = path.resolve(import.meta.dirname, '..'), guard = createGuard();
const requests = [], reports = [], etags = [];
let fail = false, failReport = false, delay = 0, decision = null, revision = 1;
let reportStatus = 'recorded', fileReport = { recorded: true, reason: null }, fileReportDelay = 0;
const bundle = () => ({ ...vendor.ruleset, ruleset_version: revision,
  destinations: { openai: { consumer: { tier: 'elevated', basis: '합성 제공사 정책', verified_at: '2026-10-30' } } },
  org_rules: { version_id: 'synthetic-v1', revision, tag_action: 'mask', regex: [
    { tag_id: 'employee', type: 'employee', name: '합성 사번', token: 'ORG_EMP', pattern: `ORG${revision}-\\d{4}` },
    { tag_id: 'python', type: 'python', name: 'Python 전용', token: 'PY', pattern: '(?P<python>secret)' },
  ] } });
const api = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.url === '/readyz') { res.end('{}'); return; }
  if (req.url === '/v1/rules/bundle') {
    etags.push(req.headers['if-none-match']);
    const etag = `"v${revision}"`; res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }
    res.end(JSON.stringify(bundle())); return;
  }
  let raw = ''; for await (const chunk of req) raw += chunk;
  try {
    const input = JSON.parse(raw);
    if (req.url === '/v1/files/report') {
      reports.push(input);
      if (fileReportDelay) await new Promise(r => setTimeout(r, fileReportDelay));
      if (failReport) { res.writeHead(503).end('{}'); return; }
      res.writeHead(202).end(JSON.stringify(fileReport)); return;
    }
    requests.push(input);
    if (delay && input.context.stage === 'submit') await new Promise(r => setTimeout(r, delay));
    if (fail && input.context.stage === 'submit') { res.writeHead(503).end('{}'); return; }
    const result = req.url.endsWith('sanitize') ? guard.sanitizeRequest(input) : guard.inspectRequest(input);
    if (req.url.endsWith('inspect') && (input.context.stage === 'draft' || reportStatus !== undefined)) {
      result.report_status = input.context.stage === 'draft' ? 'skipped' : reportStatus;
    }
    if (decision) Object.assign(result, { decision, signal: { allow: 'green', warn: 'yellow', block: 'red' }[decision],
      findings: decision === 'block' ? [{ finding_id: 'f1', type: 'synthetic', action: 'block', span: { start: 0, end: 2, start_utf16: 0, end_utf16: 2 } }] : [] });
    res.end(JSON.stringify(result));
  } catch { res.writeHead(400).end('{}'); }
});
await new Promise(r => api.listen(0, '127.0.0.1', r));
const profile = mkdtempSync(path.join(tmpdir(), 'pg-context-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  viewport: { width: 1100, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>합성 컨텍스트</title>
<style>body{font:16px system-ui;margin:32px}main{max-width:700px;margin:auto}button{padding:8px}form{margin-top:430px}textarea{width:100%;height:110px}</style>
<main><button id="model" data-testid="model-switcher-dropdown-button">가상 모델 A</button>
<button aria-label="Current workspace: Personal">Personal</button><span data-testid="current-plan">Plus</span>
<button role="switch" aria-label="Improve the model for everyone" aria-checked="false">학습 OFF</button>
<form><textarea id="prompt"></textarea><button data-testid="send-button" type="submit">전송</button><input id="file" type="file" multiple></form></main>
<script>window.sent=0;window.uploads=0;const form=document.querySelector('form'),ta=document.querySelector('textarea');form.addEventListener('submit',e=>{e.preventDefault();window.sent++;ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}));});ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});document.querySelector('#file').addEventListener('change',e=>{if(e.target.files.length)window.uploads++;});</script></html>`;
await ctx.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const popup = await ctx.newPage(); await popup.goto(new URL('../popup.html', sw.url()).href);
await popup.evaluate(port => chrome.storage.local.set({ enabled: true, serverEnabled: true, localAiEnabled: false,
  serverUrl: `http://127.0.0.1:${port}`, apiKey: 'synthetic-token', linkedClient: { clientId: 'fixture', managed: true }, testMode: false }), api.address().port);
async function eventually(fn, label) {
  for (let end = Date.now() + 9000; Date.now() < end;) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error(label);
}
const modal = page.locator('.overlay'), entry = page.locator('[data-kind="entry-policy"]');
const lamp = () => page.locator('.badge').getAttribute('data-state');
const sent = () => page.evaluate(() => window.sent), uploads = () => page.evaluate(() => window.uploads);
const fill = async (text, expected = 'green') => {
  const count = requests.length; await page.fill('#prompt', text);
  await eventually(async () => requests.length > count && await lamp() === expected, `draft ${expected}`);
};
const submitRequests = () => requests.filter(r => r.context.stage === 'submit' && !r.context.files);
const confirm = async name => { await modal.locator('.ack input').check(); await modal.getByRole('button', { name, exact: true }).click(); };
try {
  await page.goto('https://chatgpt.com/'); await entry.waitFor();
  assert.match(await entry.innerText(), /합성 제공사 정책/); assert.match(await entry.innerText(), /확인하지 못했습니다/);
  await page.keyboard.press('Escape'); console.log('PASS initial entry policy');
  await fill('회의 안건을 정리해 주세요.'); assert.equal(await lamp(), 'green', 'uncertain context does not elevate signal');
  assert.equal(await page.locator('.badge .site-context').count(), 0, 'site policy is shown only in the information modal');
  let before = submitRequests().length;
  await page.press('#prompt', 'Enter'); await eventually(async () => await sent() === 1, 'managed green send');
  assert.equal(submitRequests().length, before + 1); assert.equal(submitRequests().at(-1).context.send_action, 'normal');
  // 같은 텍스트를 새로 전송해도 기록한다.
  await fill('회의 안건을 정리해 주세요.'); await page.locator('[data-testid=send-button]').click();
  await eventually(async () => await sent() === 2, 'second managed send'); assert.equal(submitRequests().length, before + 2);
  decision = 'warn'; await fill('합성 경고 문장', 'yellow');
  await page.press('#prompt', 'Enter'); await modal.waitFor(); assert.equal(await sent(), 2);
  await confirm('확인 후 전송'); await eventually(async () => await sent() === 3, 'confirmed send');
  assert.equal(submitRequests().at(-1).context.send_action, 'confirmed');
  decision = 'block'; await fill('합성 차단 문장', 'red');
  await page.press('#prompt', 'Enter'); await modal.waitFor();
  assert.equal(await modal.getByRole('button', { name: '그래도 전송', exact: true }).isDisabled(), true);
  await confirm('그래도 전송'); await eventually(async () => await sent() === 4, 'red block forced through warning');
  assert.equal(submitRequests().at(-1).context.send_action, 'forced');
  await fill('위젯 강행 합성 문장', 'red'); await page.locator('.badge').getByRole('button', { name: '그래도 전송', exact: true }).click();
  await modal.waitFor(); await confirm('그래도 전송'); await eventually(async () => await sent() === 5, 'widget force recorded');
  assert.equal(submitRequests().at(-1).context.send_action, 'forced');
  console.log('PASS managed normal, confirmed and forced paths');
  // HTTP 200이어도 기록 실패·상태 누락이면 일반/확인/강행 모두 회색으로 보류한다.
  for (const failedStatus of ['failed', undefined]) {
    for (const action of ['normal', 'confirmed', 'forced']) {
      decision = { normal: 'allow', confirmed: 'warn', forced: 'block' }[action];
      reportStatus = 'recorded';
      await fill(`합성 기록 ${failedStatus ?? '누락'} ${action}`, { normal: 'green', confirmed: 'yellow', forced: 'red' }[action]);
      if (action !== 'normal') { await page.press('#prompt', 'Enter'); await modal.waitFor(); }
      reportStatus = failedStatus;
      if (action === 'normal') await page.press('#prompt', 'Enter');
      else await confirm(action === 'confirmed' ? '확인 후 전송' : '그래도 전송');
      await eventually(async () => await lamp() === 'gray', `${action} ${failedStatus ?? 'missing'} record holds gray`);
      assert.equal(await sent(), 5);
      await modal.waitFor();
      assert.match(await modal.innerText(), /대시보드 기록을 확인하지 못해/);
      await page.keyboard.press('Escape');
    }
  }
  reportStatus = 'recorded'; decision = 'block';
  // 강행 기록 실패: 전송하지 않고 회색 보류.
  await fill('기록 실패 합성 문장', 'red'); await page.locator('.badge').getByRole('button', { name: '그래도 전송', exact: true }).click();
  await modal.waitFor(); fail = true; await confirm('그래도 전송');
  await eventually(async () => await lamp() === 'gray', 'failed forced record holds gray'); assert.equal(await sent(), 5);
  await page.keyboard.press('Escape'); fail = false;
  decision = null; await fill('정상 전송 기록 실패'); fail = true; await page.press('#prompt', 'Enter');
  await eventually(async () => await lamp() === 'gray', 'normal submit failure'); assert.equal(await sent(), 5); fail = false; await page.keyboard.press('Escape');
  // 확인 후 기록 요청이 진행 중인 동안 입력이 바뀌면 보내지 않는다.
  decision = 'warn'; await fill('전송 전에 바뀔 문장', 'yellow'); await page.press('#prompt', 'Enter'); await modal.waitFor();
  delay = 500; before = submitRequests().length; await confirm('확인 후 전송');
  await eventually(() => submitRequests().length > before, 'confirmed record started');
  await page.evaluate(() => document.querySelector('#prompt').value = '이벤트 없이 바뀐 입력'); await page.waitForTimeout(700); assert.equal(await sent(), 5); delay = 0; decision = null;
  // 모델 변경은 기존 확인창을 덮지 않고 안내를 기다린다. 기존 승인은 취소된다.
  decision = 'warn'; await fill('모델 변경 합성 문장', 'yellow'); await page.press('#prompt', 'Enter'); await modal.waitFor();
  await page.evaluate(() => document.querySelector('#model').textContent = '가상 모델 B'); await page.waitForTimeout(300);
  assert.equal(await entry.count(), 0); await confirm('확인 후 전송'); await entry.waitFor(); assert.equal(await sent(), 5);
  await page.keyboard.press('Escape'); decision = null; await page.fill('#prompt', '');
  console.log('PASS submit failures and stale consent');
  // 파일 검사에는 조각 번호 대신 전체 파일 이름을 보낸다.
  const clean = { name: '합성 회의록 전체 이름.txt', mimeType: 'text/plain', buffer: Buffer.from('회의를 정리합니다.\n'.repeat(5000)) };
  await page.setInputFiles('#file', clean); await eventually(async () => await uploads() === 1, 'clean attachment needs no environment consent');
  assert.ok(requests.filter(r => r.input_version?.startsWith?.(`file:${clean.name}#`)).length >= 2, 'every text chunk inspected');
  assert.equal(requests.at(-1).context.files[0].name, clean.name); assert.equal(reports.at(-1).files[0].name, clean.name);
  assert.equal(reports.at(-1).send_action, 'normal');
  const image = { name: '합성 원본 사진.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 7, 8, 9]) };
  await page.setInputFiles('#file', image); await modal.waitFor(); await modal.getByRole('button', { name: '그래도 진행', exact: true }).click();
  await eventually(async () => await uploads() === 2, 'image confirmed'); assert.equal(reports.at(-1).images[0].data_base64, image.buffer.toString('base64'));
  assert.equal(reports.at(-1).send_action, 'confirmed');
  const large = { name: '5MiB 초과 합성 이미지.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) };
  await page.setInputFiles('#file', large); await modal.waitFor(); await modal.getByRole('button', { name: '그래도 진행', exact: true }).click();
  await eventually(async () => await uploads() === 3, 'large image attaches by name'); assert.equal(reports.at(-1).images.length, 0);
  assert.equal(reports.at(-1).files[0].name, large.name);
  decision = 'block'; await page.setInputFiles('#file', clean); await modal.waitFor(); await confirm('그래도 진행');
  await eventually(async () => await uploads() === 4, 'sensitive attachment forced'); assert.equal(reports.at(-1).send_action, 'forced'); decision = null;
  for (const failure of ['http', 'dashboard_unavailable', 'missing']) {
    failReport = failure === 'http';
    fileReport = failure === 'missing' ? {} : { recorded: false, reason: 'dashboard_unavailable' };
    before = reports.length; await page.setInputFiles('#file', []); await page.setInputFiles('#file', clean);
    await eventually(() => reports.length > before, `attachment ${failure} report attempted`);
    await eventually(async () => await page.locator('#file').evaluate(el => !el.files.length), `attachment ${failure} held`);
    assert.equal(await uploads(), 4);
    assert.match(await page.locator('.badge').innerText(), /기록 실패.*첨부.*보류/);
  }
  failReport = false; fileReport = { recorded: false, reason: 'dashboard_unavailable' };
  // 확인·강행 첨부도 기록 실패를 우회할 수 없다.
  for (const sensitive of [false, true]) {
    decision = sensitive ? 'block' : null;
    before = reports.length; await page.setInputFiles('#file', sensitive ? clean : image); await modal.waitFor();
    if (sensitive) await confirm('그래도 진행');
    else await modal.getByRole('button', { name: '그래도 진행', exact: true }).click();
    await eventually(() => reports.length > before, 'approved attachment record attempted');
    await eventually(async () => await page.locator('#file').evaluate(el => !el.files.length), 'approved attachment held');
    assert.equal(await uploads(), 4);
    assert.equal(reports.at(-1).send_action, sensitive ? 'forced' : 'confirmed');
  }
  decision = null; fileReport = { recorded: true, reason: null }; fileReportDelay = 400;
  before = reports.length; await page.setInputFiles('#file', clean);
  await eventually(() => reports.length > before, 'file report started');
  assert.equal(await uploads(), 4, 'attachment waits for recording acknowledgement');
  await eventually(async () => await uploads() === 5, 'recorded attachment resumes'); fileReportDelay = 0;
  console.log('PASS attachment records wait for acknowledgement and failures hold normal/confirmed/forced uploads');
  // 5분 알람은 ETag로 재검사하고, 수정된 번들은 content에 전달된다.
  await sw.evaluate(async () => {
    const alarm = await chrome.alarms.get('rules-bundle-refresh'); if (alarm.periodInMinutes !== 5) throw Error('alarm period');
    await chrome.alarms.create('rules-bundle-refresh', { when: Date.now() + 50, periodInMinutes: 5 });
  });
  await eventually(() => etags.includes('"v1"'), 'conditional ETag request'); revision = 2;
  await sw.evaluate(() => chrome.alarms.create('rules-bundle-refresh', { when: Date.now() + 50, periodInMinutes: 5 }));
  await eventually(async () => (await popup.evaluate(() => chrome.storage.local.get('ruleBundle'))).ruleBundle?.bundle?.ruleset_version === 2, 'bundle cache update');
  await eventually(async () => await page.evaluate(() => {
    const input = document.querySelector('#prompt'); input.value = 'ORG2-１２３４';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return /합성 사번/.test(document.querySelector('#pg-root-host').shadowRoot.querySelector('.badge').innerText);
  }), 'distributed organization rule in immediate content feedback');
  await page.fill('#prompt', '');
  // 원문·이미지는 저장소에 남지 않는다.
  const stored = JSON.stringify(await popup.evaluate(() => chrome.storage.local.get(null)));
  assert.ok(!stored.includes(image.buffer.toString('base64'))); assert.ok(!stored.includes(clean.name)); assert.ok(!stored.includes('회의 안건을 정리해 주세요.'));
  // 관리 상태에서는 마스터/서버 스위치로 기록을 우회할 수 없다.
  await popup.evaluate(() => chrome.storage.local.set({ enabled: false, serverEnabled: false })); await page.waitForTimeout(200);
  await fill('관리 상태 스위치 우회 방지'); fail = true; await page.press('#prompt', 'Enter');
  await eventually(async () => await lamp() === 'gray', 'managed switches cannot skip submit'); assert.equal(await sent(), 5);
  await page.keyboard.press('Escape'); fail = false;
  await popup.evaluate(() => chrome.storage.local.set({ enabled: true, serverEnabled: true })); await page.waitForTimeout(200);
  // 로컬 모드의 기존 동기 통과는 유지한다.
  await popup.evaluate(() => chrome.storage.local.set({ linkedClient: null })); await page.waitForTimeout(200);
  await fill('로컬 모드 합성 문장'); before = submitRequests().length; fail = true;
  await page.press('#prompt', 'Enter'); await eventually(async () => await sent() === 6, 'local cached allow');
  assert.equal(submitRequests().length, before); fail = false;
  assert.deepEqual(errors, []);
  console.log('PASS content-only signals, managed normal/confirmed/forced records, gray failures, stale input/model, files/images/report failure, ETag cache, local compatibility');
} finally { await ctx.close(); await new Promise(r => api.close(r)); rmSync(profile, { recursive: true, force: true }); }
