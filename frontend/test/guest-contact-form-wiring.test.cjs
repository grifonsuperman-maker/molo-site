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

function inputContaining(source, marker, message) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, message);

  const inputStart = source.lastIndexOf('<input', markerIndex);
  const inputEnd = source.indexOf('/>', markerIndex);
  assert.ok(inputStart >= 0 && inputEnd > markerIndex, message);

  return source.slice(inputStart, inputEnd + 2);
}

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

const guestPhoneInput = inputContaining(
  guestApp,
  'placeholder="+380 (__) ___-__-__"',
  'guest phone input must exist',
);
assert.doesNotMatch(
  guestPhoneInput,
  /\bmaxLength\s*=/,
  'guest phone input must let validation inspect the complete pasted value',
);

const adminPhoneLabelIndex = adminPlanner.indexOf('Телефон гостя (необов’язково)');
assert.notEqual(adminPhoneLabelIndex, -1, 'admin manual phone label must exist');
const adminPhoneInputStart = adminPlanner.indexOf('<input', adminPhoneLabelIndex);
const adminPhoneInputEnd = adminPlanner.indexOf('/>', adminPhoneInputStart);
assert.ok(
  adminPhoneInputStart > adminPhoneLabelIndex && adminPhoneInputEnd > adminPhoneInputStart,
  'admin manual phone input must exist',
);
const adminPhoneInput = adminPlanner.slice(adminPhoneInputStart, adminPhoneInputEnd + 2);
assert.doesNotMatch(
  adminPhoneInput,
  /\bmaxLength\s*=/,
  'admin manual phone input must let validation inspect the complete pasted value',
);

assert.doesNotMatch(
  adminPlanner,
  /Ім’я може містити лише літери, пробіли, дефіс та апостроф/,
  'admin validation message must not claim that hyphen or apostrophe are allowed',
);

console.log('guest contact form wiring tests passed');
