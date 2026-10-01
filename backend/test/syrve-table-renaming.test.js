require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { Reflector } = require('@nestjs/core');
const { UnauthorizedException } = require('@nestjs/common');
const { getMetadataArgsStorage } = require('typeorm');
const { buildSyrveTableRenamePlan } = require('../dist/syrve/syrve-table-rename-plan.js');
const { SyrveTableRenamingService } = require('../dist/syrve/syrve-table-renaming.service.js');
const { SyrveTableRenamingController } = require('../dist/syrve/syrve-table-renaming.controller.js');
const { TablesService } = require('../dist/tables/tables.service.js');
const { repositoryStaffActions } = require('./helpers/repository-staff-actions.js');
const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { GuestBookingsService } = require('../dist/bookings/guest-bookings.service.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');
const { JwtAuthGuard } = require('../dist/auth/guards/jwt-auth.guard.js');
const { RolesGuard } = require('../dist/auth/guards/roles.guard.js');
const { ProtectCanonicalTableNumbers2026093000040: Migration, CANONICAL_TABLE_NUMBER_SQL_V1 } = require('../dist/migrations/2026093000040-ProtectCanonicalTableNumbers.js');

function fixture() {
  const organizationId = randomUUID(), integrationId = randomUUID();
  const tables = [{ id: randomUUID(), tableNumber: '12' }, { id: randomUUID(), tableNumber: '14' },
    { id: randomUUID(), tableNumber: '15' }];
  const providers = tables.map((row) => ({ id: randomUUID(), number: Number(row.tableNumber), isDeleted: false }));
  const links = tables.slice(0, 2).map((row, index) => ({ id: randomUUID(), integrationId, organizationId,
    moloTableId: row.id, syrveTableId: providers[index].id, lastKnownNumber: providers[index].number }));
  const identities = tables.map((row) => ({ tableId: row.id,
    mapKey: Number(row.tableNumber) <= 14 ? `hall:${row.tableNumber}` : `canopy:${row.tableNumber}` }));
  const catalog = { organization: { id: organizationId, name: 'Synthetic restaurant' }, tables: providers,
    terminalGroups: { active: [], sleeping: [] }, sectionsCount: 1 };
  return { tables, links, identities, catalog, integrationId, organizationId };
}
const plan = (value) => buildSyrveTableRenamePlan(value.catalog, value.tables, value.links, value.identities);

test('rename follows confirmed UUID even when the old number is reused by an unlinked table', () => {
  const value = fixture();
  value.tables[0].tableNumber = '77';
  value.tables[2].tableNumber = '12';
  value.catalog.tables[0].number = 99;
  value.catalog.tables.push({ id: randomUUID(), number: 80, isDeleted: false });
  const before = structuredClone(value);
  const result = plan(value);
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.changes[0], { moloTableId: value.tables[0].id, syrveTableId: value.links[0].syrveTableId,
    currentNumber: '77', targetNumber: '99', mapKey: 'hall:12', originalNumber: '12' });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(value, before);
});

test('occupied canonical numbers, including swaps and padded forms, block the full batch', () => {
  for (const target of ['15', ' 015 ', '\t0015\n']) {
    const value = fixture();
    value.tables[2].tableNumber = target;
    value.catalog.tables[0].number = 98;
    value.catalog.tables[1].number = 15;
    value.catalog.tables[2].number = 16;
    const result = plan(value);
    assert.equal(result.changes.length, 1);
    assert.equal(result.conflicts[0].code, 'number_in_use');
  }
  const value = fixture();
  value.catalog.tables[0].number = 14;
  value.catalog.tables[1].number = 12;
  assert.deepEqual(plan(value).conflicts.map((row) => row.code), ['number_in_use', 'number_in_use']);
});

test('missing/deleted provider UUIDs never remove, rebind or rename physical tables', () => {
  const value = fixture();
  value.catalog.tables[0].isDeleted = true;
  value.catalog.tables = value.catalog.tables.filter((row) => row.id !== value.links[1].syrveTableId);
  const result = plan(value);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.skipped.map((row) => row.code), ['deleted_syrve_table', 'missing_syrve_table']);
});

