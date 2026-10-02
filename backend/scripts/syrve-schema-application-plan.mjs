import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { artifactHashes, artifactFingerprint, assertReviewedBuild, SyrveBuildIdentityError } from './syrve-application-build.mjs';

const loadedArtifactFingerprint = artifactFingerprint(artifactHashes());
const require = createRequire(import.meta.url);
const { SYRVE_CATALOG_QUERIES, schemaParts, schemaReference, schemaPreflight, preflightFingerprint } = require('../dist/syrve/syrve-schema-preflight.js');
const { SYRVE_SCHEMA_STEPS, SYRVE_SCHEMA_REFERENCE } = require('../dist/syrve/syrve-schema-contract.js');
const { canonicalTableNumber, legacyMapSlot } = require('../dist/tables/table-map-slots.js');
const keys = Object.keys(SYRVE_CATALOG_QUERIES);
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const identifier = value => '"' + String(value).replace(/"/g, '""') + '"';
const list = values => values.length ? values.map(literal).join(',') : "''";
const hashPattern = /^[0-9a-f]{64}$/;

export class SyrveApplicationPlanError extends Error {}
function check(condition, message) { if (!condition) throw new SyrveApplicationPlanError(message); }
export const nativeHash = sql => `SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q) ORDER BY pg_catalog.to_jsonb(q)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS fingerprint FROM (${sql}) q`;
const assertTrue = (expression, label) => `DO $syrve_check$ BEGIN IF NOT coalesce((${expression}),false) THEN RAISE EXCEPTION ${literal(label)}; END IF; END $syrve_check$`;
const assertHash = (sql, expected, label) => assertTrue(`SELECT (${nativeHash(sql)}) = ${literal(expected)}`, `Syrve audit changed: ${label}`);
const filtered = (sql, condition) => `SELECT * FROM (${sql}) q WHERE ${condition}`;

export function catalogQueries() {
  return Object.fromEntries(keys.map(key => {
    const entry = SYRVE_CATALOG_QUERIES[key];
    return [key, entry.sql.replace('$1', `ARRAY[${list(entry.parameters)}]`)];
  }));
}
export function fullCatalogQueries() {
  return Object.fromEntries(keys.map(key => {
    const sql = SYRVE_CATALOG_QUERIES[key].sql;
    const result = key === 'functions'
      ? sql.replace('AND p.proname=ANY($1::text[])', "AND p.prokind IN ('f','p')")
      : sql.replace(/AND (?:c|t)\.relname=ANY\(\$1::text\[\]\)/, '');
    check(!result.includes('$1') && result !== sql, 'Catalog query requires review.');
    return [key, result];
  }));
}
const extras = {
  views: "SELECT c.relname,pg_catalog.pg_get_viewdef(c.oid,true) AS definition FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname",
  security: "SELECT c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relreplident FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname",
  policies: "SELECT * FROM pg_catalog.pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
  sequences: "SELECT schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size FROM pg_catalog.pg_sequences WHERE schemaname='public' ORDER BY sequencename",
};
const historyQuery = 'SELECT id,"timestamp",name FROM public.migrations ORDER BY id';
const physicalQuery = 'SELECT id,table_number FROM public.tables ORDER BY id';
const entitiesQuery = revision => `SELECT id,status,organization_id,(nullif(api_login_encrypted,'') IS NOT NULL AND nullif(api_login_iv,'') IS NOT NULL AND nullif(api_login_auth_tag,'') IS NOT NULL) AS credentials${revision ? ',configuration_revision' : ''} FROM public.syrve_integrations ORDER BY id`;
const auditSetup = ['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'SET TRANSACTION READ ONLY', 'SET LOCAL search_path=pg_catalog,public', "SET LOCAL TIME ZONE 'UTC'", "SET LOCAL lock_timeout='750ms'", "SET LOCAL statement_timeout='10s'"];

// Two read-only stages avoid dynamic SQL or returning customer/credential rows.
export function inventoryQueries() {
  return { tags: [...auditSetup.map(() => 'setup'), 'inventory'], sqlStatements: [...auditSetup, fullCatalogQueries().tables] };
}
function inventoryTables(inventory) {
  check(Array.isArray(inventory) && inventory.length > 0 && inventory.length < 500, 'Invalid public catalog inventory.');
  check(inventory.every(row => typeof row.table === 'string' && row.table.length > 0 && !row.table.includes('\0') && ['r','i','S','v','m','p','I','f','c'].includes(row.kind)), 'Invalid relation inventory.');
  check(new Set(inventory.map(row => row.table)).size === inventory.length, 'Duplicate relations.');
  // RLS could hash only the caller-visible subset. Foreign/partitioned data and
  // unreviewed relation kinds need their own preservation/locking procedure.
  check(inventory.every(row => ['r','i','S','v'].includes(row.kind)), 'Unsupported public relation kind; obtain a separate audit.');
  const names = inventory.filter(row => row.kind === 'r').map(row => row.table).sort();
  check(['migrations','tables','syrve_integrations'].every(name => names.includes(name)), 'Missing legacy source tables.');
  return names;
}
function querySpecs(inventory, revision) {
  const names = inventoryTables(inventory);
  return {
    ...Object.fromEntries(Object.entries(fullCatalogQueries()).map(([key, sql]) => ['full.' + key, sql])),
    ...Object.fromEntries(Object.entries(extras).map(([key, sql]) => ['full.' + key, sql])),
    history: historyQuery, physical: physicalQuery, entities: entitiesQuery(revision),
    ...Object.fromEntries(names.filter(name => name !== 'migrations').map(name => ['business.' + name,
      `SELECT ${name === 'syrve_integrations' && !revision ? "pg_catalog.to_jsonb(t)-'configuration_revision'" : 'pg_catalog.to_jsonb(t)'} AS record FROM public.${identifier(name)} t`])),
  };
}
export function auditQueries(inventory, revision = false) {
  const specs = querySpecs(inventory, revision);
  const tags = [...auditSetup.map(() => 'setup')], sqlStatements = [...auditSetup];
  const add = (tag, sql) => { tags.push(tag); sqlStatements.push(sql); };
  add('identity', "SELECT current_database() AS database,current_setting('server_version_num')::int AS version,pg_catalog.now() AS audited_at");
  add('inventory', fullCatalogQueries().tables);
  for (const [key, sql] of Object.entries(catalogQueries())) add('catalog.' + key, sql);
  add('history', historyQuery); add('physical', physicalQuery); add('entities', entitiesQuery(revision));
  add('security', extras.security);
  for (const [key, sql] of Object.entries(specs)) add('hash.' + key, nativeHash(sql));
  return { tags, sqlStatements };
}
export function parseAudit(plan, results) {
  check(Array.isArray(results) && results.length === plan.tags.length, 'Incomplete audit results.');
  const values = Object.fromEntries(plan.tags.map((tag, i) => [tag, results[i]]).filter(([tag]) => tag !== 'setup'));
  return { catalog: Object.fromEntries(keys.map(key => [key, values['catalog.' + key]])), history: values.history,
    physical: values.physical, entities: values.entities, security: values.security, inventory: values.inventory, identity: values.identity?.[0],
    hashes: Object.fromEntries(Object.keys(values).filter(key => key.startsWith('hash.')).map(key => [key.slice(5), values[key]?.[0]?.fingerprint])) };
}
export function applicationFacts(audit) {
  check(audit?.catalog && keys.every(key => Array.isArray(audit.catalog[key])) && Array.isArray(audit.history)
    && Array.isArray(audit.physical) && Array.isArray(audit.entities), 'Incomplete schema audit.');
  const numbers = audit.physical.map(row => canonicalTableNumber(row.table_number));
  check(audit.physical.every(row => /^[0-9a-f-]{36}$/i.test(row.id || '')), 'Invalid physical UUID.');
  return { ...audit.catalog, history: audit.history, data: { tablesUnambiguous: numbers.every(Boolean) && new Set(numbers).size === numbers.length,
    integrationCount: audit.entities.length, connected: false, credentials: false, links: 0, linksValid: false,
    configurationRevision: audit.entities[0]?.configuration_revision || null, snapshot: preflightFingerprint({ physical: audit.physical, entities: audit.entities }),
    workerRecords: 0, state: 'unobserved' } };
}
export function assertApplicationContext(context, audit, now = Date.now()) {
  const { target, backup, sourceCommit } = context || {};
  check(/^[0-9a-f]{40}$/.test(sourceCommit || ''), 'Require the reviewed source commit.');
  check(target && /^[a-z0-9-]+$/.test(target.projectId || '') && /^br-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.branchId || '')
    && /^ep-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.endpointId || '') && target.host?.startsWith(target.endpointId + '.')
    && target.host.endsWith('.neon.tech') && !target.host.includes('-pooler.') && target.database === audit.identity?.database
    && audit.identity.version >= 170000 && audit.identity.version < 180000 && ['production','rehearsal'].includes(target.purpose), 'Verify the exact Neon target, direct endpoint, database and PostgreSQL 17.');
  check(backup && backup.projectId === target.projectId && backup.sourceBranchId !== backup.branchId
    && backup.branchId !== backup.restoredBranchId && backup.parentId === backup.sourceBranchId && backup.restoredParentId === backup.branchId
    && /^br-[a-z0-9-]+$/.test(backup.branchId || '') && /^br-[a-z0-9-]+$/.test(backup.restoredBranchId || '')
    && (target.purpose === 'production' ? backup.sourceBranchId === target.branchId && backup.restoredBranchId !== target.branchId
      : backup.restoredBranchId === target.branchId), 'Require an independently verified backup branch restored to a different test branch.');
  const created = Date.parse(backup.createdAt), verified = Date.parse(backup.verifiedAt), audited = Date.parse(audit.identity.audited_at);
  check([created, verified, audited, now].every(Number.isFinite) && created <= verified && verified <= now && audited <= now
    && now - created <= 3_600_000 && now - verified <= 3_600_000 && now - audited <= 3_600_000, 'Backup and audit must be freshly verified within one hour.');
  check(backup.restoredFingerprint === preflightFingerprint(audit.hashes), 'Restored backup differs from the audited target.');
  return { target, expiresAt: new Date(Math.min(created, verified, audited) + 3_600_000).toISOString() };
}

