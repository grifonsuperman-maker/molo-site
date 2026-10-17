import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

export async function runSyrveRequestLimitValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Quota validation must use the validated process environment.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { SyrveRequestLimiter, syrveRequestKey, syrveDirectoryRequestKey, syrveGroupedRequestKey } = require('../dist/syrve/syrve-request-limiter.js');
  const { CreateSyrveRequestLimits2026100600080: Migration } = require('../dist/migrations/2026100600080-CreateSyrveRequestLimits.js');
  const schema = 'quota_ci_' + randomUUID().replaceAll('-', '');
  const options = { type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432), username: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME, schema, synchronize: false,
    extra: { connectionTimeoutMillis: 5_000, statement_timeout: 5_000, application_name: 'syrve-quota-ci' } };
  let source = new DataSource(options); await source.initialize();
  const other = new DataSource(options); await other.initialize();
  const table = '"' + schema + '"."syrve_request_limits"', key = syrveRequestKey('synthetic-quota-ci-' + randomUUID());
  const migrate = fn => source.transaction(async manager => {
    await manager.query('SET LOCAL search_path TO "' + schema + '"');
    await new Migration()[fn](manager.queryRunner);
  });
  try {
    await source.query('CREATE SCHEMA "' + schema + '"');
    await assert.rejects(new SyrveRequestLimiter(source).acquire(key), e => e.reason === 'unavailable');
    await migrate('up');
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
      new SyrveRequestLimiter(index % 2 ? source : other).acquire(key, { deadline: Date.now() + 800 })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.reason === 'limited'));
    const [row] = await source.query('SELECT EXTRACT(EPOCH FROM (next_request_at-clock_timestamp())) AS seconds FROM ' + table + ' WHERE key_hash=$1', [key]);
    assert.ok(Number(row.seconds) > 29 && Number(row.seconds) <= 31);
    await source.destroy(); source = new DataSource(options); await source.initialize();
    await assert.rejects(new SyrveRequestLimiter(source).acquire(key, { deadline: Date.now() + 100 }), e => e.reason === 'limited');
    await assert.rejects(new SyrveRequestLimiter(source).acquire(key, { group: 'directories', deadline: Date.now() + 100 }), e => e.reason === 'limited');
    await new SyrveRequestLimiter(other).cooldown(key, 180_000);
    await new SyrveRequestLimiter(source).cooldown(key, 60_000);
    const [cooled] = await source.query('SELECT EXTRACT(EPOCH FROM (next_request_at-clock_timestamp())) AS seconds FROM ' + table + ' WHERE key_hash=$1', [key]);
    assert.ok(Number(cooled.seconds) > 179 && Number(cooled.seconds) <= 180);
    await assert.rejects(new SyrveRequestLimiter(other).acquire(key, { group: 'directories', deadline: Date.now() + 100 }), e => e.reason === 'limited');
    const orderGroups = ['Orders: loading data', 'Orders: receiving', 'POS: availability'];
    for (const group of orderGroups) await assert.rejects(new SyrveRequestLimiter(other).acquire(key,
      { group, deadline: Date.now() + 100 }), e => e.reason === 'limited');
    const directoryLogin = syrveRequestKey('synthetic-directory-ci-' + randomUUID());
    const directoryResults = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
      new SyrveRequestLimiter(index % 2 ? source : other).acquire(directoryLogin,
        { group: 'directories', deadline: Date.now() + 800 })));
    assert.equal(directoryResults.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(directoryResults.filter(result => result.status === 'rejected').every(result => result.reason.reason === 'limited'));
    const [directoryRow] = await source.query('SELECT EXTRACT(EPOCH FROM (next_request_at-clock_timestamp())) AS seconds FROM ' + table
      + ' WHERE key_hash=$1', [syrveDirectoryRequestKey(directoryLogin)]);
    assert.ok(Number(directoryRow.seconds) > 4 && Number(directoryRow.seconds) <= 6.1);
    // Listing reserves 6.1 seconds, not the previous 31-second order slot.
    await assert.rejects(new SyrveRequestLimiter(other).acquire(directoryLogin,
      { deadline: Date.now() + 100 }), e => e.reason === 'limited');
    await source.query('UPDATE ' + table + " SET next_request_at=clock_timestamp()-interval '1 second' WHERE key_hash=$1", [directoryLogin]);
    await new SyrveRequestLimiter(other).acquire(directoryLogin, { deadline: Date.now() + 800 });
    await new SyrveRequestLimiter(source).cooldown(directoryLogin, 180_000);
    await assert.rejects(new SyrveRequestLimiter(other).acquire(directoryLogin,
      { group: 'directories', deadline: Date.now() + 100 }), e => e.reason === 'limited');
    const groupLogin = syrveRequestKey('synthetic-order-groups-ci-' + randomUUID());
    for (const group of orderGroups) {
      await source.query('UPDATE ' + table + " SET next_request_at=clock_timestamp()-interval '1 second' WHERE key_hash=$1", [groupLogin]);
      const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
        new SyrveRequestLimiter(index % 2 ? source : other).acquire(groupLogin, { group, deadline: Date.now() + 800 })));
      assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
      assert.ok(attempts.filter(value => value.status === 'rejected').every(value => value.reason.reason === 'limited'));
      const [groupRow] = await source.query('SELECT EXTRACT(EPOCH FROM (next_request_at-clock_timestamp())) AS seconds FROM ' + table
        + ' WHERE key_hash=$1', [syrveGroupedRequestKey(groupLogin, group)]);
      assert.ok(Number(groupRow.seconds) > 29 && Number(groupRow.seconds) <= 31);
      // Advance only the isolated shared pacing row. The group must stay used.
      await source.query('UPDATE ' + table + " SET next_request_at=clock_timestamp()-interval '1 second' WHERE key_hash=$1", [groupLogin]);
      await assert.rejects(new SyrveRequestLimiter(other).acquire(groupLogin,
        { group, deadline: Date.now() + 100 }), e => e.reason === 'limited');
      const [barrier] = await source.query('SELECT next_request_at<clock_timestamp() AS expired FROM ' + table + ' WHERE key_hash=$1', [groupLogin]);
      assert.equal(barrier.expired, true);
    }
    const mixedLogin = syrveRequestKey('synthetic-mixed-groups-ci-' + randomUUID());
    const mixed = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
      new SyrveRequestLimiter(index % 2 ? source : other).acquire(mixedLogin,
        { group: orderGroups[index % orderGroups.length], deadline: Date.now() + 800 })));
    assert.equal(mixed.filter(value => value.status === 'fulfilled').length, 1);
    assert.ok(mixed.filter(value => value.status === 'rejected').every(value => value.reason.reason === 'limited'));
    await assert.rejects(migrate('down'), /live Syrve quota/);
    const [active] = await other.query("SELECT count(*) AS total FROM pg_stat_activity WHERE application_name='syrve-quota-ci' AND state='idle in transaction'");
    assert.equal(Number(active.total), 0);
    // Only this isolated synthetic row is advanced; no production data or calls.
    await source.query('UPDATE ' + table + " SET next_request_at=clock_timestamp()-interval '1 second' WHERE key_hash=$1", [key]);
    await new SyrveRequestLimiter(source).acquire(key, { deadline: Date.now() + 800 });
    await source.query('UPDATE ' + table + " SET next_request_at=clock_timestamp()-interval '1 second'");
    await migrate('down'); await migrate('up'); await migrate('down');
    process.stdout.write('Syrve quota PostgreSQL validation passed: documented order/POS groups, global admission, concurrency, restart, legacy barrier, cooldown and guarded rollback.\n');
  } finally {
    try { await source.query('DROP SCHEMA "' + schema + '" CASCADE'); }
    finally { await source.destroy(); await other.destroy(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyrveRequestLimitValidation().catch(error => {
    const code = error?.driverError?.code || error?.code;
    const detail = error instanceof assert.AssertionError ? error.message : /^[0-9A-Z]{5}$/.test(code || '') ? 'SQLSTATE ' + code : 'inspect the isolated CI database';
    process.stderr.write('Syrve quota validation failed: ' + detail + '.\n'); process.exitCode = 1;
  });
}