test('ambiguous provider IDs/numbers, invalid numbers and unbound physical slots fail closed', () => {
  for (const [mutate, code] of [
    [(v) => v.catalog.tables.push({ ...v.catalog.tables[0] }), 'duplicate_syrve_id'],
    [(v) => { v.catalog.tables[0].number = 99; v.catalog.tables.push({ id: randomUUID(), number: 99, isDeleted: false }); }, 'duplicate_syrve_number'],
    [(v) => { v.catalog.tables[0].number = 0; }, 'unsupported_syrve_number'],
    [(v) => { v.catalog.tables[0].number = 2_147_483_648; }, 'unsupported_syrve_number'],
    [(v) => { v.catalog.tables[0].number = 1.5; }, 'unsupported_syrve_number'],
    [(v) => { v.identities.shift(); }, 'missing_physical_identity'],
    [(v) => { v.identities[0].mapKey = 'hall:99'; }, 'missing_physical_identity'],
    [(v) => { v.links[0].organizationId = randomUUID(); }, 'foreign_organization'],
    [(v) => { v.tables.shift(); }, 'missing_molo_table'],
  ]) {
    const value = fixture(); mutate(value);
    assert.ok(plan(value).conflicts.some((row) => row.code === code), code);
  }
});

function harness({ physicalIdentityPrepared = true, numberUniquenessPrepared = true } = {}) {
  const value = fixture();
  value.catalog.tables[0].number = 99;
  const entity = { id: value.integrationId, configurationRevision: randomUUID(), organizationId: value.organizationId,
    status: 'connected', apiLoginEncrypted: 'synthetic-ciphertext', apiLoginIv: 'synthetic-iv', apiLoginAuthTag: 'synthetic-tag' };
  const queries = [], writes = [];
  const manager = { getRepository: () => ({ find: async () => structuredClone(value.tables) }), query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes('AS "physicalIdentityPrepared"')) return [{ physicalIdentityPrepared, numberUniquenessPrepared }];
    if (sql.startsWith('SELECT "table_id"')) return structuredClone(value.identities);
    if (sql.startsWith('UPDATE')) {
      writes.push(parameters);
      const table = value.tables.find((row) => row.id === parameters[0]);
      if (!table || table.tableNumber !== parameters[2]) return [[], 0];
      table.tableNumber = parameters[1]; return [[{ id: table.id }], 1];
    }
    return [];
  } };
  const snapshot = () => ({ prepared: true, entity: { ...entity }, links: structuredClone(value.links) });
  const settings = { read: async () => snapshot(), transaction: async (expected, action) => {
    assert.deepEqual(expected, { id: entity.id, revision: entity.configurationRevision });
    const before = structuredClone(value.tables);
    try { return await action(manager, snapshot()); }
    catch (error) { value.tables.splice(0, value.tables.length, ...before); throw error; }
  } };
  const db = { manager, options: { type: 'postgres', schema: 'public' } };
  return { ...value, value, entity, queries, writes, manager, settings, service: new SyrveTableRenamingService(db, settings) };
}

test('internal apply changes only the UUID-scoped number; fresh repeat is idempotent', async () => {
  const h = harness(), observation = await h.service.capture();
  const result = await h.service.applyCatalog(h.catalog, observation);
  assert.equal(result.renamed, 1);
  assert.equal(result.syncEnabled, false);
  assert.deepEqual(h.writes, [[h.tables[0].id, '99', '12']]);
  const sql = h.queries.find((row) => row.sql.startsWith('UPDATE')).sql;
  assert.doesNotMatch(sql, /status|zone|updated_at|insert|upsert/i);
  assert.equal((await h.service.applyCatalog(h.catalog, await h.service.capture())).renamed, 0);
  await assert.rejects(h.service.applyCatalog(h.catalog, observation), (error) => error.getStatus() === 409);
});

test('stale, expired, foreign-organization and disconnect observations write nothing', async () => {
  for (const mutate of [
    (h, o) => { h.value.tables[2].tableNumber = '80'; },
    (h, o) => { o.capturedAt = Date.now() - 300_001; },
    (h, o) => { h.catalog.organization.id = randomUUID(); },
    (h, o) => { h.entity.status = 'not_connected'; },
  ]) {
    const h = harness(), observation = await h.service.capture(); mutate(h, observation);
    await assert.rejects(h.service.applyCatalog(h.catalog, observation), (error) => error.getStatus() === 409);
    assert.equal(h.writes.length, 0);
  }
});

test('batch conflict rolls back all changes and schema prerequisites block capture', async () => {
  const h = harness();
  h.catalog.tables[1].number = 15;
  const observation = await h.service.capture();
  await assert.rejects(h.service.applyCatalog(h.catalog, observation), (error) => error.getStatus() === 409);
  assert.deepEqual(h.writes, []);
  for (const options of [{ physicalIdentityPrepared: false }, { numberUniquenessPrepared: false }]) {
    const unprepared = harness(options);
    await assert.rejects(unprepared.service.capture(), (error) => error.getStatus() === 503);
    assert.equal(unprepared.writes.length, 0);
    assert.equal((await unprepared.service.diagnostics()).renamingReady, false);
  }
});

