require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { ClientsService } = require('../dist/clients/clients.service.js');

function noopRepository() {
  return {};
}

function client(overrides) {
  return {
    id: overrides.id,
    fullName: overrides.fullName || 'Іван',
    phone: overrides.phone,
    telegramId: overrides.telegramId || null,
    visitsCount: overrides.visitsCount || 0,
    totalGuests: overrides.totalGuests || 0,
    cancellationsCount: overrides.cancellationsCount || 0,
    reschedulesCount: overrides.reschedulesCount || 0,
    lastVisitAt: overrides.lastVisitAt || null,
    note: overrides.note || null,
    isRegular: Boolean(overrides.isRegular),
    isBlacklisted: Boolean(overrides.isBlacklisted),
    blacklistReason: overrides.blacklistReason || null,
    blacklistedAt: overrides.blacklistedAt || null,
    createdAt: overrides.createdAt || new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt || new Date('2024-01-01T00:00:00.000Z'),
    bookings: overrides.bookings || [],
  };
}

test('booking lookup chooses one canonical Ukrainian-phone client and prefers verified Telegram identity', async () => {
  const local = client({
    id: 'client-local',
    phone: '067 123 45 67',
    visitsCount: 1,
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
  });
  const telegram = client({
    id: 'client-telegram',
    phone: '+380671234567',
    telegramId: '123456789',
    visitsCount: 2,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  });
  const clients = {
    async find() {
      return [local, telegram];
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

  const resolved = await service.findClientByPhone('067 123 45 67');
  assert.equal(resolved.id, 'client-telegram');
});

test('guest database projects safe equivalent-phone rows as one card with combined visit stats', async () => {
  const olderVisit = new Date('2025-01-01T20:00:00.000Z');
  const newerVisit = new Date('2026-01-01T20:00:00.000Z');
  const local = client({
    id: 'client-local',
    phone: '067 123 45 67',
    visitsCount: 1,
    totalGuests: 2,
    lastVisitAt: olderVisit,
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
  });
  const telegram = client({
    id: 'client-telegram',
    phone: '+380671234567',
    telegramId: '123456789',
    visitsCount: 2,
    totalGuests: 5,
    lastVisitAt: newerVisit,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  });
  const repo = {
    async find() {
      return [local, telegram];
    },
  };
  const service = new ClientsService(repo);

  const result = await service.findAll();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'client-telegram');
  assert.equal(result[0].visitsCount, 3);
  assert.equal(result[0].totalGuests, 7);
  assert.equal(result[0].lastVisitAt, newerVisit);
});

test('equivalent phones with different verified Telegram identities are not merged', async () => {
  const first = client({
    id: 'client-a',
    phone: '0671234567',
    telegramId: '111',
  });
  const second = client({
    id: 'client-b',
    phone: '+380671234567',
    telegramId: '222',
  });
  const repo = {
    async find() {
      return [first, second];
    },
  };
  const service = new ClientsService(repo);

  const result = await service.findAll();
  assert.equal(result.length, 2);
});

test('blacklist actions update every safely reconciled phone row', async () => {
  const local = client({
    id: 'client-local',
    phone: '067 123 45 67',
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
  });
  const telegram = client({
    id: 'client-telegram',
    phone: '+380671234567',
    telegramId: '123456789',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  });
  const rows = [local, telegram];
  const savedIds = [];
  const lockCalls = [];
  const txRepo = {
    async findOne({ where }) {
      return rows.find((item) => item.id === where.id) || null;
    },
    async find() {
      return rows;
    },
    createQueryBuilder() {
      let ids = [];
      return {
        where(_sql, params) { ids = params.ids; return this; },
        orderBy() { return this; },
        setLock(mode) { lockCalls.push(mode); return this; },
        async getMany() { return rows.filter((item) => ids.includes(item.id)); },
      };
    },
    async save(value) {
      const values = Array.isArray(value) ? value : [value];
      savedIds.push(...values.map((item) => item.id));
      return value;
    },
  };
  const repo = {
    ...txRepo,
    manager: {
      async transaction(callback) {
        return callback({ getRepository: () => txRepo });
      },
    },
  };
  const service = new ClientsService(repo);

  await service.blacklist('client-telegram', 'Тестова причина');

  assert.equal(local.isBlacklisted, true);
  assert.equal(telegram.isBlacklisted, true);
  assert.equal(local.blacklistReason, 'Тестова причина');
  assert.equal(telegram.blacklistReason, 'Тестова причина');
  assert.deepEqual(savedIds, ['client-local', 'client-telegram']);

  savedIds.length = 0;
  await service.unblacklist('client-telegram');

  assert.equal(local.isBlacklisted, false);
  assert.equal(telegram.isBlacklisted, false);
  assert.equal(local.blacklistReason, null);
  assert.equal(telegram.blacklistReason, null);
  assert.equal(local.blacklistedAt, null);
  assert.equal(telegram.blacklistedAt, null);
  assert.deepEqual(savedIds, ['client-local', 'client-telegram']);
  assert.deepEqual(lockCalls, ['pessimistic_write', 'pessimistic_write']);
});

test('blacklist actions do not cross different verified Telegram identities', async () => {
  const first = client({
    id: 'client-a',
    phone: '0671234567',
    telegramId: '111',
    isBlacklisted: true,
    blacklistReason: 'A',
    blacklistedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const second = client({
    id: 'client-b',
    phone: '+380671234567',
    telegramId: '222',
    isBlacklisted: true,
    blacklistReason: 'B',
    blacklistedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  const rows = [first, second];
  const savedIds = [];
  const lockCalls = [];
  const txRepo = {
    async findOne({ where }) {
      return rows.find((item) => item.id === where.id) || null;
    },
    async find() {
      return rows;
    },
    createQueryBuilder() {
      let ids = [];
      return {
        where(_sql, params) { ids = params.ids; return this; },
        orderBy() { return this; },
        setLock(mode) { lockCalls.push(mode); return this; },
        async getMany() { return rows.filter((item) => ids.includes(item.id)); },
      };
    },
    async save(value) {
      const values = Array.isArray(value) ? value : [value];
      savedIds.push(...values.map((item) => item.id));
      return value;
    },
  };
  const repo = {
    ...txRepo,
    manager: {
      async transaction(callback) {
        return callback({ getRepository: () => txRepo });
      },
    },
  };
  const service = new ClientsService(repo);

  await service.unblacklist('client-a');

  assert.equal(first.isBlacklisted, false);
  assert.equal(second.isBlacklisted, true);
  assert.equal(second.blacklistReason, 'B');
  assert.deepEqual(savedIds, ['client-a']);
  assert.deepEqual(lockCalls, ['pessimistic_write']);
});

test('active duplicate protection treats Ukrainian local and international phone forms as one identity', async () => {
  const activeBooking = {
    guestDeviceIdHash: 'different-device',
    guestPhoneNormalized: '0671234567',
    client: { phone: '067 123 45 67' },
  };
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return [activeBooking]; },
  };
  const bookings = {
    createQueryBuilder() { return query; },
  };
  const service = new BookingsService(
    bookings,
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  assert.equal(service.normalizePhoneIdentity('067 123 45 67'), '380671234567');
  assert.equal(service.normalizePhoneIdentity('+380 (67) 123-45-67'), '380671234567');
  await assert.rejects(
    () => service.assertNoActiveGuestBooking(
      '2099-01-01',
      '+380 (67) 123-45-67',
      'new-device',
    ),
    /вже є активне бронювання/,
  );
});

test('manual booking phone key is canonical for atomic Ukrainian duplicate constraint', async () => {
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return []; },
  };
  const bookings = {
    createQueryBuilder() { return query; },
  };
  const service = new BookingsService(
    bookings,
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  assert.equal(
    await service.assertNoActivePhoneBooking('2099-01-01', '067 123 45 67'),
    '380671234567',
  );
  assert.equal(
    await service.assertNoActivePhoneBooking('2099-01-01', '+380671234567'),
    '380671234567',
  );
});


test('approve canonicalizes a legacy Ukrainian phone key and excludes the current active booking', async () => {
  const booking = {
    id: 'booking-legacy',
    status: 'pending',
    bookingDate: '2099-01-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    wishes: '',
    guestPhoneNormalized: '0671234567',
    client: { id: 'client-1', phone: '067 123 45 67' },
    table: { id: 'table-1', tableNumber: '1', status: 'free' },
  };
  let saved = null;
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return [booking]; },
  };
  const bookings = {
    async findOne() { return booking; },
    createQueryBuilder() { return query; },
    async save(value) { saved = value; return value; },
  };
  const histories = {
    create(value) { return value; },
    async save(value) { return value; },
  };
  const service = new BookingsService(
    bookings,
    histories,
    noopRepository(),
    noopRepository(),
    { async save() { throw new Error('future booking must not update table status'); } },
    noopRepository(),
    { async create() {} },
    { async notifyBookingApproved() {} },
    {},
  );

  await service.approve('booking-legacy');

  assert.equal(saved.guestPhoneNormalized, '380671234567');
  assert.equal(saved.status, 'approved');
});

test('reactivation rejects an equivalent legacy active phone before writing', async () => {
  const booking = {
    id: 'booking-reactivate',
    status: 'cancelled',
    bookingDate: '2099-01-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    wishes: '',
    guestPhoneNormalized: '0671234567',
    client: { id: 'client-1', phone: '0671234567' },
    table: { id: 'table-1', tableNumber: '1', status: 'free' },
  };
  const otherActive = {
    id: 'booking-other',
    guestPhoneNormalized: '380671234567',
    client: { phone: '+380671234567' },
  };
  let saveCalls = 0;
  const query = {
    leftJoinAndSelect() { return this; },
    addSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    async getMany() { return [otherActive]; },
  };
  const bookings = {
    async findOne() { return booking; },
    createQueryBuilder() { return query; },
    async save(value) { saveCalls += 1; return value; },
  };
  const service = new BookingsService(
    bookings,
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    noopRepository(),
    {},
    {},
    {},
  );

  await assert.rejects(
    () => service.checkIn('booking-reactivate'),
    /вже є активне бронювання/,
  );
  assert.equal(saveCalls, 0);
});
