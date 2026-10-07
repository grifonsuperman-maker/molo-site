import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';
import { readBuildRecord } from './syrve-application-build.mjs';
import { inventoryQueries, auditQueries, parseAudit, applicationFacts, buildSyrveApplicationPlan } from './syrve-schema-application-plan.mjs';

// Destructive fixtures are confined to the guarded disposable CI database.
export async function runSyrveApplicationValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) throw new Error('Application validation requires the validated process environment.');
  const require = createRequire(import.meta.url), { DataSource } = require('typeorm');
  const { SYRVE_SCHEMA_STEPS } = require('../dist/syrve/syrve-schema-contract.js');
  const { legacyMapSlot } = require('../dist/tables/table-map-slots.js');
  const { readSyrveSchemaPreflight, schemaPreflight, preflightFingerprint } = require('../dist/syrve/syrve-schema-preflight.js');
  const source = new DataSource({ type: 'postgres', host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres', password: env.DB_PASSWORD || 'postgres', database: env.DB_NAME,
    synchronize: false, migrations: [], logging: false, extra: { connectionTimeoutMillis: 5000, statement_timeout: 10000 } });
  await source.initialize();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('Application preparation must never call upstream.');
  const readAudit = async manager => {
    const inventory = await manager.query(inventoryQueries().sqlStatements.at(-1));
    const columns = await manager.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=\'syrve_integrations\'');
    const queries = auditQueries(inventory, columns.some(row => row.column_name === 'configuration_revision'));
    const results = [];
    for (let i = 0; i < queries.tags.length; i++) results.push(queries.tags[i] === 'setup' ? [] : await manager.query(queries.sqlStatements[i]));
    return parseAudit(queries, results);
  };
  const rollback = new Error('SYRVE_CI_ROLLBACK');
  const initial = await readAudit(source.manager);
  try {
    const reference = await readSyrveSchemaPreflight(source);
    for (let prefix = 0; prefix <= SYRVE_SCHEMA_STEPS.length; prefix++) {
      await assert.rejects(source.transaction('READ COMMITTED', async manager => {
        await manager.query('SET LOCAL search_path=public,pg_catalog');
        await manager.query("SET LOCAL TIME ZONE 'UTC'");
        const runner = { isTransactionActive: true, connection: source, query: manager.query.bind(manager) };
        for (const step of SYRVE_SCHEMA_STEPS.slice(prefix).reverse()) {
          const timestamp = step.name.match(/\d{13}$/)[0], name = step.name.slice(0, -13);
          const Migration = require(`../dist/migrations/${timestamp}-${name}.js`)[step.name];
          await new Migration().down(runner);
          await manager.query('DELETE FROM public.migrations WHERE name=$1', [step.name]);
        }
        // Startup may already have a physical table 1. Reuse its stable UUID;
        // adding another row would correctly make preflight reject duplicates.
        const existing = (await manager.query('SELECT id,table_number FROM public.tables ORDER BY id'))
          .find(row => legacyMapSlot(row.table_number)?.key === 'hall:1');
        const table = existing?.id || randomUUID(), tableNumber = existing?.table_number || '1', integration = randomUUID();
        if (!existing) await manager.query('INSERT INTO public.tables(id,table_number,status) VALUES ($1,\'1\',\'cleaning\')', [table]);
        await manager.query('INSERT INTO public.syrve_integrations(id,display_name,status,api_login_encrypted,api_login_iv,api_login_auth_tag) VALUES ($1,\'Synthetic application CI\',\'not_connected\',\'synthetic-cipher\',\'synthetic-iv\',\'synthetic-tag\')', [integration]);
        if (prefix >= 3 && !(await manager.query('SELECT table_id FROM public.table_map_identities WHERE table_id=$1', [table])).length)
          await manager.query('INSERT INTO public.table_map_identities(table_id,map_key) VALUES ($1,\'hall:1\')', [table]);
        if (prefix >= 5) {
          const link = randomUUID();
          await manager.query('INSERT INTO public.syrve_table_links(id,integration_id,organization_id,molo_table_id,syrve_table_id,last_known_number) VALUES ($1,$2,gen_random_uuid(),$3,gen_random_uuid(),1)', [link, integration, table]);
          await manager.query('INSERT INTO public.syrve_table_sync_states(link_id,integration_id,configuration_revision,organization_id,molo_table_id,syrve_table_id,local_revision) SELECT l.id,l.integration_id,i.configuration_revision,l.organization_id,l.molo_table_id,l.syrve_table_id,gen_random_uuid() FROM public.syrve_table_links l JOIN public.syrve_integrations i ON i.id=l.integration_id WHERE l.id=$1', [link]);
          await manager.query('INSERT INTO public.syrve_order_versions(link_id,order_id,"timestamp",state) VALUES ($1,gen_random_uuid(),100,\'unknown\')', [link]);
        }
        if (prefix >= 6) await manager.query('INSERT INTO public.syrve_worker_state(integration_id,configuration_revision,failure_count) SELECT id,configuration_revision,3 FROM public.syrve_integrations WHERE id=$1', [integration]);
        const audit = await readAudit(manager);
        const preflight = schemaPreflight(applicationFacts(audit));
        assert.notEqual(preflight.status, 'requires_audit', JSON.stringify({ prefix, historyValid: preflight.historyValid,
          steps: preflight.steps.map(({name,status,recorded}) => ({name,status,recorded})), data: applicationFacts(audit).data }));
        const input = { audit, inventory: audit.inventory, reference, context: { sourceCommit: readBuildRecord().sourceCommit,
          target: { projectId: 'ci-project', branchId: 'br-ci-restored', endpointId: 'ep-ci-test', host: 'ep-ci-test.ci.neon.tech', database: env.DB_NAME, purpose: 'rehearsal' },
          backup: { projectId: 'ci-project', sourceBranchId: 'br-ci-source', branchId: 'br-ci-backup', parentId: 'br-ci-source',
            restoredBranchId: 'br-ci-restored', restoredParentId: 'br-ci-backup', createdAt: audit.identity.audited_at,
            verifiedAt: new Date().toISOString(), restoredFingerprint: preflightFingerprint(audit.hashes) } } };
        const plan = await buildSyrveApplicationPlan(input);
        assert.deepEqual(plan.pending, SYRVE_SCHEMA_STEPS.slice(prefix).map(step => step.name));
        assert.equal(plan.applicationAvailable, false); assert.equal(plan.requiresSeparateProductionApproval, true);
        assert.doesNotMatch(JSON.stringify(plan), /synthetic-cipher|synthetic-iv|synthetic-tag/);
        // An observed write after the audit must abort; the failing savepoint
        // includes both the injected write and every statement of the plan.
        // The outer fixture transaction supplies the leading isolation command.
        await manager.query('SAVEPOINT changed_data');
        await manager.query('UPDATE public.tables SET table_number=\'99999999\' WHERE id=$1', [table]);
        await assert.rejects((async () => { for (const sql of plan.request.sql_statements.slice(1)) await manager.query(sql); })(), /Syrve audit changed: physical/);
        await manager.query('ROLLBACK TO SAVEPOINT changed_data');
        assert.equal((await manager.query('SELECT table_number FROM public.tables WHERE id=$1', [table]))[0].table_number, tableNumber);
        for (const sql of plan.request.sql_statements.slice(1)) await manager.query(sql);
        const result = await readAudit(manager);
        for (const [key, value] of Object.entries(audit.hashes).filter(([key]) => key.startsWith('business.') && key !== 'business.syrve_integrations')) assert.equal(result.hashes[key], value);
        assert.equal(result.hashes.physical, audit.hashes.physical);
        if (prefix >= 2) assert.equal(result.hashes.entities, audit.hashes.entities);
        assert.equal(result.history.length, audit.history.length + plan.pending.length);
        throw rollback;
      }), error => error === rollback);
      assert.deepEqual((await readAudit(source.manager)).hashes, initial.hashes);
    }
  } finally { globalThis.fetch = previousFetch; await source.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyrveApplicationValidation().then(() => process.stdout.write('Syrve application PostgreSQL validation passed for every migration prefix.\n'))
    .catch(error => { console.error(`Application validation failed: ${error.message}`); process.exitCode = 1; });
}
