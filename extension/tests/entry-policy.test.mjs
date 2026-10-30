import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../src/entry-policy.js', import.meta.url), 'utf8'), context);
const { assess, evaluate } = context.PG.entryPolicy;
const source = 'https://example.test/policy';
const policy = { provider: 'fixture', name: 'Fixture', status: 'verified', channel: 'consumer', hosts: ['chat.example.test'], mandatoryCollection: true, trainingOptOut: 'unavailable', checkedAt: '2026-10-30', sources: [source], items: [{ kind: 'training', text: '검증된 테스트 정책', source }] };
const destination = { provider: 'fixture', channel: 'consumer' };
const snapshot = { provider: 'fixture' };
const host = 'chat.example.test';
const field = (value) => ({ status: 'observed', value });

test('verified fixture requires exact host and consumer destination', () => {
  const result = assess(policy, snapshot, destination, host);
  assert.equal(result.name, 'Fixture');
  assert.equal(result.items[0].source, source);
  assert.ok(result.key);
  assert.equal(assess(policy, snapshot, destination, 'evil.chat.example.test'), null);
  assert.equal(assess(policy, snapshot, { ...destination, channel: 'api' }, host), null);
  assert.equal(assess(policy, { provider: 'other' }, destination, host), null);
});

test('all evidence fields are required', () => {
  for (const change of [{ status: 'unknown' }, { channel: 'api' }, { mandatoryCollection: false }, { trainingOptOut: 'available' }, { sources: [] }, { hosts: [] }, { checkedAt: '' }, { items: [] }, { items: [{ kind: 'training', text: 'x', source: 'https://other.test' }] }]) {
    assert.equal(assess({ ...policy, ...change }, snapshot, destination, host), null);
  }
});

test('conflicting observed account and settings suppress warning', () => {
  for (const change of [{ account: field('work') }, { plan: field('Enterprise') }, { training: field(false) }, { temporary: field(true) }]) {
    assert.equal(assess(policy, { ...snapshot, ...change }, destination, host), null);
  }
  assert.ok(assess(policy, { ...snapshot, training: { status: 'unknown', value: false } }, destination, host));
});

test('empty production allowlist excludes every provider and prototype names', () => {
  for (const provider of ['openai', 'anthropic', 'google', 'microsoft', 'deepseek', 'moonshot', 'mistral', 'perplexity', 'xai', 'alibaba', 'meta', 'toString', '__proto__']) {
    assert.equal(evaluate({ provider }), null);
  }
  assert.equal(evaluate(null), null);
});

test('training warning requires observed true on an exact supported consumer host', () => {
  context.PG.SITES = [{ provider: 'openai', hosts: ['chatgpt.com'] }, { provider: 'google', hosts: ['gemini.google.com'] }];
  context.PG.PROVIDER_LABELS = { openai: 'ChatGPT' };
  const { assessTraining } = context.PG.entryPolicy;
  const current = { provider: 'openai', training: field(true), checkedAt: 'now' };
  const dest = { provider: 'openai', channel: 'consumer' };
  const result = assessTraining(current, dest, 'chatgpt.com');
  assert.equal(result.kind, 'training-enabled');
  assert.equal(result.name, 'ChatGPT');
  assert.equal(result.key, 'training-enabled:openai');
  assert.equal(result.observedAt, 'now');
  assert.equal(result.items.length, 0);
  for (const change of [{ training: field(false) }, { training: { status: 'unknown', value: true } }, { training: true }, { temporary: field(true) }, { account: field('work') }, { plan: field('Enterprise') }]) {
    assert.equal(assessTraining({ ...current, ...change }, dest, 'chatgpt.com'), null);
  }
  assert.equal(assessTraining(current, dest, 'localhost'), null);
  assert.equal(assessTraining(current, dest, 'gemini.google.com'), null);
  assert.equal(assessTraining(current, { provider: 'google', channel: 'consumer' }, 'chatgpt.com'), null);
  assert.equal(assessTraining(current, { ...dest, channel: 'api' }, 'chatgpt.com'), null);
  assert.ok(assessTraining({ ...current, temporary: { status: 'unknown', value: true } }, dest, 'chatgpt.com'));
  context.location = { hostname: 'chatgpt.com' };
  context.PG.resolveDestination = () => dest;
  assert.equal(evaluate(current).kind, 'training-enabled');
});
