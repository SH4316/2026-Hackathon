import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/site-context.js', import.meta.url), 'utf8');
function setup({ fixture = false, provider = 'openai', elements = [] } = {}) {
  const document = { querySelectorAll: () => elements };
  const context = { document, PG: { isTestHost: () => fixture, resolveDestination: () => provider && ({ provider, channel: 'consumer' }) } };
  vm.runInNewContext(source, context);
  return context.PG.siteContext;
}
function element({ label = '', text = '', pressed, checked, state, role = 'button', hidden = false } = {}) {
  const attrs = { 'aria-label': label, 'aria-pressed': pressed, 'aria-checked': checked, 'data-state': state };
  return { textContent: text, tagName: 'BUTTON', hidden, getAttribute: (n) => attrs[n] ?? null,
    closest: () => null, getClientRects: () => [1], matches: () => false, role };
}

test('production context stays uncertain even with observed controls', () => {
  const api = setup({ elements: [element({ label: 'Model: GPT-5', text: 'GPT-5' }), element({ label: 'Current workspace: Acme' }), element({ label: 'Improve model for everyone', checked: 'false' }), element({ label: 'Temporary chat', pressed: 'true' })] });
  const s = api.read();
  assert.equal(s.provider, 'openai');
  assert.equal(s.model.value, 'GPT-5');
  assert.equal(s.account.value, 'Acme');
  assert.equal(s.training.value, false);
  assert.equal(s.temporary.value, true);
  assert.equal(s.policy.status, 'unknown');
  assert.equal(s.uncertain, true);
  assert.equal(api.read().revision, s.revision);
});

test('hidden and conflicting controls do not claim certainty', () => {
  const api = setup({ elements: [element({ label: 'Model: GPT-5', text: 'GPT-5', hidden: true }), element({ label: 'Model: Claude', text: 'Claude' }), element({ label: 'Model: Gemini', text: 'Gemini' })] });
  assert.equal(api.read().model.status, 'unknown');
  const auto = setup({ elements: [element({ label: 'Model: Auto', text: 'Auto' })] }).read();
  assert.equal(auto.model.value, 'Auto');
  assert.equal(auto.model.status, 'unknown');
});

test('context changes revision and fixture is explicitly known', () => {
  const items = [];
  const api = setup({ elements: items });
  const first = api.read();
  items.push(element({ label: 'Model: GPT-5', text: 'GPT-5' }));
  assert.ok(api.read().revision > first.revision);
  const fixture = setup({ fixture: true }).read();
  assert.equal(fixture.uncertain, false);
  assert.equal(fixture.policy.value, 'Local test fixture');
});

test('apply conservatively downgrades only complete allow and never mutates result', () => {
  const api = setup();
  const result = { status: 'complete', decision: 'allow', signal: 'green', notices: [] };
  const applied = api.apply(result);
  assert.equal(applied.decision, 'warn');
  assert.equal(applied.signal, 'yellow');
  assert.ok(applied.notices.includes('site_context_uncertain'));
  assert.equal(result.decision, 'allow');
  assert.equal(api.apply({ status: 'complete', decision: 'block', signal: 'red' }).decision, 'block');
  assert.equal(api.apply({ status: 'incomplete', decision: 'allow', signal: 'gray' }).signal, 'gray');
  assert.equal(setup({ fixture: true }).apply(result).decision, 'allow');
});

test('synchronous reads notify subscribers and route changes invalidate the snapshot', () => {
  const location = { pathname: '/chat/one', search: '' };
  const context = { location, document: { querySelectorAll: () => [] }, PG: { isTestHost: () => false, resolveDestination: () => ({ provider: 'openai' }) } };
  vm.runInNewContext(source, context);
  const api = context.PG.siteContext;
  const changes = [];
  const unsubscribe = api.subscribe((snapshot) => changes.push(snapshot.revision));
  api.read();
  api.read();
  location.pathname = '/chat/two';
  api.read();
  assert.deepEqual(changes, [1, 2]);
  unsubscribe();
  location.search = '?new=1';
  api.read();
  assert.deepEqual(changes, [1, 2]);
});

test('conflicting settings and conversation controls remain unknown', () => {
  const a = element({ label: 'Improve model for everyone', checked: 'true' });
  const b = element({ label: 'Improve model for everyone', checked: 'false' });
  const conversation = element({ label: 'Model: GPT-5', text: 'GPT-5' });
  conversation.closest = () => ({});
  const s = setup({ elements: [a, b, conversation] }).read();
  assert.equal(s.training.status, 'unknown');
  assert.equal(s.model.status, 'unknown');
  const error = setup().apply({ status: 'error', decision: 'warn', signal: 'gray' });
  assert.equal(error.signal, 'gray');
});

test('account changes are observed and email labels are excluded', () => {
  const items = [element({ label: 'Current workspace: Alpha' })];
  const api = setup({ elements: items });
  const first = api.read();
  items[0] = element({ label: 'Current workspace: Beta' });
  const next = api.read();
  assert.equal(next.account.value, 'Beta');
  assert.ok(next.revision > first.revision);
  assert.equal(setup({ elements: [element({ label: 'Current account: person@example.com' })] }).read().account.status, 'unknown');
});

test('workspace and plan are independent observations', () => {
  const s = setup({ elements: [element({ label: 'Current workspace: Personal' }), element({ label: 'Current plan: Plus' })] }).read();
  assert.equal(s.account.value, 'Personal');
  assert.equal(s.plan.value, 'Plus');
  assert.equal(setup({ elements: [element({ label: 'Model: Auto (recommended)', text: 'Auto (recommended)' })] }).read().model.status, 'unknown');
});
