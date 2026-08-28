const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/guest/components/GuestBookingDecisionController.tsx'),
  'utf8',
);

test('guest decision controller supports reschedule decisions without changing polling or acknowledgement', () => {
  assert.match(source, /const POLLING_MS = 15_000;/);
  assert.match(source, /'Перенесення підтверджено'/);
  assert.match(source, /'Перенесення відхилено'/);
  assert.match(source, /'Новий стіл підтверджено'/);
  assert.match(source, /'Поточний стіл залишено'/);
  assert.match(source, /guestAcknowledgeNotification/);
  assert.match(source, /'Ознайомився'/);
});
