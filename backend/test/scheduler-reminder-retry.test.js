require("reflect-metadata");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SchedulesService,
} = require("../dist/schedules/schedules.service.js");

function createRestaurant(overrides = {}) {
  return {
    id: "restaurant-1",
    bookingCloseTime: "22:00",
    closeTime: "23:00",
    bookingCloseNotifiedAt: null,
    restaurantCloseNotifiedAt: null,
    ...overrides,
  };
}

function createHarness(deliveries) {
  let databaseRestaurant = createRestaurant();
  let notificationCalls = 0;
  let logCalls = 0;
  let saves = 0;

  const transactionalRepo = {
    findOne: async (options) => {
      assert.deepEqual(options.lock, { mode: "pessimistic_write" });
      return { ...databaseRestaurant };
    },
    save: async (value) => {
      saves += 1;
      databaseRestaurant = { ...value };
      return value;
    },
  };

  const restaurantRepo = {
    find: async () => [{ ...databaseRestaurant }],
    create: (value) => value,
    save: async (value) => value,
    manager: {
      transaction: async (work) =>
        work({
          getRepository: () => transactionalRepo,
        }),
    },
  };

  const nextDelivery = async () => {
    const index = notificationCalls;
    notificationCalls += 1;
    return deliveries[Math.min(index, deliveries.length - 1)];
  };

  const notificationsService = {
    notifyLateGuest: async () => undefined,
    notifyBookingCloseReminder: nextDelivery,
    notifyRestaurantCloseReminder: nextDelivery,
  };

  const service = new SchedulesService(
    { find: async () => [], save: async (value) => value },
    restaurantRepo,
    notificationsService,
    {
      create: async () => {
        logCalls += 1;
      },
    },
  );

  return {
    service,
    getRestaurant: () => ({ ...databaseRestaurant }),
    getNotificationCalls: () => notificationCalls,
    getLogCalls: () => logCalls,
    getSaves: () => saves,
  };
}

test("booking reminder releases today's marker after complete Telegram failure and retries", async () => {
  const harness = createHarness([
    { attempted: 2, delivered: 0, failed: 2 },
    { attempted: 2, delivered: 2, failed: 0 },
  ]);
  harness.service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "22:01",
    minutes: 22 * 60 + 1,
  });

  await harness.service.checkBookingCloseReminder();

  assert.equal(harness.getRestaurant().bookingCloseNotifiedAt, null);
  assert.equal(harness.getNotificationCalls(), 1);
  assert.equal(harness.getLogCalls(), 0);

  await harness.service.checkBookingCloseReminder();

  assert.equal(harness.getRestaurant().bookingCloseNotifiedAt, "2026-08-16");
  assert.equal(harness.getNotificationCalls(), 2);
  assert.equal(harness.getLogCalls(), 1);
  assert.equal(harness.getSaves(), 3);
});

test("partial booking reminder delivery keeps today's marker to avoid duplicate recipients", async () => {
  const harness = createHarness([
    { attempted: 2, delivered: 1, failed: 1 },
  ]);
  harness.service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "22:01",
    minutes: 22 * 60 + 1,
  });

  await harness.service.checkBookingCloseReminder();
  await harness.service.checkBookingCloseReminder();

  assert.equal(harness.getRestaurant().bookingCloseNotifiedAt, "2026-08-16");
  assert.equal(harness.getNotificationCalls(), 1);
  assert.equal(harness.getLogCalls(), 1);
});

test("restaurant close reminder also releases its marker after complete Telegram failure", async () => {
  const harness = createHarness([
    { attempted: 1, delivered: 0, failed: 1 },
  ]);
  harness.service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "23:01",
    minutes: 23 * 60 + 1,
  });

  await harness.service.checkRestaurantCloseReminder();

  assert.equal(harness.getRestaurant().restaurantCloseNotifiedAt, null);
  assert.equal(harness.getNotificationCalls(), 1);
  assert.equal(harness.getLogCalls(), 0);
});

test("no linked Telegram recipients keeps existing one-per-day marker behavior", async () => {
  const harness = createHarness([
    { attempted: 0, delivered: 0, failed: 0 },
  ]);
  harness.service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "22:01",
    minutes: 22 * 60 + 1,
  });

  await harness.service.checkBookingCloseReminder();

  assert.equal(harness.getRestaurant().bookingCloseNotifiedAt, "2026-08-16");
  assert.equal(harness.getNotificationCalls(), 1);
  assert.equal(harness.getLogCalls(), 1);
});
