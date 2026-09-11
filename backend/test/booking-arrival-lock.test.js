require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingArrivalLockService,
} = require('../dist/bookings/booking-arrival-lock.service.js');

function createHarness(status = 'approved', cancellationReason = null) {
  const calls = [];
  const runner = {
    async connect() { calls.push(['connect']); },
    async query(sql, params) { calls.push(['query', sql, params]); },
    async release() { calls.push(['release']); },
  };
  const dataSource = {
    createQueryRunner() { return runner; },
  };
  const bookings = {
    async findOne() {
      calls.push(['findOne', status, cancellationReason]);
      return { id: 'booking-1', status, cancellationReason };
    },
  };
  return {
    service: new BookingArrivalLockService(dataSource, bookings),
    calls,
  };
}

test('arrival lock holds the same advisory lock around a booking action', async () => {
  const { service, calls } = createHarness();
  let ran = false;

  await service.withLock('booking-1', async () => {
    ran = true;
    calls.push(['work']);
  });

  assert.equal(ran, true);
  assert.equal(calls[1][0], 'query');
  assert.match(calls[1][1], /pg_advisory_lock/);
  assert.deepEqual(calls[1][2], ['booking:booking-1', 'arrival-state']);
  assert.deepEqual(calls[2], ['work']);
  assert.match(calls[3][1], /pg_advisory_unlock/);
  assert.deepEqual(calls[4], ['release']);
});

test('check-in cannot resurrect a booking already cancelled as no-show', async () => {
  const { service, calls } = createHarness('cancelled', 'no_show');
  let ran = false;

  await assert.rejects(
    service.withCheckInLock('booking-1', async () => {
      ran = true;
    }),
    /Бронювання вже анульовано через неявку/,
  );

  assert.equal(ran, false);
  assert.ok(calls.some((call) => call[0] === 'findOne'));
  assert.ok(calls.some((call) => call[0] === 'query' && /pg_advisory_unlock/.test(call[1])));
});

test('check-in guard does not redefine unrelated cancelled-booking behavior', async () => {
  const { service } = createHarness('cancelled', 'guest_cancelled');
  let ran = false;

  await service.withCheckInLock('booking-1', async () => {
    ran = true;
  });

  assert.equal(ran, true);
});
