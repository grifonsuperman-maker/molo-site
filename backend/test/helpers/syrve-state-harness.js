const { randomUUID } = require('node:crypto');
const { SyrveStateStore } = require('../../dist/syrve/syrve-state.store.js');
const { staleSyrveSettings } = require('../../dist/syrve/syrve-settings.store.js');

// Transactional test double for failure injection. The same scenarios also run
// against the compiled adapter and real PostgreSQL in database-reference CI.
function harness() {
  const entity = { id: randomUUID(), configurationRevision: randomUUID(), organizationId: randomUUID(), status: 'connected' };
  let db = { activation: null, worker: null, saved: null, versions: [], link: { id: randomUUID(), integration_id: entity.id,
    organization_id: entity.organizationId, molo_table_id: randomUUID(), syrve_table_id: randomUUID(),
    last_syrve_state: 'unknown', active_syrve_order_ids: [], manually_freed_syrve_order_ids: [] } };
  db.physical = { id: db.link.molo_table_id, tableNumber: '12', status: 'free', zone: { id: randomUUID() } };
  db.bookings = [];
  let now = 1_000_000, workerFail = false;
  const queries = []; let prepared = true, configurationPresent = true, settingsPrepared = true, fail = false, physicalFail = false, tail = Promise.resolve();
  const tables = { find: async () => [structuredClone(db.physical)], findOne: async (options) => (options.where.id
    ? options.where.id.toLowerCase() === db.physical.id : options.where.tableNumber === db.physical.tableNumber)
    ? structuredClone(db.physical) : null,
    save: async (patch) => {
      if (physicalFail) throw new Error('synthetic physical failure');
      Object.assign(db.physical, patch); return structuredClone(db.physical);
    } };
  const bookings = { find: async () => structuredClone(db.bookings) };
  const manager = { queryRunner: { isTransactionActive: true }, getRepository: (entity) => {
    if (entity.name === 'TableEntity') return tables;
    if (entity.name === 'Booking') return bookings;
    throw new Error(`Unexpected repository ${entity.name}`);
  }, query: async (sql, args = []) => {
    queries.push(sql);
    if (sql.includes('syrve_sync_activation') && !sql.includes('to_regclass')) return db.activation ? [structuredClone(db.activation)] : [];
    if (sql.startsWith('SELECT local_revision')) return db.saved ? [{local_revision:db.saved.local_revision}] : [];
    if (sql.includes('syrve_worker_state') && !sql.includes('to_regclass')) {
      if (sql.startsWith('INSERT')) db.worker ||= { integration_id:args[0],configuration_revision:args[1],lease_id:null,lease_until:null,
        failure_count:0,next_attempt_at:0,last_attempt_at:null,last_success_at:null,last_error_code:null,cursor_link_id:null };
      if (sql.startsWith('SELECT')) return db.worker ? [{...structuredClone(db.worker),busy:db.worker.lease_until > now,
        waiting:db.worker.next_attempt_at > now,live:db.worker.lease_until > now}] : [];
      if (sql.startsWith('UPDATE') && sql.includes('SET lease_id=NULL')) {
        if (db.worker?.lease_id === args[1]) Object.assign(db.worker,{lease_id:null,lease_until:null});
      } else if (sql.startsWith('UPDATE') && args.length===3) {
        if (db.worker.configuration_revision!==args[1]) Object.assign(db.worker,{failure_count:0,last_success_at:null,last_error_code:null,cursor_link_id:null});
        Object.assign(db.worker,{configuration_revision:args[1],lease_id:args[2],lease_until:now+90_000,last_attempt_at:now});
      } else if (sql.startsWith('UPDATE') && args.length===6) {
        if (workerFail) throw new Error('synthetic worker write failure');
        if (db.worker.lease_id===args[1]) Object.assign(db.worker,{cursor_link_id:args[2],failure_count:args[3],last_error_code:args[4],
          next_attempt_at:now+args[5],last_success_at:args[4] ? db.worker.last_success_at : now});
      }
      return [];
    }
    if (sql.includes('to_regclass')) return [{ prepared, durable:prepared, configuration_present:configurationPresent }];
    if (sql.startsWith('SELECT "id"')) return args[0].toLowerCase() === db.physical.id
      ? [{ id: db.physical.id, status: db.physical.status, physical_updated_at:db.physical.updatedAt?.toISOString() || 'initial-fixture-version' }] : [];
    if (sql.startsWith('SELECT *') && sql.includes('syrve_table_links')) return db.link ? [structuredClone(db.link)] : [];
    if (sql.startsWith('SELECT *')) return db.saved ? [structuredClone(db.saved)] : [];
    if (sql.startsWith('SELECT "order_id"')) return db.versions.map((v) => ({ order_id: v.id, timestamp: String(v.timestamp), state: v.state, fingerprint: v.fingerprint }));
    if (sql.startsWith('INSERT') && sql.includes('syrve_table_sync_states')) {
      db.saved = Object.fromEntries(['link_id','integration_id','configuration_revision','organization_id','molo_table_id','syrve_table_id','local_revision'].map((key, index) => [key,args[index]]));
    } else if (sql.startsWith('INSERT')) {
      const versions = new Map(db.versions.map((v) => [v.id, v]));
      for (const v of JSON.parse(args[1])) versions.set(v.id, v);
      db.versions = [...versions.values()].sort((a,b) => a.id.localeCompare(b.id));
    } else if (sql.startsWith('UPDATE') && sql.includes('syrve_integrations')) {
      entity.configurationRevision=args[1];
    } else if (sql.startsWith('UPDATE') && sql.includes('"tables"')) {
      if (physicalFail) throw new Error('synthetic physical failure');
      if (args[0] !== db.physical.id) throw new Error('unexpected physical UUID');
      db.physical.status = args[1]; db.physical.updatedAt = new Date(now);
    } else if (sql.startsWith('UPDATE') && sql.includes('syrve_table_links') && args.length===1) {
      db.link.manually_freed_syrve_order_ids=[...db.link.active_syrve_order_ids];
    } else if (sql.startsWith('UPDATE') && sql.includes('syrve_table_links')) {
      db.link.last_syrve_state = args[1]; db.link.active_syrve_order_ids = [...args[2]]; db.link.manually_freed_syrve_order_ids = [...args[3]];
    } else if (sql.startsWith('UPDATE')) {
      if (fail) throw new Error('synthetic write failure');
      db.saved.configuration_revision = args[1]; db.saved.local_revision = args[2];
    }
    return [];
  } };
  const snapshot = () => ({ prepared: settingsPrepared, entity: { ...entity }, links: db.link
    ? [{id:db.link.id,moloTableId:db.link.molo_table_id,integrationId:db.link.integration_id,organizationId:db.link.organization_id,syrveTableId:db.link.syrve_table_id}] : [] });
  const transaction = async (action, expected) => {
    const previous = tail; let release; tail = new Promise((yes) => release = yes); await previous;
    const before = structuredClone(db), entityBefore={...entity};
    try {
      if (expected && (expected.id !== entity.id || expected.revision !== entity.configurationRevision)) throw staleSyrveSettings();
      return await action(manager, snapshot());
    } catch (error) { db = before; Object.assign(entity,entityBefore); throw error; } finally { release(); }
  };
  const settings = { read: async () => { queries.push('settings read'); return snapshot(); },
    transaction: (expected, action) => transaction((m) => action(m, snapshot()), expected),
    localTransaction: (action) => transaction(action) };
  const source = { options: { type: 'postgres', schema: 'public' }, manager, query:manager.query, transaction };
  const restart = () => new SyrveStateStore(source, settings);
  return { entity, queries, source, settings, manager, tables, bookings, snapshot, restart, store: restart(), table: db.physical.id,
    saved: () => structuredClone(db), mutate: (action) => action(db), unprepare: () => prepared = false,
    restore: () => prepared = true, legacy: () => {prepared=false;configurationPresent=false;},
    unprepareSettings: () => settingsPrepared = false, failWrite: () => fail = true, failPhysical: () => physicalFail = true, advance: (ms) => now += ms, failWorker: () => workerFail = true };
}
module.exports = { harness };
