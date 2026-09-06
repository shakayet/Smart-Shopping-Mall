const assert = require('node:assert/strict');
const test = require('node:test');

const { cache } = require('../dist/helpers/cache.js');
const { socketHelper } = require('../dist/helpers/socketHelper.js');
const {
  PRODUCT_LIST_CACHE_PREFIX,
  PRODUCT_DETAIL_CACHE_PREFIX,
  PRODUCT_STATUS_CHANGED_EVENT,
  PRODUCT_WISHLIST_COUNT_CHANGED_EVENT,
  invalidateAllProductCaches,
  publishProductWishlistCount,
  synchronizeProductStatusMutation,
} = require('../dist/app/modules/product/product-state-sync.js');

test('profile changes invalidate product feeds and populated product details', () => {
  const listKey = `${PRODUCT_LIST_CACHE_PREFIX}profile-view`;
  const detailKey = `${PRODUCT_DETAIL_CACHE_PREFIX}product-1`;
  cache.set(listKey, { sellerImage: 'old.jpg' }, 10_000);
  cache.set(detailKey, { sellerImage: 'old.jpg' }, 10_000);

  invalidateAllProductCaches();

  assert.equal(cache.get(listKey), undefined);
  assert.equal(cache.get(detailKey), undefined);
});

test('a secured product invalidates all feeds and broadcasts one authoritative status', async () => {
  const sellerCacheKey = `${PRODUCT_LIST_CACHE_PREFIX}seller-view`;
  const buyerCacheKey = `${PRODUCT_LIST_CACHE_PREFIX}buyer-view`;
  cache.set(sellerCacheKey, { status: 'available' }, 10_000);
  cache.set(buyerCacheKey, { status: 'available' }, 10_000);

  const emitted = [];
  const originalEmitToAll = socketHelper.emitToAll;
  socketHelper.emitToAll = (event, payload) => emitted.push({ event, payload });

  try {
    const result = await synchronizeProductStatusMutation(
      Promise.resolve({ id: 'product-1' }),
      { productId: 'product-1', status: 'secured' },
    );

    assert.deepEqual(result, { id: 'product-1' });
    assert.equal(cache.get(sellerCacheKey), undefined);
    assert.equal(cache.get(buyerCacheKey), undefined);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, PRODUCT_STATUS_CHANGED_EVENT);
    assert.equal(emitted[0].payload.productId, 'product-1');
    assert.equal(emitted[0].payload.status, 'secured');
    assert.match(emitted[0].payload.changedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    socketHelper.emitToAll = originalEmitToAll;
  }
});

test('a failed or unmatched mutation does not publish a false status change', async () => {
  const cacheKey = `${PRODUCT_LIST_CACHE_PREFIX}unchanged-view`;
  cache.set(cacheKey, { status: 'available' }, 10_000);

  const emitted = [];
  const originalEmitToAll = socketHelper.emitToAll;
  socketHelper.emitToAll = (event, payload) => emitted.push({ event, payload });

  try {
    const result = await synchronizeProductStatusMutation(
      Promise.resolve(null),
      { productId: 'product-2', status: 'secured' },
    );

    assert.equal(result, null);
    assert.deepEqual(cache.get(cacheKey), { status: 'available' });
    assert.deepEqual(emitted, []);
  } finally {
    socketHelper.emitToAll = originalEmitToAll;
  }
});

test('wishlist count changes invalidate buyer and seller feeds and broadcast the total', () => {
  const sellerCacheKey = `${PRODUCT_LIST_CACHE_PREFIX}wishlist-seller-view`;
  const buyerCacheKey = `${PRODUCT_LIST_CACHE_PREFIX}wishlist-buyer-view`;
  cache.set(sellerCacheKey, { wishlistCount: 1 }, 10_000);
  cache.set(buyerCacheKey, { wishlistCount: 1 }, 10_000);

  const emitted = [];
  const originalEmitToAll = socketHelper.emitToAll;
  socketHelper.emitToAll = (event, payload) => emitted.push({ event, payload });

  try {
    publishProductWishlistCount('product-3', 2);

    assert.equal(cache.get(sellerCacheKey), undefined);
    assert.equal(cache.get(buyerCacheKey), undefined);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, PRODUCT_WISHLIST_COUNT_CHANGED_EVENT);
    assert.equal(emitted[0].payload.productId, 'product-3');
    assert.equal(emitted[0].payload.wishlistCount, 2);
  } finally {
    socketHelper.emitToAll = originalEmitToAll;
  }
});
