require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { WaiterCallsService } = require('../dist/waiter-calls/waiter-calls.service.js');

const WAITER_ID = '11111111-1111-4111-8111-111111111111';

function createCall(status = 'new') {
  const now = new Date();
  return {
    id: 'call-1',
    booking: { id: 'booking-1' },
    tableId: '22222222-2222-4222-8222-222222222222',
    tableNumber: '8',
    clientName: 'Гість',
    waiterId: status === 'accepted' ? WAITER_ID : null,
    waiterName: status === 'accepted' ? 'Офіціант 1' : null,
    assignmentActive: true,
    status,
    acceptedAt: status === 'accepted' ? now : null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createService(call) {
  const findOptions = [];
  const callRepo = {
    async findOne(options) {
      findOptions.push(options);
      return call;
    },
    async save(value) {
      return value;
    },
  };
  const dataSource = {
    transaction: async (work) =>
      work({
        getRepository() {
          return callRepo;
        },
      }),
  };

  return {
    service: new WaiterCallsService({}, {}, callRepo, dataSource),
    findOptions,
  };
}

function assertSafeRelationLock(options) {
  assert.equal(options.lock?.mode, 'pessimistic_write');
  assert.deepEqual(options.relations, { booking: true });
  assert.equal(
    options.relationLoadStrategy,
    'query',
    'waiter call lock must not LEFT JOIN booking into PostgreSQL FOR UPDATE',
  );
}

test('waiter accept loads booking relation separately from pessimistic lock query', async () => {
  const call = createCall('new');
  const { service, findOptions } = createService(call);

  const result = await service.accept(call.id, {
    waiterId: WAITER_ID,
    waiterName: 'Офіціант 1',
  });

  assert.equal(result.call.status, 'accepted');
  assert.equal(findOptions.length, 1);
  assertSafeRelationLock(findOptions[0]);
});

test('waiter close uses the same PostgreSQL-safe relation loading strategy', async () => {
  const call = createCall('accepted');
  const { service, findOptions } = createService(call);

  const result = await service.close(call.id, WAITER_ID);

  assert.equal(result.call.status, 'closed');
  assert.equal(findOptions.length, 1);
  assertSafeRelationLock(findOptions[0]);
});
