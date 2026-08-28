const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

test('live AdminWorkspace renders the reschedule panel', () => {
  const workspace = read('src/admin/AdminWorkspace.tsx');

  assert.match(
    workspace,
    /import AdminReschedulePanel from '\.\/AdminReschedulePanel';/,
  );
  assert.match(workspace, /<AdminReschedulePanel \/>/);
});

test('admin reschedule client uses the merged web API routes', () => {
  const api = read('src/api/adminAttention.ts');

  assert.match(
    api,
    /getReschedules:\s*\(\) => api\.get<AdminRescheduleRequest\[]>\('\/admin-attention\/reschedules'\)/,
  );
  assert.match(
    api,
    /\/admin-attention\/reschedules\/\$\{encode\(requestId\)\}\/approve/,
  );
  assert.match(
    api,
    /\/admin-attention\/reschedules\/\$\{encode\(requestId\)\}\/reject/,
  );
});

test('admin reschedule panel preserves 15 second polling and admin approval flow', () => {
  const panel = read('src/admin/AdminReschedulePanel.tsx');

  assert.match(panel, /const POLLING_MS = 15_000;/);
  assert.match(
    panel,
    /window\.setInterval\(\(\) => void load\(true\), POLLING_MS\)/,
  );
  assert.match(panel, /adminAttentionApi\.getReschedules\(\)/);
  assert.match(panel, /adminAttentionApi\.approveReschedule\(request\.id\)/);
  assert.match(panel, /adminAttentionApi\.rejectReschedule\(/);
  assert.match(panel, /Гість просить перенести бронювання/);
  assert.match(
    panel,
    /Час бронювання зміниться тільки після підтвердження Адміністратора\./,
  );
});

test('reject prompt can be cancelled without sending a rejection', () => {
  const panel = read('src/admin/AdminReschedulePanel.tsx');

  assert.match(
    panel,
    /const adminComment = window\.prompt\('Причина відмови для гостя', ''\);/,
  );
  assert.match(panel, /if \(adminComment === null\) return;/);
});
