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

function createHarness({ status = 'approved', cancellationReason = null } = {}) {
  const calls = [];
  const table = { id: 'table-8', tableNumber: '8', status: 'reserved' };
  const booking = {
    id: 'booking-1',
    status,
    cancellationReason,
    approvedAt: new Date('2026-09-12T12:00:00.000Z'),
    checkedInAt: null,
    cancelledAt: status === 'cancelled' ? new Date('2026-09-12T12:30:00.000Z') : null,
    completedAt: null,
    expectedArrivalAt: null,
    bookingDate: kyivToday(),
    bookingTime: '19:20:00',
    durationMinutes: 110,
    table,
    client: { id: 'client-1' },
  };

  const bookingRepo = {
    async findOne(options) {
      calls.push(['booking.findOne', options]);
      if (options.lock) {
        return { ...booking, table: undefined, client: undefined };
      }
      return booking;
    },
    async save(value) {
      calls.push(['booking.save', value.status, Boolean(value.checkedInAt)]);
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
  };
  const dataSource = {
    async transaction(work) {
      calls.push(['transaction']);
      return work(manager);
    },
  };
  const rawBookings = {
    bookingSnapshot(value) {
      return {
        status: value.status,
        tableId: value.table?.id || null,
        bookingDate: value.bookingDate,
        bookingTime: value.bookingTime,
        checkedInAt: value.checkedInAt,
        cancellationReason: value.cancellationReason,
      };
    },
    async safeLog(action, details) {
      calls.push(['log', action, details.bookingId]);
    },
    async getToday() {
      calls.push(['raw.getToday']);
      return [];
    },
    async checkIn() {
      throw new Error('raw checkIn must not run outside the coordinated transaction');
    },
  };

  return {
    coordinated: createCoordinatedBookingsService(rawBookings, dataSource),
    booking,
    table,
    calls,
  };
}

test('all BookingsService check-in callers serialize on the booking row in one transaction', async () => {
  const { coordinated, booking, table, calls } = createHarness();

  const result = await coordinated.checkIn('booking-1', {
    role: 'waiter',
    staffId: 'waiter-1',
    name: 'Офіціант',
  });

  assert.deepEqual(result, { message: 'Гості відмічені як присутні' });
  assert.equal(booking.status, 'approved');
  assert.ok(booking.checkedInAt instanceof Date);
  assert.equal(table.status, 'occupied');
  assert.deepEqual(calls[0], ['transaction']);
  assert.deepEqual(calls[1][1].lock, { mode: 'pessimistic_write' });
  assert.ok(calls.some((call) => call[0] === 'history.create' && call[2] === 'waiter'));
  assert.ok(calls.some((call) => call[0] === 'table.findOne' && call[1].lock?.mode === 'pessimistic_write'));
  assert.ok(calls.some((call) => call[0] === 'log' && call[2] === 'booking-1'));
});

test('coordinated check-in cannot resurrect a booking already cancelled as no-show', async () => {
  const { coordinated, calls } = createHarness({
    status: 'cancelled',
    cancellationReason: 'no_show',
  });

  await assert.rejects(
    coordinated.checkIn('booking-1', { role: 'waiter' }),
    /Бронювання вже анульовано через неявку/,
  );

  assert.deepEqual(calls.map((call) => call[0]), ['transaction', 'booking.findOne']);
});

test('non-check-in methods still delegate to the existing BookingsService', async () => {
  const { coordinated, calls } = createHarness();

  await coordinated.getToday();

  assert.deepEqual(calls, [['raw.getToday']]);
});
