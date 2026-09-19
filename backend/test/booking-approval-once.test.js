require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { createCoordinatedBookingsService } = require('../dist/bookings/coordinated-bookings.provider.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

function todayInKyiv() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function fixture(status = 'pending', tableStatus = 'pending') {
  const table = { id: 'table-40', tableNumber: '40', status: tableStatus };
  const booking = {
    id: 'booking-40', status, bookingDate: todayInKyiv(),
    approvedAt: status === 'approved' ? new Date('2026-09-18T15:00:00Z') : null,
    table, client: { fullName: 'Гість' },
  };
  const histories = [];
  const logs = [];
  const notifications = [];
  let gate = null;
  let tail = Promise.resolve();

  const bookingsRepo = {
    async findOne(options) {
      assert.equal(options.where.id, 'booking-40');
      if (options.lock) assert.equal(options.lock.mode, 'pessimistic_write');
      return { ...booking, table: { ...table } };
    },
    async save(value) {
      Object.assign(booking, value);
      return value;
    },
  };
  const historyRepo = {
    create(value) { return value; },
    async save(value) { histories.push(value); return value; },
  };
  const tablesRepo = {
    async findOne(options) {
      assert.equal(options.where.id, 'table-40');
      assert.equal(options.lock.mode, 'pessimistic_write');
      return { ...table };
    },
    async save(value) { Object.assign(table, value); return value; },
  };
  const manager = {
    getRepository(entity) {
      if (entity === Booking) return bookingsRepo;
      if (entity === BookingHistory) return historyRepo;
      if (entity === TableEntity) return tablesRepo;
      throw new Error('Unexpected repository');
    },
  };
  const dataSource = {
    async transaction(action) {
      // Simulate the database's serialization of competing row locks.
      const preceding = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await preceding;
      try { return await action(manager); }
      finally { release(); }
    },
  };
  const raw = {
    bookingSnapshot(value) { return { status: value.status, approvedAt: value.approvedAt }; },
    async safeLog(action, details) { logs.push({ action, details }); },
    async safeNotify(action) { await action(); },
    notifications: {
      async notifyBookingApproved(value) {
        notifications.push(value.id);
        if (gate) await gate;
      },
    },
    async approve() { throw new Error('Unsafe raw approve must never be used'); },
  };
  return {
    booking, table, histories, logs, notifications,
    service: createCoordinatedBookingsService(raw, dataSource),
    delayNotifications(promise) { gate = promise; },
  };
}

test('ten concurrent website and Telegram approvals change one booking and notify once', async () => {
  const state = fixture();
  let release;
  state.delayNotifications(new Promise((resolve) => { release = resolve; }));

  const first = state.service.approve('booking-40');
  const retries = await Promise.all(
    Array.from({ length: 9 }, () => state.service.approve('booking-40')),
  );
  assert.ok(retries.every((result) => result.message === 'Бронювання вже підтверджено'));
  assert.equal(state.booking.status, 'approved');
  assert.equal(state.histories.length, 1);
  assert.equal(state.table.status, 'reserved');
  assert.deepEqual(state.notifications, ['booking-40']);

  release();
  assert.deepEqual(await first, { message: 'Бронювання підтверджено' });
  assert.equal(state.logs.length, 1);
  assert.equal(state.histories[0].action, 'booking_approved');
  assert.equal(state.histories[0].previousData.status, 'pending');
  assert.equal(state.histories[0].newData.status, 'approved');
});

test('already approved booking preserves timestamp, history and notifications', async () => {
  const state = fixture('approved', 'reserved');
  const approvedAt = state.booking.approvedAt;
  assert.deepEqual(await state.service.approve('booking-40'), {
    message: 'Бронювання вже підтверджено',
  });
  assert.equal(state.booking.approvedAt, approvedAt);
  assert.equal(state.histories.length, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.logs.length, 0);
});

for (const status of ['rejected', 'cancelled', 'completed']) {
  test(`a ${status} booking cannot be approved by a stale Telegram button`, async () => {
    const state = fixture(status);
    await assert.rejects(state.service.approve('booking-40'), (error) => {
      assert.equal(error.getStatus(), 409);
      return true;
    });
    assert.equal(state.booking.status, status);
    assert.equal(state.histories.length, 0);
    assert.equal(state.notifications.length, 0);
  });
}

for (const physicalStatus of ['occupied', 'cleaning', 'closed']) {
  test(`approving a booking preserves the physical ${physicalStatus} table state`, async () => {
    const state = fixture('pending', physicalStatus);
    await state.service.approve('booking-40');
    assert.equal(state.table.status, physicalStatus);
    assert.deepEqual(state.notifications, ['booking-40']);
  });
}
