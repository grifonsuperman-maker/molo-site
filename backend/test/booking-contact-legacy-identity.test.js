const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingTableLockService,
} = require('../dist/bookings/booking-table-lock.service.js');

function queryBuilder(rows) {
  const builder = {
    where: () => builder,
    andWhere: () => builder,
    orderBy: () => builder,
    leftJoinAndSelect: () => builder,
    addSelect: () => builder,
    getMany: async () => rows,
  };
  return builder;
}

function createHarness({ clients = [], activeBookings = [] } = {}) {
  const queries = [];
  const runner = {
    connect: async () => {},
    release: async () => {},
    query: async (sql, params) => {
      queries.push({ sql, params });
      return [];
    },
  };

  const service = new BookingTableLockService(
    { createQueryRunner: () => runner },
    {
      findOne: async () => ({ id: 'table-1', tableNumber: '15' }),
      find: async () => [],
    },
    {
      createQueryBuilder: () => queryBuilder(activeBookings),
      findOne: async () => null,
    },
    { findOne: async () => null },
    { createQueryBuilder: () => queryBuilder(clients) },
  );

  return { service, queries };
}

test('create lock reuses an existing legacy local phone representation', async () => {
  const client = {
    id: 'client-1',
    phone: '0501234567',
    isBlacklisted: false,
  };
  const { service } = createHarness({ clients: [client] });
  const dto = {
    tableId: 'table-1',
    bookingDate: '2026-09-10',
    phone: '+380501234567',
  };

  const seenPhone = await service.withCreateLock(dto, async () => dto.phone);

  assert.equal(seenPhone, '0501234567');
  assert.equal(dto.phone, '0501234567');
});

test('blacklisted equivalent legacy client has priority', async () => {
  const clients = [
    { id: 'client-1', phone: '+380501234567', isBlacklisted: false },
    { id: 'client-2', phone: '501234567', isBlacklisted: true },
  ];
  const { service } = createHarness({ clients });
  const dto = {
    tableId: 'table-1',
    bookingDate: '2026-09-10',
    phone: '+380 (50) 123-45-67',
  };

  const seenPhone = await service.withCreateLock(dto, async () => dto.phone);

  assert.equal(seenPhone, '501234567');
});

test('active equivalent booking wins when duplicate legacy client cards exist', async () => {
  const canonicalClient = {
    id: 'client-1',
    phone: '+380501234567',
    isBlacklisted: false,
  };
  const legacyClient = {
    id: 'client-2',
    phone: '0501234567',
    isBlacklisted: false,
  };
  const activeBookings = [
    {
      status: 'approved',
      guestPhoneNormalized: '0501234567',
      client: legacyClient,
    },
  ];
  const { service } = createHarness({
    clients: [canonicalClient, legacyClient],
    activeBookings,
  });
  const dto = {
    tableId: 'table-1',
    bookingDate: '2026-09-10',
    phone: '+380501234567',
  };

  const seenPhone = await service.withCreateLock(dto, async () => dto.phone);

  assert.equal(seenPhone, '0501234567');
});
