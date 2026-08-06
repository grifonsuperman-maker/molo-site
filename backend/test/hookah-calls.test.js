require("reflect-metadata");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  HookahCallsService,
} = require("../dist/hookah-calls/hookah-calls.service.js");

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
      table: {
        id: "table-1",
        tableNumber: "8",
        status: "occupied",
        zone: { name: "Зал ресторану" },
      },
      client: { fullName: "Гість" },
    }),
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
