import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalTableNumber } from '../tables/table-map-slots';
import { getSyrveOrderIdsToObserve } from './syrve-state-reducer';
import { SYRVE_EXISTING_HISTORY, SYRVE_SCHEMA_REFERENCE, SYRVE_SCHEMA_STEPS } from './syrve-schema-contract';

type Row = Record<string, any>;
export type SyrveSchemaFacts = { tables: Row[]; columns: Row[]; constraints: Row[]; indexes: Row[]; functions: Row[]; triggers: Row[];
  history: Row[] | null; data: { tablesUnambiguous: boolean; integrationCount: number; connected: boolean; credentials: boolean;
    links: number; linksValid: boolean; configurationRevision: string | null; snapshot: string; workerRecords: number; state: 'unobserved' | 'valid' | 'invalid' | 'stale' } | null };
const TABLES = ['tables', 'syrve_integrations', 'migrations', ...SYRVE_SCHEMA_STEPS.flatMap(step => [...step.tables])];
const FUNCTIONS = ['molo_keep_table_map_identity', 'molo_canonical_table_number'];
export const SYRVE_CATALOG_QUERIES = {
  tables: { sql: `SELECT c.relname AS "table",c.relkind AS kind FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, parameters: TABLES },
  columns: { sql: `SELECT c.relname AS "table",a.attname AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS "notNull",pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS "default"
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attname`, parameters: TABLES },
  constraints: { sql: `SELECT c.relname AS "table",k.conname AS name,pg_catalog.pg_get_constraintdef(k.oid,true) AS definition,
    k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS deferred FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`, parameters: TABLES },
  indexes: { sql: `SELECT t.relname AS "table",c.relname AS name,pg_catalog.pg_get_indexdef(c.oid) AS definition,
    i.indisvalid AS valid,i.indisready AS ready,i.indisunique AS "unique",i.indimmediate AS immediate FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,c.relname`, parameters: TABLES },
  functions: { sql: `SELECT p.proname AS name,pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_catalog.pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname,arguments`, parameters: FUNCTIONS },
  triggers: { sql: `SELECT c.relname AS "table",t.tgname AS name,t.tgenabled AS enabled,
    pg_catalog.pg_get_triggerdef(t.oid,true) AS definition FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    AND (NOT t.tgisinternal OR t.tgenabled <> 'O') ORDER BY c.relname,t.tgname`, parameters: TABLES },
} as const;


function canonical(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const preflightFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function schemaParts(facts: SyrveSchemaFacts, index: number) {
  const step = SYRVE_SCHEMA_STEPS[index], tables: readonly string[] = step.tables;
  const take = (rows: Row[]) => rows.filter(row => tables.includes(row.table));
  if (index === 1) return { columns: facts.columns.filter(row => row.table === 'syrve_integrations' && row.name === 'configuration_revision'),
    indexes: facts.indexes.filter(row => row.name === 'UQ_syrve_integrations_singleton') };
  if (index === 3) return { functions: facts.functions.filter(row => row.name === FUNCTIONS[1]),
    indexes: facts.indexes.filter(row => row.name === 'UQ_tables_canonical_number') };
  return { tables: take(facts.tables), columns: take(facts.columns), constraints: take(facts.constraints), indexes: take(facts.indexes),
    triggers: take(facts.triggers), functions: index === 2 ? facts.functions.filter(row => row.name === FUNCTIONS[0]) : [] };
}
export function schemaReference(facts: SyrveSchemaFacts): Record<string, string> {
  return Object.fromEntries(SYRVE_SCHEMA_STEPS.map((step, i) => [step.name, preflightFingerprint(schemaParts(facts, i))]));
}
export function schemaPreflight(facts: SyrveSchemaFacts, reference = SYRVE_SCHEMA_REFERENCE) {
  const history = facts.history || [], names = history.map(row => row.name);
  const baseline = names[0] === 'InitialSchemaBaseline2026081300000';
  const offset = baseline ? 1 : 0;
  const push = names[offset + SYRVE_EXISTING_HISTORY.length] === 'CreateGuestPushSubscriptions2026092000010';
  const base = [...(baseline ? ['InitialSchemaBaseline2026081300000'] : []), ...SYRVE_EXISTING_HISTORY,
    ...(push ? ['CreateGuestPushSubscriptions2026092000010'] : [])];
  const suffix = names.slice(base.length);
  const historyValid = facts.history !== null && history.length <= 1000 && suffix.length <= SYRVE_SCHEMA_STEPS.length
    && JSON.stringify(names.slice(0, base.length)) === JSON.stringify(base)
    && suffix.every((name, i) => name === SYRVE_SCHEMA_STEPS[i].name)
    && history.every((row, i) => Number(row.timestamp) === Number(String(row.name).match(/\d{13}$/)?.[0])
      && Number.isSafeInteger(Number(row.id)) && Number(row.id) > (i ? Number(history[i - 1].id) : 0));
  const steps = SYRVE_SCHEMA_STEPS.map((step, i) => {
    const part = schemaParts(facts, i), fingerprint = preflightFingerprint(part);
    const absent = Object.values(part).every(values => values.length === 0);
    const status = absent ? 'missing' : reference[step.name] === fingerprint ? 'verified' : 'drift';
    const recorded = history.some(row => row.name === step.name);
    return { name: step.name, status, recorded, fingerprint: absent ? null : fingerprint };
  });
  const consistent = historyValid && facts.triggers.every(trigger => trigger.enabled === 'O')
    && steps.every((step, i) => i < suffix.length ? step.status === 'verified' && step.recorded
    : step.status === 'missing' && !step.recorded);
  const prerequisites = facts.data !== null && facts.data.tablesUnambiguous && facts.data.integrationCount <= 1;
  return { version: 1, applicationAvailable: false as const,
    status: consistent && prerequisites ? steps.every(step => step.status === 'verified') ? 'prepared' : 'plan_requires_review' : 'requires_audit',
    historyValid, steps, pending: steps.filter(step => step.status === 'missing' && !step.recorded).map(step => step.name),
    fingerprint: preflightFingerprint(facts) };
}

async function readFacts(manager: EntityManager): Promise<SyrveSchemaFacts> {
  const tables = await manager.query(SYRVE_CATALOG_QUERIES.tables.sql, [SYRVE_CATALOG_QUERIES.tables.parameters]);
  const columns = await manager.query(SYRVE_CATALOG_QUERIES.columns.sql, [SYRVE_CATALOG_QUERIES.columns.parameters]);
  const constraints = await manager.query(SYRVE_CATALOG_QUERIES.constraints.sql, [SYRVE_CATALOG_QUERIES.constraints.parameters]);
  const indexes = await manager.query(SYRVE_CATALOG_QUERIES.indexes.sql, [SYRVE_CATALOG_QUERIES.indexes.parameters]);
  const functions = await manager.query(SYRVE_CATALOG_QUERIES.functions.sql, [SYRVE_CATALOG_QUERIES.functions.parameters]);
  const triggers = await manager.query(SYRVE_CATALOG_QUERIES.triggers.sql, [SYRVE_CATALOG_QUERIES.triggers.parameters]);
  const has = (table: string, name: string, type: string) => tables.some(row => row.table === table && row.kind === 'r') && columns.some(row => row.table === table && row.name === name && row.type === type);
  const history = has('migrations', 'id', 'integer') && has('migrations', 'timestamp', 'bigint') && has('migrations', 'name', 'character varying')
    ? await manager.query('SELECT id,"timestamp",name FROM public.migrations ORDER BY id LIMIT 1001') : null;
  const facts: SyrveSchemaFacts = { tables, columns, constraints, indexes, functions, triggers, history, data: null };
  const baseAvailable = has('tables', 'id', 'uuid') && has('tables', 'table_number', 'character varying')
    && has('syrve_integrations', 'id', 'uuid') && ['status','organization_id','api_login_encrypted','api_login_iv','api_login_auth_tag']
      .every(name => columns.some(row => row.table === 'syrve_integrations' && row.name === name && /^(text|character varying)/.test(row.type)));
  if (!baseAvailable) return facts;
  const physical = await manager.query('SELECT id,table_number FROM public.tables ORDER BY id');
  const numbers = physical.map(row => canonicalTableNumber(row.table_number)).filter(Boolean);
  const entities = await manager.query(`SELECT id,status,organization_id,
    (nullif(api_login_encrypted,'') IS NOT NULL AND nullif(api_login_iv,'') IS NOT NULL AND nullif(api_login_auth_tag,'') IS NOT NULL) AS credentials
    ${has('syrve_integrations','configuration_revision','uuid') ? ',configuration_revision' : ''} FROM public.syrve_integrations ORDER BY id`);
  const entity = entities.length === 1 ? entities[0] : null;
  facts.data = { tablesUnambiguous: new Set(numbers).size === numbers.length && numbers.length === physical.length, integrationCount: entities.length,
    connected: Boolean(entity?.status === 'connected' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entity.organization_id || '')),
    credentials: Boolean(entity?.credentials), links: 0, linksValid: false, configurationRevision: entity?.configuration_revision || null,
    snapshot: preflightFingerprint({physical, entities}), workerRecords: 0, state: 'unobserved' };
  const verified = schemaReference(facts);
  if (!SYRVE_SCHEMA_STEPS.every(step => verified[step.name] === SYRVE_SCHEMA_REFERENCE[step.name])) return facts;
  const links = await manager.query('SELECT * FROM public.syrve_table_links ORDER BY id');
  const identities = await manager.query('SELECT table_id FROM public.table_map_identities ORDER BY table_id');
  facts.data.links = links.length;
  facts.data.linksValid = links.length > 0 && links.every(link => entity && link.integration_id === entity.id
    && link.organization_id === entity.organization_id && physical.some(table => table.id === link.molo_table_id)
    && identities.some(identity => identity.table_id === link.molo_table_id));
  const states = await manager.query('SELECT * FROM public.syrve_table_sync_states ORDER BY link_id');
  const versions = await manager.query('SELECT * FROM public.syrve_order_versions ORDER BY link_id,order_id');
  const jobs = await manager.query('SELECT * FROM public.syrve_worker_state ORDER BY integration_id');
  facts.data.workerRecords = jobs.length;
  facts.data.snapshot = preflightFingerprint({physical, entities, links, identities, states, versions, jobs});
  let unobserved = false;
  for (const link of links) {
    const saved = states.find(row => row.link_id === link.id);
    if (!saved) {
      if (link.last_syrve_state !== 'unknown' || link.active_syrve_order_ids.length || link.manually_freed_syrve_order_ids.length) {
        facts.data.state = 'invalid'; return facts;
      }
      unobserved = true; continue;
    }
    if (!entity || saved.integration_id !== entity.id || saved.configuration_revision !== entity.configuration_revision
      || saved.organization_id !== link.organization_id || saved.molo_table_id !== link.molo_table_id || saved.syrve_table_id !== link.syrve_table_id) {
      facts.data.state = 'stale'; return facts;
    }
    try {
      getSyrveOrderIdsToObserve({ scope: { integrationId: saved.integration_id, configurationRevision: saved.configuration_revision,
        organizationId: saved.organization_id, moloTableId: saved.molo_table_id, syrveTableId: saved.syrve_table_id },
        localRevision: saved.local_revision, lastSyrveState: link.last_syrve_state, activeSyrveOrderIds: link.active_syrve_order_ids,
        manuallyFreedSyrveOrderIds: link.manually_freed_syrve_order_ids, orderVersions: versions.filter(row => row.link_id === link.id)
          .map(row => ({ id: row.order_id, timestamp: Number(row.timestamp), state: row.state, fingerprint: row.fingerprint })) });
    } catch { facts.data.state = 'invalid'; return facts; }
  }
  facts.data.state = unobserved || !links.length ? 'unobserved' : 'valid';
  return facts;
}

// Shared by the Director diagnostic and standalone operator. No Nest bootstrap,
// migration executor, settings write lock, upstream caller or credential decrypt.
export function readSyrveSchemaPreflight(source: DataSource): Promise<SyrveSchemaFacts> {
  if (source.options.type !== 'postgres' || (source.options.schema && source.options.schema !== 'public')) throw new Error('Unsupported schema');
  return source.transaction('REPEATABLE READ', async manager => {
    await manager.query('SET TRANSACTION READ ONLY');
    await manager.query("SET LOCAL search_path = pg_catalog, public");
    await manager.query("SET LOCAL lock_timeout = '750ms'");
    await manager.query("SET LOCAL statement_timeout = '5s'");
    return readFacts(manager);
  });
}
