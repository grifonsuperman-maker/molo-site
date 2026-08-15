require('reflect-metadata');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { WaiterCallRecord } = require('../dist/waiter-calls/entities/waiter-call.entity.js');
const { WaiterCallsService } = require('../dist/waiter-calls/waiter-calls.service.js');

function matchesStatus(callStatus, requestedStatus) {
  if (!requestedStatus) return true;
  if (typeof requestedStatus === 'string') return callStatus === requestedStatus;
  return callStatus === 'new' || callStatus === 'accepted';
}

function assignedTime(call) {
  return new Date(call.acceptedAt || call.createdAt).getTime();
}

function kyivToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
  }).format(new Date());
}

function createStore() {
  const booking = {
    id: 'booking-1',
    status: 'approved',
    bookingDate: kyivToday(),
    table: { id: 'table-1', tableNumber: '8', status: 'occupied' },
    client: { fullName: 'Гість' },
  };
  const calls = [];

  const bookingsRepo = {
    exist: async ({ where }) => where.id === booking.id && Boolean(where.guestAccessTokenHash),
    findOne: async ({ where }) => where.id === booking.id ? booking : null,
    createQueryBuilder: () => ({
      where() { return this; },
      setLock() { return this; },
      async getOne() { return { id: booking.id }; },
    }),
  };

  const callRepo = {
    create(value) {
      return {
        assignmentActive: value.assignmentActive ?? true,
        ...value,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    async save(value) {
      const index = calls.findIndex((call) => call.id === value.id);
      value.updatedAt = new Date();
      if (index >= 0) calls[index] = value;
      else calls.push(value);
      return value;
    },
    async find({ where } = {}) {
      return [...calls]
        .filter((call) => matchesStatus(call.status, where?.status))
        .filter((call) => !where?.waiterId || call.waiterId === where.waiterId)
        .filter((call) => where?.assignmentActive === undefined || call.assignmentActive === where.assignmentActive)
        .filter((call) => !where?.booking?.status || call.booking?.status === where.booking.status)
        .filter((call) => !where?.booking?.bookingDate || call.booking?.bookingDate === where.booking.bookingDate)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    },
    async findOne({ where }) {
      if (where.id) return calls.find((call) => call.id === where.id) || null;
      if (where.booking?.id) {
        return [...calls]
          .reverse()
          .find((call) =>
            call.booking.id === where.booking.id &&
            matchesStatus(call.status, where.status) &&
            (where.assignmentActive === undefined || call.assignmentActive === where.assignmentActive) &&
            (!where.waiterId || Boolean(call.waiterId))) || null;
      }
      return null;
    },
    async query(sql, params) {
      assert.match(sql, /ROW_NUMBER\(\) OVER/);
      assert.match(sql, /PARTITION BY waiter_calls\.booking_id/);
      assert.match(sql, /INNER JOIN bookings/);
      assert.match(sql, /bookings\.status = 'approved'/);
      assert.match(sql, /bookings\.booking_date = \(CURRENT_TIMESTAMP AT TIME ZONE 'Europe\/Kyiv'\)::date/);
      assert.match(sql, /latest_per_table/);
      assert.match(sql, /LIMIT 50/);

      const waiterId = params[0];
      const today = kyivToday();
      const ordered = [...calls]
        .filter((call) => call.waiterId === waiterId && call.assignmentActive)
        .filter((call) => call.booking?.status === 'approved' && call.booking?.bookingDate === today)
        .sort((left, right) => assignedTime(right) - assignedTime(left));

      const latestByBooking = new Map();
      for (const call of ordered) {
        if (!latestByBooking.has(call.booking.id)) {
          latestByBooking.set(call.booking.id, call);
        }
      }

      const latestByTable = new Map();
      for (const call of latestByBooking.values()) {
        const tableKey = call.tableId
          ? `id:${call.tableId}`
          : call.tableNumber
            ? `number:${call.tableNumber}`
            : `booking:${call.booking.id}`;
        if (!latestByTable.has(tableKey)) {
          latestByTable.set(tableKey, call);
        }
      }

      return [...latestByTable.values()]
        .sort((left, right) => assignedTime(right) - assignedTime(left))
        .slice(0, 50)
        .map((call) => ({
          bookingId: call.booking.id,
          tableId: call.tableId,
          tableNumber: call.tableNumber,
          waiterId: call.waiterId,
          waiterName: call.waiterName,
          assignedAt: call.acceptedAt || call.createdAt,
        }));
    },
    createQueryBuilder() {
      let bookingId = null;
      let values = {};
      let activeOnly = false;
      let assignmentActiveOnly = false;
      return {
        update() { return this; },
        set(next) { values = next; return this; },
        where(_sql, params) { bookingId = params.bookingId; return this; },
        andWhere(sql) {
          activeOnly ||= sql.includes('"status"');
          assignmentActiveOnly ||= sql.includes('"assignment_active"');
          return this;
        },
        async execute() {
          let affected = 0;
          calls.forEach((call) => {
            if (call.booking.id !== bookingId) return;
            if (activeOnly && call.status !== 'new' && call.status !== 'accepted') return;
            if (assignmentActiveOnly && !call.assignmentActive) return;
            Object.assign(call, values);
            affected += 1;
          });
          return { affected };
        },
      };
    },
  };

  const historiesRepo = {
    createQueryBuilder: () => ({
      leftJoin() { return this; },
      where() { return this; },
      andWhere() { return this; },
      orderBy() { return this; },
      async getOne() { return null; },
    }),
  };

  const dataSource = {
    transaction: async (work) => work({
      getRepository(entity) {
        if (entity === WaiterCallRecord || entity.name === 'WaiterCallRecord') return callRepo;
        if (entity === Booking || entity.name === 'Booking') return bookingsRepo;
        throw new Error(`Unexpected repository: ${entity.name}`);
      },
    }),
  };

  return { booking, calls, bookingsRepo, callRepo, historiesRepo, dataSource };
}

function createService(store) {
  return new WaiterCallsService(
    store.bookingsRepo,
    store.historiesRepo,
    store.callRepo,
    store.dataSource,
  );
}

test('active waiter call survives service recreation', async () => {
  const store = createStore();
  const firstService = createService(store);

  const created = await firstService.createFromGuest(
    { bookingId: store.booking.id },
    'guest-token',
  );
  assert.equal(store.calls.length, 1);

  const restartedService = createService(store);
  const guestStatus = await restartedService.guestStatus(
    store.booking.id,
    'guest-token',
  );

  assert.equal(guestStatus.activeCall.id, created.call.id);
  assert.equal(guestStatus.activeCall.status, 'new');
});

test('waiter list hides persisted active calls from non-current bookings', async () => {
  const store = createStore();
  const today = kyivToday();
  const now = new Date();

  store.calls.push(
    {
      id: 'valid-call',
      booking: { id: 'valid-booking', status: 'approved', bookingDate: today },
      tableId: 'table-valid',
      tableNumber: '8',
      clientName: null,
      waiterId: null,
      waiterName: null,
      assignmentActive: true,
      status: 'new',
      acceptedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'completed-call',
      booking: { id: 'completed-booking', status: 'completed', bookingDate: today },
      tableId: 'table-completed',
      tableNumber: '9',
      clientName: null,
      waiterId: null,
      waiterName: null,
      assignmentActive: true,
      status: 'accepted',
      acceptedAt: now,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'past-call',
      booking: { id: 'past-booking', status: 'approved', bookingDate: '2000-01-01' },
      tableId: 'table-past',
      tableNumber: '10',
      clientName: null,
      waiterId: null,
      waiterName: null,
      assignmentActive: true,
      status: 'new',
      acceptedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  );

  const visible = await createService(store).list();

  assert.deepEqual(visible.map((call) => call.id), ['valid-call']);
});

test('repeated guest call reuses the persisted active call', async () => {
  const store = createStore();
  const service = createService(store);

  const first = await service.createFromGuest(
    { bookingId: store.booking.id },
    'guest-token',
  );
  const second = await service.createFromGuest(
    { bookingId: store.booking.id },
    'guest-token',
  );

  assert.equal(store.calls.length, 1);
  assert.equal(second.call.id, first.call.id);
  assert.match(second.message, /вже відправлено/);
});

test('accepted waiter assignment survives service recreation', async () => {
  const store = createStore();
  const service = createService(store);
  const waiterId = '11111111-1111-4111-8111-111111111111';
  const created = await service.createFromGuest(
    { bookingId: store.booking.id },
    'guest-token',
  );

  await service.accept(created.call.id, {
    waiterId,
    waiterName: 'Офіціант 1',
  });

  const restartedService = createService(store);
  const assignments = await restartedService.myAssignments(waiterId);
  const assignment = await restartedService.assignmentForBooking(store.booking);

  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].bookingId, store.booking.id);
  assert.equal(assignments[0].waiterId, waiterId);
  assert.equal(assignment.waiterId, waiterId);
  assert.equal(assignment.waiterName, 'Офіціант 1');
});

test('normal call close keeps the waiter assignment across service recreation', async () => {
  const store = createStore();
  const service = createService(store);
  const waiterId = '11111111-1111-4111-8111-111111111111';
  const created = await service.createFromGuest(
    { bookingId: store.booking.id },
    'guest-token',
  );

  await service.accept(created.call.id, {
    waiterId,
    waiterName: 'Офіціант 1',
  });
  await service.close(created.call.id, waiterId);

  const restartedService = createService(store);
  assert.deepEqual(await restartedService.list(waiterId), []);

  const assignments = await restartedService.myAssignments(waiterId);
  const assignment = await restartedService.assignmentForBooking(store.booking);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].bookingId, store.booking.id);
  assert.equal(assignment.waiterId, waiterId);
});

