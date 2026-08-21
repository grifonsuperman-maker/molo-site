require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HookahCallTelegramNotifierService,
} = require('../dist/hookah-calls/hookah-call-telegram-notifier.service.js');

test('new hookah call push goes only to active hookah workers and shows the new-call count', async () => {
  const sent = [];
  const staffRepo = {
    async find(options) {
      assert.deepEqual(options.where, {
        role: 'hookah',
        active: true,
        isArchived: false,
        isOnShift: true,
      });
      return [
        { id: 'hookah-1', telegramId: '111' },
        { id: 'hookah-2', telegramId: '222' },
        { id: 'hookah-3', telegramId: null },
      ];
    },
  };
  const telegram = {
    async sendMessage(...args) {
      sent.push(args);
      return { ok: true };
    },
  };
  const service = new HookahCallTelegramNotifierService(staffRepo, telegram);
  const call = {
    id: 'call-1',
    tableNumber: '8',
    zoneName: 'Навіс',
    clientName: 'Гість',
    waiterName: 'Олена',
    status: 'new',
  };

  const result = await service.notifyCreated(call, [
    call,
    { ...call, id: 'call-2', status: 'new' },
    { ...call, id: 'call-3', status: 'accepted' },
  ]);

  assert.deepEqual(result, { attempted: 2, delivered: 2, failed: 0 });
  assert.equal(sent.length, 2);
  assert.match(sent[0][1], /Нових викликів: <b>2<\/b>/);
  assert.deepEqual(
    sent[0][2].inline_keyboard[0].map((button) => button.callback_data),
    [
      'hookah:accept_5:call-1',
      'hookah:accept_10:call-1',
      'hookah:accept_20:call-1',
      'hookah:accept_30:call-1',
    ],
  );
  assert.equal(sent[0][2].inline_keyboard[1][0].text, '🔔 Нові виклики · 2');
});
