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
  };
  const logsService = {
    create: async () => undefined,
  };

  return new SchedulesService(
    bookingsRepo,
    restaurantRepo,
    notificationsService,
    logsService,
  );
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
