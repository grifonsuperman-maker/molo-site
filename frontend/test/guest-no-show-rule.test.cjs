const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
const serviceActions = fs.readFileSync(
  path.join(__dirname, '../src/guest/GuestBookingServiceActions.tsx'),
  'utf8',
);

assert.match(
  serviceActions,
  /aria-label="Виклик персоналу для цього бронювання"/,
  'approved booking card must keep the service-actions section used by the no-show rule notice',
);
assert.match(
  styles,
  /Якщо ви не прибули протягом 30 хвилин після зазначеного часу та не змінили час прибуття, бронювання буде автоматично анульовано\./,
  'guest booking must visibly explain the 30-minute no-show rule',
);
assert.match(
  serviceActions,
  /const POLLING_INTERVAL_MS = 15_000;/,
  'guest service polling must remain exactly 15 seconds',
);

console.log('guest no-show rule wiring checks passed');
