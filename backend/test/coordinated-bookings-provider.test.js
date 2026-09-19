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

function createHarness({
  status = 'approved',
  cancellationReason = null,
  checkedInAt = null,
  tableStatus = 'reserved',
  otherBookings = [],
  onBookingLock = null,
  failHistory = false,
  failBookingSave = false,
} = {}) {
  const calls = [];
  const table = {
    id: 'table-8', tableNumber: '8', status: tableStatus,
    isVisible: true, zone: { isClosed: false, isVisible: true },
  };
  const booking = {
    id: 'booking-1', status, cancellationReason,
    approvedAt: status === 'pending' ? null : new Date('2026-09-12T12:00:00.000Z'),
    checkedInAt,
    cancelledAt: status === 'cancelled' ? new Date('2026-09-12T12:30:00.000Z') : null,
    completedAt: status === 'completed' ? new Date('2026-09-12T13:00:00.000Z') : null,
    bookingDate: kyivToday(), bookingTime: '19:20:00', durationMinutes: 110,
    table, client: { id: 'client-1' },
  };

  const bookingRepo = {
    async findOne(options) {
      calls.push(['booking.findOne', options]);
      if (options.lock) {
        if (onBookingLock) onBookingLock(booking);
        return { ...booking, table: undefined, client: undefined };
      }
      return booking;
    },
    async find(options) {
      calls.push(['booking.find', options]);
      return [booking, ...otherBookings];
    },
    async save(value) {
      calls.push(['booking.save', value.status, Boolean(value.checkedInAt)]);
      if (failBookingSave) throw { driverError: { code: '23505' } };
      Object.assign(booking, value);
      return value;
    },
  };
  const historyRepo = {
    create(value) {
      calls.push(['history.create', value.action, value.actorRole, value.actorStaffId]);
      return value;
    },
    async save(value) {
      calls.push(['history.save', value.action]);
      if (failHistory) throw new Error('history write failed');
      return value;
    },
  };
  const tableRepo = {
    async findOne(options) {
      calls.push(['table.findOne', options]);
      return table;
    },
    async save(value) {
      calls.push(['table.save', value.status]);
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity.name === 'Booking') return bookingRepo;
      if (entity.name === 'BookingHistory') return historyRepo;
      if (entity.name === 'TableEntity') return tableRepo;
      throw new Error(`Unexpected repository: ${entity.name}`);
    },
    async query(sql, params) {
      calls.push(['manager.query', sql, params]);
    },
  };
  const dataSource = {
    async transaction(work) {
      calls.push(['transaction']);
      const previousBooking = { ...booking };
      const previousTableStatus = table.status;
      try {
        return await work(manager);
      } catch (error) {
        Object.assign(booking, previousBooking);
        table.status = previousTableStatus;
        throw error;
      }
    },
  };
  const rawBookings = {
    bookingSnapshot(value) {
      return {
        status: value.status, tableId: value.table?.id || null,
        bookingDate: value.bookingDate, bookingTime: value.bookingTime,
        checkedInAt: value.checkedInAt, cancellationReason: value.cancellationReason,
      };
    },
    getBookingStartMinutes(value) {
      const [hours, minutes] = value.bookingTime.split(':').map(Number);
      return hours * 60 + minutes;
    },
    getBookingAvailableFromMinutes(value) {
      return this.getBookingStartMinutes(value) + (value.durationMinutes || 120) + 15;
    },
    async safeLog(action, details) {
      calls.push(['log', action, details.bookingId]);
    },
    async safeNotify(action) {
      calls.push(['safeNotify']);
      await action();
    },
    notifications: {
      async notifyBookingApproved(value) {
        calls.push(['notifyApproved', value.id]);
      },
    },
    async getToday() {
      calls.push(['raw.getToday']);
      return [];
    },
    async checkIn() {
      throw new Error('raw checkIn must not run outside the coordinated transaction');
    },
    async approve() {
      throw new Error('raw approve must not run outside the coordinated transaction');
    },
  };

  return {
    coordinated: createCoordinatedBookingsService(rawBookings, dataSource),
    booking, table, calls,
  };
}

