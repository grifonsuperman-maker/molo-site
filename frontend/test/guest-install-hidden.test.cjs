const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('guest installation invitation stays hidden while PWA registration remains active', () => {
  const source = read('src/guest/components/GuestInstallPrompt.tsx');
  const main = read('src/main.tsx');
  assert.match(source, /const INSTALL_INVITATION_ENABLED = false;/);
  assert.match(source, /if \(!INSTALL_INVITATION_ENABLED \|\| hidden \|\| !eligible \|\| !isHome\) return null;/);
  assert.match(source, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(main, /<GuestInstallPrompt\s*\/>/);
});
