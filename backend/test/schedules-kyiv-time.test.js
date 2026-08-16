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

  if (!restaurantRepo.findOne) {
    restaurantRepo.findOne = async () => {
      const restaurants = await restaurantRepo.find({
        order: { createdAt: "ASC" },
        take: 1,
      });
      return restaurants[0] || null;
    };
  }

  if (!restaurantRepo.manager) {
    restaurantRepo.manager = {
      transaction: async (work) =>
        work({
          getRepository: () => restaurantRepo,
        }),
    };
  }

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
    id: "restaurant-1",
    bookingCloseTime: "22:00",
    closeTime: "23:00",
    bookingCloseNotifiedAt: null,
    restaurantCloseNotifiedAt: null,
    ...overrides,
  };
}

function createSerialTransactionManager(repository) {
  let tail = Promise.resolve();

  return {
    transaction: async (work) => {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => {
        release = resolve;
      });

      await previous;

      try {
        return await work({
          getRepository: () => repository,
        });
      } finally {
        release();
      }
    },
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

test("scheduler reminder claim locks the restaurant row before saving the day marker", async () => {
  const restaurant = createRestaurant();
  let lockOptions = null;
  let transactionCalls = 0;
  let notifications = 0;
  const transactionalRepo = {
    findOne: async (options) => {
      lockOptions = options.lock;
      return restaurant;
    },
    save: async (value) => value,
  };
  const manager = {
    transaction: async (work) => {
      transactionCalls += 1;
      return work({
        getRepository: (entity) => {
          assert.equal(entity.name, "Restaurant");
          return transactionalRepo;
        },
      });
    },
  };
  const service = createService({
    restaurantRepo: {
      find: async () => [restaurant],
      manager,
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

  assert.equal(transactionCalls, 1);
  assert.deepEqual(lockOptions, { mode: "pessimistic_write" });
  assert.equal(restaurant.bookingCloseNotifiedAt, "2026-08-16");
  assert.equal(notifications, 1);
});

test("two scheduler instances send only one reminder after the locked reread", async () => {
  let databaseRestaurant = createRestaurant();
  const staleRestaurant = createRestaurant();
  let saves = 0;
  let notifications = 0;
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
  const manager = createSerialTransactionManager(transactionalRepo);
  const restaurantRepo = {
    find: async () => [{ ...staleRestaurant }],
    manager,
  };
  const notificationsService = {
    notifyBookingCloseReminder: async () => {
      notifications += 1;
    },
  };
  const firstService = createService({
    restaurantRepo,
    notificationsService,
  });
  const secondService = createService({
    restaurantRepo,
    notificationsService,
  });

  for (const service of [firstService, secondService]) {
    service.getKyivClock = () => ({
      date: "2026-08-16",
      time: "22:01",
      minutes: 22 * 60 + 1,
    });
  }

  await Promise.all([
    firstService.checkBookingCloseReminder(),
    secondService.checkBookingCloseReminder(),
  ]);

  assert.equal(saves, 1);
  assert.equal(databaseRestaurant.bookingCloseNotifiedAt, "2026-08-16");
  assert.equal(notifications, 1);
});
