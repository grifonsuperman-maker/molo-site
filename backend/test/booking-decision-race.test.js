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

function fixture({ status = 'pending', tableStatus = 'pending', date = todayInKyiv() } = {}) {
  const table = { id: 'table-40', tableNumber: '40', status: tableStatus };
  const booking = {
    id: 'booking-40', status, bookingDate: date, table,
    client: { id: 'client-40', fullName: 'Гість' },
    approvedAt: null, rejectedAt: null, cancelledAt: null, completedAt: null,
    cancellationReason: null, checkedInAt: null, wishes: null, guestNotification: null,
  };
  const histories = [];
  const logs = [];
  const notifications = [];
  const lockedReads = [];
  let notificationGate = null;
  let tail = Promise.resolve();
  const bookingsRepo = {
    async findOne(options) {
      assert.equal(options.where.id, 'booking-40');
      if (options.lock) {
        assert.equal(options.lock.mode, 'pessimistic_write');
        lockedReads.push(booking.status);
      }
      return { ...booking, table: { ...table }, client: { ...booking.client } };
    },
    async save(value) { Object.assign(booking, value); return value; },
  };
  const historiesRepo = {
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
      if (entity === BookingHistory) return historiesRepo;
      if (entity === TableEntity) return tablesRepo;
      throw new Error('Unexpected repository');
    },
  };
  const dataSource = {
    async transaction(action) {
      // Simulate PostgreSQL row-lock ordering; this is not a live database test.
      const before = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await before;
      try { return await action(manager); }
      finally { release(); }
    },
  };
  const raw = {
    bookingSnapshot(value) {
      return { status: value.status, cancelledAt: value.cancelledAt, reason: value.cancellationReason };
    },
    markNoShowInWishes(value) { return `${value.wishes || ''}[NO_SHOW]`; },
    async safeLog(action, details) { logs.push({ action, details }); },
    async safeNotify(action) { await action(); },
    notifications: {
      async notifyBookingApproved(value) {
        notifications.push({ type: 'approved', status: value.status });
        if (notificationGate) await notificationGate;
      },
      async notifyBookingCancelled(value) {
        notifications.push({ type: 'cancelled', status: value.status });
        if (notificationGate) await notificationGate;
      },
    },
    async approve() { throw new Error('Uncoordinated approve'); },
    async reject() { throw new Error('Uncoordinated reject'); },
    async cancel() { throw new Error('Uncoordinated cancel'); },
    async noShow() { throw new Error('Uncoordinated noShow'); },
    async complete() { throw new Error('Uncoordinated complete'); },
    async checkIn() { throw new Error('Uncoordinated checkIn'); },
  };
  return {
    booking, table, histories, logs, notifications, lockedReads,
    service: createCoordinatedBookingsService(raw, dataSource),
    delayNotifications(promise) { notificationGate = promise; },
  };
}

for (const [firstAction, laterAction, expectedStatus, notificationType] of [
  ['approve', 'reject', 'approved', 'approved'],
  ['reject', 'approve', 'rejected', 'cancelled'],
  ['cancel', 'approve', 'cancelled', 'cancelled'],
  ['noShow', 'approve', 'cancelled', 'cancelled'],
  ['complete', 'approve', 'completed', null],
]) {
  test(`${firstAction} beats competing ${laterAction} without contradictory messages`, async () => {
    const state = fixture();
    let release;
    state.delayNotifications(new Promise((resolve) => { release = resolve; }));
    const first = state.service[firstAction]('booking-40');
    const later = state.service[laterAction]('booking-40');
    await assert.rejects(later, (error) => {
      assert.equal(error.getStatus(), 409);
      return true;
    });
    release();
    await first;
    assert.equal(state.booking.status, expectedStatus);
    assert.equal(state.histories.length, 1);
    assert.equal(state.logs.length, 1);
    assert.equal(state.notifications.length, notificationType ? 1 : 0);
    if (notificationType) assert.equal(state.notifications[0].type, notificationType);
    assert.equal(state.lockedReads.length, 2);
  });
}

test('repeated reject cannot write a second history row or Telegram notification', async () => {
  const state = fixture();
  const result = await Promise.allSettled(
    Array.from({ length: 10 }, () => state.service.reject('booking-40')),
  );
  assert.equal(result.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(result.filter((entry) => entry.status === 'rejected' && entry.reason.getStatus() === 409).length, 9);
  assert.equal(state.booking.status, 'rejected');
  assert.equal(state.histories.length, 1);
  assert.equal(state.logs.length, 1);
  assert.deepEqual(state.notifications.map((entry) => entry.type), ['cancelled']);
});

test('rejecting an approved booking requires the separate cancellation action', async () => {
  const state = fixture({ status: 'approved', tableStatus: 'reserved' });
  await assert.rejects(state.service.reject('booking-40'), (error) => error.getStatus() === 409);
  assert.equal(state.booking.status, 'approved');
  assert.equal(state.histories.length, 0);
  await state.service.cancel('booking-40');
  assert.equal(state.booking.status, 'cancelled');
  assert.equal(state.booking.cancellationReason, 'admin_cancelled');
  assert.equal(state.table.status, 'free');
});

test('no-show cannot cancel checked-in guests and terminal bookings cannot check in', async () => {
  const checkedIn = fixture({ status: 'approved', tableStatus: 'occupied' });
  checkedIn.booking.checkedInAt = new Date();
  await assert.rejects(checkedIn.service.noShow('booking-40'), (error) => error.getStatus() === 400);
  assert.equal(checkedIn.booking.status, 'approved');
  const rejected = fixture({ status: 'rejected' });
  await assert.rejects(rejected.service.checkIn('booking-40'), (error) => error.getStatus() === 409);
  assert.equal(rejected.booking.status, 'rejected');
});

test('physical table priority and waiter completion behavior are preserved', async () => {
  for (const tableStatus of ['occupied', 'cleaning', 'closed']) {
    const state = fixture({ tableStatus });
    await state.service.reject('booking-40');
    assert.equal(state.table.status, tableStatus);
  }
  const future = fixture({ date: '2099-01-01' });
  await future.service.cancel('booking-40');
  assert.equal(future.table.status, 'pending');
  const visit = fixture({ status: 'approved', tableStatus: 'occupied' });
  await visit.service.complete('booking-40', { role: 'waiter', staffId: 'waiter-40', name: 'Офіціант' });
  assert.equal(visit.table.status, 'free');
  assert.equal(visit.histories[0].actorRole, 'waiter');
  assert.equal(visit.histories[0].actorStaffId, 'waiter-40');
  assert.equal(visit.notifications.length, 0);
});
