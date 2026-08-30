require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const { BookingsService } = require('../dist/bookings/bookings.service.js');

const waiterActor = {
  sub: 'staff-waiter-1',
  telegramId: '123',
  role: 'waiter',
  staffId: 'staff-waiter-1',
  name: 'Олександр',
};

test('booking completion history records the real waiter', async () => {
  const booking = {
    id: 'booking-1',
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    wishes: '',
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
  const savedHistory = [];
  const logged = [];
  const completionLockCalls = [];

  const bookingRepository = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'booking');
      return {
        leftJoinAndSelect() {
          return this;
        },
        where() {
          return this;
        },
        setLock(mode, version, tables) {
          completionLockCalls.push({ mode, version, tables });
          return this;
        },
        async getOne() {
          return booking;
        },
      };
    },
    async save(value) {
      return value;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity?.name === 'Booking') return bookingRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const bookings = {
    manager: {
      transaction: async (callback) => callback(manager),
    },
  };
  const histories = {
    create(value) {
      return value;
    },
    async save(value) {
      savedHistory.push(value);
      return value;
    },
  };
  const tables = {
    async save() {
      throw new Error('future booking must not change today table status');
    },
  };
  const logs = {
    async create(action, staffId, details) {
      logged.push({ action, staffId, details });
    },
  };

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

  const result = await service.complete('booking-1', waiterActor);

  assert.deepEqual(result, { message: 'Стіл звільнено' });
  assert.deepEqual(completionLockCalls, [
    { mode: 'pessimistic_write', version: undefined, tables: ['booking'] },
  ]);
  assert.equal(savedHistory.length, 1);
  assert.equal(savedHistory[0].action, 'booking_completed');
  assert.equal(savedHistory[0].actorRole, 'waiter');
  assert.equal(savedHistory[0].actorStaffId, 'staff-waiter-1');
  assert.equal(savedHistory[0].actorName, 'Олександр');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].details.staffId, 'staff-waiter-1');
  assert.equal(logged[0].details.staffName, 'Олександр');
  assert.equal(logged[0].details.role, 'waiter');
});

test('completion controller passes the signed-in employee to the service', async () => {
  const calls = [];
  const service = {
    async complete(id, actor) {
      calls.push({ id, actor });
      return { message: 'Стіл звільнено' };
    },
  };

  const controller = new BookingsController(
    service,
    {},
    {},
    {},
    {},
    {},
    {},
  );

  await controller.complete('booking-1', { user: waiterActor });

  assert.deepEqual(calls, [{ id: 'booking-1', actor: waiterActor }]);
});
