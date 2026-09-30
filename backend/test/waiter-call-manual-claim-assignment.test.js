require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { WaiterCallsService } = require('../dist/waiter-calls/waiter-calls.service.js');

function createHarness() {
  const approvedAt = new Date('2026-09-30T12:00:00.000Z');
  const claimAt = new Date('2026-09-30T12:01:00.000Z');
  const booking = {
    id: 'booking-1',
    status: 'approved',
    approvedAt,
    bookingDate: '2026-09-30',
    table: {
      id: 'table-1',
      tableNumber: '8',
      status: 'occupied',
    },
    client: { fullName: 'Гість' },
  };
  let queriedActions = null;

  const bookingsRepo = {
    async exist() { return true; },
    async findOne() { return booking; },
  };
  const callRepo = {
    async findOne() { return null; },
  };
  const historiesRepo = {
    createQueryBuilder() {
      return {
        leftJoin() { return this; },
        where() { return this; },
        andWhere(_sql, params) {
          if (params?.actions) queriedActions = params.actions;
          return this;
        },
        orderBy() { return this; },
        addOrderBy() { return this; },
        async getOne() {
          return {
            id: 'history-claim',
            action: 'waiter_manual_visit_claimed',
            actorRole: 'waiter',
            actorStaffId: 'waiter-1',
            actorName: 'Сергій',
            createdAt: claimAt,
          };
        },
      };
    },
  };

  const service = new WaiterCallsService(
    bookingsRepo,
    historiesRepo,
    callRepo,
    {},
  );

  return {
    service,
    booking,
    getQueriedActions: () => queriedActions,
  };
}

test('manual visit claim is a persisted waiter assignment', async () => {
  const fixture = createHarness();

  const assignment = await fixture.service.assignmentForBooking(fixture.booking);

  assert.equal(assignment.waiterId, 'waiter-1');
  assert.equal(assignment.waiterName, 'Сергій');
  assert.deepEqual(fixture.getQueriedActions(), [
    'booking_checked_in',
    'waiter_manual_visit_claimed',
    'waiter_table_transfer',
  ]);
});

test('guest status keeps the claimed waiter instead of returning a shared call target', async () => {
  const fixture = createHarness();

  const status = await fixture.service.guestStatus(
    fixture.booking.id,
    'guest-token',
  );

  assert.equal(status.canCall, true);
  assert.equal(status.waiterAssigned, true);
  assert.equal(status.waiterName, 'Сергій');
});