function writes(calls) {
  return calls.filter(([name]) =>
    ['booking.save', 'table.save', 'history.save', 'log', 'safeNotify', 'notifyApproved'].includes(name),
  );
}

test('check-in uses the shared table/date advisory lock and a locked booking row', async () => {
  const { coordinated, booking, table, calls } = createHarness();
  const result = await coordinated.checkIn('booking-1', {
    role: 'waiter', staffId: 'waiter-1', name: 'Офіціант',
  });

  assert.deepEqual(result, { message: 'Гості відмічені як присутні' });
  assert.equal(booking.status, 'approved');
  assert.ok(booking.checkedInAt instanceof Date);
  assert.equal(table.status, 'occupied');
  assert.deepEqual(calls[0], ['transaction']);
  const advisoryIndex = calls.findIndex(([name]) => name === 'manager.query');
  const bookingLockIndex = calls.findIndex(([name, options]) =>
    name === 'booking.findOne' && options.lock?.mode === 'pessimistic_write',
  );
  assert.ok(advisoryIndex > 0 && bookingLockIndex > advisoryIndex);
  assert.deepEqual(calls[advisoryIndex][2], ['table-8', kyivToday()]);
  assert.ok(calls.some((call) => call[0] === 'history.create' && call[2] === 'waiter' && call[3] === 'waiter-1'));
  assert.ok(calls.some((call) => call[0] === 'table.findOne' && call[1].lock?.mode === 'pessimistic_write'));
  assert.ok(calls.some((call) => call[0] === 'log' && call[2] === 'booking-1'));
});

test('approval of a pending booking is atomic and notifies only after commit', async () => {
  const { coordinated, booking, table, calls } = createHarness({ status: 'pending', tableStatus: 'pending' });
  assert.deepEqual(await coordinated.approve('booking-1'), { message: 'Бронювання підтверджено' });
  assert.equal(booking.status, 'approved');
  assert.ok(booking.approvedAt instanceof Date);
  assert.equal(table.status, 'reserved');
  assert.ok(calls.some(([name, action]) => name === 'history.save' && action === 'booking_approved'));
  assert.ok(calls.findIndex(([name]) => name === 'notifyApproved') > calls.findIndex(([name]) => name === 'history.save'));
  assert.deepEqual(writes(calls).map(([name]) => name), [
    'booking.save', 'history.save', 'table.save', 'log', 'safeNotify', 'notifyApproved',
  ]);
});

test('pending booking may still be checked in directly', async () => {
  const { coordinated, booking, table, calls } = createHarness({ status: 'pending', tableStatus: 'pending' });
  await coordinated.checkIn('booking-1', { role: 'waiter' });
  assert.equal(booking.status, 'approved');
  assert.ok(booking.approvedAt instanceof Date);
  assert.ok(booking.checkedInAt instanceof Date);
  assert.equal(table.status, 'occupied');
  assert.equal(calls.some(([name]) => name === 'notifyApproved'), false);
});

for (const [status, cancellationReason] of [
  ['cancelled', 'guest_cancelled'],
  ['cancelled', 'admin_cancelled'],
  ['cancelled', 'no_show'],
  ['rejected', null],
  ['completed', null],
]) {
  for (const action of ['approve', 'checkIn']) {
    test(`${action} cannot revive ${status} (${cancellationReason || 'none'})`, async () => {
      const { coordinated, booking, table, calls } = createHarness({ status, cancellationReason });
      await assert.rejects(coordinated[action]('booking-1', { role: 'admin' }),
        cancellationReason === 'no_show'
          ? /Бронювання вже анульовано через неявку/
          : /Закрите бронювання не можна повторно активувати/);
      assert.equal(booking.status, status);
      assert.equal(table.status, 'reserved');
      assert.deepEqual(writes(calls), []);
    });
  }
}

