import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: fileURLToPath(new URL('../src/sites.js', import.meta.url)) });
  await page.evaluate(() => { PG.isTestHost = () => false; PG.resolveDestination = () => ({ provider: window.testProvider }); });
  await page.addScriptTag({ path: fileURLToPath(new URL('../src/site-context.js', import.meta.url)) });
  async function read(provider, html) {
    return page.evaluate(({ provider, html }) => {
      window.testProvider = provider;
      document.body.innerHTML = html;
      return PG.siteContext.read();
    }, { provider, html });
  }
  for (const [provider, html, expected] of [
    ['openai', '<button data-testid="model-switcher-dropdown-button">GPT-5</button>', 'GPT-5'],
    ['anthropic', '<button data-testid="model-selector-dropdown">Claude Sonnet</button>', 'Claude Sonnet'],
    ['google', '<button data-test-id="bard-mode-menu-button">Gemini Pro</button>', 'Gemini Pro'],
  ]) assert.equal((await read(provider, html)).model.value, expected);
  for (const provider of ['microsoft', 'deepseek', 'moonshot', 'mistral', 'perplexity', 'xai', 'alibaba', 'meta']) {
    assert.equal((await read(provider, '<button aria-label="Model: Example Model">Change</button>')).model.value, 'Example Model');
  }
  let s = await read('openai', '<button aria-label="Model: Auto">Auto</button>');
  assert.equal(s.model.status, 'unknown');
  assert.equal(s.model.value, 'Auto');
  s = await read('openai', '<button data-testid="model-switcher-dropdown-button">Select a model</button>');
  assert.equal(s.model.status, 'unknown');
  s = await read('openai', '<span id="training-label">Improve model for everyone</span><button role="switch" aria-labelledby="training-label" aria-checked="true"></button>');
  assert.equal(s.training.value, true);
  s = await read('openai', '<label>Model improvement <input type="checkbox"></label>');
  assert.equal(s.training.value, false);
  s = await read('openai', '<button role="switch" aria-label="Model improvement" aria-checked="true"></button><button role="switch" aria-label="Model improvement" aria-checked="false"></button>');
  assert.equal(s.training.status, 'unknown');
  s = await read('openai', '<div style="opacity:0"><button aria-label="Model: Hidden">Hidden</button></div><div hidden><button aria-label="Model: Hidden2">Hidden2</button></div>');
  assert.equal(s.model.status, 'unknown');
  s = await read('openai', '<div contenteditable="plaintext-only"><button aria-label="Model: Impostor">Impostor</button></div><div class="prose"><button aria-label="Model: Impostor2">Impostor2</button></div><model-response><button aria-label="Model: Impostor3">Impostor3</button></model-response>');
  assert.equal(s.model.status, 'unknown');
  s = await read('anthropic', '<button aria-label="Incognito" aria-pressed="true"></button>');
  assert.equal(s.temporary.value, true);
  s = await read('anthropic', '<div role="status">시크릿 대화 사용 중</div>');
  assert.equal(s.temporary.value, true);
  s = await read('openai', '<div data-testid="current-workspace">Personal</div><div data-testid="current-plan">Plus</div><div><span>Model improvement</span><button role="switch" aria-checked="true"></button><small>Subtitle</small></div>');
  assert.equal(s.account.value, 'Personal');
  assert.equal(s.plan.value, 'Plus');
  assert.equal(s.training.value, true);
  s = await read('openai', '<button aria-label="Model: 자동 선택">자동 선택</button>');
  assert.equal(s.model.status, 'unknown');
  const callbacks = await page.evaluate(() => {
    let count = 0;
    const unsubscribe = PG.siteContext.subscribe(() => { count++; PG.siteContext.read(); });
    document.body.innerHTML = '<button aria-label="Model: Reentry">Reentry</button>';
    PG.siteContext.read();
    unsubscribe();
    return count;
  });
  assert.equal(callbacks, 1);
  console.log('Site context DOM checks passed (Chromium).');
} finally {
  await browser.close();
}
