const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const controls = fs.readFileSync(
  path.join(root, 'src/director/DirectorSiteControlsDock.tsx'),
  'utf8',
);
const guest = fs.readFileSync(
  path.join(root, 'src/guest/GuestApp.tsx'),
  'utf8',
);
const workspace = fs.readFileSync(
  path.join(root, 'src/director/DirectorWorkspace.tsx'),
  'utf8',
);

test('Director site controls reuse existing restaurant availability and phone settings', () => {
  assert.match(controls, /restaurantApi\.close\(/);
  assert.match(controls, /restaurantApi\.open\(\)/);
  assert.match(controls, /restaurantApi\.update\(\{ phone:/);
  assert.match(controls, /Закрити сайт/);
  assert.match(controls, /Телефон адміністратора/);
});

test('guest admin call continues to use restaurant phone', () => {
  assert.match(guest, /bookingStatus\?\.restaurantPhone \|\| restaurant\?\.phone/);
  assert.match(guest, /window\.location\.href = `tel:\$\{phone\}`/);
});

test('Director workspace mounts site controls without changing PremiumDirectorPanel', () => {
  assert.match(workspace, /<DirectorSiteControlsDock \/>/);
  assert.match(workspace, /<PremiumDirectorPanel \/>/);
});
