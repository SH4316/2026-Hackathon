import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import vendor from '../vendor/prompt-guard-rules/data/policy.js';
const context = vm.createContext({ PG: { resolveDestination: () => ({ provider: 'openai', channel: 'consumer' }), PROVIDER_LABELS: { openai: 'ChatGPT' } } });
vm.runInContext(await readFile(new URL('../src/entry-policy.js', import.meta.url), 'utf8'), context);
const { evaluate } = context.PG.entryPolicy;
const field = value => ({ status: 'observed', value });
const snapshot = { provider: 'openai', model: field('가상 모델 A'), training: field(false), optIn: field(true) };

test('ON, OFF, unknown, enterprise and temporary all receive informational entry guidance', () => {
  for (const change of [{}, { training: field(true) }, { training: { status: 'unknown' } }, { account: field('Enterprise') }, { temporary: field(true) }]) {
    const result = evaluate({ ...snapshot, ...change });
    assert.equal(result.kind, 'site-information');
    assert.equal(result.name, 'ChatGPT');
    assert.ok(result.items.some(item => item.text === '확인하지 못했습니다'));
  }
  assert.equal(evaluate(snapshot).items.find(i => i.label === '학습·모델 개선 설정').text, 'OFF');
  assert.match(evaluate(snapshot).items.find(i => i.label === '학습 opt-in 상태').text, /ON/);
});

test('server destinations and vendor profiles are informational evidence, model-specific unknown stays explicit', () => {
  const result = evaluate(snapshot, { openai: { consumer: { tier: 'elevated', basis: '합성 정책', verified_at: '2026-10-30' } } });
  assert.equal(result.items.find(i => i.label === '제공사·접근 경로 정책').text, '합성 정책');
  assert.equal(result.items.find(i => i.label === '모델별 학습 정책').text, '확인하지 못했습니다');
  assert.equal(evaluate(snapshot, vendor.destinations).items.find(i => i.label === '제공사·접근 경로 정책').text,
    vendor.destinations.profiles.openai.channels.consumer.basis);
  assert.equal(evaluate(snapshot).items.find(i => i.label === '정책 확인일').text, '확인하지 못했습니다');
});

test('entry key changes only with selected model/provider, never creates transmission consent', () => {
  const first = evaluate(snapshot);
  assert.equal(evaluate({ ...snapshot, training: field(true) }).key, first.key);
  assert.notEqual(evaluate({ ...snapshot, model: field('가상 모델 B') }).key, first.key);
  assert.notEqual(evaluate({ ...snapshot, model: { status: 'unknown' } }).key, first.key);
  assert.equal(first.decision, undefined);
  assert.equal(first.sendAction, undefined);
  assert.equal(evaluate({ provider: 'other' }), null);
  assert.equal(evaluate(null), null);
});
