const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guestApp = fs.readFileSync(
  path.join(__dirname, '../src/guest/GuestApp.tsx'),
  'utf8',
);
const adminPlanner = fs.readFileSync(
  path.join(__dirname, '../src/admin/AdminVisualTablePlanner.tsx'),
  'utf8',
);

assert.match(
  guestApp,
  /fullName:\s*sanitizeGuestNameInput\(event\.target\.value\)/,
  'guest name input must strip non-letter characters before storing form state',
);
assert.match(
  guestApp,
  /placeholder="\+380 \(__\) ___-__-__"/,
  'guest phone input must show the Ukrainian +380 mask',
);
assert.match(
  guestApp,
  /phone:\s*formatUkrainePhoneInput\(event\.target\.value\)/,
  'guest phone input must format the value while typing',
);
assert.match(
  guestApp,
  /type="tel"[\s\S]*?inputMode="tel"[\s\S]*?autoComplete="tel"/,
  'guest phone input must use phone-friendly browser attributes',
);
assert.doesNotMatch(
  guestApp,
  /placeholder="\+380 \(__\) ___-__-__"[\s\S]{0,220}?maxLength=\{19\}/,
  'guest phone input must let an overlong paste reach validation instead of truncating it to a valid number',
);
assert.doesNotMatch(
  adminPlanner,
  /Ім’я може містити лише літери, пробіли, дефіс та апостроф/,
  'admin validation message must not claim that hyphen or apostrophe are allowed',
);

console.log('guest contact form wiring tests passed');
