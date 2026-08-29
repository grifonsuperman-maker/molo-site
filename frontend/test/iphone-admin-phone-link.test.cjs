const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'guest', 'GuestApp.tsx'),
  'utf8',
);

test('guest admin call controls use user-initiated window.open for Telegram iPhone', () => {
  assert.match(
    source,
    /const adminPhone = bookingStatus\?\.restaurantPhone \|\| restaurant\?\.phone;/,
    'admin phone priority must remain booking response first, restaurant settings second',
  );
  assert.equal(
    (source.match(/onClick=\{callAdmin\}/g) || []).length,
    3,
    'all three admin call controls must remain direct user-click buttons',
  );
  assert.match(
    source,
    /window\.open\(`tel:\$\{adminPhone\}`, '_blank'\);/,
    'Telegram iPhone workaround must open the tel URL in a new window from the user click',
  );
  assert.doesNotMatch(source, /href=\{`tel:/);
  assert.doesNotMatch(source, /window\.location\.href\s*=\s*`tel:/);
  assert.match(source, /alert\('Телефон адміністратора ще не додано\.'\);/);
});
