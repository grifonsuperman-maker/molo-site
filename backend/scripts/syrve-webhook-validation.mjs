import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveWebhookValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Webhook validation requires the validated process environment.');
  const require = createRequire(import.meta.url), { DataSource } = require('typeorm');
  const { SyrveSettingsStore, settingsVersion } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveActivationStore } = require('../dist/syrve/syrve-activation.store.js');
  const { SyrveWebhookService } = require('../dist/syrve/syrve-webhook.service.js');
  const { SyrveStateStore, syrveCaptureContext } = require('../dist/syrve/syrve-state.store.js');
  const { SyrveClient } = require('../dist/syrve/syrve-client.js');
  const { parseSyrveWebhookBatch } = require('../dist/syrve/syrve-webhook.js');
  const { batchTransport } = require('../test/helpers/syrve-batch-transport.js');
  const { consentDatabase } = require('../test/helpers/syrve-confirmed-worker.js');
  const { row, id } = require('../test/helpers/syrve-state-fixtures.js');
  const options = { type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432), username: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME, synchronize: false,
    entities: [fileURLToPath(new URL('../dist/**/*.entity.js', import.meta.url))],
    extra: { application_name: 'syrve-webhook-ci', connectionTimeoutMillis: 5000, statement_timeout: 10000 } };
  const source = new DataSource(options), other = new DataSource(options);
  await source.initialize(); await other.initialize();
  const org = randomUUID(), physical = [randomUUID(), randomUUID(), randomUUID()], providers = [randomUUID(), randomUUID(), randomUUID()];
  const bill = randomUUID(), second = randomUUID(), settings = db => new SyrveSettingsStore(db);
  const states = db => new SyrveStateStore(db, settings(db));
  const previousFetch = globalThis.fetch, secret = env.SYRVE_CREDENTIALS_SECRET;
  env.SYRVE_CREDENTIALS_SECRET = 'synthetic-webhook-ci-secret-only';
  const client = new SyrveClient(require('../test/helpers/syrve-test-request-limiter.js'));
  const service = (db, transport = client) => new SyrveWebhookService(db, settings(db), new SyrveActivationStore(db, settings(db)), transport);
  const tx = batchTransport(org, providers); globalThis.fetch = tx.fetch;
  // The production plan fingerprint uses canonical UUID order; preserve the
  // fixture's physical-index mapping while sorting its separate group plan.
  tx.plan.groups.forEach(group => { group.tableIds = [...group.tableIds].sort(); });
  let integrationId, bookingId, revision;
  const event = (table, orderId, status, timestamp) => ({ eventType: 'TableOrderUpdate', eventTime: '2026-10-12 10:00:00.123',
    organizationId: org, correlationId: randomUUID(), eventInfo: row({ organizationId: org, syrveTableId: providers[table] }, orderId, status, timestamp) });
  const receive = (...args) => service(source).receive(revision, [event(...args)]);
  const status = async () => (await source.query('SELECT id,status,updated_at::text FROM tables WHERE id=ANY($1::uuid[]) ORDER BY id', [physical]));
  const ledger = async () => ({ links: await source.query('SELECT * FROM syrve_table_links WHERE integration_id=$1 ORDER BY id', [integrationId]),
    states: await source.query('SELECT * FROM syrve_table_sync_states WHERE integration_id=$1 ORDER BY link_id', [integrationId]),
    versions: await source.query('SELECT v.* FROM syrve_order_versions v JOIN syrve_table_links l ON l.id=v.link_id WHERE l.integration_id=$1 ORDER BY v.link_id,v.order_id', [integrationId]) });
  const warm = (transport = client) => transport.probeLoadedOrderBatch('https://api-eu.syrve.live', 'synthetic-webhook-ci-login', org,
    providers.map(tableId => ({ tableId, orderIdBatches: [[]], visibilityContext: randomUUID() })),
    { loadingPlan: tx.plan, configurationRevision: revision, beforeCommand: async () => {} });
  const mark = async (index, value) => {
    await other.query('UPDATE tables SET status=$2,updated_at=clock_timestamp() WHERE id=$1', [physical[index], value]);
    await states(other).recordStaffAction(physical[index], 'status_changed');
  };
  try {
    assert.equal((await source.query('SELECT count(*)::int AS count FROM syrve_integrations'))[0].count, 0);
    for (const [index, table] of physical.entries()) await source.query('INSERT INTO tables(id,table_number,status) VALUES ($1,$2,$3)',
      [table, String(200_000_000 + Math.floor(Math.random() * 100_000) * 10 + index), ['cleaning', 'reserved', 'closed'][index]]);
    bookingId = (await source.query("INSERT INTO bookings(table_id,booking_date,booking_time,guests_count,status,source,guest_name) VALUES ($1,CURRENT_DATE,'21:00',2,'approved','admin_manual','Synthetic') RETURNING id", [physical[0]]))[0].id;
    const bookingBefore = await source.query('SELECT * FROM bookings WHERE id=$1', [bookingId]);
    integrationId = (await source.query("INSERT INTO syrve_integrations(display_name,organization_id,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES ('Synthetic webhook CI',$1,'connected','synthetic','synthetic','synthetic') RETURNING id", [org]))[0].id;
    for (const [index, table] of physical.entries()) await source.query('INSERT INTO syrve_table_links(integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,$3,$4,$5)', [integrationId, org, table, providers[index], index + 1]);
    await consentDatabase(source, settings(source)); revision = (await settings(source).read()).entity.configurationRevision;
    await warm();
    assert.equal((await receive(0, bill, 'New', 100)).statusesApplied, 1);
    assert.equal((await status()).find(value => value.id === physical[0]).status, 'occupied');
    assert.equal((await status()).find(value => value.id === physical[1]).status, 'reserved');
    await mark(0, 'cleaning'); const staffBefore = await status();
    assert.equal((await receive(0, bill, 'New', 100)).statusesApplied, 0);
    assert.equal((await receive(0, bill, 'Bill', 150)).statusesApplied, 0);
    assert.deepEqual(await status(), staffBefore);
    await receive(0, second, 'New', 160);
    assert.equal((await receive(0, bill, 'Closed', 200)).statusesApplied, 0);
    assert.equal((await receive(0, second, 'Closed', 201)).statusesApplied, 1);
    await mark(0, 'reserved'); const closedBefore = await status();
    assert.equal((await receive(0, second, 'Closed', 201)).statusesApplied, 0);
    assert.deepEqual(await status(), closedBefore);
    await receive(0, bill, 'New', 300); await receive(0, second, 'New', 301);
    assert.equal((await receive(1, bill, 'Bill', 400)).statusesApplied, 1, 'another source bill must remain occupied');
    assert.equal((await receive(0, second, 'Closed', 500)).statusesApplied, 1);
    await mark(1, 'cleaning'); const movedBefore = await status();
    assert.equal((await receive(1, bill, 'Bill', 400)).statusesApplied, 0);
    assert.equal((await receive(2, bill, 'Bill', 350)).statusesApplied, 0);
    assert.deepEqual(await status(), movedBefore);

    // A real private transport receipt cannot bypass the global version fence
    // on a physical destination that has never tracked this bill.
    const capture = await states(source).capture(physical[2]), lease = randomUUID();
    tx.setRows([row({ organizationId: org, syrveTableId: providers[2] }, bill, 'Bill', 350)]);
    const proof = (await client.probeLoadedOrderBatch('https://api-eu.syrve.live', 'synthetic-webhook-ci-login', org,
      [{ tableId: providers[2], orderIdBatches: [[]], visibilityContext: syrveCaptureContext(lease, capture) }],
      { loadingPlan: { organizationId: org, groups: [{ ...tx.plan.groups[0], tableIds: [providers[2]] }] },
        configurationRevision: revision, beforeCommand: async () => {} }))[0];
    const rejectedPoll = await settings(source).transaction(settingsVersion(await settings(source).read()), (manager, current) =>
      states(source).applyWorkerObservationInTransaction(manager, current, capture, [{ orderIds: [], probe: proof[0] }], lease));
    assert.ok(rejectedPoll.diagnostics.includes('stale_order')); assert.equal(rejectedPoll.changed, false);
    assert.deepEqual(await status(), movedBefore);
    tx.setRows([]); await warm();

    // Fail the second physical write after both ledgers were already staged.
    const beforeFailure = { physical: await status(), ledger: await ledger() };
    await source.query(`CREATE FUNCTION molo_syrve_webhook_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = '${physical[2]}'::uuid THEN RAISE EXCEPTION 'synthetic webhook failure'; END IF; RETURN NEW; END $$`);
    await source.query('CREATE TRIGGER webhook_ci_failure BEFORE UPDATE ON tables FOR EACH ROW EXECUTE FUNCTION molo_syrve_webhook_ci_fail()');
    await assert.rejects(receive(2, bill, 'Bill', 600), /synthetic webhook failure/);
    assert.deepEqual({ physical: await status(), ledger: await ledger() }, beforeFailure);
    await source.query('DROP FUNCTION molo_syrve_webhook_ci_fail() CASCADE');
    assert.equal((await receive(2, bill, 'Bill', 600)).statusesApplied, 2);

    const captured = await states(source).captureBatch(physical, settingsVersion(await settings(source).read()));
    await other.query("UPDATE tables SET updated_at=updated_at+interval '1 microsecond' WHERE id=$1", [physical[2]]);
    const fencedBefore = { physical: await status(), ledger: await ledger() };
    await assert.rejects(settings(source).transaction(settingsVersion(await settings(source).read()), (manager, current) =>
      states(source).applyWebhookOrdersInTransaction(manager, current, captured,
        parseSyrveWebhookBatch([event(1, bill, 'Bill', 700)]).orders, client.webhookTopology(org, revision))), error => error.getStatus() === 409);
    assert.deepEqual({ physical: await status(), ledger: await ledger() }, fencedBefore);
    await receive(1, bill, 'Bill', 700);
    const duplicates = await Promise.allSettled([source, other].map(db => service(db).receive(revision, [event(0, bill, 'Bill', 800)])));
    assert.ok(duplicates.some(value => value.status === 'fulfilled'));
    for (const value of duplicates) if (value.status === 'rejected') assert.equal(value.reason.getStatus(), 409);
    assert.equal((await status()).find(value => value.id === physical[0]).status, 'occupied');
    assert.equal((await status()).find(value => value.id === physical[1]).status, 'free');
    assert.equal((await receive(0, bill, 'Bill', 800)).statusesApplied, 0);
    assert.deepEqual(await source.query('SELECT * FROM bookings WHERE id=$1', [bookingId]), bookingBefore);

    const discovered = randomUUID();
    tx.setRows([row({ organizationId: org, syrveTableId: providers[0] }, bill, 'Bill', 800),
      row({ organizationId: org, syrveTableId: providers[0] }, discovered, 'New', 950)]);
    await warm();
    assert.equal((await receive(0, bill, 'Closed', 900)).statusesApplied, 0, 'uncommitted discovery blocks last-bill release');
    assert.equal((await receive(0, discovered, 'Closed', 960)).statusesApplied, 0);
    assert.equal((await receive(0, bill, 'Closed', 900)).statusesApplied, 1);
    tx.setRows([]); await warm();

    const pending = randomUUID(), unassociated = event(2, pending, 'New', 3000);
    unassociated.eventInfo.creationStatus = 'InProgress'; unassociated.eventInfo.order = null;
    await mark(2, 'cleaning'); const pendingBefore = await status();
    assert.equal((await service(source).receive(revision, [unassociated])).statusesApplied, 0);
    const pendingVersions = await source.query('SELECT count(*)::int AS count FROM syrve_order_versions WHERE order_id=$1 AND timestamp=3000 AND state=\'unknown\'', [pending]);
    assert.equal(pendingVersions[0].count, physical.length);
    const restartedClient = new SyrveClient(require('../test/helpers/syrve-test-request-limiter.js'));
    await warm(restartedClient);
    assert.equal((await service(other, restartedClient).receive(revision, [event(2, pending, 'New', 2900)])).statusesApplied, 0);
    assert.deepEqual(await status(), pendingBefore);
    await receive(2, pending, 'Closed', 3001);

    // Open and close delivered together remain two events with a final free
    // status, while equal-version contradictions apply no physical action.
    const combined = await service(source).receive(revision, [event(2, second, 'Closed', 1001), event(2, second, 'New', 1000)]);
    assert.equal(combined.statusesApplied, 2);
    assert.equal((await status()).find(value => value.id === physical[2]).status, 'free');
    const conflictBefore = await status(), conflicted = randomUUID();
    assert.equal((await service(source).receive(revision, [event(1, conflicted, 'New', 1002), event(2, conflicted, 'New', 1002)])).statusesApplied, 0);
    assert.deepEqual(await status(), conflictBefore);
    const cold = new SyrveClient(require('../test/helpers/syrve-test-request-limiter.js'));
    const unavailableBefore = { physical: await status(), ledger: await ledger() };
    await assert.rejects(service(other, cold).receive(revision, [event(0, bill, 'Closed', 1100)]), error => error.getStatus() === 503);
    assert.deepEqual({ physical: await status(), ledger: await ledger() }, unavailableBefore);
    await source.query('UPDATE syrve_sync_activation SET enabled=false WHERE integration_id=$1', [integrationId]);
    await assert.rejects(receive(0, bill, 'Closed', 1100), error => error.getStatus() === 409);
    assert.deepEqual(await status(), unavailableBefore.physical);
    assert.ok(tx.calls.every(call => !/(create|close|change|add|remove|update)/.test(call.path)), 'never write to POS');
    process.stdout.write('Syrve webhook PostgreSQL passed: two pools, duplicates, multiple bills, atomic transfer rollback, microsecond fence, stale poll protection, batch ordering, cold receipt and unchanged booking.\n');
  } finally {
    globalThis.fetch = previousFetch;
    secret === undefined ? delete env.SYRVE_CREDENTIALS_SECRET : env.SYRVE_CREDENTIALS_SECRET = secret;
    await source.query('DROP FUNCTION IF EXISTS molo_syrve_webhook_ci_fail() CASCADE');
    if (integrationId) await source.query('DELETE FROM syrve_integrations WHERE id=$1', [integrationId]);
    if (bookingId) await source.query('DELETE FROM bookings WHERE id=$1', [bookingId]);
    await source.query('DELETE FROM tables WHERE id=ANY($1::uuid[])', [physical]);
    await source.destroy(); await other.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runSyrveWebhookValidation().catch(error => {
  // This command is guarded to synthetic loopback CI. Preserve useful failure
  // details; production endpoints continue to sanitize provider/database errors.
  process.stderr.write('Syrve webhook PostgreSQL failed: ' + (error instanceof Error ? error.message : 'unknown test failure') + '\n'); process.exitCode = 1;
});