test('diagnostics expose original/current label conflicts without credentials or order state', async () => {
  const h = harness(); h.tables[0].tableNumber = '99';
  const result = await h.service.diagnostics();
  assert.equal(result.renamingReady, true);
  assert.equal(result.renamingEnabled, false);
  assert.equal(result.summary.photoLabelConflicts, 1);
  assert.equal(result.links[0].originalNumber, '12');
  assert.equal(result.links[0].currentNumber, '99');
  assert.doesNotMatch(JSON.stringify(result), /ciphertext|synthetic-iv|synthetic-tag|apiLogin|OrderIds/);
  assert.ok(h.queries.every((row) => row.sql.startsWith('SELECT')));
  const fence = h.queries.find((row) => row.sql.includes('AS "physicalIdentityPrepared"'));
  assert.match(fence.sql, /p\.prosrc = \$4/);
  assert.equal(fence.parameters[3], CANONICAL_TABLE_NUMBER_SQL_V1);
});

test('prepared number-status actions cannot recreate a missing slot or mutate a reused number', async () => {
  let reads = 0, writes = 0;
  const repository = { findOne: async () => { reads++; return { id: 'different-uuid', tableNumber: '12' }; },
    save: async () => { writes++; }, create: () => { writes++; } };
  const service = new TablesService(repository, {}, {}, { project: async () => ({ prepared: true, tables: [] }) }, repositoryStaffActions(repository));
  for (const number of ['12', '99']) {
    await assert.rejects(service.setStatusByNumber(number, 'closed'), (error) => error.getStatus() === 409);
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
});

test('unprepared number-status action keeps its legacy create/status behavior', async () => {
  let current = null;
  const repository = { findOne: async (options) => current &&
    (options.where.id === current.id || options.where.tableNumber === current.tableNumber) ? { ...current } : null,
  create: (row) => ({ id: 'legacy-uuid', ...row }), save: async (patch) => {
    current = { ...current, ...patch }; return { ...current };
  } };
  const service = new TablesService(repository, {}, {}, { project: async () => ({ prepared: false, tables: [] }) }, repositoryStaffActions(repository));
  const result = await service.setStatusByNumber('12', 'closed');
  assert.equal(result.id, 'legacy-uuid'); assert.equal(result.tableNumber, '12'); assert.equal(result.status, 'closed');
});

test('waiter status saves do not overwrite a number changed after its initial read', async () => {
  for (const method of ['setWaiterStatus', 'setStatus']) {
    const current = { id: 'same-table', tableNumber: '12', status: 'free', zone: { id: 'same-zone' } };
    let reads = 0; const writes = [];
    const repository = { findOne: async () => {
      const copy = structuredClone(current);
      if (reads++ === 0) current.tableNumber = '99';
      return copy;
    }, save: async (patch) => { writes.push(patch); Object.assign(current, patch); return patch; } };
    const bookings = { find: async () => [] };
    const service = new TablesService(repository, {}, bookings, undefined, repositoryStaffActions(repository, bookings));
    const result = await service[method](current.id, 'occupied');
    assert.deepEqual(writes, [{ id: 'same-table', status: 'occupied' }]);
    assert.equal(result.tableNumber, '99'); assert.equal(result.status, 'occupied');
    assert.deepEqual(result.zone, { id: 'same-zone' });
  }
});

test('explicit table updates preserve a concurrent number and explain canonical conflicts', async () => {
  const current = { id: 'same-table', tableNumber: '12', seats: 4 };
  let reads = 0;
  const repository = { findOne: async () => {
    const copy = { ...current }; if (reads++ === 0) current.tableNumber = '99'; return copy;
  }, save: async (patch) => { Object.assign(current, patch); return patch; } };
  assert.equal((await new TablesService(repository, {}, {}).update(current.id, { seats: 6 })).tableNumber, '99');
  repository.save = async () => { throw { driverError: { code: '23505', constraint: 'UQ_tables_canonical_number' } }; };
  await assert.rejects(new TablesService(repository, {}, {}).update(current.id, { tableNumber: '15' }),
    (error) => error.getStatus() === 409 && /номер столу/.test(error.message));
});

test('booking status save retains a concurrent rename instead of saving its old entity number', async () => {
  const current = { id: 'same-table', tableNumber: '99', status: 'free' };
  const old = { ...current, tableNumber: '12' }, writes = [];
  const service = Object.create(BookingsService.prototype);
  service.tables = { save: async (patch) => { writes.push(patch); Object.assign(current, patch); return patch; } };
  await service.setTableStatus(old, 'reserved');
  assert.equal(current.tableNumber, '99'); assert.equal(current.status, 'reserved');
  assert.deepEqual(writes, [{ id: current.id, status: 'reserved' }]);
});

test('guest booking approval persists status without overwriting a concurrently renamed table', async () => {
  const current = { id: 'same-table', tableNumber: '12', status: 'free' }, writes = [];
  const repository = { findOne: async () => {
    const old = { ...current }; current.tableNumber = '99'; return old;
  }, save: async (patch) => { writes.push(patch); Object.assign(current, patch); return patch; } };
  const service = Object.create(GuestBookingsService.prototype);
  service.isToday = () => true;
  await service.applyBookingStatusToTable({ getRepository: () => repository }, current.id, '2099-09-30', 'approved');
  assert.equal(current.tableNumber, '99'); assert.equal(current.status, 'reserved');
  assert.deepEqual(writes, [{ id: current.id, status: 'reserved' }]);
});

function runner(duplicate = false, active = true) {
  const queries = [];
  return { queries, isTransactionActive: active, query: async (sql) => {
    queries.push(sql); return sql.includes('AS "hasDuplicates"') ? [{ hasDuplicates: duplicate }] : [];
  } };
}
test('number protection migration stops on duplicates and never repairs/deletes physical data', async () => {
  const db = runner(true);
  await assert.rejects(new Migration().up(db), /audited reconciliation/);
  assert.doesNotMatch(db.queries.join('\n'), /CREATE UNIQUE INDEX|UPDATE |DELETE |INSERT /);
  for (const direction of ['up', 'down']) {
    const inactive = runner(false, false);
    await assert.rejects(new Migration()[direction](inactive), /requires an active transaction/);
    assert.deepEqual(inactive.queries, []);
  }
});
test('expression index is migration-owned and absent from the production registry', () => {
  const metadata = getMetadataArgsStorage().indices.find((row) => row.target === TableEntity && row.name === 'UQ_tables_canonical_number');
  assert.equal(metadata.synchronize, false);
  const source = fs.readFileSync(require('node:path').resolve(__dirname, '../src/app.module.ts'), 'utf8');
  assert.doesNotMatch(source.split('const staffPinMigrationOptions = {')[1].split('};')[0], /ProtectCanonicalTableNumbers/);
  assert.match(source, /migrations: isDisposableSchemaReference[\s\S]*ProtectCanonicalTableNumbers/);
});

test('real JWT/role guards protect read-only diagnostics; no HTTP rename mutation exists', async (t) => {
  let calls = 0;
  const module = await Test.createTestingModule({ controllers: [SyrveTableRenamingController],
    providers: [{ provide: SyrveTableRenamingService, useValue: { diagnostics: async () => { calls++; return { syncEnabled: false }; } } }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new JwtAuthGuard(reflector, { verifyToken: async (token) => {
    if (token === 'invalid') throw new UnauthorizedException(); return { role: token };
  } }), new RolesGuard(reflector));
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const url = `${await app.getUrl()}/syrve-integration/table-renaming`;
  for (const [role, expected] of [[null, 401], ['invalid', 401], ['guest', 403], ['waiter', 403], ['hookah', 403], ['admin', 403], ['owner', 200]]) {
    const before = calls;
    const response = await fetch(url, { headers: role ? { Authorization: `Bearer ${role}` } : {} });
    assert.equal(response.status, expected); await response.text();
    assert.equal(calls - before, role === 'owner' ? 1 : 0);
    if (role === 'owner') assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const response = await fetch(url, { method, headers: { Authorization: 'Bearer owner' } });
    assert.equal(response.status, 404); await response.text();
  }
});

test('PostgreSQL rename probe refuses remote/unapproved databases before connection', async () => {
  const { runSyrveTableRenamingValidation } = await import('../scripts/syrve-table-renaming-validation.mjs');
  await assert.rejects(runSyrveTableRenamingValidation({}), /Fresh schema reference is disabled/);
  await assert.rejects(runSyrveTableRenamingValidation({ FRESH_SCHEMA_REFERENCE_ALLOW: 'true', DB_URL: 'postgres://remote/production' }), /refuses DB_URL/);
});
