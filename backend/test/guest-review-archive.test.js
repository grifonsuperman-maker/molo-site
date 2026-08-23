require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GuestReviewsController,
} = require('../dist/bookings/guest-reviews.controller.js');
const {
  ROLES_KEY,
} = require('../dist/common/decorators/roles.decorator.js');

function createController(review, initiallyArchived = false, archiveTotal = review ? 1 : 0) {
  const removed = [];
  const logEntries = [];
  const state = { archived: initiallyArchived };
  const transactions = [];
  const locks = [];
  const pagination = { skip: null, take: null };
  const archiveSearch = [];

  const queryBuilder = {
    leftJoinAndSelect() { return this; },
    leftJoin() { return this; },
    innerJoin() { return this; },
    where() { return this; },
    andWhere(sql, params) {
      archiveSearch.push({ sql, params });
      return this;
    },
    orderBy() { return this; },
    addOrderBy() { return this; },
    skip(value) {
      pagination.skip = value;
      return this;
    },
    take(value) {
      pagination.take = value;
      return this;
    },
    setLock(mode, version, aliases) {
      locks.push({ mode, aliases });
      return this;
    },
    async getMany() { return review ? [review] : []; },
    async getManyAndCount() {
      return [review ? [review] : [], archiveTotal];
    },
    async getOne() { return review; },
  };

  const repository = {
    manager: null,
    createQueryBuilder() {
      return queryBuilder;
    },
    async save(value) {
      return value;
    },
    async remove(value) {
      removed.push(value);
      state.archived = false;
      return value;
    },
    async query(sql) {
      if (sql.includes('SELECT EXISTS')) {
        return [{ archived: state.archived }];
      }
      throw new Error(`Unexpected repository SQL in review archive test: ${sql}`);
    },
  };

  const manager = {
    getRepository() {
      return repository;
    },
    async query(sql) {
      if (sql.includes('INSERT INTO "guest_review_archives"')) {
        if (state.archived) return [];
        state.archived = true;
        return [{ guest_review_id: review.id }];
      }
      if (sql.includes('DELETE FROM "guest_review_archives"')) {
        if (!state.archived) return [];
        state.archived = false;
        return [{ guest_review_id: review.id }];
      }
      if (sql.includes('SELECT EXISTS')) {
        return [{ archived: state.archived }];
      }
      throw new Error(`Unexpected transaction SQL in review archive test: ${sql}`);
    },
  };

  repository.manager = {
    async transaction(callback) {
      transactions.push('transaction');
      return callback(manager);
    },
  };

  const permissions = {
    async assert() {},
  };
  const logs = {
    async create(...args) {
      logEntries.push(args);
    },
  };

  return {
    controller: new GuestReviewsController(repository, permissions, logs),
    removed,
    logEntries,
    state,
    transactions,
    locks,
    pagination,
    archiveSearch,
  };
}

function reviewFixture() {
  return {
    id: 'review-1',
    text: 'Все сподобалось',
    booking: {
      client: { fullName: 'Тестовий гість' },
    },
  };
}

const ownerRequest = {
  user: { role: 'owner', name: 'Директор' },
};

test('review archive manager endpoints are owner-only', () => {
  for (const method of ['findActive', 'findArchive', 'archive', 'restore', 'deletePermanently']) {
    assert.deepEqual(
      Reflect.getMetadata(ROLES_KEY, GuestReviewsController.prototype[method]),
      ['owner'],
    );
  }
});

test('active review manager supports pages beyond the first 300 reviews and displayed-date search', async () => {
  const review = reviewFixture();
  const { controller, pagination, archiveSearch } = createController(review, false, 451);

  const result = await controller.findActive('4', '100', '23.08.2026');

  assert.deepEqual(result, {
    items: [review],
    total: 451,
    page: 4,
    limit: 100,
    hasMore: true,
  });
  assert.deepEqual(pagination, { skip: 300, take: 100 });
  assert.equal(archiveSearch.length, 1);
  assert.match(
    archiveSearch[0].sql,
    /TO_CHAR\("booking"\."booking_date", 'DD\.MM\.YYYY'\)/,
  );
  assert.equal(archiveSearch[0].params.activeSearch, '%23.08.2026%');
});

test('archive list supports pages beyond the first 300 reviews', async () => {
  const review = reviewFixture();
  const { controller, pagination, archiveSearch } = createController(review, true, 451);

  const result = await controller.findArchive('4', '100', 'ТЕСТ');

  assert.deepEqual(result, {
    items: [review],
    total: 451,
    page: 4,
    limit: 100,
    hasMore: true,
  });
  assert.deepEqual(pagination, { skip: 300, take: 100 });
  assert.equal(archiveSearch.length, 1);
  assert.equal(archiveSearch[0].params.archiveSearch, '%тест%');
});

test('archive search accepts the date format shown to the Director', async () => {
  const review = reviewFixture();
  const { controller, archiveSearch } = createController(review, true, 1);

  await controller.findArchive('1', '50', '23.08.2026');

  assert.equal(archiveSearch.length, 1);
  assert.match(
    archiveSearch[0].sql,
    /TO_CHAR\("booking"\."booking_date", 'DD\.MM\.YYYY'\)/,
  );
  assert.equal(archiveSearch[0].params.archiveSearch, '%23.08.2026%');
});

test('Director can archive and restore a review without deleting it', async () => {
  const review = reviewFixture();
  const { controller, removed, state, logEntries, transactions, locks } = createController(review);

  assert.deepEqual(await controller.archive(review.id, ownerRequest), {
    ok: true,
    id: review.id,
  });
  assert.equal(state.archived, true);
  assert.equal(removed.length, 0);
  assert.equal(logEntries.at(-1)[0], 'Відгук переміщено до архіву');

  assert.deepEqual(await controller.restore(review.id, ownerRequest), {
    ok: true,
    id: review.id,
  });
  assert.equal(state.archived, false);
  assert.equal(removed.length, 0);
  assert.equal(logEntries.at(-1)[0], 'Відгук відновлено з архіву');
  assert.equal(transactions.length, 2);
  assert.deepEqual(locks, [
    { mode: 'pessimistic_write', aliases: ['review'] },
    { mode: 'pessimistic_write', aliases: ['review'] },
  ]);
});

test('permanent deletion is blocked until the review is archived', async () => {
  const review = reviewFixture();
  const { controller, removed, transactions, locks } = createController(review);

  await assert.rejects(
    () => controller.deletePermanently(review.id, ownerRequest),
    /Спочатку перемістіть відгук до архіву/,
  );
  assert.equal(removed.length, 0);
  assert.equal(transactions.length, 1);
  assert.deepEqual(locks, [
    { mode: 'pessimistic_write', aliases: ['review'] },
  ]);
});

test('Director can permanently delete an archived review only', async () => {
  const review = reviewFixture();
  const { controller, removed, logEntries, transactions, locks } = createController(review, true);

  const result = await controller.deletePermanently(review.id, ownerRequest);

  assert.deepEqual(result, { ok: true, id: review.id });
  assert.equal(removed.length, 1);
  assert.equal(logEntries.at(-1)[0], 'Відгук видалено назавжди');
  assert.equal(transactions.length, 1);
  assert.deepEqual(locks, [
    { mode: 'pessimistic_write', aliases: ['review'] },
  ]);
});
