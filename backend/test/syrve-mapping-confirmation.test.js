require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getMetadataArgsStorage } = require('typeorm');
const { settingsHarness } = require('./helpers/syrve-settings-harness.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
const { SyrveIntegration } = require('../dist/syrve/entities/syrve-integration.entity.js');
const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
const { FenceSyrveConfiguration2026093000020 } = require('../dist/migrations/2026093000020-FenceSyrveConfiguration.js');
const ORG = 'a0000000-0000-4000-8000-000000000001';
const MOLO = 'a0000000-0000-4000-8000-000000000012';
const SYRVE = 'b0000000-0000-4000-8000-000000000012';
const OTHER = 'a0000000-0000-4000-8000-000000000077';
const INPUT = { displayName: 'MOLO', apiBaseUrl: 'https://api-eu.syrve.live', apiLogin: 'synthetic-api-login',
  organizationId: ORG, organizationName: 'Untrusted browser name' };
function setup(t) {
  const before = process.env.SYRVE_CREDENTIALS_SECRET;
  process.env.SYRVE_CREDENTIALS_SECRET = 'synthetic-separate-syrve-secret';
  t.after(() => before === undefined ? delete process.env.SYRVE_CREDENTIALS_SECRET : process.env.SYRVE_CREDENTIALS_SECRET = before);
  const h = settingsHarness([{ id: MOLO, tableNumber: '12' }]);
  let catalog = { organization: { id: ORG, name: 'Verified restaurant' }, terminalGroups: { active: [], sleeping: [] }, sectionsCount: 1,
    tables: [{ id: SYRVE, number: 12, name: '12', isDeleted: false, sectionId: ORG, sectionName: 'Зал', terminalGroupId: ORG },
      { id: OTHER, number: 77, name: '77', isDeleted: false, sectionId: ORG, sectionName: 'Зал', terminalGroupId: ORG }] };
  const client = { normalizeBaseUrl: (url) => url, getCatalog: async () => structuredClone(catalog),
    checkOrganizations: async () => ({ organizations: [catalog.organization] }) };
  const service = new SyrveIntegrationService(h.store, { create: async () => {} }, client, { find: async () => h.tables });
  const preview = () => service.previewTables(INPUT);
  const confirm = async (overrides = {}) => {
    const value = await preview();
    return service.connect({ ...INPUT, confirmationProof: value.confirmation.proof,
      pairs: value.proposals.map(({ moloTableId, syrveTableId }) => ({ moloTableId, syrveTableId })), ...overrides });
  };
  return { ...h, client, service, preview, confirm, catalog: () => catalog };
}

test('read-only preview issues a bounded receipt without settings/link writes or credentials', async (t) => {
  const h = setup(t);
  const value = await h.preview();
  assert.equal(value.mappingConfirmationAvailable, true);
  assert.equal(value.proposals.length, 1);
  assert.equal(value.missingInMolo[0].number, 77);
  assert.equal(h.entity(), null);
  assert.equal(h.links().length, 0);
  const payload = Buffer.from(value.confirmation.proof.split('.')[0], 'base64url').toString();
  assert.ok(!payload.includes(INPUT.apiLogin));
  assert.ok(Date.parse(value.confirmation.expiresAt) <= Date.now() + 300000);
});

test('explicit confirmation saves only the reviewed UUID pair and verified restaurant name', async (t) => {
  const h = setup(t);
  const result = await h.confirm();
  assert.equal(result.confirmedPairs, 1);
  assert.equal(result.integration.confirmedLinks, 1);
  assert.equal(h.links()[0].moloTableId, MOLO);
  assert.equal(h.links()[0].syrveTableId, SYRVE);
  assert.equal(h.links()[0].lastSyrveState, 'unknown');
  assert.equal(h.entity().organizationName, 'Verified restaurant');
  assert.notEqual(h.entity().apiLoginEncrypted, INPUT.apiLogin);
  assert.equal(result.integration.syncEnabled, false);
  assert.equal(h.tables.length, 1);
});

for (const [name, pairs] of [['unknown physical table', [{ moloTableId: OTHER, syrveTableId: SYRVE }]],
  ['unreviewed provider table', [{ moloTableId: MOLO, syrveTableId: OTHER }]],
  ['duplicate selection', [{ moloTableId: MOLO, syrveTableId: SYRVE }, { moloTableId: MOLO, syrveTableId: SYRVE }]]]) {
  test(`${name} rejects the whole transaction without creating a configuration or a table`, async (t) => {
    const h = setup(t);
    await assert.rejects(h.confirm({ pairs }), /унікальні запропоновані пари/);
    assert.equal(h.entity(), null);
    assert.equal(h.links().length, 0);
    assert.equal(h.tables.length, 1);
  });
}

test('a tampered or expired receipt is rejected before any provider read or write', async (t) => {
  const h = setup(t);
  const p = await h.preview();
  h.client.getCatalog = () => assert.fail('must reject before upstream');
  await assert.rejects(h.service.connect({ ...INPUT, pairs: [], confirmationProof: `x${p.confirmation.proof}` }), /застаріла або недійсна/);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 300001);
  await assert.rejects(h.service.connect({ ...INPUT, pairs: [], confirmationProof: p.confirmation.proof }), /застаріла або недійсна/);
  assert.equal(h.entity(), null);
});

