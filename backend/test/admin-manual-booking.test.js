require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { ROLES_KEY } = require('../dist/common/decorators/roles.decorator.js');
const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const { BookingsService } = require('../dist/bookings/bookings.service.js');

test('admin manual endpoint keeps lock + availability guard and forwards actor', async () => {
  const calls = [];
  const actor = { role: 'admin', staffId: 'staff-1', name: 'Admin' };
  const dto = {
    tableId: 'table-1',
    fullName: 'Гість',
    phone: '+380000000000',
    bookingDate: '2026-09-10',
    bookingTime: '18:00',
    guestsCount: 2,
    durationMinutes: 120,
  };
  const service = {
    async createManual(payload, receivedActor) {
      calls.push(['service', payload, receivedActor]);
      return { message: 'Бронювання створено та підтверджено' };
    },
  };
  const tableLock = {
    async withCreateLock(payload, work) {
      calls.push(['lock', payload]);
      return work();
    },
  };
  const availability = {
    async assertBookable(payload) {
      calls.push(['availability', payload]);
    },
  };
  const controller = new BookingsController(
    service,
    {},
    {},
    tableLock,
    availability,
    {},
    {},
    {},
    {},
  );

  const result = await controller.createManual(dto, { user: actor });

  assert.deepEqual(result, { message: 'Бронювання створено та підтверджено' });
  assert.equal(calls[0][0], 'lock');
  assert.equal(calls[1][0], 'availability');
  assert.equal(calls[2][0], 'service');
  assert.deepEqual(calls[2][2], actor);
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, BookingsController.prototype.createManual),
    ['admin', 'owner'],
  );
});

test('manual booking is saved approved without guest browser credentials', async () => {
  const saved = [];
  const histories = [];
  const tableStatus = [];
  const waiterNotifications = [];
  const table = {
    id: 'table-1',
    tableNumber: '5',
    seats: 6,
    isVisible: true,
    status: 'free',
    zone: { isClosed: false, isVisible: true },
  };
  const bookings = {
    create(value) {
      return { id: 'booking-1', ...value };
    },
    async save(value) {
      saved.push(value);
      return value;
    },
    async findOne() {
      return saved[0] || null;
    },
  };
  const clients = {
    createQueryBuilder() {
      return {
        where() {
          return this;
        },
        async getMany() {
          return [];
        },
      };
    },
    async findOne() {
      return null;
    },
    create(value) {
      return value;
    },
    async save(value) {
      return { id: 'client-1', isBlacklisted: false, ...value };
    },
  };
  const tables = {
    async findOne() {
      return table;
    },
  };
  const service = new BookingsService(
    bookings,
    {},
    {},
    clients,
    tables,
    {},
    { create: async () => undefined },
    {
      async notifyManualBookingCreated(value) {
        waiterNotifications.push(value);
      },
    },
    {},
  );

  service.assertNoActivePhoneBooking = async () => '380000000000';
  service.assertTableCanBeBooked = async () => undefined;
  service.assertNoTimeConflict = async () => ({
    bookingTime: '18:00:00',
    bookingTimeLabel: '18:00',
    departureTime: '20:00:00',
    departureTimeLabel: '20:00',
    availableFrom: '20:15:00',
    availableFromLabel: '20:15',
    durationMinutes: 120,
    cleanupMinutes: 15,
  });
  service.saveHistory = async (...args) => histories.push(args);
  service.setTableStatusOnlyForToday = async (...args) => tableStatus.push(args);
  service.safeLog = async () => undefined;

  const actor = { role: 'admin', staffId: 'staff-1', name: 'Admin' };
  const result = await service.createManual(
    {
      tableId: 'table-1',
      fullName: 'Гість',
      phone: '+380000000000',
      bookingDate: '2026-09-10',
      bookingTime: '18:00',
      guestsCount: 2,
      durationMinutes: 120,
      wishes: 'Тихий стіл',
    },
    actor,
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'approved');
  assert.equal(saved[0].source, 'admin_manual');
  assert.equal(saved[0].guestAccessTokenHash, null);
  assert.equal(saved[0].guestDeviceIdHash, null);
  assert.equal(saved[0].guestPhoneNormalized, '380000000000');
  assert.equal(saved[0].guestName, 'Гість');
  assert.ok(saved[0].approvedAt instanceof Date);
  assert.equal(result.status, 'approved');
  assert.equal(histories[0][1], 'booking_created');
  assert.equal(histories[0][2], 'admin');
  assert.deepEqual(histories[0][6], actor);
  assert.equal(tableStatus[0][1], 'reserved');
  assert.equal(tableStatus[0][2], '2026-09-10');
  assert.equal(waiterNotifications.length, 1);
  assert.equal(waiterNotifications[0].id, 'booking-1');
  assert.equal(waiterNotifications[0].status, 'approved');
  assert.equal(waiterNotifications[0].source, 'admin_manual');
});

