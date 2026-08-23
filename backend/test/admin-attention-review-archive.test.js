const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AdminAttentionService,
} = require('../dist/bookings/admin-attention.service.js');

test('Admin attention dashboard excludes archived reviews', async () => {
  const joins = [];
  const whereClauses = [];

  const reviewQuery = {
    leftJoinAndSelect(relation, alias) {
      joins.push({ type: 'select', relation, alias });
      return this;
    },
    leftJoin(relation, alias, condition) {
      joins.push({ type: 'left', relation, alias, condition });
      return this;
    },
    where(condition) {
      whereClauses.push(condition);
      return this;
    },
    orderBy() { return this; },
    take() { return this; },
    async getMany() { return []; },
  };

  const tableChanges = {
    async find() { return []; },
  };
  const reviews = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'review');
      return reviewQuery;
    },
  };

  const service = new AdminAttentionService(
    tableChanges,
    reviews,
    {},
  );

  const result = await service.dashboard();

  assert.deepEqual(result, { tableChanges: [], reviews: [] });
  assert.ok(joins.some((join) =>
    join.type === 'left' &&
    join.relation === 'guest_review_archives' &&
    join.alias === 'review_archive' &&
    join.condition === 'review_archive.guest_review_id = review.id'
  ));
  assert.deepEqual(whereClauses, [
    'review_archive.guest_review_id IS NULL',
  ]);
});