for (const changed of ['credentials', 'provider number', 'provider deletion', 'MOLO number', 'new duplicate MOLO number']) {
  test(`changing ${changed} after preview requires another review and preserves settings`, async (t) => {
    const h = setup(t);
    const p = await h.preview();
    const input = { ...INPUT, confirmationProof: p.confirmation.proof, pairs: [{ moloTableId: MOLO, syrveTableId: SYRVE }] };
    if (changed === 'credentials') input.apiLogin = 'different-synthetic-login';
    if (changed === 'provider number') h.catalog().tables[0].number = 14;
    if (changed === 'provider deletion') h.catalog().tables[0].isDeleted = true;
    if (changed === 'MOLO number') h.tables[0].tableNumber = '14';
    if (changed === 'new duplicate MOLO number') h.tables.push({ id: randomUUID(), tableNumber: '0012' });
    await assert.rejects(h.service.connect(input), /змінилися/);
    assert.equal(h.entity(), null);
    assert.equal(h.links().length, 0);
  });
}

test('a repeated receipt and simultaneous initial confirmations have exactly one winner', async (t) => {
  const h = setup(t);
  const p = await h.preview();
  const dto = { ...INPUT, pairs: [{ moloTableId: MOLO, syrveTableId: SYRVE }], confirmationProof: p.confirmation.proof };
  const results = await Promise.allSettled([h.service.connect(dto), h.service.connect(dto)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /змінилися/);
  assert.equal(h.links().length, 1);
  const before = h.snapshot();
  await assert.rejects(h.service.connect(dto), /змінилися/);
  assert.deepEqual(h.snapshot(), before);
});

test('offline confirmation never damages saved settings or persistent links', async (t) => {
  const h = setup(t);
  await h.confirm();
  const p = await h.preview();
  const before = h.snapshot();
  h.client.getCatalog = async () => { throw new Error('synthetic offline'); };
  await assert.rejects(h.service.connect({ ...INPUT, pairs: [], confirmationProof: p.confirmation.proof }), /offline/);
  assert.deepEqual(h.snapshot(), before);
});

test('persisted IDs survive provider renumbering, reconnect and disconnect with active overrides intact', async (t) => {
  const h = setup(t);
  await h.confirm();
  const order = randomUUID();
  Object.assign(h.links()[0], { lastSyrveState: 'open', activeSyrveOrderIds: [order], manuallyFreedSyrveOrderIds: [order] });
  const before = structuredClone(h.links());
  h.catalog().tables[0].number = 14;
  const preview = await h.preview();
  assert.equal(preview.proposals.length, 0);
  assert.equal(preview.confirmedLinks[0].syrveTableId, SYRVE);
  await h.service.disconnect({ configurationRevision: h.entity().configurationRevision });
  assert.deepEqual(h.links(), before);
  await h.confirm();
  assert.deepEqual(h.links(), before);
  assert.equal(h.tables[0].tableNumber, '12');
});

for (const fails of [false, true]) {
  test(`late recheck ${fails ? 'failure' : 'success'} cannot undo a newer disconnect`, async (t) => {
    const h = setup(t);
    await h.confirm();
    let resolve, reject;
    h.client.checkOrganizations = () => new Promise((yes, no) => { resolve = yes; reject = no; });
    const pending = h.service.recheck({ configurationRevision: h.entity().configurationRevision });
    while (!resolve) await new Promise((yes) => setImmediate(yes));
    await h.service.disconnect({ configurationRevision: h.entity().configurationRevision });
    const before = h.snapshot();
    if (fails) reject(new Error('upstream failed')); else resolve({ organizations: [h.catalog().organization] });
    await assert.rejects(pending, /змінилися/);
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.entity().apiLoginEncrypted, null);
  });
}

