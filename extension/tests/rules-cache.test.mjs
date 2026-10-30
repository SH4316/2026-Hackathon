import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundleCache, bundleScope } from '../src/rules-cache.js';
const settings = { serverEnabled: true, serverUrl: 'https://fixture.invalid', apiKey: 'synthetic-token' };
const bundle = { custom_rules: [], org_rules: { revision: 3 } };
function setup(fetchBundle) {
  let stored = null, writes = 0;
  const cache = createBundleCache({ read: async () => stored, write: async v => { stored = v; writes++; }, fetchBundle });
  return { cache, stored: () => stored, writes: () => writes };
}
test('bundle persists without credential, sends ETag and reuses 304 after worker restart', async () => {
  let calls = 0;
  const fixture = setup(async (url, options) => {
    assert.equal(url, settings.serverUrl);
    assert.equal(options.apiKey, settings.apiKey);
    assert.equal(options.etag, calls++ ? '"v3"' : undefined);
    return calls === 1 ? { status: 'updated', bundle, etag: '"v3"' } : { status: 'not_modified' };
  });
  await fixture.cache.refresh(settings);
  await fixture.cache.refresh(settings);
  assert.equal(fixture.writes(), 1);
  assert.deepEqual((await fixture.cache.current(settings)).bundle, bundle);
  assert.ok(!JSON.stringify(fixture.stored()).includes('synthetic-token'));
  const restarted = createBundleCache({ read: async () => fixture.stored(), write: () => assert.fail(),
    fetchBundle: async (_, options) => { assert.equal(options.etag, '"v3"'); return { status: 'not_modified' }; } });
  assert.deepEqual((await restarted.refresh(settings)).bundle, bundle);
});
test('network failure/server off preserves cached rules; other server or credential never uses them', async () => {
  let fail = false;
  const { cache } = setup(async () => { if (fail) throw Error('network'); return { status: 'updated', bundle }; });
  await cache.refresh(settings); fail = true;
  await assert.rejects(cache.refresh(settings), /network/);
  assert.deepEqual((await cache.current(settings)).bundle, bundle);
  assert.deepEqual((await cache.current({ ...settings, serverEnabled: false })).bundle, bundle);
  for (const change of [{ serverUrl: 'https://other.invalid' }, { apiKey: 'another-synthetic-token' }]) {
    assert.equal(await cache.current({ ...settings, ...change }), null);
  }
  assert.equal(await cache.refresh({ ...settings, serverEnabled: false }), null);
  assert.equal(await bundleScope(settings), await bundleScope({ ...settings, serverUrl: settings.serverUrl + '/' }));
});
test('settings change discards a late response and overlapping refreshes share one request', async () => {
  let finish, calls = 0;
  const { cache, writes } = setup(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = cache.refresh(settings), second = cache.refresh(settings);
  while (!finish) await new Promise(r => setTimeout(r, 1));
  cache.invalidate(); finish({ status: 'updated', bundle });
  assert.equal(await first, null); assert.equal(await second, null);
  assert.equal(calls, 1); assert.equal(writes(), 0);
});
