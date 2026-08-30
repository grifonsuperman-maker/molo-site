const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/staff/TelegramStaffInvitePanel.tsx', 'utf8');

test('Director can create only an Administrator from the Telegram staff panel', () => {
  assert.match(source, /audience === 'director'/);
  assert.match(source, /Додати Адміністратора/);
  assert.match(source, /role: 'admin'/);
  assert.match(source, /\^\\d\{4,6\}\$/);
  assert.match(source, /pattern="\\d\{4,6\}"/);
  assert.match(source, /createTelegramInvite\(member\.id\)/);
});

test('Admin audience keeps ordinary staff scope only', () => {
  assert.match(
    source,
    /audience === 'admin'[\s\S]*member\.role === 'waiter' \|\| member\.role === 'hookah'/,
  );
});