test('changing restaurants never replaces existing UUID links', async (t) => {
  const h = setup(t);
  await h.confirm();
  h.catalog().organization = { id: OTHER, name: 'Other restaurant' };
  const p = await h.service.previewTables({ ...INPUT, organizationId: OTHER });
  const before = h.snapshot();
  await assert.rejects(h.service.connect({ ...INPUT, organizationId: OTHER, pairs: [], confirmationProof: p.confirmation.proof }), /іншому ресторану/);
  assert.deepEqual(h.snapshot(), before);
});

test('legacy settings remain readable without migration-owned columns or writes', async () => {
  const columns = [];
  const row = { id: ORG, status: 'not_connected' };
  const query = { select: (value) => { columns.push(...value); return query; }, orderBy: () => query, take: () => query,
    addSelect: () => assert.fail('must not select unavailable revision'), getMany: async () => [row] };
  const store = new SyrveSettingsStore({ manager: { query: async () => [{ present: true, prepared: false }],
    getRepository: (entity) => { assert.equal(entity, SyrveIntegration); return { createQueryBuilder: () => query }; } } });
  const result = await store.read();
  assert.equal(result.prepared, false);
  assert.equal(result.entity, row);
  assert.deepEqual(result.links, []);
  assert.ok(columns.every((column) => !column.includes('Revision')));
  assert.equal(getMetadataArgsStorage().tables.find((table) => table.target === SyrveIntegration).synchronize, false);
});

for (const code of ['23505', '23503', '55P03', '57014']) {
  test(`database ${code} becomes a controlled Ukrainian conflict`, async () => {
    const store = new SyrveSettingsStore({ transaction: async () => { throw { driverError: { code } }; } });
    await assert.rejects(store.transaction({ id: null, revision: null }, () => assert.fail()),
      (error) => error.getStatus() === 409 && !error.message.includes(code));
  });
}

test('singleton migration refuses duplicate configurations without deleting data', async () => {
  const queries = [];
  await assert.rejects(new FenceSyrveConfiguration2026093000020().up({ isTransactionActive: true,
    query: async (sql) => { queries.push(sql); return [{ count: 2 }]; } }), /audited reconciliation/);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((sql) => !/DELETE|DROP|ALTER/.test(sql)));
});

test('configuration migration rollback requires a transaction and retains confirmed links', async () => {
  const migration = new FenceSyrveConfiguration2026093000020();
  await assert.rejects(migration.down({ isTransactionActive: false }), /requires an active transaction/);
  const queries = [];
  await assert.rejects(migration.down({ isTransactionActive: true,
    query: async (sql) => { queries.push(sql); return [{ hasLinks: true }]; } }), /confirmed mappings exist/);
  assert.equal(queries.length, 2);
});

test('configuration fencing stays outside production startup until reviewed schema adoption', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/app.module.ts'), 'utf8');
  const production = source.split('const staffPinMigrationOptions = {')[1].split('};')[0];
  assert.doesNotMatch(production, /FenceSyrveConfiguration|CreateSyrveTableLinks/);
  assert.match(source, /migrations: isDisposableSchemaReference[\s\S]*FenceSyrveConfiguration2026093000020/);
});

test('PostgreSQL confirmation probe rejects remote or unapproved targets before connecting', async () => {
  const { runSyrveMappingValidation } = await import('../scripts/syrve-mapping-validation.mjs');
  await assert.rejects(runSyrveMappingValidation({}), /Fresh schema reference is disabled/);
  await assert.rejects(runSyrveMappingValidation({ FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_URL: 'postgres://remote/production' }), /refuses DB_URL/);
});
