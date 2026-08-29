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
  const lookupValues = [];

  const clients = {
    async findOne({ where }) {
      lookupValues.push(where.phone);
      return typeof where.phone === 'string' ? null : existingClient;
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
  assert.equal(lookupValues.length, 2);
  assert.deepEqual(
    service.phoneIdentityCandidates('+380 (67) 123-45-67'),
    ['380671234567', '0671234567'],
  );
  assert.deepEqual(
    service.phoneIdentityCandidates('067 123 45 67'),
    ['0671234567', '380671234567'],
  );
});

test('completing visits recalculates one visit per completed booking without double counting', async () => {
  const client = {
    id: 'client-1',
    fullName: 'Іван',
    phone: '+380671234567',
    visitsCount: 0,
    totalGuests: 0,
    lastVisitAt: null,
  };
  const olderCompletedAt = new Date('2098-12-01T20:00:00.000Z');
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
  const clientSaves = [];

  const bookings = {
    async findOne() { return booking; },
    async save(value) { return value; },
    createQueryBuilder() {
      return {
        leftJoin() { return this; },
        where() { return this; },
        andWhere() { return this; },
        async getMany() { return [previousBooking, booking]; },
      };
    },
  };
  const histories = {
    create(value) { return value; },
    async save(value) { return value; },
  };
  const clients = {
    async findOne({ where }) {
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
    clients,
    tables,
    {},
    logs,
    {},
    {},
  );

  await service.complete('booking-current');
  assert.equal(client.visitsCount, 2);
  assert.equal(client.totalGuests, 5);

  await service.complete('booking-current');

  assert.equal(client.visitsCount, 2);
  assert.equal(client.totalGuests, 5);
  assert.ok(client.lastVisitAt instanceof Date);
  assert.ok(client.lastVisitAt.getTime() >= olderCompletedAt.getTime());
  assert.equal(clientSaves.length, 2);
  assert.deepEqual(
    clientSaves.map((item) => [item.visitsCount, item.totalGuests]),
    [[2, 5], [2, 5]],
  );
});
