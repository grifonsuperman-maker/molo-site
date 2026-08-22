require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GuestReviewsController,
} = require('../dist/bookings/guest-reviews.controller.js');
const {
  ROLES_KEY,
} = require('../dist/common/decorators/roles.decorator.js');

function createController(review, initiallyArchived = false) {
  const removed = [];
  const logEntries = [];
  const state = { archived: initiallyArchived };

  const queryBuilder = {
    leftJoinAndSelect() { return this; },
    leftJoin() { return this; },
    innerJoin() { return this; },
    where() { return this; },
    orderBy() { return this; },
    addOrderBy() { return this; },
    take() { return this; },
    async getMany() { return review ? [review] : []; },
    async getOne() { return review; },
  };

  const repository = {
    createQueryBuilder() {
      return queryBuilder;
    },
    async save(value) {
      return value;
    },
    async remove(value) {
      removed.push(value);
      return value;
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
      throw new Error(`Unexpected SQL in review archive test: ${sql}`);
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

test('review archive mutations are owner-only', () => {
  for (const method of ['findArchive', 'archive', 'restore', 'deletePermanently']) {
    assert.deepEqual(
      Reflect.getMetadata(ROLES_KEY, GuestReviewsController.prototype[method]),
      ['owner'],
    );
  }
});

test('Director can archive and restore a review without deleting it', async () => {
  const review = reviewFixture();
  const { controller, removed, state, logEntries } = createController(review);

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
});

test('permanent deletion is blocked until the review is archived', async () => {
  const review = reviewFixture();
  const { controller, removed } = createController(review);

  await assert.rejects(
    () => controller.deletePermanently(review.id, ownerRequest),
    /Спочатку перемістіть відгук до архіву/,
  );
  assert.equal(removed.length, 0);
});

test('Director can permanently delete an archived review only', async () => {
  const review = reviewFixture();
  const { controller, removed, logEntries } = createController(review, true);

  const result = await controller.deletePermanently(review.id, ownerRequest);

  assert.deepEqual(result, { ok: true, id: review.id });
  assert.equal(removed.length, 1);
  assert.equal(logEntries.at(-1)[0], 'Відгук видалено назавжди');
});
