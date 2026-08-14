require("reflect-metadata");

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  HookahGuestAccessService,
} = require("../dist/hookah-calls/hookah-guest-access.service.js");

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createService() {
  const bookingId = "7e09ea68-56f6-45b0-8cf5-c52c2ff118b3";
  const guestToken = "hookah-guest-token";
  const existCalls = [];
  const bookingsRepo = {
    exist: async (options) => {
      existCalls.push(options);
      return (
        options.where.id === bookingId &&
        options.where.guestAccessTokenHash === hashToken(guestToken)
      );
    },
  };

  return {
    bookingId,
    guestToken,
    existCalls,
    service: new HookahGuestAccessService(bookingsRepo),
  };
}

async function expectUnauthorized(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.message, "Недійсний доступ до бронювання");
    return true;
  });
}

test("hookah guest access rejects a missing token without querying the booking", async () => {
  const state = createService();

  await expectUnauthorized(() =>
    state.service.assertBookingAccess(state.bookingId),
  );

  assert.equal(state.existCalls.length, 0);
});

test("hookah guest access rejects a token from another booking", async () => {
  const state = createService();

  await expectUnauthorized(() =>
    state.service.assertBookingAccess(state.bookingId, "another-booking-token"),
  );

  assert.equal(state.existCalls.length, 1);
});

test("hookah guest access accepts the token of the same booking", async () => {
  const state = createService();

  await state.service.assertBookingAccess(state.bookingId, state.guestToken);

  assert.equal(state.existCalls.length, 1);
  assert.deepEqual(state.existCalls[0].where, {
    id: state.bookingId,
    guestAccessTokenHash: hashToken(state.guestToken),
  });
});
