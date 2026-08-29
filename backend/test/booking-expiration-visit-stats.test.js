require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingExpirationService,
} = require('../dist/bookings/booking-expiration.service.js');

test('automatic completion refreshes client visit stats in the same transaction', async () => {
  const client = {
    id: 'client-1',
    visitsCount: 0,
    totalGuests: 0,
    lastVisitAt: null,
  };
  const expired = {
    id: 'booking-expired',
    bookingDate: '2020-01-01',
    bookingTime: '19:00:00',
    status: 'approved',
    guestsCount: 3,
    completedAt: null,
  };
  let expirationLock = null;
  let clientLock = null;

  const bookingRepo = {
    createQueryBuilder() {
      return {
        where() { return this; },
        andWhere() { return this; },
        orderBy() { return this; },
        addOrderBy() { return this; },
        setLock(mode) {
          expirationLock = mode;
          return this;
        },
        leftJoin() { return this; },
        async getMany() { return [expired]; },
      };
    },
    async save(values) {
      return values;
    },
    async find() {
      return [{ ...expired, client, table: null }];
    },
  };
  const clientRepo = {
    async findOne({ lock }) {
      clientLock = lock?.mode || null;
      return client;
    },
    async save(value) {
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
    async find() {
      return [];
    },
  };
  const tables = {
    async findOne() {
      throw new Error('no table should be synchronized in this fixture');
    },
    async save() {
      throw new Error('no table should be saved in this fixture');
    },
  };

  const service = new BookingExpirationService(bookings, tables);
  await service.completeExpiredBookings();

  assert.equal(expired.status, 'completed');
  assert.ok(expired.completedAt instanceof Date);
  assert.equal(client.visitsCount, 1);
  assert.equal(client.totalGuests, 3);
  assert.equal(client.lastVisitAt, expired.completedAt);
  assert.equal(expirationLock, 'pessimistic_write');
  assert.equal(clientLock, 'pessimistic_write');
});
