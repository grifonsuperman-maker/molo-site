require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCoordinatedBookingsService,
} = require('../dist/bookings/coordinated-bookings.provider.js');

function kyivToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function harness({ status = 'pending', tableStatus = 'pending', date = kyivToday(), missing = false } = {}) {
  const calls = [];
  const table = { id: 'table-40', tableNumber: '40', status: tableStatus };
  const booking = {
    id: 'booking-40', status, approvedAt: status === 'approved' ? new Date('2026-09-18T17:00:00Z') : null,
    bookingDate: date, bookingTime: '19:20:00', durationMinutes: 120,
    checkedInAt: null, cancelledAt: null, completedAt: null, cancellationReason: null,
    expectedArrivalAt: null, table, client: { id: 'client-1', fullName: 'Гість' },
  };
  const bookings = {
    async findOne(options) {
      calls.push(['booking.findOne', options]);
      if (missing) return null;
      return booking;
    },
    async save(value) {
      calls.push(['booking.save', value.status]);
      return value;
    },
  };
  const histories = {
    create(value) { calls.push(['history.create', value.action]); return value; },
    async save(value) { calls.push(['history.save', value.action]); return value; },
  };
  const tables = {
    async findOne(options) { calls.push(['table.findOne', options]); return table; },
    async save(value) { calls.push(['table.save', value.status]); return value; },
  };
  const manager = {
    getRepository(entity) {
      if (entity.name === 'Booking') return bookings;
      if (entity.name === 'BookingHistory') return histories;
      if (entity.name === 'TableEntity') return tables;
      throw new Error(`Unexpected repository: ${entity.name}`);
    },
  };
  // Simulate PostgreSQL's row-lock queue so concurrent requests observe the
  // committed status in order; assert the code really requests the row lock.
  let queue = Promise.resolve();
  const dataSource = {
    async transaction(work) {
      const previous = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        calls.push(['transaction']);
        return await work(manager);
      } finally {
        release();
      }
    },
  };
  const raw = {
    bookingSnapshot(value) {
      return { status: value.status, tableId: value.table?.id || null, approvedAt: value.approvedAt };
    },
    async safeLog(action, details) { calls.push(['log', action, details.bookingId]); },
    async safeNotify(action) { await action(); },
    notifications: {
      async notifyBookingApproved(value) {
        calls.push(['notify', value.id]);
        // A slow Telegram send must not make the next click notify again.
        await new Promise((resolve) => setTimeout(resolve, 3));
      },
    },
    async approve() { throw new Error('Raw approval must not bypass transaction'); },
  };
  return { service: createCoordinatedBookingsService(raw, dataSource), calls, booking, table };
}

test('ten concurrent web/Telegram confirmations create one transition and one notification', async () => {
  const { service, calls, booking, table } = harness();
  const results = await Promise.all(Array.from({ length: 10 }, () => service.approve('booking-40')));

  assert.equal(results.filter((result) => result.message === 'Бронювання підтверджено').length, 1);
  assert.equal(results.filter((result) => result.message === 'Бронювання вже підтверджено').length, 9);
  assert.equal(booking.status, 'approved');
  assert.ok(booking.approvedAt instanceof Date);
  assert.equal(table.status, 'reserved');
  assert.equal(calls.filter(([name]) => name === 'booking.save').length, 1);
  assert.equal(calls.filter(([name]) => name === 'history.save').length, 1);
  assert.equal(calls.filter(([name]) => name === 'table.save').length, 1);
  assert.equal(calls.filter(([name]) => name === 'log').length, 1);
  assert.equal(calls.filter(([name]) => name === 'notify').length, 1);
  assert.equal(calls.filter(([name, options]) => name === 'booking.findOne' && options.lock?.mode === 'pessimistic_write').length, 10);

  const firstApprovalAt = booking.approvedAt;
  const repeat = await service.approve('booking-40');
  assert.equal(repeat.message, 'Бронювання вже підтверджено');
  assert.equal(booking.approvedAt, firstApprovalAt);
  assert.equal(calls.filter(([name]) => name === 'notify').length, 1);
});

test('stale approvals cannot resurrect rejected, cancelled, no-show or completed bookings', async () => {
  for (const status of ['rejected', 'cancelled', 'completed']) {
    const { service, calls, booking } = harness({ status });
    await assert.rejects(service.approve('booking-40'), (error) => error.status === 409);
    assert.equal(booking.status, status);
    assert.deepEqual(calls.map(([name]) => name), ['transaction', 'booking.findOne']);
  }
});

test('already-approved booking is unchanged and missing booking is rejected', async () => {
  const { service, calls, booking } = harness({ status: 'approved' });
  const originalApprovedAt = booking.approvedAt;
  assert.equal((await service.approve('booking-40')).message, 'Бронювання вже підтверджено');
  assert.equal(booking.approvedAt, originalApprovedAt);
  assert.equal(calls.filter(([name]) => name === 'history.save' || name === 'notify').length, 0);

  const absent = harness({ missing: true });
  await assert.rejects(absent.service.approve('missing'), (error) => error.status === 404);
});

test('approval preserves physical occupied/cleaning/closed statuses and future-day table status', async () => {
  for (const tableStatus of ['occupied', 'cleaning', 'closed']) {
    const { service, table, calls } = harness({ tableStatus });
    await service.approve('booking-40');
    assert.equal(table.status, tableStatus);
    assert.equal(calls.filter(([name]) => name === 'table.save').length, 0);
  }

  const future = harness({ date: '2099-01-01' });
  await future.service.approve('booking-40');
  assert.equal(future.table.status, 'pending');
  assert.equal(future.calls.filter(([name]) => name === 'table.findOne').length, 0);
});
