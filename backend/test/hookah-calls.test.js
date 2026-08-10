require("reflect-metadata");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  HookahCallsService,
} = require("../dist/hookah-calls/hookah-calls.service.js");

function kyivDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function futureKyivDate() {
  return kyivDate(new Date(Date.now() + 48 * 60 * 60 * 1_000));
}

function createService(overrides = {}) {
  const restaurant = {
    id: "restaurant-1",
    hookahCallsAvailable: true,
    hookahCallsAvailabilityChangedAt: null,
  };
  const hookahRepo = {
    find: async () => [],
    findOne: async () => null,
    save: async (value) => value,
    ...overrides.hookahRepo,
  };
  const bookingsRepo = {
    findOne: async () => ({
      id: "booking-1",
      status: "approved",
      bookingDate: kyivDate(),
      table: {
        id: "table-1",
        tableNumber: "8",
        status: "occupied",
        zone: { name: "Зал ресторану" },
      },
      client: { fullName: "Гість" },
    }),
    ...overrides.bookingsRepo,
  };
  const staffRepo = {
    findOne: async () => ({ id: "hookah-1", role: "hookah", isOnShift: true }),
  };
  const restaurantRepo = {
    find: async () => [restaurant],
    save: async (value) => value,
  };
  const waiterCalls = { assignmentForBooking: async () => null };
  const dataSource = {
    transaction: async (work) =>
      work({
        getRepository() {
          throw new Error("not used");
        },
      }),
  };
  return {
    restaurant,
    service: new HookahCallsService(
      hookahRepo,
      bookingsRepo,
      staffRepo,
      restaurantRepo,
      waiterCalls,
      dataSource,
    ),
  };
}

test("hookah worker can block and restore only new guest calls", async () => {
  const { service, restaurant } = createService();

  const blocked = await service.setAvailability("hookah-1", false);
  assert.equal(blocked.available, false);
  assert.equal(restaurant.hookahCallsAvailable, false);

  const restored = await service.setAvailability("hookah-1", true);
  assert.equal(restored.available, true);
  assert.equal(restaurant.hookahCallsAvailable, true);
});

test("expired accepted call automatically releases the guest button", async () => {
  const overdue = {
    id: "call-1",
    status: "accepted",
    etaDueAt: new Date(Date.now() - 1_000),
    completedAt: null,
    booking: { id: "booking-1" },
  };
  let activeCall = overdue;
  const { service } = createService({
    hookahRepo: {
      find: async () => (activeCall ? [activeCall] : []),
      save: async (value) => {
        activeCall = null;
        return value;
      },
      findOne: async () => activeCall,
    },
  });

  const status = await service.guestStatus("booking-1");
  assert.equal(overdue.status, "completed");
  assert.equal(status.activeCall, null);
  assert.equal(status.canCall, true);
});

test("guest status blocks a hookah call for a future booking", async () => {
  const { service } = createService({
    bookingsRepo: {
      findOne: async () => ({
        id: "booking-future",
        status: "approved",
        bookingDate: futureKyivDate(),
        table: {
          id: "table-8",
          tableNumber: "8",
          status: "occupied",
          zone: { name: "Зал ресторану" },
        },
        client: { fullName: "Гість" },
      }),
    },
  });

  const status = await service.guestStatus("booking-future");

  assert.equal(status.canCall, false);
});

test("guest call locks only the booking row before nullable relations are loaded", async () => {
  const booking = {
    id: "booking-1",
    status: "approved",
    bookingDate: kyivDate(),
    table: {
      id: "table-1",
      tableNumber: "8",
      status: "occupied",
      zone: { name: "Зал ресторану" },
    },
    client: { fullName: "Гість" },
  };
  const lockCalls = [];
  const bookingFindCalls = [];
  const queryBuilder = {
    where() {
      return this;
    },
    setLock(...args) {
      lockCalls.push(args);
      return this;
    },
    async getOne() {
      return { id: booking.id };
    },
  };
  const bookingRepo = {
    createQueryBuilder: () => queryBuilder,
    findOne: async (options) => {
      bookingFindCalls.push(options);
      return booking;
    },
  };
  const call = {
    id: "call-1",
    booking,
    table: booking.table,
    acceptedByStaff: null,
    status: "new",
    etaMinutes: null,
    etaDueAt: null,
    waiterName: null,
    createdAt: new Date(),
    acceptedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
  };
  const callRepo = {
    find: async () => [],
    findOne: async (options) => options.where.id === call.id ? call : null,
    create: (value) => ({ ...value, id: call.id, createdAt: call.createdAt }),
    save: async (value) => value,
  };
  const staffRepo = { count: async () => 1 };
  const restaurantRepo = {
    find: async () => [{ id: "restaurant-1", hookahCallsAvailable: true }],
  };
  const repositories = { Booking: bookingRepo, HookahCall: callRepo, Staff: staffRepo, Restaurant: restaurantRepo };
  const dataSource = {
    transaction: async (work) => work({
      getRepository: (entity) => repositories[entity.name],
    }),
  };
  const service = new HookahCallsService(
    callRepo,
    bookingRepo,
    staffRepo,
    restaurantRepo,
    { assignmentForBooking: async () => null },
    dataSource,
  );

  const result = await service.createFromGuest({ bookingId: booking.id });

  assert.equal(result.call.id, call.id);
  assert.deepEqual(lockCalls, [["pessimistic_write", undefined, ["booking"]]]);
  assert.equal(bookingFindCalls.length, 1);
  assert.equal("lock" in bookingFindCalls[0], false);
  assert.deepEqual(bookingFindCalls[0].relations, {
    table: { zone: true },
    client: true,
  });
});

test("guest request rejects a hookah call for a future booking", async () => {
  const booking = {
    id: "booking-future",
    status: "approved",
    bookingDate: futureKyivDate(),
    table: {
      id: "table-8",
      tableNumber: "8",
      status: "occupied",
      zone: { name: "Зал ресторану" },
    },
    client: { fullName: "Гість" },
  };
  const queryBuilder = {
    where() {
      return this;
    },
    setLock() {
      return this;
    },
    async getOne() {
      return { id: booking.id };
    },
  };
  const bookingRepo = {
    createQueryBuilder: () => queryBuilder,
    findOne: async () => booking,
  };
  const callRepo = {
    find: async () => [],
  };
  const staffRepo = {};
  const restaurantRepo = {};
  const repositories = {
    Booking: bookingRepo,
    HookahCall: callRepo,
    Staff: staffRepo,
    Restaurant: restaurantRepo,
  };
  const dataSource = {
    transaction: async (work) => work({
      getRepository: (entity) => repositories[entity.name],
    }),
  };
  const service = new HookahCallsService(
    callRepo,
    bookingRepo,
    staffRepo,
    restaurantRepo,
    { assignmentForBooking: async () => null },
    dataSource,
  );

  await assert.rejects(
    () => service.createFromGuest({ bookingId: booking.id }),
    (error) => {
      assert.equal(
        error.message,
        "Виклик кальянника доступний тільки у день візиту",
      );
      return true;
    },
  );
});
