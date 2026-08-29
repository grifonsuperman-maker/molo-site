require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');

function noopRepository() {
  return {};
}

test('guest identity reuses a client across Ukrainian local and international phone formats', async () => {
  const existingClient = {
    id: 'client-1',
    fullName: 'Іван',
    phone: '067 123 45 67',
  };
  const lookups = [];

  const clients = {
    async find(options) {
      lookups.push(options);
      return [existingClient];
    },
  };

  const service = new BookingsService(
    noopRepository(),
    noopRepository(),
    noopRepository(),
    clients,
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  const client = await service.findClientByPhone('+380 (67) 123-45-67');

  assert.equal(client, existingClient);
  assert.equal(lookups.length, 1);
  assert.deepEqual(
    service.phoneIdentityCandidates('+380 (67) 123-45-67'),
    ['380671234567', '0671234567'],
  );
  assert.deepEqual(
    service.phoneIdentityCandidates('067 123 45 67'),
    ['0671234567', '380671234567'],
  );
});

test('completing visits keeps completedAt stable and refreshes stats under row locks', async () => {
  const client = {
    id: 'client-1',
    fullName: 'Іван',
    phone: '+380671234567',
    visitsCount: 0,
    totalGuests: 0,
    lastVisitAt: null,
  };
  const olderCompletedAt = new Date('2025-12-01T20:00:00.000Z');
  const booking = {
    id: 'booking-current',
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    wishes: '',
    guestsCount: 3,
    client,
    table: {
      id: 'table-1',
      tableNumber: '8',
      status: 'occupied',
    },
    checkedInAt: new Date('2099-01-01T17:00:00.000Z'),
    cancelledAt: null,
    cancellationReason: null,
    completedAt: null,
    expectedArrivalAt: null,
  };
  const previousBooking = {
    id: 'booking-old',
    status: 'completed',
    guestsCount: 2,
    completedAt: olderCompletedAt,
  };
  const bookingLocks = [];
  const clientLocks = [];
  const clientSaves = [];

  const bookingRepo = {
    async findOne({ lock }) {
      bookingLocks.push(lock?.mode || null);
      return booking;
    },
    async save(value) {
      return value;
    },
    createQueryBuilder() {
      return {
        leftJoin() { return this; },
        where() { return this; },
        andWhere() { return this; },
        async getMany() { return [previousBooking, booking]; },
      };
    },
  };
  const clientRepo = {
    async findOne({ where, lock }) {
      clientLocks.push(lock?.mode || null);
      return where.id === client.id ? client : null;
    },
    async save(value) {
      clientSaves.push({
        visitsCount: value.visitsCount,
        totalGuests: value.totalGuests,
        lastVisitAt: value.lastVisitAt,
      });
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepo;
      if (entity?.name === 'Client') return clientRepo;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const bookings = {
    manager: {
      transaction: async (callback) => callback(manager),
    },
  };
  const histories = {
    create(value) { return value; },
    async save(value) { return value; },
  };
  const tables = {
    async save() {
      throw new Error('future booking must not change today table status');
    },
  };
  const logs = { async create() {} };

  const service = new BookingsService(
    bookings,
    histories,
    {},
    {},
    tables,
    {},
    logs,
    {},
    {},
  );

  await service.complete('booking-current');
  const firstCompletedAt = booking.completedAt;
  const firstLastVisitAt = client.lastVisitAt;

  assert.equal(client.visitsCount, 2);
  assert.equal(client.totalGuests, 5);
  assert.ok(firstCompletedAt instanceof Date);
  assert.equal(firstLastVisitAt, firstCompletedAt);

  await service.complete('booking-current');

  assert.equal(client.visitsCount, 2);
  assert.equal(client.totalGuests, 5);
  assert.equal(booking.completedAt, firstCompletedAt);
  assert.equal(client.lastVisitAt, firstLastVisitAt);
  assert.deepEqual(bookingLocks, ['pessimistic_write', 'pessimistic_write']);
  assert.deepEqual(clientLocks, ['pessimistic_write', 'pessimistic_write']);
  assert.equal(clientSaves.length, 2);
  assert.deepEqual(
    clientSaves.map((item) => [item.visitsCount, item.totalGuests]),
    [[2, 5], [2, 5]],
  );
});
