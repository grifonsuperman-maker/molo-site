require("reflect-metadata");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SchedulesService,
} = require("../dist/schedules/schedules.service.js");

function createService(overrides = {}) {
  const bookingsRepo = {
    find: async () => [],
    save: async (value) => value,
    ...overrides.bookingsRepo,
  };
  const restaurantRepo = {
    find: async () => [],
    create: (value) => value,
    save: async (value) => value,
    ...overrides.restaurantRepo,
  };
  const notificationsService = {
    notifyLateGuest: async () => undefined,
    notifyBookingCloseReminder: async () => undefined,
    notifyRestaurantCloseReminder: async () => undefined,
    ...overrides.notificationsService,
  };
  const logsService = {
    create: async () => undefined,
    ...overrides.logsService,
  };

  return new SchedulesService(
    bookingsRepo,
    restaurantRepo,
    notificationsService,
    logsService,
  );
}

function createRestaurant(overrides = {}) {
  return {
    bookingCloseTime: "22:00",
    closeTime: "23:00",
    bookingCloseNotifiedAt: null,
    restaurantCloseNotifiedAt: null,
    ...overrides,
  };
}

test("scheduler clock follows Europe/Kyiv in summer and winter", () => {
  const service = createService();

  assert.deepEqual(
    service.getKyivClock(new Date("2026-08-16T19:05:00.000Z")),
    {
      date: "2026-08-16",
      time: "22:05",
      minutes: 22 * 60 + 5,
    },
  );

  assert.deepEqual(
    service.getKyivClock(new Date("2026-01-15T20:05:00.000Z")),
    {
      date: "2026-01-15",
      time: "22:05",
      minutes: 22 * 60 + 5,
    },
  );
});

test("scheduler clock uses the Kyiv calendar date across a UTC day boundary", () => {
  const service = createService();

  assert.deepEqual(
    service.getKyivClock(new Date("2026-08-16T21:05:00.000Z")),
    {
      date: "2026-08-17",
      time: "00:05",
      minutes: 5,
    },
  );
});

test("late guest scan uses one Kyiv clock for both date and minutes", async () => {
  let findOptions = null;
  const service = createService({
    bookingsRepo: {
      find: async (options) => {
        findOptions = options;
        return [];
      },
    },
  });

  service.getKyivClock = () => ({
    date: "2026-08-17",
    time: "00:05",
    minutes: 5,
  });

  await service.checkLateGuests();

  assert.equal(findOptions.where.bookingDate, "2026-08-17");
  assert.equal(findOptions.where.status, "approved");
});

test("booking close reminder still sends at the configured minute", async () => {
  const restaurant = createRestaurant();
  let notifications = 0;
  const service = createService({
    restaurantRepo: {
      find: async () => [restaurant],
    },
    notificationsService: {
      notifyBookingCloseReminder: async () => {
        notifications += 1;
      },
    },
  });

  service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "22:00",
    minutes: 22 * 60,
  });

  await service.checkBookingCloseReminder();

  assert.equal(notifications, 1);
  assert.equal(restaurant.bookingCloseNotifiedAt, "2026-08-16");
});

test("booking close reminder catches up after the configured minute", async () => {
  const restaurant = createRestaurant();
  let notifications = 0;
  const service = createService({
    restaurantRepo: {
      find: async () => [restaurant],
    },
    notificationsService: {
      notifyBookingCloseReminder: async () => {
        notifications += 1;
      },
    },
  });

  service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "22:01",
    minutes: 22 * 60 + 1,
  });

  await service.checkBookingCloseReminder();

  assert.equal(notifications, 1);
  assert.equal(restaurant.bookingCloseNotifiedAt, "2026-08-16");
});

test("booking close reminder is not repeated after today's marker is saved", async () => {
  const restaurant = createRestaurant({
    bookingCloseNotifiedAt: "2026-08-16",
  });
  let notifications = 0;
  let saves = 0;
  const service = createService({
    restaurantRepo: {
      find: async () => [restaurant],
      save: async (value) => {
        saves += 1;
        return value;
      },
    },
    notificationsService: {
      notifyBookingCloseReminder: async () => {
        notifications += 1;
      },
    },
  });

  service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "22:30",
    minutes: 22 * 60 + 30,
  });

  await service.checkBookingCloseReminder();

  assert.equal(notifications, 0);
  assert.equal(saves, 0);
});

test("restaurant close reminder catches up after the configured minute", async () => {
  const restaurant = createRestaurant();
  let notifications = 0;
  const service = createService({
    restaurantRepo: {
      find: async () => [restaurant],
    },
    notificationsService: {
      notifyRestaurantCloseReminder: async () => {
        notifications += 1;
      },
    },
  });

  service.getKyivClock = () => ({
    date: "2026-08-16",
    time: "23:01",
    minutes: 23 * 60 + 1,
  });

  await service.checkRestaurantCloseReminder();

  assert.equal(notifications, 1);
  assert.equal(restaurant.restaurantCloseNotifiedAt, "2026-08-16");
});
