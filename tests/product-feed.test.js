const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildProductFeedCacheDiscriminator,
  buildProductFeedViewerFilter,
} = require('../dist/app/modules/product/product-feed.util.js');

test('authenticated product feeds exclude the viewer as seller', () => {
  const filter = buildProductFeedViewerFilter('viewer-1');

  assert.deepEqual(filter, {
    $and: [{ seller: { $ne: 'viewer-1' } }],
  });
  assert.deepEqual(buildProductFeedViewerFilter(), {});
});

test('product feed caches are isolated by viewer', () => {
  const query = { status: 'available', page: '1' };

  assert.notEqual(
    buildProductFeedCacheDiscriminator(query, 'viewer-1'),
    buildProductFeedCacheDiscriminator(query, 'viewer-2'),
  );
});
