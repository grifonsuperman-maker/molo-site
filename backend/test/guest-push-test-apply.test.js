const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const loader = import(pathToFileURL(path.resolve(__dirname, '../scripts/guest-push-test-apply.mjs')).href);
const HOST = 'ep-example.eu-central-1.aws.neon.tech';
const approval = 'apply-guest-push-subscriptions-to-test-push-migration';
const validEnv = () => ({
  DB_URL: `postgresql://molo_push_migration_runner:private@${HOST}/neondb?sslmode=require`,
  MOLO_PUSH_EXPECTED_HOST: HOST,
  MOLO_PUSH_BRANCH: 'test-push-migration',
  MOLO_PUSH_APPROVAL: approval,
  DB_SYNCHRONIZE: 'false',
});

test('test-only apply accepts only the dedicated direct test connection', async () => {
  const { assertTestApplyIntent } = await loader;
  assert.equal(assertTestApplyIntent(validEnv()).branch, 'test-push-migration');
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), MOLO_PUSH_BRANCH: 'production' }), /exact test branch/);
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), MOLO_PUSH_APPROVAL: 'apply-guest-push-subscriptions-to-production' }), /exact test branch/);
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), DB_SYNCHRONIZE: 'true' }), /disabled synchronization/);
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), DB_URL: validEnv().DB_URL.replace('molo_push_migration_runner', 'neondb_owner') }), /dedicated test-only/);
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), DB_URL: validEnv().DB_URL.replace('molo_push_migration_runner', 'molo_push_preflight_ro') }), /dedicated test-only/);
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), DB_URL: validEnv().DB_URL.replace('ep-example.', 'ep-example-pooler.'), MOLO_PUSH_EXPECTED_HOST: 'ep-example-pooler.eu-central-1.aws.neon.tech' }), /direct Neon/);
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), MOLO_PUSH_EXPECTED_HOST: 'ep-different.eu-central-1.aws.neon.tech' }), /does not match/);
  assert.throws(() => assertTestApplyIntent({ ...validEnv(), DB_URL: validEnv().DB_URL.replace('sslmode=require', 'sslmode=disable') }), /require SSL/);
});

test('new workflow is manual, test-only, and keeps the preflight ahead of write access', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/guest-push-test-apply.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /secrets\.MOLO_TEST_PUSH_DB_URL/);
  assert.match(workflow, /secrets\.MOLO_TEST_PUSH_APPLY_DB_URL/);
  assert.doesNotMatch(workflow, /secrets\.MOLO_TEST_PUSH_APPLY_DB_URL[\s\S]*guest-push-migration-operator\.mjs --check/);
  assert.match(workflow, /guest-push-migration-operator\.mjs --check[\s\S]*guest-push-test-apply\.mjs/);
  assert.doesNotMatch(workflow, /MOLO_PUSH_BRANCH:\s*production/);
  assert.doesNotMatch(workflow, /MOLO_PUSH_PRODUCTION_CHANGE_APPROVED/);
});