test('repeated approval and arrival do not write a second history entry or notify again', async () => {
  const approved = createHarness({ status: 'approved' });
  await approved.coordinated.approve('booking-1');
  assert.deepEqual(writes(approved.calls), []);

  const arrival = createHarness({ status: 'approved', checkedInAt: new Date() });
  await arrival.coordinated.checkIn('booking-1');
  assert.deepEqual(writes(arrival.calls), []);
});

test('overlapping booking blocks approval and arrival without changing the table', async () => {
  for (const action of ['approve', 'checkIn']) {
    const { coordinated, booking, table, calls } = createHarness({
      status: 'pending', tableStatus: 'pending',
      otherBookings: [{ id: 'other', bookingTime: '20:00:00', durationMinutes: 120 }],
    });
    await assert.rejects(coordinated[action]('booking-1'), /Стіл уже заброньовано/);
    assert.equal(booking.status, 'pending');
    assert.equal(table.status, 'pending');
    assert.deepEqual(writes(calls), []);
  }
});

test('a later non-overlapping booking does not block approval', async () => {
  const { coordinated, booking } = createHarness({
    status: 'pending',
    otherBookings: [{ id: 'other', bookingTime: '21:25:00', durationMinutes: 120 }],
  });
  await coordinated.approve('booking-1');
  assert.equal(booking.status, 'approved');
});

test('approval preserves occupied physical status; arrival does not take an occupied or cleaning table', async () => {
  const approval = createHarness({ status: 'pending', tableStatus: 'occupied' });
  await approval.coordinated.approve('booking-1');
  assert.equal(approval.table.status, 'occupied');
  assert.equal(approval.calls.some(([name]) => name === 'table.save'), false);

  for (const tableStatus of ['occupied', 'cleaning']) {
    const { coordinated, booking, calls } = createHarness({ status: 'approved', tableStatus });
    await assert.rejects(coordinated.checkIn('booking-1'), /Стіл зараз зайнятий або прибирається/);
    assert.equal(booking.checkedInAt, null);
    assert.deepEqual(writes(calls), []);
  }
});

test('a closed table or location cannot be activated', async () => {
  const closed = createHarness({ status: 'pending', tableStatus: 'closed' });
  await assert.rejects(closed.coordinated.approve('booking-1'), /Стіл зараз закритий/);
  assert.deepEqual(writes(closed.calls), []);

  const hidden = createHarness({ status: 'pending' });
  hidden.table.zone.isClosed = true;
  await assert.rejects(hidden.coordinated.approve('booking-1'), /Стіл або локація зараз недоступні/);
  assert.deepEqual(writes(hidden.calls), []);
});

test('cancellation committed while an action waits for the row lock cannot be undone', async () => {
  const { coordinated, booking, calls } = createHarness({
    status: 'pending',
    onBookingLock(value) {
      value.status = 'cancelled';
      value.cancellationReason = 'guest_cancelled';
    },
  });
  await assert.rejects(coordinated.approve('booking-1'), /Закрите бронювання/);
  assert.equal(booking.status, 'pending'); // simulated rollback of this isolated transaction
  assert.deepEqual(writes(calls), []);
});

test('failed history write rolls the transition back without sending notifications', async () => {
  const { coordinated, booking, table, calls } = createHarness({
    status: 'pending', tableStatus: 'pending', failHistory: true,
  });
  await assert.rejects(coordinated.approve('booking-1'), /history write failed/);
  assert.equal(booking.status, 'pending');
  assert.equal(table.status, 'pending');
  assert.equal(calls.some(([name]) => name === 'notifyApproved'), false);
});

test('database duplicate constraint produces a clear Ukrainian conflict', async () => {
  const { coordinated } = createHarness({ status: 'pending', failBookingSave: true });
  await assert.rejects(coordinated.approve('booking-1'), /На цю дату вже є активне бронювання/);
});

test('unrelated methods still delegate to the original BookingsService', async () => {
  const { coordinated, calls } = createHarness();
  await coordinated.getToday();
  assert.deepEqual(calls, [['raw.getToday']]);
});
