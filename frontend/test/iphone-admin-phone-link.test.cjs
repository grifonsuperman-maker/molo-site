const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'guest', 'GuestApp.tsx'),
  'utf8',
);

test('guest admin call controls use native tel links for iPhone-compatible navigation', () => {
  assert.match(
    source,
    /const adminPhone = bookingStatus\?\.restaurantPhone \|\| restaurant\?\.phone;/,
    'admin phone priority must remain booking response first, restaurant settings second',
  );
  assert.equal(
    (source.match(/href=\{`tel:\$\{adminPhone\}`\}/g) || []).length,
    3,
    'all three admin call controls must render native tel anchors when a phone exists',
  );
  assert.equal(
    (source.match(/onClick=\{callAdmin\}/g) || []).length,
    3,
    'all three call locations must keep the missing-phone button fallback',
  );
  assert.doesNotMatch(source, /window\.location\.href\s*=\s*`tel:/);
  assert.match(source, /alert\('Телефон адміністратора ще не додано\.'\);/);
});
