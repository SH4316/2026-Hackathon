#!/usr/bin/env node
// Install Playwright separately; set PLAYWRIGHT_MODULE to its absolute index.mjs path.
// Run only against an isolated test database: this test registers a labeled demo person.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = (process.env.DASHBOARD_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
const page = await context.newPage();
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let apiRequests = 0;
page.on('request', request => { if (request.url().includes('/api/v1/')) apiRequests++; });

async function ready(title) {
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.getByRole('button', { name: '새로고침', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('button.button:disabled')?.textContent?.includes('새로고침'));
}

try {
  await page.goto(baseUrl);
  await ready('전체 현황');
  await page.locator('.stat-strip').waitFor();
  assert.equal(await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link').count(), 4);
  const settledRequests = apiRequests;
  await page.waitForTimeout(1400);
  assert.equal(apiRequests, settledRequests, 'settled page should not poll');
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.waitForFunction(previous => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('새로고침'));
    return button && !button.disabled && document.querySelector('.stat-strip');
  }, settledRequests);
  assert(apiRequests > settledRequests, 'manual refresh should request current data');
  checks.push('overview loads from real API, navigation and explicit refresh; no idle polling');

  await page.locator('.category-distribution a').first().click();
  await ready('탐지 이력');
  assert(new URL(page.url()).searchParams.has('category'), 'category chart should link to filtered history');
  await page.getByRole('region', { name: '이벤트 목록' }).waitFor();
  await page.getByRole('link', { name: /이벤트 \d+ 상세 보기/ }).first().click();
  await page.getByRole('heading', { name: /^이벤트 #/ }).waitFor();
  await page.getByRole('heading', { name: '수집 정보', exact: true }).waitFor();
  const detailUrl = page.url();
  await page.reload();
  await page.getByRole('heading', { name: /^이벤트 #/ }).waitFor();
  await page.locator('.event-info .person-cell').click();
  await page.getByRole('heading', { name: /님의 기록$/ }).waitFor();
  await page.locator('.stat-strip').waitFor();
  checks.push('category drill-down, event detail, direct-route reload and person history');

  await page.goto(baseUrl + '/events');
  await ready('탐지 이력');
  await page.getByRole('region', { name: '이벤트 목록' }).waitFor();
  const nextPage = page.getByRole('button', { name: '다음 페이지', exact: true });
  if (await nextPage.isEnabled()) {
    const firstEvent = await page.getByRole('link', { name: /이벤트 \d+ 상세 보기/ }).first().getAttribute('aria-label');
    await nextPage.click();
    await page.waitForURL(url => url.searchParams.get('page') === '1');
    await page.getByRole('region', { name: '이벤트 목록' }).waitFor();
    await page.waitForFunction(previous => {
      const link = document.querySelector('a[aria-label^="이벤트 "][aria-label$=" 상세 보기"]');
      return link && link.getAttribute('aria-label') !== previous;
    }, firstEvent);
    await page.getByRole('button', { name: '이전 페이지', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('page') === '0');
    await page.getByRole('region', { name: '이벤트 목록' }).waitFor();
    await page.waitForFunction(previous => document.querySelector('a[aria-label^="이벤트 "][aria-label$=" 상세 보기"]')?.getAttribute('aria-label') === previous, firstEvent);
    checks.push('history pagination advances and returns while updating the URL');
  }
  const beforeInvalidDates = apiRequests;
  await page.locator('input[name="from"]').fill('2099-01-02');
  await page.locator('input[name="to"]').fill('2099-01-01');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.equal(apiRequests, beforeInvalidDates, 'invalid date range must not request data');
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.goto(baseUrl + '/events?from=malformed&to=malformed');
  await page.getByRole('alert').waitFor();
  await page.goto(baseUrl + '/events');
  await ready('탐지 이력');
  await page.locator('input[name="service"]').fill('browser-empty-service');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await page.getByRole('heading', { name: '표시할 이벤트가 없습니다' }).waitFor();
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await page.getByRole('region', { name: '이벤트 목록' }).waitFor();
  await page.locator('select[name="category"]').selectOption('CREDENTIAL');
  await page.locator('select[name="policyState"]').selectOption('TRAINING_ALLOWED');
  await page.locator('input[name="service"]').fill('chatgpt');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await page.getByRole('region', { name: '이벤트 목록' }).waitFor();
  const applied = new URL(page.url()).searchParams;
  assert.equal(applied.get('category'), 'CREDENTIAL');
  assert.equal(applied.get('policyState'), 'TRAINING_ALLOWED');
  assert.equal(applied.get('service'), 'chatgpt');
  checks.push('invalid/reversed dates, empty events, filter reset and combined service/category/policy filters');

  await page.goto(baseUrl + '/people');
  await ready('사람 관리');
  const suffix = Date.now().toString(36);
  const personId = 'browser-' + suffix;
  const personName = '데모 UI 검증 ' + suffix;
  await page.getByRole('button', { name: '사람 등록', exact: true }).click();
  await page.locator('.registration-panel input[name="id"]').fill(personId);
  await page.locator('.registration-panel input[name="name"]').fill(personName);
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await page.locator('.success-notice').waitFor();
  await page.locator('input[name="q"]').fill(personId);
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('q') === personId);
  await page.getByRole('region', { name: '사람 목록' }).getByRole('link', { name: new RegExp(personName) }).waitFor();
  await page.waitForFunction(id => {
    const rows = document.querySelectorAll('.people-table tbody tr');
    return rows.length === 1 && rows[0].textContent.includes(id);
  }, personId);
  assert.equal(await page.locator('.people-table tbody tr').count(), 1);
  assert((await page.locator('.people-table tbody').innerText()).includes('기록 없음'));
  await page.getByRole('button', { name: '사람 등록', exact: true }).click();
  await page.locator('.registration-panel input[name="id"]').fill(personId);
  await page.locator('.registration-panel input[name="name"]').fill(personName);
  await page.getByRole('button', { name: '등록하기', exact: true }).click();
  await page.locator('.registration-panel [role="alert"]').waitFor();
  assert((await page.locator('.registration-panel [role="alert"]').innerText()).length > 0);
  checks.push('person registration, success feedback, search, zero events and duplicate form error');

  await page.goto(baseUrl + '/settings/monitoring');
  await page.getByRole('heading', { name: '감시 설정', exact: true }).waitFor();
  assert.equal(await page.locator('fieldset input').count(), 7);
  for (const input of await page.locator('fieldset input').all()) assert(await input.isDisabled());
  assert(await page.getByRole('button', { name: '설정 저장', exact: true }).isDisabled());
  const settingsRequests = apiRequests;
  const checkedBefore = await page.locator('fieldset input').evaluateAll(inputs => inputs.map(input => input.checked));
  await page.locator('fieldset label').first().evaluate(label => label.click());
  await page.getByRole('button', { name: '설정 저장', exact: true }).evaluate(button => button.click());
  assert.deepEqual(await page.locator('fieldset input').evaluateAll(inputs => inputs.map(input => input.checked)), checkedBefore);
  assert.equal(apiRequests, settingsRequests, 'disabled monitoring controls must not request data');
  checks.push('monitoring settings and save remain disabled and send no request');

  await page.route('**/api/v1/metrics?*', route => route.abort(), { times: 1 });
  await page.goto(baseUrl + '/');
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await page.locator('.stat-strip').waitFor();
  await page.goto(baseUrl + '/events/9223372036854775807');
  await page.getByRole('alert').waitFor();
  checks.push('recoverable network error, retry and missing-detail error state');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl + '/settings/monitoring');
  await page.getByRole('heading', { name: '감시 설정', exact: true }).waitFor();
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '사람 관리', exact: true }).click();
  await ready('사람 관리');
  checks.push('mobile navigation remains usable at 390px width');
  assert.deepEqual(errors, [], 'browser should have no uncaught JavaScript exceptions');

  const report = { status: 'PASS', checkedAt: new Date().toISOString(), baseUrl, personId, detailUrl, checks, uncaughtErrors: errors };
  const output = process.env.BROWSER_REPORT;
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