test('explicit booking detach removes persisted waiter assignment even after call close', async () => {
  const store = createStore();
  const service = createService(store);
  const waiterId = '11111111-1111-4111-8111-111111111111';
  const created = await service.createFromGuest(
    { bookingId: store.booking.id },
    'guest-token',
  );

  await service.accept(created.call.id, {
    waiterId,
    waiterName: 'Офіціант 1',
  });
  await service.close(created.call.id, waiterId);
  await service.closeActiveCallsAndDetachBooking(store.booking.id);

  const restartedService = createService(store);
  assert.deepEqual(await restartedService.myAssignments(waiterId), []);
  assert.equal(await restartedService.assignmentForBooking(store.booking), null);
});

test('myAssignments deduplicates persisted rows in SQL before applying the 50-assignment limit', async () => {
  const store = createStore();
  const waiterId = '11111111-1111-4111-8111-111111111111';
  const baseTime = Date.now();
  const today = kyivToday();

  for (let index = 0; index < 55; index += 1) {
    store.calls.push({
      id: `duplicate-${index}`,
      booking: { id: 'booking-duplicate', status: 'approved', bookingDate: today },
      tableId: 'table-duplicate',
      tableNumber: '9',
      clientName: null,
      waiterId,
      waiterName: 'Офіціант 1',
      assignmentActive: true,
      status: 'closed',
      acceptedAt: new Date(baseTime - index * 1000),
      closedAt: new Date(baseTime - index * 900),
      createdAt: new Date(baseTime - index * 1000),
      updatedAt: new Date(baseTime - index * 900),
    });
  }

  store.calls.push({
    id: 'older-other-booking',
    booking: { id: 'booking-other', status: 'approved', bookingDate: today },
    tableId: 'table-other',
    tableNumber: '10',
    clientName: null,
    waiterId,
    waiterName: 'Офіціант 1',
    assignmentActive: true,
    status: 'closed',
    acceptedAt: new Date(baseTime - 100000),
    closedAt: new Date(baseTime - 99000),
    createdAt: new Date(baseTime - 100000),
    updatedAt: new Date(baseTime - 99000),
  });

  const assignments = await createService(store).myAssignments(waiterId);

  assert.equal(assignments.filter((item) => item.bookingId === 'booking-duplicate').length, 1);
  assert.equal(assignments.some((item) => item.bookingId === 'booking-other'), true);
});

