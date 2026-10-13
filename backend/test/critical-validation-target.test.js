const assert = require('node:assert/strict');
const test = require('node:test');

for (const [file, entry] of [
  ['booking-create-validation.mjs', 'runBookingCreateValidation'],
  ['staff-credential-validation.mjs', 'runStaffCredentialValidation'],
]) {
  test(`${file} refuses production or unapproved database targets before opening a connection`, async () => {
    const { [entry]: run } = await import(`../scripts/${file}`);
    await assert.rejects(run({}), /Fresh schema reference is disabled/);
    const isolated = { FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_HOST: '127.0.0.1', DB_NAME: 'molo_fresh_schema_reference', DB_SYNCHRONIZE: 'true' };
    await assert.rejects(run({ ...isolated, DB_URL: 'postgres://example/production' }), /refuses DB_URL/);
    await assert.rejects(run({ ...isolated, DB_HOST: 'production.example' }), /requires DB_HOST/);
    await assert.rejects(run({ ...isolated, DB_NAME: 'production' }), /requires DB_NAME/);
    await assert.rejects(run(isolated), /validated process environment/);
  });
}
