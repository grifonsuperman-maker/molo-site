require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const {
  BookingRescheduleRequest,
} = require('../dist/bookings/entities/booking-reschedule-request.entity.js');

function createHarness(status = 'pending') {
  const request = {
    id: 'reschedule-1',
    status,
    adminComment: null,
    resolvedAt: null,
  };
  const observed = {
    transaction: false,
    lock: null,
    saves: 0,
  };

  const repository = {
    async findOne(options) {
      observed.lock = options?.lock?.mode || null;
      return options?.where?.id === request.id ? request : null;
    },
    async save(value) {
      observed.saves += 1;
      return value;
    },
  };

  const manager = {
    getRepository(entity) {
      assert.equal(entity, BookingRescheduleRequest);
      return repository;
    },
  };

  const reschedules = {
    manager: {
      async transaction(callback) {
        observed.transaction = true;
        return callback(manager);
      },
    },
  };

  const service = new BookingsService(
    {},
    {},
    reschedules,
    {},
    {},
    {},
    {},
    {},
    {},
  );

  return { request, observed, service };
}

test('reschedule rejection is serialized with a pessimistic write lock', async () => {
  const { request, observed, service } = createHarness('pending');

  const result = await service.rejectReschedule('reschedule-1', {
    adminComment: 'Час уже зайнятий',
  });

  assert.equal(observed.transaction, true);
  assert.equal(observed.lock, 'pessimistic_write');
  assert.equal(observed.saves, 1);
  assert.equal(request.status, 'rejected');
  assert.equal(request.adminComment, 'Час уже зайнятий');
  assert.ok(request.resolvedAt instanceof Date);
  assert.deepEqual(result, { message: 'Перенесення відхилено' });
});

test('stale reject cannot overwrite an already processed reschedule', async () => {
  const { request, observed, service } = createHarness('approved');

  await assert.rejects(
    () => service.rejectReschedule('reschedule-1', { adminComment: 'Запізніле рішення' }),
    (error) => {
      assert.equal(error?.getStatus?.(), 400);
      assert.equal(error?.message, 'Цей запит уже опрацьовано');
      return true;
    },
  );

  assert.equal(observed.transaction, true);
  assert.equal(observed.lock, 'pessimistic_write');
  assert.equal(observed.saves, 0);
  assert.equal(request.status, 'approved');
  assert.equal(request.adminComment, null);
  assert.equal(request.resolvedAt, null);
});
