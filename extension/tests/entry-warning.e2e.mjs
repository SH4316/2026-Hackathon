import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
const extension = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
async function boot({ enabled = true, busy = false, slow = false } = {}) {
  await page.goto('about:blank');
  await page.setContent('<html lang="ko"><meta charset="utf-8"><button id="site">사이트 버튼</button></html>');
  await page.focus('#site');
  await page.evaluate(({ enabled, slow }) => {
    window.listeners = []; window.subscribers = [];
    window.snapshot = { provider: 'fixture', model: { status: 'observed', value: '가상 모델 A' } };
    window.chrome = { runtime: {
      getURL: () => 'data:text/javascript,export default {destinations:{}}',
      sendMessage: async msg => slow && msg.type === 'rules:bundle' ? new Promise(() => {}) : ({ ok: true, data: msg.type === 'settings' ? { enabled } :
        { destinations: { fixture: { consumer: { basis: '서버 합성 정책', tier: 'standard' } } } } }) },
      storage: { onChanged: { addListener: fn => listeners.push(fn) } } };
    window.PG = { resolveDestination: () => ({ provider: 'fixture', channel: 'consumer' }),
      siteContext: { current: () => snapshot, subscribe: fn => subscribers.push(fn) } };
  }, { enabled, slow });
  for (const file of ['labels.js', 'ui.js', 'entry-policy.js']) await page.addScriptTag({ path: path.join(extension, 'src', file) });
  if (busy) await page.evaluate(() => PG.ui.showWarning({ error: 'network', onRetry() {} }));
  await page.addScriptTag({ path: path.join(extension, 'src/entry-warning.js') });
}
const modal = page.locator('[data-kind="entry-policy"]');
const changeModel = model => page.evaluate(model => { snapshot.model.value = model; subscribers.forEach(fn => fn()); }, model);
try {
  await boot({ enabled: false }); await page.waitForTimeout(100); assert.equal(await modal.count(), 0);
  await page.evaluate(() => listeners.forEach(fn => fn({ enabled: { newValue: true } })));
  await modal.waitFor();
  assert.match(await modal.innerText(), /확인하지 못했습니다/);
  assert.match(await modal.innerText(), /서버 합성 정책/);
  assert.equal(await modal.getAttribute('aria-labelledby'), 'pg-entry-title');
  await page.keyboard.press('Tab'); assert.equal(await modal.locator('button').evaluate(e => e === e.getRootNode().activeElement), true);
  for (const [theme, width] of [['light', 1100], ['dark', 1100], ['light', 390]]) {
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width, height: 844 });
    assert.equal(await modal.locator('.card').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  }
  await modal.getByRole('button', { name: '확인하고 닫기' }).click();
  assert.equal(await page.locator('#site').evaluate(e => e === document.activeElement), true);
  await page.evaluate(() => subscribers.forEach(fn => fn())); await page.waitForTimeout(100); assert.equal(await modal.count(), 0);
  for (const model of ['가상 모델 B', '가상 모델 A']) {
    await changeModel(model); await modal.waitFor(); assert.match(await modal.innerText(), new RegExp(model)); await page.keyboard.press('Escape');
  }
  await boot({ busy: true }); await page.waitForTimeout(100);
  assert.equal(await modal.count(), 0, 'existing inspection remains open');
  await changeModel('대기 중 모델'); await page.waitForTimeout(250);
  assert.equal(await modal.count(), 0, 'model change never replaces an inspection modal');
  assert.match(await page.locator('.overlay').innerText(), /전송을 보류/);
  await page.keyboard.press('Escape'); await modal.waitFor(); assert.match(await modal.innerText(), /대기 중 모델/);
  await boot({ slow: true }); await modal.waitFor({ timeout: 3000 });
  assert.match(await modal.innerText(), /확인하지 못했습니다/, 'unavailable server cannot delay entry guidance');
  assert.deepEqual(errors, []);
  console.log('PASS entry guidance: unknown states, server policy, model changes, modal priority, focus and layouts');
} finally { await browser.close(); }
