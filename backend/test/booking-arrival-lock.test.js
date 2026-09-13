require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingArrivalLockService,
} = require('../dist/bookings/booking-arrival-lock.service.js');

test('arrival wrapper does not reserve a separate database connection', async () => {
  const service = new BookingArrivalLockService();
  const calls = [];

  const result = await service.withLock('booking-1', async () => {
    calls.push('work');
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.deepEqual(calls, ['work']);
});

test('check-in compatibility wrapper delegates without a second pooled connection', async () => {
  const service = new BookingArrivalLockService();
  let ran = false;

  const result = await service.withCheckInLock('booking-1', async () => {
    ran = true;
    return { message: 'ok' };
  });

  assert.equal(ran, true);
  assert.deepEqual(result, { message: 'ok' });
});
