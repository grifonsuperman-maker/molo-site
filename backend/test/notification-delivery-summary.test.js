require("reflect-metadata");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  NotificationsService,
} = require("../dist/notifications/notifications.service.js");

function createService(chatIds, failedChatIds = []) {
  const failed = new Set(failedChatIds.map(String));
  const staffRepo = {
    find: async () => chatIds.map((telegramId) => ({ telegramId })),
  };
  const telegramService = {
    sendMessage: async (chatId) => {
      if (failed.has(String(chatId))) {
        throw new Error(`telegram failed for ${chatId}`);
      }
      return { ok: true };
    },
  };

  return new NotificationsService(staffRepo, telegramService);
}

test("notification delivery summary reports a complete Telegram failure", async () => {
  const service = createService(["admin-1", "owner-1"], ["admin-1", "owner-1"]);

  const result = await service.sendToRoles(["owner", "admin"], "test");

  assert.deepEqual(result, {
    attempted: 2,
    delivered: 0,
    failed: 2,
  });
});

test("notification delivery summary preserves partial success without throwing", async () => {
  const service = createService(["admin-1", "owner-1"], ["admin-1"]);

  const result = await service.notifyBookingCloseReminder();

  assert.deepEqual(result, {
    attempted: 2,
    delivered: 1,
    failed: 1,
  });
});

test("notification delivery summary distinguishes no linked recipients from delivery failure", async () => {
  const service = createService([]);

  const result = await service.notifyRestaurantCloseReminder();

  assert.deepEqual(result, {
    attempted: 0,
    delivered: 0,
    failed: 0,
  });
});
