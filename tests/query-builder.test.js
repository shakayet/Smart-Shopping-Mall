const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizePagination } = require('../dist/app/builder/QueryBuilder.js');

test('pagination defaults invalid input and caps oversized responses', () => {
  assert.deepEqual(normalizePagination({}), { page: 1, limit: 10 });
  assert.deepEqual(normalizePagination({ page: '-2', limit: '0' }), {
    page: 1,
    limit: 10,
  });
  assert.deepEqual(normalizePagination({ page: '3', limit: '10000' }), {
    page: 3,
    limit: 100,
  });
});
