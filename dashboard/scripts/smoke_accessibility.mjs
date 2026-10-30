#!/usr/bin/env node
/** Automated accessibility and document-overflow audit; does not claim full WCAG conformance. */
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const importFrom = (variable, fallback) => import(process.env[variable] ? pathToFileURL(process.env[variable]).href : fallback);
const { chromium } = await importFrom('PLAYWRIGHT_MODULE', 'playwright');
const { default: AxeBuilder } = await importFrom('AXE_MODULE', '@axe-core/playwright');
const baseUrl = (process.env.DASHBOARD_URL || 'http://127.0.0.1:8083').replace(/\/$/, '');
const api = async path => (await fetch(baseUrl + '/api/v1' + path)).json();
const events = await api('/events?size=1');
const saved = await api('/saved-searches');
const routes = ['/', '/events', '/people', '/settings/metrics', '/settings/monitoring', '/saved-searches'];
if (events.items?.[0]) { routes.push('/events/' + events.items[0].id); routes.push('/people/' + events.items[0].personId); }
if (saved[0]) routes.push('/saved-searches/' + saved[0].id);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
async function ready(route) {
  await page.goto(baseUrl + route);
  await page.locator('h1').waitFor();
  await page.waitForFunction(() => !document.querySelector('.loading-state'));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
try {
  const axe = [];
  for (const route of routes) {
    await ready(route);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    axe.push({ route, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), incomplete: result.incomplete.map(v => ({ id: v.id, nodes: v.nodes.length })), passes: result.passes.length });
  }
  const responsive = [];
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of routes) {
      await ready(route);
      responsive.push({ route, width, ...await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 })) });
    }
  }
  const violations = axe.reduce((n, r) => n + r.violations.length, 0);
  const overflows = responsive.filter(r => r.overflow).length;
  const report = { status: violations || overflows || errors.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), baseUrl, scope: 'Automated axe WCAG A/AA rules and document overflow only; incomplete rules and manual accessibility remain outside this result.', violations, overflows, uncaughtErrors: errors, axe, responsive };
  if (process.env.ACCESSIBILITY_REPORT) await writeFile(process.env.ACCESSIBILITY_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, axe: axe.map(r => ({ route: r.route, violations: r.violations, incomplete: r.incomplete })), responsive: responsive.filter(r => r.overflow) }, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
} finally { await browser.close(); }
