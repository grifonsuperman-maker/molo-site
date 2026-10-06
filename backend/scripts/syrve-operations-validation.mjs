import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';
export async function runSyrveOperationsValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Operation validation requires the validated process environment.');
  const require = createRequire(import.meta.url), { DataSource } = require('typeorm');
  const { SyrveOperationsService } = require('../dist/syrve/syrve-operations.service.js');
  const { CreateSyrveOperations2026100700010: Migration } = require('../dist/migrations/2026100700010-CreateSyrveOperations.js');
  const schema = 'syrve_ops_ci_' + randomUUID().replaceAll('-', '');
  const options = { type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432), username: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME, schema, synchronize: false,
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 5000 } };
  const source = new DataSource(options), other = new DataSource(options); await source.initialize(); await other.initialize();
  const service = new SyrveOperationsService(source), restarted = new SyrveOperationsService(other);
  const actor = { sub: randomUUID(), role: 'owner', directorSessionVersion: 1 }; let finish;
  const migrate = direction => source.transaction(async manager => { await manager.query('SET LOCAL search_path TO "' + schema + '"'); await new Migration()[direction](manager.queryRunner); });
  try {
    await source.query('CREATE SCHEMA "' + schema + '"');
    await assert.rejects(service.start(actor, 'test', async () => assert.fail(), async () => actor), e => e.getStatus() === 503);
    await migrate('up');
    const blocked = new Promise(resolve => finish = resolve);
    const accepted = await service.start(actor, 'test', () => blocked, async () => actor);
    assert.equal((await restarted.read(accepted.operationId, actor)).status, 'running');
    await assert.rejects(restarted.start(actor, 'test', async () => assert.fail(), async () => actor), e => e.getStatus() === 409);
    await assert.rejects(restarted.read(accepted.operationId, { ...actor, sub: randomUUID() }), e => e.getStatus() === 404);
    await assert.rejects(migrate('down'), /live Syrve operations/);
    finish({ connected: true }); await service.onApplicationShutdown();
    // Shutdown may interrupt work already queued: it must never forge success.
    assert.ok(['done', 'failed'].includes((await restarted.read(accepted.operationId, actor)).status));
    const second = await restarted.start(actor, 'test', async () => ({ syncEnabled: false }), async () => actor);
    let result;
    for (let n = 0; n < 20; n++) { result = await service.read(second.operationId, actor); if (result.status !== 'running') break; }
    assert.equal(result.status, 'done'); assert.equal(result.result.syncEnabled, false);
    await restarted.onApplicationShutdown();
    await migrate('down'); await migrate('up'); await migrate('down');
    process.stdout.write('Syrve operations PostgreSQL passed: independent instances, ownership, duplicate exclusion, completion and rollback.\n');
  } finally {
    finish?.(); await service.onApplicationShutdown(); await restarted.onApplicationShutdown();
    await source.query('DROP SCHEMA "' + schema + '" CASCADE'); await source.destroy(); await other.destroy();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runSyrveOperationsValidation().catch(error => {
  process.stderr.write('Syrve operations PostgreSQL failed: ' + (error instanceof assert.AssertionError ? error.message : 'inspect isolated CI database') + '\n'); process.exitCode = 1;
});
