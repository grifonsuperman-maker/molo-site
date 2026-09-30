import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

// Run the actual compiled settings store and service on disposable PostgreSQL.
// Only the external catalog/health client is synthetic; no network is used.
export async function runSyrveMappingValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Syrve mapping validation must use process.env after safety validation.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { SyrveTableLink } = require('../dist/syrve/entities/syrve-table-link.entity.js');
  const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { FenceSyrveConfiguration2026093000020 } = require('../dist/migrations/2026093000020-FenceSyrveConfiguration.js');
  const source = new DataSource({ type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    synchronize: false, entities: [resolve(dirname(fileURLToPath(import.meta.url)), '../dist/**/*.entity.js')],
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 } });
  await source.initialize();
  const secretBefore = env.SYRVE_CREDENTIALS_SECRET;
  env.SYRVE_CREDENTIALS_SECRET = 'synthetic-syrve-confirmation-ci-secret';
  const tableIds = [randomUUID(), randomUUID(), randomUUID()];
  const organizationId = randomUUID(), syrveIds = [randomUUID(), randomUUID()];
  const number = 1_000_000 + Math.floor(Math.random() * 1_000_000);
  const input = { displayName: 'Syrve confirmation CI', apiBaseUrl: 'https://api-eu.syrve.live',
    apiLogin: 'synthetic-syrve-confirmation-login', organizationId, organizationName: 'Untrusted browser name' };
  let catalog = { organization: { id: organizationId, name: 'Verified CI restaurant' },
    terminalGroups: { active: [{ id: randomUUID(), name: 'Synthetic active terminal' }], sleeping: [] }, sectionsCount: 1,
    tables: syrveIds.map((id, index) => ({ id, number: number + index, name: 'Synthetic table', isDeleted: false,
      sectionId: organizationId, sectionName: 'CI', terminalGroupId: organizationId })) };
  const client = { normalizeBaseUrl: (url) => url,
    getCatalog: async () => structuredClone(catalog),
    checkOrganizations: async () => ({ organizations: [catalog.organization] }) };
  const store = new SyrveSettingsStore(source);
  const service = new SyrveIntegrationService(store, { create: async () => {} }, client, source.getRepository(TableEntity));
  const snapshot = () => source.query('SELECT * FROM "tables" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"', [tableIds]);
  const config = async () => (await source.query('SELECT * FROM "syrve_integrations"'))[0];
  const links = () => source.query('SELECT * FROM "syrve_table_links" ORDER BY "id"');
  const preview = (value = input) => service.previewTables(value);
  const dto = (value, previewValue, pairs = previewValue.proposals) => ({ ...value,
    confirmationProof: previewValue.confirmation.proof, pairs: pairs.map(({ moloTableId, syrveTableId }) => ({ moloTableId, syrveTableId })) });
  let integrationId;
  try {
    assert.equal((await config()), undefined, 'CI fixture requires no existing Syrve configuration');
    assert.equal((await links()).length, 0);
    const tableCount = Number((await source.query('SELECT count(*) AS count FROM "tables"'))[0].count);
    const initial = await service.getStatus();
    assert.equal(initial.settingsPrepared, true);
    assert.equal(await config(), undefined, 'status must not create settings');
    await source.query(`INSERT INTO "tables" ("id", "table_number", "status", "x", "rotation", "photo_url")
      VALUES ($1, $2, 'cleaning', 17, 45, '/existing-ci-photo.jpg'), ($3, $4, 'closed', 22, 90, '/existing-ci-photo-2.jpg')`,
    [tableIds[0], String(number), tableIds[1], String(number + 2)]);
    const physicalBefore = await snapshot();
    const checked = await preview();
    assert.equal(checked.proposals.length, 1);
    assert.equal(checked.missingInMolo.some((table) => table.number === number + 1), true);
    assert.equal(await config(), undefined);
    const request = dto(input, checked);
    const concurrent = await Promise.allSettled([service.connect(request), service.connect(request)]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((result) => result.status === 'rejected').reason.getStatus(), 409);
    integrationId = concurrent.find((result) => result.status === 'fulfilled').value.integration.id;
    assert.equal((await links()).length, 1);
    assert.equal((await links())[0].syrve_table_id, syrveIds[0]);
    assert.equal((await links())[0].last_syrve_state, 'unknown');
    assert.deepEqual(await snapshot(), physicalBefore);
    assert.equal(Number((await source.query('SELECT count(*) AS count FROM "tables"'))[0].count), tableCount + 2);
    await assert.rejects(service.connect(request), (error) => error.getStatus() === 409);
    await assert.rejects(source.query('INSERT INTO "syrve_integrations" (display_name) VALUES ($1)', ['Duplicate CI settings']),
      (error) => error.code === '23505' && error.constraint === 'UQ_syrve_integrations_singleton');

    const stateBefore = await config();
    const unknown = await preview();
    await assert.rejects(service.connect(dto(input, unknown, [{ moloTableId: tableIds[2], syrveTableId: syrveIds[1] }])),
      (error) => error.getStatus() === 400);
    assert.deepEqual(await config(), stateBefore);
    const changed = await preview();
    await source.query('UPDATE "tables" SET table_number = $2 WHERE id = $1', [tableIds[0], String(number + 10)]);
    await assert.rejects(service.connect(dto(input, changed)), (error) => error.getStatus() === 409);
    assert.deepEqual(await config(), stateBefore);
    await source.query('UPDATE "tables" SET table_number = $2 WHERE id = $1', [tableIds[0], String(number)]);

    const beforeDuplicate = await preview();
    await source.query('INSERT INTO "tables" (id, table_number) VALUES ($1, $2)', [tableIds[2], String(number)]);
    await assert.rejects(service.connect(dto(input, beforeDuplicate)), (error) => error.getStatus() === 409);
    await source.query('DELETE FROM "tables" WHERE id = $1', [tableIds[2]]);
    const offline = await preview();
    client.getCatalog = async () => { throw new Error('synthetic offline'); };
    await assert.rejects(service.connect(dto(input, offline)), /synthetic offline/);
    assert.deepEqual(await config(), stateBefore);
    client.getCatalog = async () => structuredClone(catalog);

    // A real unique violation after a settings write rolls the whole transaction back.
    const current = await store.read();
    await assert.rejects(store.transaction({ id: current.entity.id, revision: current.entity.configurationRevision }, async (manager, value) => {
      await store.save(manager, { ...value.entity, displayName: 'Must roll back' });
      await manager.getRepository(SyrveTableLink).insert({ integrationId, organizationId, moloTableId: tableIds[1],
        syrveTableId: syrveIds[0], lastKnownNumber: number });
    }), (error) => error.getStatus() === 409 && /інший зв’язок/.test(error.message));
    assert.deepEqual(await config(), stateBefore);

    const orderId = randomUUID();
    await source.query(`UPDATE "syrve_table_links" SET last_syrve_state = 'open', active_syrve_order_ids = $1,
      manually_freed_syrve_order_ids = $1`, [[orderId]]);
    const linksBefore = await links();
    const oldRevision = (await service.getStatus()).configurationRevision;
    let ready, release;
    const started = new Promise((yes) => ready = yes);
    client.checkOrganizations = () => { ready(); return new Promise((yes) => release = yes); };
    const pending = service.recheck({ configurationRevision: oldRevision });
    await started;
    await service.disconnect({ configurationRevision: oldRevision });
    const disconnected = await config();
    release({ organizations: [catalog.organization] });
    await assert.rejects(pending, (error) => error.getStatus() === 409);
    assert.deepEqual(await config(), disconnected);
    assert.equal(disconnected.api_login_encrypted, null);
    assert.deepEqual(await links(), linksBefore);

    // Reconnect the same IDs with a different number: no renaming or state reset.
    catalog.tables[0].number = number + 10;
    const reconnect = await preview();
    assert.equal(reconnect.confirmedLinks.length, 1);
    await service.connect(dto(input, reconnect));
    assert.deepEqual(await links(), linksBefore);
    assert.deepEqual(await snapshot(), physicalBefore);
    const stable = await config();
    const otherInput = { ...input, organizationId: randomUUID() };
    catalog.organization = { id: otherInput.organizationId, name: 'Other CI restaurant' };
    const other = await preview(otherInput);
    await assert.rejects(service.connect(dto(otherInput, other)), (error) => error.getStatus() === 409);
    assert.deepEqual(await config(), stable);
    const migration = new FenceSyrveConfiguration2026093000020();
    await assert.rejects(source.transaction((manager) => migration.down(manager.queryRunner)), /confirmed mappings exist/);
    assert.deepEqual(await links(), linksBefore);

    // Legacy read and down/up data preservation are checked with the actual SQL.
    await source.query('DELETE FROM "syrve_table_links" WHERE integration_id = $1', [integrationId]);
    await source.transaction(async (manager) => {
      await migration.down(manager.queryRunner);
      const legacy = await store.read(manager);
      assert.equal(legacy.prepared, false);
      assert.equal(legacy.entity.apiLoginEncrypted, stable.api_login_encrypted);
      assert.equal(legacy.entity.configurationRevision, undefined);
      await migration.up(manager.queryRunner);
    });
    const reapplied = await config();
    assert.notEqual(reapplied.configuration_revision, stable.configuration_revision);
    const stripRevision = ({ configuration_revision, ...row }) => row;
    assert.deepEqual(stripRevision(reapplied), stripRevision(stable));
    assert.deepEqual(await snapshot(), physicalBefore);
  } finally {
    try {
      if (!integrationId) integrationId = (await source.query('SELECT id FROM "syrve_integrations" WHERE display_name = $1', [input.displayName]))[0]?.id;
      if (integrationId) await source.query('DELETE FROM "syrve_integrations" WHERE id = $1', [integrationId]);
      await source.query('DELETE FROM "tables" WHERE id = ANY($1::uuid[])', [tableIds]);
    } finally {
      if (secretBefore === undefined) delete env.SYRVE_CREDENTIALS_SECRET; else env.SYRVE_CREDENTIALS_SECRET = secretBefore;
      await source.destroy();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyrveMappingValidation().then(() => process.stdout.write('Syrve mapping confirmation PostgreSQL validation passed.\n'))
    .catch((error) => { console.error(`Syrve mapping validation failed: ${error.message}`); process.exitCode = 1; });
}
