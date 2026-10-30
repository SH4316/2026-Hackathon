import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const extension = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
async function boot({ eligible = true, enabled = true, busy = false } = {}) {
  await page.goto('about:blank');
  await page.setContent('<html lang="ko"><meta charset="utf-8"><button id="site">사이트 버튼</button></html>');
  await page.focus('#site');
  await page.evaluate(({ enabled }) => {
    window.listeners = []; window.subscribers = [];
    window.chrome = { runtime: { sendMessage: async () => ({ ok: true, data: { enabled } }) },
      storage: { onChanged: { addListener: fn => listeners.push(fn) } } };
    window.PG = { siteContext: { current: () => ({ provider: 'fixture' }), subscribe: fn => subscribers.push(fn) } };
  }, { enabled });
  for (const file of ['labels.js', 'ui.js', 'entry-policy.js']) await page.addScriptTag({ path: path.join(extension, 'src', file) });
  await page.evaluate(({ eligible, busy }) => {
    if (eligible) PG.entryPolicy.evaluate = () => ({ key: 'mandatory-fixture', kind: 'mandatory-collection', name: '가상 서비스 (테스트)', checkedAt: '2026-10-30',
      items: [{ kind: 'training', text: '필수 수집 및 학습 거부 불가를 검증한 테스트 정책입니다.', source: 'https://example.test/policy' }] });
    if (busy) PG.ui.showWarning({ error: 'network', onRetry() {} });
  }, { eligible, busy });
  await page.addScriptTag({ path: path.join(extension, 'src/entry-warning.js') });
}
const modal = page.locator('[data-kind="entry-policy"]');
try {
  await boot({ eligible: false });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.overlay').count(), 0, 'empty production list must not warn');
  await boot({ enabled: false });
  assert.equal(await modal.count(), 0);
  await page.evaluate(() => listeners.forEach(fn => fn({ enabled: { newValue: true } })));
  await modal.waitFor();
  assert.equal(await modal.getAttribute('aria-labelledby'), 'pg-entry-title');
  assert.equal(await modal.locator('.head').getAttribute('data-tone'), 'red');
  assert.equal(await modal.locator('a').getAttribute('href'), 'https://example.test/policy');
  await page.keyboard.press('Tab');
  assert.equal(await modal.locator('a').evaluate(e => e === e.getRootNode().activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await modal.locator('button').evaluate(e => e === e.getRootNode().activeElement), true);
  const shotDir = path.join(extension, 'tests/shots/entry-policy');
  mkdirSync(shotDir, { recursive: true });
  for (const [theme, width] of [['light', 1100], ['dark', 1100], ['light', 390]]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await modal.locator('.card').evaluate(e => e.scrollWidth <= e.clientWidth), true);
    if (process.env.PG_ENTRY_SHOTS === '1') await page.screenshot({ path: path.join(shotDir, `${theme}-${width}.png`) });
  }
  await modal.getByRole('button', { name: '확인하고 닫기' }).click();
  assert.equal(await page.locator('#site').evaluate(e => e === document.activeElement), true);
  await page.evaluate(() => { subscribers.forEach(fn => fn()); listeners.forEach(fn => fn({ enabled: { newValue: true } })); });
  await page.waitForTimeout(100);
  assert.equal(await modal.count(), 0, 'no repeats for DOM/SPA/settings changes');
  await boot({ busy: true });
  assert.equal(await modal.count(), 0, 'existing inspection stays open');
  await page.keyboard.press('Escape');
  await modal.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await modal.count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS entry warning eligibility, settings, once per document, modal priority, focus and layouts');
} finally { await browser.close(); }
