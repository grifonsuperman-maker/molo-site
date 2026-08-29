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
  };
  const clients = {
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
    {},
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
  assert.ok(saved[0].approvedAt instanceof Date);
  assert.equal(result.status, 'approved');
  assert.equal(histories[0][1], 'booking_created');
  assert.equal(histories[0][2], 'admin');
  assert.deepEqual(histories[0][6], actor);
  assert.equal(tableStatus[0][1], 'reserved');
  assert.equal(tableStatus[0][2], '2026-09-10');
});
