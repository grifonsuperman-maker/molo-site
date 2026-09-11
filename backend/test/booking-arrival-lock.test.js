require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingArrivalLockService,
} = require('../dist/bookings/booking-arrival-lock.service.js');

function createHarness(status = 'approved') {
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
      calls.push(['findOne', status]);
      return { id: 'booking-1', status };
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

test('check-in cannot resurrect a booking already cancelled by no-show', async () => {
  const { service, calls } = createHarness('cancelled');
  let ran = false;

  await assert.rejects(
    service.withCheckInLock('booking-1', async () => {
      ran = true;
    }),
    /Бронювання вже анульовано/,
  );

  assert.equal(ran, false);
  assert.ok(calls.some((call) => call[0] === 'findOne'));
  assert.ok(calls.some((call) => call[0] === 'query' && /pg_advisory_unlock/.test(call[1])));
});
