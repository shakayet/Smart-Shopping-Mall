const assert = require('node:assert/strict');
const test = require('node:test');

const { TTLCache } = require('../dist/helpers/cache.js');

test('cache coalesces concurrent misses into one loader call', async () => {
  const cache = new TTLCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { value: 42 };
  };

  const results = await Promise.all(
    Array.from({ length: 20 }, () => cache.getOrSet('same-key', 1_000, loader)),
  );

  assert.equal(calls, 1);
  assert.ok(results.every(result => result.value === 42));
});

test('prefix invalidation prevents an in-flight stale value from repopulating', async () => {
  const cache = new TTLCache();
  let resolveStale;
  const staleLoader = new Promise(resolve => {
    resolveStale = resolve;
  });

  const staleRequest = cache.getOrSet('products:detail:1', 1_000, () => staleLoader);
  cache.flushPrefix('products:detail:');
  const fresh = await cache.getOrSet(
    'products:detail:1',
    1_000,
    async () => 'fresh',
  );
  resolveStale('stale');
  await staleRequest;

  assert.equal(fresh, 'fresh');
  assert.equal(cache.get('products:detail:1'), 'fresh');
});

test('cache evicts the least recently used entry at its size bound', () => {
  const cache = new TTLCache(2);
  cache.set('one', 1, 1_000);
  cache.set('two', 2, 1_000);
  cache.get('one');
  cache.set('three', 3, 1_000);

  assert.equal(cache.get('one'), 1);
  assert.equal(cache.get('two'), undefined);
  assert.equal(cache.get('three'), 3);
});