// The frozen TypeORM methods are the only DDL source. Conditional reads are
// translated to server-side checks, never accepted as successful fake reads.
export async function compilePendingMigration(step) {
  const timestamp = step.name.match(/\d{13}$/)[0];
  const className = step.name.slice(0, -13);
  const Migration = require(`../dist/migrations/${timestamp}-${className}.js`)[step.name];
  const sqlStatements = [];
  await new Migration().up({ isTransactionActive: true, connection: { options: { type: 'postgres', schema: 'public' } },
    async query(raw, parameters = []) {
      check(parameters.length === 0, 'Parameterized migration requires compiler review.');
      const sql = raw.trim();
      if (sql === 'SELECT count(*)::int AS count FROM "syrve_integrations"') {
        sqlStatements.push(assertTrue('SELECT count(*) <= 1 FROM public.syrve_integrations', 'Duplicate integration configurations require reconciliation.'));
        return [{ count: 1 }];
      }
      if (/^SELECT EXISTS \([\s\S]+\) AS "hasDuplicates"$/.test(sql)) {
        sqlStatements.push(assertTrue(`SELECT NOT "hasDuplicates" FROM (${sql}) q`, 'Duplicate canonical table numbers require reconciliation.'));
        return [{ hasDuplicates: false }];
      }
      check(/^(CREATE |ALTER |LOCK |SET LOCAL |WITH [\s\S]+INSERT INTO )/.test(sql), 'Unreviewed migration statement or conditional read.');
      sqlStatements.push(sql); return [];
    } });
  return [...sqlStatements, `INSERT INTO public.migrations("timestamp",name) VALUES (${Number(timestamp)},${literal(step.name)})`];
}