test('myAssignments filters completed history before the 50-assignment limit', async () => {
  const store = createStore();
  const waiterId = '11111111-1111-4111-8111-111111111111';
  const baseTime = Date.now();
  const today = kyivToday();

  for (let index = 0; index < 55; index += 1) {
    store.calls.push({
      id: `completed-${index}`,
      booking: { id: `completed-booking-${index}`, status: 'completed', bookingDate: today },
      tableId: `completed-table-${index}`,
      tableNumber: String(100 + index),
      clientName: null,
      waiterId,
      waiterName: 'Офіціант 1',
      assignmentActive: true,
      status: 'closed',
      acceptedAt: new Date(baseTime - index * 1000),
      closedAt: new Date(baseTime - index * 900),
      createdAt: new Date(baseTime - index * 1000),
      updatedAt: new Date(baseTime - index * 900),
    });
  }

  store.calls.push({
    id: 'older-active-booking',
    booking: { id: 'active-booking', status: 'approved', bookingDate: today },
    tableId: 'active-table',
    tableNumber: '8',
    clientName: null,
    waiterId,
    waiterName: 'Офіціант 1',
    assignmentActive: true,
    status: 'closed',
    acceptedAt: new Date(baseTime - 100000),
    closedAt: new Date(baseTime - 99000),
    createdAt: new Date(baseTime - 100000),
    updatedAt: new Date(baseTime - 99000),
  });

  const assignments = await createService(store).myAssignments(waiterId);

  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].bookingId, 'active-booking');
});

test('waiter_calls schema is migration-owned and enforces one active call per booking', () => {
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '../src/migrations/2026081500010-CreateWaiterCalls.ts'),
    'utf8',
  );
  const entitySource = fs.readFileSync(
    path.join(__dirname, '../src/waiter-calls/entities/waiter-call.entity.ts'),
    'utf8',
  );

  assert.match(entitySource, /synchronize:\s*false/);
  assert.match(migrationSource, /"assignment_active" boolean NOT NULL DEFAULT true/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS "waiter_calls"/);
  assert.match(migrationSource, /CREATE UNIQUE INDEX IF NOT EXISTS "UQ_waiter_calls_active_booking"/);
  assert.match(migrationSource, /WHERE "status" IN \('new', 'accepted'\)/);
});
