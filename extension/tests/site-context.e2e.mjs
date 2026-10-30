// Installed extension on a routed production host, with a local rules API; no external traffic.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGuard } from '../vendor/prompt-guard-rules/src/index.js';
const ext = path.resolve(import.meta.dirname, '..'), shots = path.join(ext, 'tests/shots/site-context');
mkdirSync(shots, { recursive: true });
const guard = createGuard();
let fail = false, forceBlock = false, delay = 0, calls = 0;
const api = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.url === '/readyz') { res.end('{}'); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  calls++;
  if (delay) await new Promise(r => setTimeout(r, delay));
  if (fail) { res.writeHead(500).end('{}'); return; }
  try {
    const input = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    const result = req.url.endsWith('sanitize') ? guard.sanitizeRequest(input) : guard.inspectRequest(input);
    if (forceBlock) Object.assign(result, { decision: 'block', signal: 'red', findings: [] });
    res.end(JSON.stringify(result));
  } catch { res.writeHead(400).end('{}'); }
});
await new Promise(r => api.listen(0, '127.0.0.1', r));
const profile = mkdtempSync(path.join(tmpdir(), 'pg-context-'));
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  viewport: { width: 1100, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Site context fixture</title>
<style>body{font:16px system-ui;margin:32px;background:#f5f5f7}main{max-width:700px;margin:auto}header{display:flex;gap:12px;flex-wrap:wrap}button{padding:8px}form{margin-top:430px}textarea{box-sizing:border-box;width:100%;height:110px;font:inherit}</style>
<main><h1>사이트 상태 감지 테스트</h1><header>
<button id="model" data-testid="model-switcher-dropdown-button">GPT-6.1 Sol</button>
<button aria-label="Current workspace: Personal">Personal</button><span data-testid="current-plan">Plus</span>
<button role="switch" aria-label="Improve the model for everyone" aria-checked="false">학습 OFF</button>
<button aria-label="Temporary chat" aria-pressed="false">임시 대화 OFF</button>
</header><form><textarea aria-label="메시지" id="prompt"></textarea><button data-testid="send-button" type="submit">전송</button><input id="file" type="file" multiple></form></main>
<script>window.sent=0;window.uploads=0; const form=document.querySelector('form'),ta=document.querySelector('textarea');form.addEventListener('submit',e=>{e.preventDefault();window.sent++;ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}));});ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});document.querySelector('#file').addEventListener('change',()=>window.uploads++);</script></html>`;
await ctx.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
const page = await ctx.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const popup = await ctx.newPage();
await popup.goto(new URL('../popup.html', sw.url()).href);
await popup.evaluate(port => chrome.storage.local.set({ enabled:true, serverEnabled:true, localAiEnabled:false, serverUrl:`http://127.0.0.1:${port}` }), api.address().port);
async function eventually(fn, label) {
  for (let end = Date.now()+7000; Date.now()<end;) { if (await fn()) return; await new Promise(r=>setTimeout(r,50)); }
  throw new Error(label);
}
const lamp=()=>page.locator('.badge').getAttribute('data-state'), sent=()=>page.evaluate(()=>window.sent), uploads=()=>page.evaluate(()=>window.uploads);
const modal=page.locator('.overlay');
const fill=async text=>{ await page.locator('#prompt').fill(text); await eventually(async()=> (await page.locator('.chip-w').textContent())?.includes('이용 환경 확인 필요'),'context warning'); };
try {
  await page.goto('https://chatgpt.com/'); await fill('오늘 회의 안건을 정리해 주세요.');
  await eventually(async()=>!(await page.locator('.chip-w').textContent()).includes('검사 확인 중'),'completed check');
  assert.equal(await lamp(),'yellow');
  assert.equal(await page.locator('.badge .retention-summary').isVisible(), true);
  assert.match(await page.locator('.badge [data-field=model]').textContent(),/GPT-6.1 Sol/);
  assert.match(await page.locator('.badge [data-field=training]').textContent(),/OFF/);
  assert.match(await page.locator('.badge [data-field=plan]').textContent(),/Plus/);
  assert.equal(await page.locator('.badge [data-field=policy]').getAttribute('data-status'),'unknown');
  await page.locator('.badge .site-context summary').click();
  if (process.env.PG_CONTEXT_SHOTS === '1') await page.screenshot({path:path.join(shots,'light-expanded.png')});
  await page.emulateMedia({colorScheme:'dark'}); if (process.env.PG_CONTEXT_SHOTS === '1') await page.screenshot({path:path.join(shots,'dark-expanded.png')});
  await page.emulateMedia({colorScheme:'light'}); await page.setViewportSize({width:390,height:844});
  if (process.env.PG_CONTEXT_SHOTS === '1') await page.screenshot({path:path.join(shots,'narrow-expanded.png')});
  await eventually(()=>page.locator('.badge').evaluate(e=>e.getBoundingClientRect().right<=innerWidth),'horizontal overflow after resize');
  await page.setViewportSize({width:1100,height:900});
  await page.press('#prompt','Enter'); await modal.waitFor();
  assert.equal(await modal.locator('.head').getAttribute('data-tone'),'yellow'); assert.equal(await sent(),0);
  assert.equal(await modal.locator('.retention-notice').count(), 1);
  assert.match(await modal.locator('.retention-notice').innerText(), /학습 OFF·임시 대화·대화 삭제/);
  assert.match(await modal.locator('.retention-notice').innerText(), /보관 기간·삭제 조건은 확인되지/);
  if (process.env.PG_CONTEXT_SHOTS === '1') {
    for (const [theme,width] of [['light',1100],['dark',1100],['light',390]]) {
      await page.emulateMedia({colorScheme:theme}); await page.setViewportSize({width,height:844});
      assert.equal(await modal.locator('.card').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
      await page.screenshot({path:path.join(shots,`retention-${theme}-${width}.png`)});
    }
    await page.setViewportSize({width:1100,height:900});
  }
  assert.equal(await modal.getByRole('button',{name:'확인 후 전송',exact:true}).isDisabled(),true);
  await modal.locator('.ack input').check(); await modal.getByRole('button',{name:'확인 후 전송',exact:true}).click();
  await eventually(async()=>await sent()===1,'confirmed send');
  await fill('다음 회의 안건을 정리해 주세요.'); await page.press('#prompt','Enter'); await modal.waitFor();
  await modal.locator('.ack input').check();
  // Same turn: approval must be invalidated even before MutationObserver runs.
  await page.evaluate(()=>{document.querySelector('#model').textContent='Auto'; const root=document.querySelector('#pg-root-host').shadowRoot; [...root.querySelectorAll('.overlay button')].find(e=>e.textContent==='확인 후 전송').click();});
  assert.equal(await sent(),1);
  await eventually(async()=>await page.locator('.badge [data-field=model]').getAttribute('data-status')==='unknown','Auto unknown');
  await page.press('#prompt','Enter'); await modal.waitFor();
  await page.evaluate(()=>history.pushState({},'','/c/another')); await page.keyboard.press('Escape');
  await page.press('#prompt','Enter'); await modal.waitFor(); assert.equal(await sent(),1); await page.keyboard.press('Escape');
  await page.fill('#prompt','aws_access_key_id = AKIAIOSFODNN7EXAMPLE');
  await eventually(async()=>await lamp()==='red','red precedence');
  await page.press('#prompt','Enter'); await modal.waitFor(); assert.equal(await modal.locator('.head').getAttribute('data-tone'),'red');
  await modal.getByRole('button',{name:'안전 다듬기',exact:true}).click();
  await eventually(async()=>(await page.inputValue('#prompt')).includes('[AWS_KEY_1]'),'sanitize applied');
  await page.press('#prompt','Enter'); await modal.waitFor(); assert.equal(await modal.locator('.head').getAttribute('data-tone'),'yellow'); await page.keyboard.press('Escape');
  fail=true; await page.fill('#prompt','평범한 문장입니다.'); await eventually(async()=>await lamp()==='gray','gray precedence'); fail=false;
  await page.fill('#prompt','');
  const file={name:'meeting.txt',mimeType:'text/plain',buffer:Buffer.from('회의 주제를 정리합니다.')};
  await page.setInputFiles('#file',file); await modal.waitFor();
  assert.equal(await modal.locator('.retention-notice').count(),1);
  assert.equal(await modal.locator('.head').getAttribute('data-tone'),'yellow'); assert.match(await modal.locator('.title').textContent(),/이용 환경/); assert.equal(await uploads(),0);
  await page.evaluate(()=>document.querySelector('#model').textContent='GPT-6.1 Sol');
  await eventually(async()=>!(await modal.isVisible()),'file approval invalidation'); assert.equal(await uploads(),0);
  await page.setInputFiles('#file',file); await modal.waitFor(); await modal.locator('.ack input').check();
  await modal.getByRole('button',{name:'그래도 진행',exact:true}).click(); await eventually(async()=>await uploads()===1,'file acknowledgement');
  forceBlock=true; await page.setInputFiles('#file',[]); await page.setInputFiles('#file',file); await modal.waitFor();
  assert.equal(await modal.locator('.head').getAttribute('data-tone'),'red','unlocated server block must stay red');
  await page.keyboard.press('Escape'); forceBlock=false;
  await page.setInputFiles('#file',[file,{name:'scan.png',mimeType:'image/png',buffer:Buffer.from('unreadable fixture')}]); await modal.waitFor();
  assert.equal(await modal.locator('.head').getAttribute('data-tone'),'gray','unreadable file keeps gray in a mixed batch');
  assert.match(await modal.locator('.title').textContent(),/읽을 수 없는/); await page.keyboard.press('Escape');
  await page.evaluate(()=>document.querySelector('[role=switch]').remove()); await page.click('#prompt');
  await eventually(async()=>await page.locator('.badge [data-field=training]').getAttribute('data-status')==='unknown','disappeared setting unknown');
  delay=700; const before=calls;
  await page.fill('#prompt','늦게 응답하는 검사'); await page.press('#prompt','Enter'); await eventually(()=>calls>before,'request started');
  await page.evaluate(()=>document.querySelector('#model').textContent='GPT-6 Astra');
  await eventually(async()=>(await page.locator('.badge [data-field=model]').textContent()).includes('GPT-6 Astra'),'model update');
  await new Promise(r=>setTimeout(r,1000)); assert.equal(await modal.isVisible(),false); assert.equal(await sent(),1); delay=0;
  await popup.evaluate(()=>chrome.storage.local.set({enabled:false})); await eventually(async()=>!(await page.locator('.badge').isVisible()),'disabled widget');
  await page.press('#prompt','Enter'); await eventually(async()=>await sent()===2,'master switch'); assert.deepEqual(errors,[]);
  console.log('PASS context UI, consent, red/gray precedence, sanitize, files, stale approval/response, master switch');
} finally { await ctx.close(); await new Promise(r=>api.close(r)); rmSync(profile,{recursive:true,force:true}); }
