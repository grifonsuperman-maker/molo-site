const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/admin/AdminAuthGate.tsx', 'utf8');

test('admin auth accepts the same 4-6 digit PIN range as the backend', () => {
  assert.ok(source.includes("if (!/^\\d{4,6}$/.test(pin))"));
  assert.ok(source.includes("PIN має містити від 4 до 6 цифр"));
  assert.ok(source.includes('type="password"'));
  assert.ok(source.includes('pattern="\\d{4,6}"'));
  assert.ok(source.includes('maxLength={6}'));
  assert.ok(source.includes(".replace(/\\D/g, '').slice(0, 6)"));
  assert.equal(source.includes('рівно 6 цифр'), false);
  assert.equal(source.includes('шестизначний PIN'), false);
});