test('manual booking blocks a blacklisted client even when phone formatting differs', async () => {
  const queryCalls = [];
  let clientCreated = false;
  let bookingSaved = false;
  const table = {
    id: 'table-1',
    tableNumber: '5',
    isVisible: true,
    status: 'free',
    zone: { isClosed: false, isVisible: true },
  };
  const clients = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'client');
      return {
        where(sql, params) {
          queryCalls.push([sql, params]);
          return this;
        },
        async getMany() {
          return [
            {
              id: 'client-blacklisted',
              fullName: 'Заблокований гість',
              phone: '+380501234567',
              isBlacklisted: true,
            },
          ];
        },
      };
    },
    create() {
      clientCreated = true;
      return {};
    },
    async save() {
      clientCreated = true;
      return {};
    },
  };
  const bookings = {
    create() {
      return {};
    },
    async save() {
      bookingSaved = true;
      return {};
    },
  };
  const tables = {
    async findOne() {
      return table;
    },
  };
  const service = new BookingsService(
    bookings,
    {},
    {},
    clients,
    tables,
    {},
    {},
    {},
    {},
  );

  service.assertNoActivePhoneBooking = async () => '380501234567';
  service.assertTableCanBeBooked = async () => undefined;

  await assert.rejects(
    () =>
      service.createManual({
        tableId: 'table-1',
        fullName: 'Гість',
        phone: '380 50 123 45 67',
        bookingDate: '2026-09-10',
        bookingTime: '18:00',
        guestsCount: 2,
      }),
    /Бронювання з цього номера недоступне/,
  );

  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0][0], /regexp_replace/);
  assert.equal(queryCalls[0][1].normalizedPhone, '380501234567');
  assert.equal(clientCreated, false);
  assert.equal(bookingSaved, false);
});

test('phone-less manual booking does not create a fake Client and keeps the guest name', async () => {
  const saved = [];
  const clientCalls = [];
  const waiterNotifications = [];
  const table = {
    id: 'table-1',
    tableNumber: '5',
    seats: 6,
    isVisible: true,
    status: 'free',
    zone: { isClosed: false, isVisible: true },
  };
  const bookings = {
    create(value) {
      return { id: 'booking-phone-less', ...value };
    },
    async save(value) {
      saved.push(value);
      return value;
    },
    async findOne() {
      return saved[0] || null;
    },
  };
  const clients = {
    async findOne() {
      clientCalls.push('findOne');
      return null;
    },
    create(value) {
      clientCalls.push('create');
      return value;
    },
    async save(value) {
      clientCalls.push('save');
      return value;
    },
  };
  const tables = {
    async findOne() {
      return table;
    },
  };
  const service = new BookingsService(
    bookings,
    {},
    {},
    clients,
    tables,
    {},
    { create: async () => undefined },
    {
      async notifyManualBookingCreated(value) {
        waiterNotifications.push(value);
      },
    },
    {},
  );

  service.assertNoActivePhoneBooking = async () => {
    throw new Error('phone duplicate check must not run without a phone');
  };
  service.assertTableCanBeBooked = async () => undefined;
  service.assertNoTimeConflict = async () => ({
    bookingTime: '18:00:00',
    bookingTimeLabel: '18:00',
    departureTime: '20:00:00',
    departureTimeLabel: '20:00',
    availableFrom: '20:15:00',
    availableFromLabel: '20:15',
    durationMinutes: 120,
    cleanupMinutes: 15,
  });
  service.saveHistory = async () => undefined;
  service.setTableStatusOnlyForToday = async () => undefined;
  service.safeLog = async () => undefined;

  const result = await service.createManual({
    tableId: 'table-1',
    fullName: 'Гість без телефону',
    bookingDate: '2026-09-10',
    bookingTime: '18:00',
    guestsCount: 2,
    durationMinutes: 120,
  });

  assert.deepEqual(clientCalls, []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].client, null);
  assert.equal(saved[0].guestPhoneNormalized, null);
  assert.equal(saved[0].guestName, 'Гість без телефону');
  assert.equal(saved[0].status, 'approved');
  assert.equal(saved[0].source, 'admin_manual');
  assert.equal(result.status, 'approved');
  assert.equal(waiterNotifications.length, 1);
  assert.equal(waiterNotifications[0].client.fullName, 'Гість без телефону');
  assert.equal(waiterNotifications[0].client.phone, null);
});
