require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GuestReviewsController,
} = require('../dist/bookings/guest-reviews.controller.js');
const {
  ROLES_KEY,
} = require('../dist/common/decorators/roles.decorator.js');

function createController(review) {
  const saved = [];
  const removed = [];
  const logEntries = [];
  const repository = {
    async findOne() {
      return review;
    },
    async save(value) {
      saved.push(value);
      return value;
    },
    async remove(value) {
      removed.push(value);
      return value;
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
    saved,
    removed,
    logEntries,
  };
}

function reviewFixture(archivedAt = null) {
  return {
    id: 'review-1',
    text: 'Все сподобалось',
    archivedAt,
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
  const { controller, saved, removed } = createController(review);

  const archived = await controller.archive(review.id, ownerRequest);
  assert.ok(archived.archivedAt instanceof Date);
  assert.equal(saved.length, 1);
  assert.equal(removed.length, 0);

  const restored = await controller.restore(review.id, ownerRequest);
  assert.equal(restored.archivedAt, null);
  assert.equal(saved.length, 2);
  assert.equal(removed.length, 0);
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
  const review = reviewFixture(new Date('2026-08-22T20:00:00Z'));
  const { controller, removed, logEntries } = createController(review);

  const result = await controller.deletePermanently(review.id, ownerRequest);

  assert.deepEqual(result, { ok: true, id: review.id });
  assert.equal(removed.length, 1);
  assert.equal(logEntries.at(-1)[0], 'Відгук видалено назавжди');
});
