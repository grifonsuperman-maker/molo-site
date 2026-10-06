import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveBatchValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Batch validation requires the validated process environment.');
  const require = createRequire(import.meta.url), { DataSource } = require('typeorm');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveActivationStore } = require('../dist/syrve/syrve-activation.store.js');
  const { SyrveWorkerStore } = require('../dist/syrve/syrve-worker.store.js');
  const { SyrveWorkerRunner } = require('../dist/syrve/syrve-worker.runner.js');
  const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
  const { SyrveClient } = require('../dist/syrve/syrve-client.js');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { batchTransport } = require('../test/helpers/syrve-batch-transport.js');
  const { consentDatabase } = require('../test/helpers/syrve-confirmed-worker.js');
  const { row, id } = require('../test/helpers/syrve-state-fixtures.js');
  const { SYRVE_OPERATION_BUDGET_MS } = require('../dist/syrve/syrve-operation-context.js');
  const options = { type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432), username: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME, synchronize: false,
    entities: [fileURLToPath(new URL('../dist/**/*.entity.js', import.meta.url))],
    extra: { application_name: 'syrve-batch-ci', connectionTimeoutMillis: 5000, statement_timeout: 10000 } };
  const source = new DataSource(options), other = new DataSource(options); await source.initialize(); await other.initialize();
  const org = randomUUID(), physical = Array.from({ length: 60 }, () => randomUUID()), providers = Array.from({ length: 60 }, () => randomUUID());
  const numbers = physical.map((_, index) => String(100_000_000 + index + Math.floor(Math.random() * 100_000) * 100));
  const secret = env.SYRVE_CREDENTIALS_SECRET, previousFetch = globalThis.fetch;
  env.SYRVE_CREDENTIALS_SECRET = 'synthetic-batch-ci-secret-only';
  let integrationId, bookingId, changed = false, mixed = false;
  const settings = db => new SyrveSettingsStore(db), store = db => new SyrveWorkerStore(db, settings(db));
  // Only the HTTP/quota fixture is synthetic. Captures, leases, guards, receipt
  // issuance and per-table transactional application use the production path.
  const client = new SyrveClient(require('../test/helpers/syrve-test-request-limiter.js'));
  const bridge = db => new SyrveIntegrationService(settings(db), {}, client, db.getRepository(TableEntity), new SyrveActivationStore(db, settings(db)));
  const run = () => new SyrveWorkerRunner(store(source), () => assert.fail('Per-table fallback used'),
    (captures, lease, controls) => bridge(source).probeWorkerBatch(captures, lease, controls), SYRVE_OPERATION_BUDGET_MS).run();
  const due = () => source.query("UPDATE syrve_worker_state SET next_attempt_at='-infinity' WHERE integration_id=$1", [integrationId]);
  const orders = status => providers.map((syrveTableId, index) => row({ organizationId: org, syrveTableId }, id(10000 + index), status, status === 'Closed' ? 200 : 100));
  const groups = [{ terminalGroupId: id(1), posVersion: '7.7.1', tableIds: providers.slice(0, 30) },
    { terminalGroupId: id(2), posVersion: '7.7.1', tableIds: providers.slice(30) }];
  let tx = batchTransport(org, providers, { rows: orders('New') });
  globalThis.fetch = async (url, request) => {
    const [active] = await other.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='syrve-batch-ci' AND state='idle in transaction'");
    assert.equal(active.count, 0);
    const path = new URL(url).pathname;
    if (path.endsWith('/by_table') && !changed && !mixed) {
      changed = true;
      // A booking writer may bypass the staff hook: fence full physical version.
      await other.query("UPDATE tables SET status='cleaning',updated_at=clock_timestamp() WHERE id=$1", [physical[0]]);
    }
    return tx.fetch(url, request);
  };
  try {
    assert.equal((await source.query('SELECT count(*)::int AS count FROM syrve_integrations'))[0].count, 0);
    for (const [index, table] of physical.entries()) await source.query("INSERT INTO tables(id,table_number,status) VALUES ($1,$2,'free')", [table, numbers[index]]);
    bookingId = (await source.query("INSERT INTO bookings(table_id,booking_date,booking_time,guests_count,status,source,guest_name) VALUES ($1,CURRENT_DATE,'21:00',2,'approved','admin_manual','Synthetic') RETURNING id", [physical[0]]))[0].id;
    const bookingBefore = await source.query('SELECT * FROM bookings WHERE id=$1', [bookingId]);
    const encrypted = bridge(source).encrypt('synthetic-batch-ci-login');
    integrationId = (await source.query("INSERT INTO syrve_integrations(display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES ('Synthetic batch CI',$1,'connected',$2,$3,$4) RETURNING id", [org, encrypted.encrypted, encrypted.iv, encrypted.authTag]))[0].id;
    for (const [index, table] of physical.entries()) await source.query('INSERT INTO syrve_table_links(integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,$5)', [integrationId, org, table, providers[index], index + 1]);
    await consentDatabase(source, settings(source));
    const claims = await Promise.all([store(source).claim(), store(other).claim()]);
    assert.deepEqual(claims.map(item => item.status).sort(), ['busy', 'claimed']);
    await store(source).release(claims.find(item => item.status === 'claimed').lease);
    const first = await run(); assert.equal(first.status, 'observed'); assert.equal(first.processed, 59);
    const statuses = await source.query('SELECT id,status FROM tables WHERE id=ANY($1::uuid[])', [physical]);
    assert.equal(statuses.find(item => item.id === physical[0]).status, 'cleaning');
    assert.equal(statuses.filter(item => item.status === 'occupied').length, 59);
    const [unconsumed] = await source.query('SELECT count(*)::int AS count FROM syrve_order_versions v JOIN syrve_table_links l ON l.id=v.link_id WHERE l.molo_table_id=$1', [physical[0]]);
    assert.equal(unconsumed.count, 0); assert.equal(tx.calls.length, 15);
    await due(); assert.equal((await run()).processed, 60);
    tx.setRows(orders('Closed')); await due(); assert.equal((await run()).processed, 60);
    assert.equal((await source.query("SELECT count(*)::int AS count FROM tables WHERE id=ANY($1::uuid[]) AND status='free'", [physical]))[0].count, 60);
    assert.deepEqual(await source.query('SELECT * FROM bookings WHERE id=$1', [bookingId]), bookingBefore);
    mixed = true;
    await source.query('UPDATE syrve_sync_activation SET loading_plan=$2::jsonb WHERE integration_id=$1', [integrationId, JSON.stringify({ organizationId: org, groups })]);
    tx = batchTransport(org, providers, { groups, rows: [...orders('Closed'), ...providers.map((syrveTableId, index) => row({ organizationId: org, syrveTableId }, id(20000 + index), 'New', 300))],
      override: path => path.endsWith('/is_alive') ? { correlationId: id(9001), isAliveStatus: groups.map((group, index) => ({ organizationId: org, terminalGroupId: group.terminalGroupId, isAlive: index === 0 })) } : undefined });
    await due(); const partial = await run(); assert.equal(partial.processed, 30);
    assert.equal((await source.query("SELECT count(*)::int AS count FROM tables WHERE id=ANY($1::uuid[]) AND status='occupied'", [physical.slice(0, 30)]))[0].count, 30);
    assert.equal((await source.query("SELECT count(*)::int AS count FROM tables WHERE id=ANY($1::uuid[]) AND status='free'", [physical.slice(30)]))[0].count, 30);
    assert.deepEqual(await source.query('SELECT * FROM bookings WHERE id=$1', [bookingId]), bookingBefore);
    process.stdout.write('Syrve batch PostgreSQL passed: 60 tables, two pools, physical-version fence, independent registers and unchanged booking.\n');
  } finally {
    globalThis.fetch = previousFetch;
    secret === undefined ? delete env.SYRVE_CREDENTIALS_SECRET : env.SYRVE_CREDENTIALS_SECRET = secret;
    if (integrationId) await source.query('DELETE FROM syrve_integrations WHERE id=$1', [integrationId]);
    if (bookingId) await source.query('DELETE FROM bookings WHERE id=$1', [bookingId]);
    await source.query('DELETE FROM tables WHERE id=ANY($1::uuid[])', [physical]);
    await source.destroy(); await other.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runSyrveBatchValidation().catch(error => {
  process.stderr.write('Syrve batch PostgreSQL failed: ' + (error instanceof assert.AssertionError ? error.message : 'inspect isolated CI database') + '\n'); process.exitCode = 1;
});
