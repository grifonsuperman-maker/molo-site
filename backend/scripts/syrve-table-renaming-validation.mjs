import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

// Real compiled service, real transactions/indexes, synthetic validated catalog.
// Separate namespace leaves all 60 actual bootstrap tables/bindings untouched.
export async function runSyrveTableRenamingValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Rename validation must use process.env after safety validation.');
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { TableEntity } = require('../dist/tables/entities/table.entity.js');
  const { Zone } = require('../dist/zones/entities/zone.entity.js');
  const { Booking } = require('../dist/bookings/entities/booking.entity.js');
  const { TableMapIdentityService } = require('../dist/tables/table-map-identity.service.js');
  const { TablesService } = require('../dist/tables/tables.service.js');
  const { SyrveSettingsStore } = require('../dist/syrve/syrve-settings.store.js');
  const { SyrveStaffActionsService } = require('../dist/syrve/syrve-staff-actions.service.js');
  const { SyrveTableRenamingService } = require('../dist/syrve/syrve-table-renaming.service.js');
  const { canonicalTableNumber } = require('../dist/tables/table-map-slots.js');
  const { ProtectCanonicalTableNumbers2026093000040: NumberMigration, CANONICAL_TABLE_NUMBER_SQL_V1 } = require('../dist/migrations/2026093000040-ProtectCanonicalTableNumbers.js');
  const { CreateTableMapIdentities2026093000030: IdentityMigration } = require('../dist/migrations/2026093000030-CreateTableMapIdentities.js');
  const schemaName = 'molo_rename_probe_' + randomUUID().replaceAll('-', '');
  const schema = '"' + schemaName + '"';
  const db = new DataSource({ type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    schema: schemaName, synchronize: false, entities: [fileURLToPath(new URL('../dist/**/*.entity.js', import.meta.url))],
    extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 } });
  await db.initialize();
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const organizationId = randomUUID(), integrationId = randomUUID(), revision = randomUUID();
  const providerIds = Array.from({ length: 3 }, () => randomUUID());
  const numberMigration = new NumberMigration(), identityMigration = new IdentityMigration();
  const migrate = (migration, direction) => db.transaction((manager) => migration[direction](manager.queryRunner));
  const physical = () => db.query('SELECT * FROM ' + schema + '."tables" ORDER BY "id"');
  const bindings = () => db.query('SELECT * FROM ' + schema + '."table_map_identities" ORDER BY "table_id"');
  const links = () => db.query('SELECT * FROM ' + schema + '."syrve_table_links" ORDER BY "id"');
  const bookings = () => db.query('SELECT * FROM ' + schema + '."bookings" ORDER BY "id"');
  const settings = () => db.query('SELECT * FROM ' + schema + '."syrve_integrations"');
  const publicSnapshot = async () => ({
    tables: await db.query('SELECT * FROM public."tables" ORDER BY "id"'),
    identities: await db.query('SELECT * FROM public."table_map_identities" ORDER BY "table_id"'),
    zones: await db.query('SELECT * FROM public."zones" ORDER BY "id"'),
  });
  const catalog = (first = 12, second = 14) => ({ organization: { id: organizationId, name: 'Synthetic restaurant' },
    terminalGroups: { active: [{ id: randomUUID(), name: 'Synthetic terminal' }], sleeping: [] }, sectionsCount: 1,
    tables: [first, second, 15].map((number, index) => ({ id: providerIds[index], number,
      name: 'Synthetic table', isDeleted: false, sectionId: organizationId, sectionName: 'Synthetic section', terminalGroupId: organizationId })) });
  const restoreNumbers = async () => {
    await db.query('UPDATE ' + schema + '."tables" SET "table_number"=fixture.number '
      + 'FROM unnest($1::uuid[], $2::text[]) AS fixture(id, number) WHERE "tables"."id"=fixture.id',
    [ids.slice(0, 4), ['12', '14', '15', '77']]);
  };
  let created = false;
  try {
    const baseline = await publicSnapshot();
    assert.equal(baseline.identities.length, 60);
    await db.query('CREATE SCHEMA ' + schema); created = true;
    for (const table of ['tables', 'zones', 'bookings', 'syrve_integrations', 'syrve_table_links']) {
      await db.query('CREATE TABLE ' + schema + '."' + table + '" (LIKE public."' + table + '" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)');
      await db.query('ALTER TABLE ' + schema + '."' + table + '" ADD PRIMARY KEY ("id")');
    }
    await db.query('CREATE UNIQUE INDEX "UQ_syrve_integrations_singleton" ON ' + schema + '."syrve_integrations" ((1))');
    await db.query('ALTER TABLE ' + schema + '."syrve_table_links" ADD UNIQUE ("molo_table_id"), ADD UNIQUE ("organization_id","syrve_table_id"), '
      + 'ADD FOREIGN KEY ("molo_table_id") REFERENCES ' + schema + '."tables" ("id") ON DELETE CASCADE, '
      + 'ADD FOREIGN KEY ("integration_id") REFERENCES ' + schema + '."syrve_integrations" ("id") ON DELETE CASCADE');
    await db.query('ALTER TABLE ' + schema + '."bookings" ADD FOREIGN KEY ("table_id") REFERENCES ' + schema + '."tables" ("id") ON DELETE SET NULL');
    await db.query('INSERT INTO ' + schema + '."tables" ("id","table_number","status","x","y","width","height","rotation","photo_url","is_visible") '
      + 'SELECT id, number, status::public.tables_status_enum, 27, 91, 170, 90, 13, \'/existing-photo.jpg\', visible '
      + 'FROM unnest($1::uuid[], $2::text[], $3::text[], $4::boolean[]) AS fixture(id, number, status, visible)',
    [ids, ['12', '14', '15', '77', '012'], ['free', 'cleaning', 'closed', 'occupied', 'free'], [true, false, true, true, true]]);
    const beforeDuplicate = await physical();
    await assert.rejects(migrate(numberMigration, 'up'), /Duplicate canonical table numbers/);
    assert.deepEqual(await physical(), beforeDuplicate);
    assert.equal((await db.query('SELECT to_regprocedure($1) IS NOT NULL AS present',
      [schema + '.molo_canonical_table_number(text)']))[0].present, false, 'Failed up rolls its function back.');
    await db.query('DELETE FROM ' + schema + '."tables" WHERE "id"=$1', [ids[4]]);
    const before = await physical();
    await migrate(numberMigration, 'up');
    assert.deepEqual(await physical(), before);
    const inputs = ['12', '0012', ' 012 ', '\t012\n', '\u00a00012\ufeff', '0', '0000', '-1', '1.5', '', 'table12', '1234567890123'];
    const normalized = await db.query('SELECT input, ' + schema + '.molo_canonical_table_number(input) AS number FROM unnest($1::text[]) AS fixture(input)', [inputs]);
    assert.deepEqual(normalized.map((row) => row.number), inputs.map(canonicalTableNumber));
    for (const duplicate of ['12', '0012', ' 012 ', '\t012\n', '\u00a00012\ufeff']) {
      await assert.rejects(db.query('INSERT INTO ' + schema + '."tables" ("id","table_number") VALUES ($1,$2)', [randomUUID(), duplicate]),
        (error) => error.code === '23505' && error.constraint === 'UQ_tables_canonical_number');
    }
    await migrate(identityMigration, 'up');
    await db.query('INSERT INTO ' + schema + '."syrve_integrations" ("id","configuration_revision","organization_id","status","api_login_encrypted","api_login_iv","api_login_auth_tag") '
      + 'VALUES ($1,$2,$3,\'connected\',\'synthetic-ciphertext\',\'synthetic-iv\',\'synthetic-tag\')', [integrationId, revision, organizationId]);
    for (let index = 0; index < 3; index++) {
      await db.query('INSERT INTO ' + schema + '."syrve_table_links" ("integration_id","organization_id","molo_table_id","syrve_table_id","last_known_number") '
        + 'VALUES ($1,$2,$3,$4,$5)', [integrationId, organizationId, ids[index], providerIds[index], [12, 14, 15][index]]);
    }
    const orderId = randomUUID();
    await db.query('UPDATE ' + schema + '."syrve_table_links" SET "last_syrve_state"=\'open\', "active_syrve_order_ids"=$1, "manually_freed_syrve_order_ids"=$1 WHERE "molo_table_id"=$2', [[orderId], ids[0]]);
    await db.query('INSERT INTO ' + schema + '."bookings" ("id","table_id","booking_date","booking_time","guests_count","status") VALUES ($1,$2,\'2099-09-30\',\'18:00\',2,\'approved\')', [randomUUID(), ids[0]]);
    const mapBefore = await bindings(), linksBefore = await links(), bookingsBefore = await bookings(), settingsBefore = await settings();
    const store = new SyrveSettingsStore(db), service = new SyrveTableRenamingService(db, store);
    const diagnostic = await service.diagnostics();
    assert.equal(diagnostic.renamingReady, true, JSON.stringify(diagnostic));
    assert.equal(diagnostic.renamingEnabled, false);
    const beforeDrift = await service.capture();
    for (const body of ['SELECT $1', 'SELECT NULL::text']) {
      // Identical name/signature/volatility with the wrong body is not prepared.
      await db.query('CREATE OR REPLACE FUNCTION ' + schema + '.molo_canonical_table_number(text) RETURNS text '
        + 'LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$' + body + '$$');
      assert.equal((await service.diagnostics()).numberUniquenessPrepared, false);
      await assert.rejects(service.capture(), (error) => error.getStatus() === 503);
      await assert.rejects(service.applyCatalog(catalog(99), beforeDrift), (error) => error.getStatus() === 503);
      assert.deepEqual(await physical(), before);
    }
    await db.query('CREATE OR REPLACE FUNCTION ' + schema + '.molo_canonical_table_number(text) RETURNS text '
      + 'LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$' + CANONICAL_TABLE_NUMBER_SQL_V1 + '$$');
    assert.equal((await service.diagnostics()).numberUniquenessPrepared, true);
    const observation = await service.capture();
    const result = await service.applyCatalog(catalog(99), observation);
    assert.equal(result.renamed, 1);
    for (const row of await physical()) {
      const original = before.find((item) => item.id === row.id);
      assert.deepEqual({ ...row, table_number: original.table_number }, original, 'Only table_number may change, including timestamps.');
    }
    assert.deepEqual(await bindings(), mapBefore); assert.deepEqual(await links(), linksBefore);
    assert.deepEqual(await bookings(), bookingsBefore); assert.deepEqual(await settings(), settingsBefore);
    const projected = await new TableMapIdentityService(db).project(await db.getRepository(TableEntity).find());
    assert.equal(projected.tables.find((row) => row.id === ids[0]).mapKey, 'hall:12');
    assert.equal(projected.tables.find((row) => row.id === ids[0]).tableNumber, '99');
    const adminTables = new TablesService(db.getRepository(TableEntity), db.getRepository(Zone),
      db.getRepository(Booking), new TableMapIdentityService(db), new SyrveStaffActionsService(db, store));
    const afterRename = await physical();
    await assert.rejects(adminTables.setStatusByNumber('12', 'closed'), (error) => error.getStatus() === 409);
    assert.deepEqual(await physical(), afterRename, 'A missing old label cannot create a second UUID.');
    await db.query('INSERT INTO ' + schema + '."tables" ("id","table_number") VALUES ($1,\'12\')', [ids[4]]);
    const withReusedNumber = await physical();
    await assert.rejects(adminTables.setStatusByNumber('12', 'closed'), (error) => error.getStatus() === 409);
    assert.deepEqual(await physical(), withReusedNumber, 'A stale number cannot change a different physical UUID.');
    await db.query('DELETE FROM ' + schema + '."tables" WHERE "id"=$1', [ids[4]]);
    assert.equal((await service.diagnostics()).summary.photoLabelConflicts, 1);
    assert.equal((await service.applyCatalog(catalog(99), await service.capture())).renamed, 0);
    await assert.rejects(service.applyCatalog(catalog(), observation), (error) => error.getStatus() === 409);
    await assert.rejects(migrate(identityMigration, 'down'), /non-reconstructable binding records/);
    await restoreNumbers();

    // A valid first change must not escape a conflicting second change.
    const beforeConflict = await physical();
    await assert.rejects(service.applyCatalog(catalog(98, 15), await service.capture()), (error) => error.getStatus() === 409);
    assert.deepEqual(await physical(), beforeConflict);
    // Inject a late PostgreSQL unique violation on the second update: the first
    // update must also roll back, with a controlled Ukrainian conflict response.
    await db.query('CREATE FUNCTION ' + schema + '.reject_second_probe_rename() RETURNS trigger LANGUAGE plpgsql AS $$ '
      + 'BEGIN IF NEW.table_number=\'99\' AND OLD.table_number=\'14\' THEN '
      + 'RAISE EXCEPTION \'synthetic late number conflict\' USING ERRCODE=\'23505\', CONSTRAINT=\'UQ_tables_canonical_number\'; '
      + 'END IF; RETURN NEW; END; $$');
    await db.query('CREATE TRIGGER "reject_second_probe_rename" BEFORE UPDATE ON ' + schema + '."tables" '
      + 'FOR EACH ROW EXECUTE FUNCTION ' + schema + '.reject_second_probe_rename()');
    await assert.rejects(service.applyCatalog(catalog(98, 99), await service.capture()),
      (error) => error.getStatus() === 409 && /номер столу/.test(error.message));
    assert.deepEqual(await physical(), beforeConflict);
    await db.query('DROP TRIGGER "reject_second_probe_rename" ON ' + schema + '."tables"');
    await db.query('DROP FUNCTION ' + schema + '.reject_second_probe_rename()');
    const absent = catalog(); absent.tables[0].isDeleted = true; absent.tables.splice(1, 1);
    assert.equal((await service.applyCatalog(absent, await service.capture())).renamed, 0);
    assert.deepEqual(await physical(), beforeConflict);

    // Concurrent observations cannot steal a target or revert a newer rename.
    const concurrentObservation = await service.capture();
    const outcomes = await Promise.allSettled([
      service.applyCatalog(catalog(99), concurrentObservation),
      service.applyCatalog(catalog(12, 99), concurrentObservation),
    ]);
    assert.equal(outcomes.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find((row) => row.status === 'rejected').reason.getStatus(), 409);
    assert.equal((await physical()).filter((row) => row.table_number === '99').length, 1);
    await restoreNumbers();
    const inserts = await Promise.allSettled([80, 80].map((number) => db.query(
      'INSERT INTO ' + schema + '."tables" ("id","table_number") VALUES ($1,$2)', [randomUUID(), String(number)])));
    assert.equal(inserts.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(inserts.find((row) => row.status === 'rejected').reason.code, '23505');
    await db.query('DELETE FROM ' + schema + '."tables" WHERE "table_number"=\'80\'');

    const stale = await service.capture();
    await db.query('UPDATE ' + schema + '."syrve_integrations" SET "configuration_revision"=gen_random_uuid(),"status"=\'not_connected\'');
    await assert.rejects(service.applyCatalog(catalog(99), stale), (error) => error.getStatus() === 409);
    assert.deepEqual(await physical(), beforeConflict);
    await db.query('UPDATE ' + schema + '."syrve_integrations" SET "configuration_revision"=$1,"status"=\'connected\'', [revision]);

    // A real staff transaction now serializes renames. Hold its settings/table
    // locks while starting an old rename; the staff fence must reject that
    // rename, and a fresh rename must preserve the committed occupied status.
    const repository = db.getRepository(TableEntity);
    const raceObservation = await service.capture();
    let signalHeld, rejectHeld, release;
    const held = new Promise((resolve, reject) => { signalHeld = resolve; rejectHeld = reject; });
    const released = new Promise((resolve) => { release = resolve; });
    const coordinator = new SyrveStaffActionsService(db, store);
    const pausedCoordinator = { run: (id, action, write) => coordinator.run(id, action, async (manager) => {
      await manager.getRepository(TableEntity).findOne({where:{id},lock:{mode:'pessimistic_write'}});
      signalHeld(); await released;
      return write(manager);
    }) };
    const waiter = new TablesService(repository, db.getRepository(Zone), db.getRepository(Booking), new TableMapIdentityService(db), pausedCoordinator);
    const manual = waiter.setWaiterStatus(ids[0], 'occupied'); manual.catch(rejectHeld);
    await held;
    const oldRename = service.applyCatalog(catalog(99), raceObservation);
    release();
    const raced = await Promise.allSettled([manual, oldRename]);
    assert.equal(raced[0].status, 'fulfilled'); assert.equal(raced[0].value.status, 'occupied');
    assert.equal(raced[1].status, 'rejected'); assert.equal(raced[1].reason.getStatus(), 409);
    assert.equal((await service.applyCatalog(catalog(99), await service.capture())).renamed, 1);
    const occupied = await repository.findOne({where:{id:ids[0]}});
    assert.equal(occupied.tableNumber, '99'); assert.equal(occupied.status, 'occupied');
    assert.equal((await bindings()).find((row) => row.table_id === ids[0]).map_key, 'hall:12');
    assert.deepEqual(await bookings(), bookingsBefore);
    const postRace = await physical();
    await migrate(numberMigration, 'down');
    assert.deepEqual(await physical(), postRace);
    assert.equal((await service.diagnostics()).renamingReady, false);
    await assert.rejects(service.capture(), (error) => error.getStatus() === 503);
    await migrate(numberMigration, 'up');
    assert.equal((await service.diagnostics()).renamingReady, true);
    assert.deepEqual(await physical(), postRace);
    assert.deepEqual(await publicSnapshot(), baseline, 'Every real seeded physical table, binding and zone stays unchanged.');
  } finally {
    try { if (created) await db.query('DROP SCHEMA ' + schema + ' CASCADE'); }
    finally { await db.destroy(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyrveTableRenamingValidation().then(() => process.stdout.write('Syrve UUID table renaming PostgreSQL validation passed.\n'))
    .catch((error) => { console.error('Syrve table renaming validation failed: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
}
