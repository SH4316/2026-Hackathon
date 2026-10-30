// Load the real extension on a routed host. Only the page is synthetic; policy/detection/UI are unmodified.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const extension = path.resolve(import.meta.dirname, '..');
const profile = mkdtempSync(path.join(tmpdir(), 'pg-training-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: `
  <!doctype html><html lang="ko"><meta charset="utf-8"><title>Training option fixture</title>
  <style>body{font:16px system-ui;margin:32px}button{padding:8px}textarea{display:block;margin-top:300px}</style>
  <button data-testid="model-switcher-dropdown-button">GPT-6.1 Sol</button>
  <button id="account" aria-label="Current workspace: Personal">Personal</button>
  <button id="training" role="switch" aria-label="Improve the model for everyone" aria-checked="true">학습</button>
  <button id="temporary" aria-label="Temporary chat" aria-pressed="false">임시 대화</button>
  <textarea id="prompt"></textarea></html>` }));
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const settings = await context.newPage();
await settings.goto(new URL('../popup.html', worker.url()).href);
await settings.evaluate(() => chrome.storage.local.set({ enabled: true, serverEnabled: false, localAiEnabled: false }));
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const modal = page.locator('[data-kind="entry-policy"]');
const pause = () => page.waitForTimeout(400);
const change = async (selector, attr, value) => {
  await page.locator(selector).evaluate((el, { attr, value }) => el.setAttribute(attr, value), { attr, value });
  await pause();
};
try {
  await page.goto('https://chatgpt.com/');
  await modal.waitFor();
  assert.match(await modal.innerText(), /모델 학습 옵션이 켜져 있습니다/);
  assert.equal(await modal.locator('.head').getAttribute('data-tone'), 'yellow');
  assert.doesNotMatch(await modal.innerText(), /거부할 수 없는|필수로 수집/);
  const shots = path.join(extension, 'tests/shots/training-warning');
  mkdirSync(shots, { recursive: true });
  for (const [theme, width] of [['light', 1100], ['dark', 1100], ['light', 390]]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await modal.locator('.card').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (process.env.PG_TRAINING_SHOTS === '1') await page.screenshot({ path: path.join(shots, `${theme}-${width}.png`) });
  }
  await modal.getByRole('button', { name: '확인하고 닫기' }).click();
  await page.locator('#prompt').focus();
  await pause();
  assert.equal(await modal.count(), 0, 'acknowledgement does not re-open the modal');
  await change('#training', 'hidden', '');
  await page.locator('#training').evaluate(el => el.removeAttribute('hidden'));
  await pause();
  assert.equal(await modal.count(), 0, 'unknown then visible ON does not re-arm');
  await change('#training', 'aria-checked', 'false');
  assert.equal(await modal.count(), 0);
  await change('#training', 'aria-checked', 'true');
  await modal.waitFor();
  await change('#training', 'aria-checked', 'false');
  assert.equal(await modal.count(), 0, 'turning OFF closes stale training warning');
  await change('#temporary', 'aria-pressed', 'true');
  await change('#training', 'aria-checked', 'true');
  assert.equal(await modal.count(), 0, 'temporary conversation excluded');
  await change('#temporary', 'aria-pressed', 'false');
  await modal.waitFor();
  await change('#account', 'aria-label', 'Current workspace: Enterprise');
  assert.equal(await modal.count(), 0, 'organization exception remains uncertain');
  await change('#account', 'aria-label', 'Current workspace: Personal');
  await modal.waitFor();
  await settings.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await pause();
  assert.equal(await modal.count(), 0, 'master OFF closes modal');
  await page.reload(); await pause();
  assert.equal(await modal.count(), 0, 'master OFF suppresses entry');
  await settings.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await modal.waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => history.pushState({}, '', '/c/another'));
  await page.locator('#prompt').focus(); await pause();
  assert.equal(await modal.count(), 0, 'SPA navigation does not repeat same warning');
  await page.reload(); await modal.waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS installed extension training ON entry, OFF/ON, unknown, temporary, organization, master switch, SPA, reload');
} finally { await context.close(); rmSync(profile, { recursive: true, force: true }); }
