const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '../../.github/workflows/guest-push-test-preflight.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('manual preflight is main-only, check-only, and has minimal permissions', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'grifonsuperman-maker\/molo-site'/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /guest-push-migration-operator\.mjs --check/);
  assert.doesNotMatch(workflow, /--apply|MOLO_PUSH_APPROVAL|MOLO_PUSH_PRODUCTION_CHANGE_APPROVED|MOLO_PUSH_BACKUP_CONFIRMED/);
  assert.doesNotMatch(workflow, /run:\s*\|[\s\S]*\b(?:DROP TABLE|CREATE TABLE|INSERT INTO|UPDATE public\.)\b/i);
});

test('test connection is a dedicated secret exposed only after install and build', () => {
  assert.match(workflow, /DB_URL: \$\{\{ secrets\.MOLO_TEST_PUSH_DB_URL \}\}/);
  assert.match(workflow, /MOLO_PUSH_EXPECTED_HOST: \$\{\{ vars\.MOLO_TEST_PUSH_EXPECTED_HOST \}\}/);
  assert.match(workflow, /^          MOLO_PUSH_BRANCH: test-push-migration$/m);
  assert.match(workflow, /^          DB_SYNCHRONIZE: 'false'$/m);
  assert.doesNotMatch(workflow, /secrets\.(?!MOLO_TEST_PUSH_DB_URL)/);
  const build = workflow.indexOf('run: npm --prefix backend run build');
  const secret = workflow.indexOf('DB_URL: ${{ secrets.MOLO_TEST_PUSH_DB_URL }}');
  assert.ok(build >= 0 && secret > build, 'the secret must not be available to dependency installation or builds');
  assert.doesNotMatch(workflow, /upload-artifact|echo [^\n]*\$DB_URL|set -x/);
});
