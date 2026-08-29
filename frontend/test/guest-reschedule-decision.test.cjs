const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const actionsSource = fs.readFileSync(
  path.join(root, 'src/guest/GuestBookingServiceActions.tsx'),
  'utf8',
);
const bookingsApiSource = fs.readFileSync(
  path.join(root, 'src/api/bookings.ts'),
  'utf8',
);

test('active booking service actions show only reschedule decision notifications', () => {
  assert.match(actionsSource, /guestNotification\?\.type === 'reschedule_decision'/);
  assert.match(actionsSource, /decision === 'approved'/);
  assert.match(actionsSource, /Зрозуміло/);
});

test('reschedule decision acknowledgement reuses protected guest booking token', () => {
  assert.match(actionsSource, /readGuestBrowserAccess\(\)/);
  assert.match(actionsSource, /item\.bookingId === booking\.bookingId/);
  assert.match(actionsSource, /bookingsApi\.guestAcknowledgeNotification\(booking\.bookingId, token\)/);
  assert.match(bookingsApiSource, /guestAcknowledgeNotification/);
});

test('existing guest service polling remains exactly 15 seconds', () => {
  assert.match(actionsSource, /const POLLING_INTERVAL_MS = 15_000;/);
  assert.match(actionsSource, /window\.setInterval\([\s\S]*?POLLING_INTERVAL_MS\)/);
});