export async function buildSyrveApplicationPlan(input, now = Date.now()) {
  const { audit, inventory, reference, context } = input || {};
  const build = assertReviewedBuild(context?.sourceCommit, loadedArtifactFingerprint);
  const facts = applicationFacts(audit), report = schemaPreflight(facts);
  check(['plan_requires_review','prepared'].includes(report.status), 'Target schema, history or data require a separate audit.');
  check(reference && keys.every(key => Array.isArray(reference[key])) && SYRVE_SCHEMA_STEPS.every(step => schemaReference(reference)[step.name] === SYRVE_SCHEMA_REFERENCE[step.name]), 'Prepared catalog must match all frozen references.');
  const { target, expiresAt } = assertApplicationContext(context, audit, now);
  const prefix = SYRVE_SCHEMA_STEPS.length - report.pending.length;
  const pending = SYRVE_SCHEMA_STEPS.slice(prefix);
  const revision = prefix >= 2;
  const specs = querySpecs(inventory, revision), names = inventoryTables(inventory);
  check(preflightFingerprint(inventory) === preflightFingerprint(audit.inventory), 'Inventory changed between read-only audit stages.');
  check(Array.isArray(audit.security) && audit.security.every(row => !row.relrowsecurity && !row.relforcerowsecurity), 'RLS requires an independently reviewed complete-data audit.');
  check(Object.keys(audit.hashes || {}).length === Object.keys(specs).length && Object.keys(specs).every(key => hashPattern.test(audit.hashes[key] || '')), 'Incomplete native schema/data fingerprints.');
  if (prefix < 3) check(audit.physical.every(row => legacyMapSlot(row.table_number)), 'Every physical UUID needs an unambiguous frozen map slot before backfill.');
  const order = ['migrations','syrve_integrations','tables', ...names.filter(name => !['migrations','syrve_integrations','tables'].includes(name))];
  const sqlStatements = ['SET TRANSACTION ISOLATION LEVEL READ COMMITTED', 'SET LOCAL search_path=public,pg_catalog', "SET LOCAL TIME ZONE 'UTC'",
    "SET LOCAL lock_timeout='750ms'", "SET LOCAL statement_timeout='10s'",
    assertTrue(`SELECT current_database()=${literal(target.database)} AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999`, 'Wrong database/version.'),
    assertTrue(`SELECT pg_catalog.clock_timestamp() <= ${literal(expiresAt)}::timestamptz`, 'Backup/audit expired; reverify before applying.'),
    assertTrue("SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('molo/schema-migrations',0))", 'Schema migration fence is busy.'),
    `LOCK TABLE ${order.map(name => 'public.' + identifier(name)).join(',')} IN ACCESS EXCLUSIVE MODE`,
    assertTrue("SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relrowsecurity OR c.relforcerowsecurity))", 'RLS requires a complete-data audit.'),
  ];
  for (const [key, sql] of Object.entries(specs)) sqlStatements.push(assertHash(sql, audit.hashes[key], key));
  for (const step of pending) sqlStatements.push(...await compilePendingMigration(step));

  // Preserve the entire original public catalog, including ACL/RLS, views,
  // policy and sequence definitions. Sequence counters are nontransactional;
  // migration IDs may have gaps, but original history rows must be identical.
  const parts = pending.map(step => schemaParts(reference, SYRVE_SCHEMA_STEPS.indexOf(step)));
  const addedRelations = [...new Set(parts.flatMap(part => [...(part.tables || []).map(row => row.table), ...(part.indexes || []).map(row => row.name)]))];
  const addedFunctions = parts.flatMap(part => (part.functions || []).map(row => row.name));
  const full = fullCatalogQueries();
  for (const [key, sql] of Object.entries(full)) {
    let condition = key === 'functions' ? `q.name NOT IN (${list(addedFunctions)})` : key === 'indexes'
      ? `q.name NOT IN (${list(parts.flatMap(part => (part.indexes || []).map(row => row.name)))})`
      : `q."table" NOT IN (${list(addedRelations)})`;
    if (key === 'columns' && prefix < 2) condition += " AND NOT (q.\"table\"='syrve_integrations' AND q.name='configuration_revision')";
    sqlStatements.push(assertHash(filtered(sql, condition), audit.hashes['full.' + key], 'preserved ' + key));
  }
  for (const [key, sql] of Object.entries(extras)) sqlStatements.push(assertHash(key === 'security'
    ? filtered(sql, `q.relname NOT IN (${list(addedRelations)})`) : sql, audit.hashes['full.' + key], 'preserved ' + key));
  for (const [key, sql] of Object.entries(specs).filter(([key]) => key.startsWith('business.') || ['physical','entities'].includes(key))) {
    sqlStatements.push(assertHash(sql, audit.hashes[key], 'preserved ' + key));
  }
  for (let i = 0; i < SYRVE_SCHEMA_STEPS.length; i++) {
    const part = schemaParts(reference, i);
    for (const [key, rows] of Object.entries(part)) {
      const step = SYRVE_SCHEMA_STEPS[i];
      const selector = i === 1 ? key === 'columns' ? "q.\"table\"='syrve_integrations' AND q.name='configuration_revision'" : "q.name='UQ_syrve_integrations_singleton'"
        : i === 3 ? `q.name=${literal(key === 'functions' ? 'molo_canonical_table_number' : 'UQ_tables_canonical_number')}`
        : key === 'functions' ? i === 2 ? "q.name='molo_keep_table_map_identity'" : 'false' : `q."table" IN (${list(step.tables)})`;
      const expected = `SELECT value AS record FROM pg_catalog.jsonb_array_elements(${literal(JSON.stringify(rows))}::jsonb)`;
      const actual = `SELECT pg_catalog.to_jsonb(q) AS record FROM (${filtered(catalogQueries()[key], selector)}) q`;
      sqlStatements.push(assertTrue(`SELECT (${nativeHash(actual)}) = (${nativeHash(expected)})`, 'Prepared catalog mismatch: ' + step.name + '/' + key));
    }
  }
  const pendingNames = pending.map(step => step.name);
  sqlStatements.push(assertHash(filtered(historyQuery, `q.name NOT IN (${list(pendingNames)})`), audit.hashes.history, 'original migration history'));
  const expectedHistory = [...audit.history.map(row => row.name), ...pendingNames];
  sqlStatements.push(assertTrue(`SELECT pg_catalog.array_agg(name::text ORDER BY id)=ARRAY[${list(expectedHistory)}]::text[] AND count(*)=${expectedHistory.length} FROM public.migrations`, 'Migration history suffix mismatch.'));
  for (const step of pending) sqlStatements.push(assertTrue(`SELECT count(*)=1 FROM public.migrations WHERE name=${literal(step.name)} AND "timestamp"=${Number(step.name.match(/\d{13}$/)[0])}`, 'Migration timestamp mismatch.'));
  if (prefix < 3) {
    const expected = audit.physical.map(row => `(${literal(row.id)}::uuid,${literal(legacyMapSlot(row.table_number).key)}::text)`);
    const source = expected.length ? `VALUES ${expected.join(',')}` : 'SELECT NULL::uuid,NULL::text WHERE false';
    sqlStatements.push(assertTrue(`SELECT NOT EXISTS ((SELECT table_id,map_key FROM public.table_map_identities EXCEPT SELECT * FROM (${source}) expected) UNION ALL (SELECT * FROM (${source}) expected EXCEPT SELECT table_id,map_key FROM public.table_map_identities))`, 'Physical UUID/map backfill mismatch.'));
  }
  for (const name of pending.flatMap(step => step.tables).filter(name => name !== 'table_map_identities')) {
    sqlStatements.push(assertTrue(`SELECT count(*)=0 FROM public.${identifier(name)}`, 'Unexpected new Syrve state.'));
  }
  sqlStatements.push("SELECT true AS schema_verified,true AS original_data_preserved,false AS sync_enabled");
  const request = { project_id: target.projectId, branch_id: target.branchId, database_name: target.database, sql_statements: sqlStatements };
  return { version: 1, applicationAvailable: false, requiresSeparateProductionApproval: true, sourceCommit: context.sourceCommit,
    build, target, expiresAt, pending: pendingNames, auditFingerprint: report.fingerprint, planFingerprint: preflightFingerprint(request), request };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, path] = process.argv.slice(2);
  Promise.resolve().then(async () => {
    check(['--inventory','--audit','--plan'].includes(mode), 'Only --inventory, --audit and --plan are available; --apply is refused.');
    const input = path ? JSON.parse(readFileSync(path, 'utf8')) : null;
    if (mode === '--inventory') return inventoryQueries();
    if (mode === '--audit') return auditQueries(input.inventory, input.revision === true);
    return buildSyrveApplicationPlan(input);
  }).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => { console.error(error instanceof SyrveApplicationPlanError || error instanceof SyrveBuildIdentityError ? error.message : 'Syrve plan failed; inspect private input locally.'); process.exitCode = 1; });
}
