const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { SYRVE_SCHEMA_STEPS } = require('../dist/syrve/syrve-schema-contract.js');
const { preflightFingerprint } = require('../dist/syrve/syrve-schema-preflight.js');
const script = '../scripts/syrve-schema-application-plan.mjs';
const now = Date.parse('2026-10-02T03:45:00Z');
function fixture() {
  const audit = { identity: { database: 'neondb', version: 170011, audited_at: '2026-10-02T03:40:00Z' }, hashes: { history: 'a'.repeat(64) } };
  const context = { sourceCommit: 'a'.repeat(40), target: { projectId: 'test-project', branchId: 'br-test-production', endpointId: 'ep-test-source', host: 'ep-test-source.ci.neon.tech', database: 'neondb', purpose: 'production' },
    backup: { projectId: 'test-project', sourceBranchId: 'br-test-production', branchId: 'br-test-backup', parentId: 'br-test-production',
      restoredBranchId: 'br-test-restore', restoredParentId: 'br-test-backup', createdAt: '2026-10-02T03:39:00Z', verifiedAt: '2026-10-02T03:41:00Z', restoredFingerprint: preflightFingerprint(audit.hashes) } };
  return { audit, context };
}
test('production context requires a fresh independent restored backup and exact endpoint/database', async () => {
  const { assertApplicationContext } = await import(script);
  const { audit, context } = fixture();
  assert.equal(assertApplicationContext(context, audit, now).expiresAt, '2026-10-02T04:39:00.000Z');
  for (const mutate of [
    f => f.context.target.database = 'another_db', f => f.context.target.host = 'ep-test-source-pooler.ci.neon.tech',
    f => f.context.target.endpointId = 'ep-wrong-source', f => f.context.target.purpose = 'default',
    f => f.context.sourceCommit = '', f => f.context.backup.projectId = 'another-project',
    f => f.context.backup.sourceBranchId = 'br-another-production', f => f.context.backup.parentId = 'br-another-production',
    f => f.context.backup.restoredParentId = 'br-another-backup', f => f.context.backup.restoredBranchId = f.context.target.branchId,
    f => f.context.backup.branchId = f.context.backup.sourceBranchId, f => f.context.backup.restoredFingerprint = 'b'.repeat(64),
    f => f.context.backup.createdAt = '2026-10-02T02:00:00Z', f => f.context.backup.verifiedAt = '2026-10-02T04:00:00Z',
    f => f.audit.identity.audited_at = '2026-10-02T02:00:00Z', f => f.audit.identity.version = 160011,
  ]) { const f = fixture(); mutate(f); assert.throws(() => assertApplicationContext(f.context, f.audit, now)); }
});
test('rehearsal must address the independently restored branch, never the backup or source', async () => {
  const { assertApplicationContext } = await import(script);
  const f = fixture(); f.context.target.purpose = 'rehearsal';
  assert.throws(() => assertApplicationContext(f.context, f.audit, now));
  f.context.target.branchId = f.context.backup.restoredBranchId;
  assertApplicationContext(f.context, f.audit, now);
  f.context.target.branchId = f.context.backup.branchId;
  assert.throws(() => assertApplicationContext(f.context, f.audit, now));
});
test('read-only inventory/audit statements retain the shared catalog and keep business rows on the server', async () => {
  const { inventoryQueries, auditQueries, fullCatalogQueries, parseAudit } = await import(script);
  const inventory = ['migrations','tables','syrve_integrations','clients'].map(table => ({ table, kind: 'r' }));
  const q = auditQueries(inventory);
  assert.ok(q.sqlStatements.includes('SET TRANSACTION READ ONLY'));
  assert.ok(q.sqlStatements.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'));
  assert.ok(q.sqlStatements.every(sql => /^(SET |SELECT )/.test(sql)));
  assert.equal(Object.keys(fullCatalogQueries()).length, 6);
  assert.ok(Object.values(fullCatalogQueries()).every(sql => !sql.includes('$1')));
  assert.doesNotMatch(q.sqlStatements[q.tags.indexOf('entities')], /SELECT \*|SELECT api_login_encrypted/);
  const customerQuery = q.sqlStatements[q.tags.indexOf('hash.business.clients')];
  assert.match(customerQuery, /pg_catalog\.sha256/); assert.match(customerQuery, /FROM public\."clients"/);
  assert.throws(() => parseAudit(q, []));
  assert.equal(inventoryQueries().tags.at(-1), 'inventory');
  for (const kind of ['f','p','m','c']) assert.throws(() => auditQueries([...inventory, { table: 'unsupported', kind }]));
});
test('migration compiler preserves native conditional checks and compiles only the selected frozen step', async () => {
  const { compilePendingMigration } = await import(script);
  const configuration = await compilePendingMigration(SYRVE_SCHEMA_STEPS[1]);
  assert.match(configuration.join('\n'), /IF NOT coalesce/);
  assert.match(configuration.join('\n'), /count\(\*\) <= 1/);
  assert.doesNotMatch(configuration.join('\n'), /DELETE|TRUNCATE|DROP TABLE/);
  assert.equal(configuration.filter(sql => sql.startsWith('INSERT INTO public.migrations')).length, 1);
  const canonical = await compilePendingMigration(SYRVE_SCHEMA_STEPS[3]);
  assert.match(canonical.join('\n'), /SELECT NOT "hasDuplicates"/);
  assert.doesNotMatch(canonical.join('\n'), /UPDATE .*table_number/);
});
test('--apply is refused before reading input or opening a connection', () => {
  const r = spawnSync(process.execPath, [resolve(__dirname, script), '--apply', '/does-not-exist'], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /--apply is refused/); assert.doesNotMatch(r.stderr, /ENOENT|ECONN|postgres:\/\//);
});
test('database validation rejects remote/unverified environment before connecting', async () => {
  const { runSyrveApplicationValidation } = await import('../scripts/syrve-schema-application-validation.mjs');
  await assert.rejects(runSyrveApplicationValidation({}), /disabled/);
  await assert.rejects(runSyrveApplicationValidation({ FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_HOST: 'remote.neon.tech', DB_NAME: 'molo_fresh_schema_reference', DB_SYNCHRONIZE: 'true' }), /loopback|localhost/);
});
test('reviewed build identity rejects an invented SHA, dirty checkout, stale disk and stale loaded modules', async () => {
  const { verifyBuildIdentity, artifactFingerprint } = await import('../scripts/syrve-application-build.mjs');
  const files = { 'syrve/schema.js': '1'.repeat(64), 'migrations/frozen.js': '2'.repeat(64) };
  const fingerprint = artifactFingerprint(files), commit = 'a'.repeat(40), tree = 'b'.repeat(40);
  const record = { version: 1, sourceCommit: commit, sourceTree: tree, artifactFingerprint: fingerprint, files };
  const checkout = { commit, tree, dirty: false };
  assert.equal(verifyBuildIdentity(commit, record, checkout, files, fingerprint).sourceCommit, commit);
  for (const args of [
    ['c'.repeat(40), record, checkout, files, fingerprint],
    [commit, record, {...checkout, dirty:true}, files, fingerprint],
    [commit, record, {...checkout, commit:'c'.repeat(40)}, files, fingerprint],
    [commit, record, {...checkout, tree:'c'.repeat(40)}, files, fingerprint],
    [commit, record, checkout, {...files, 'migrations/frozen.js':'3'.repeat(64)}, fingerprint],
    [commit, record, checkout, files, '3'.repeat(64)],
    [commit, {...record, files:{...files,'stale.js':'4'.repeat(64)}}, checkout, files, fingerprint],
  ]) assert.throws(() => verifyBuildIdentity(...args));
});
