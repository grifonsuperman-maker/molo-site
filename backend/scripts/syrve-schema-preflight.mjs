import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export class SyrvePreflightGuardError extends Error {}
export function assertSyrvePreflightIntent(mode, env) {
  if(mode!=='--check') throw new SyrvePreflightGuardError('Only --check is available. Applying migrations requires a separately reviewed target audit.');
  if(!['production','test-syrve-migration'].includes(env.MOLO_SYRVE_BRANCH)) throw new SyrvePreflightGuardError('Select the independently verified Neon branch.');
  if(String(env.DB_SYNCHRONIZE || '').trim().toLowerCase()!=='false') throw new SyrvePreflightGuardError('Set DB_SYNCHRONIZE=false for preflight.');
  const host=String(env.MOLO_SYRVE_EXPECTED_HOST || '').trim().toLowerCase();
  const database=String(env.MOLO_SYRVE_EXPECTED_DATABASE || '').trim();
  let url;
  try { url=new URL(String(env.DB_URL || '')); } catch { throw new SyrvePreflightGuardError('Provide the private verified Neon connection.'); }
  let actualDatabase;try{actualDatabase=decodeURIComponent(url.pathname.slice(1));}catch{throw new SyrvePreflightGuardError('Invalid database target.');}
  if(!host.endsWith('.neon.tech') || !database || !['postgres:','postgresql:'].includes(url.protocol)
    || !url.username || !url.password || url.hostname.toLowerCase()!==host || actualDatabase!==database
    || url.hash || (url.port && url.port!=='5432') || [...url.searchParams.keys()].some(key=>key!=='sslmode')
    || !['require','verify-full'].includes(url.searchParams.get('sslmode'))) throw new SyrvePreflightGuardError('Connection does not match the verified host/database and TLS requirements.');
  // Strip URL TLS options so pg cannot override the explicit verified-TLS object.
  url.search=''; return {url:url.toString()};
}
export async function runSyrveSchemaPreflight(mode='--check',env=process.env) {
  if(env!==process.env) throw new SyrvePreflightGuardError('The operator must use the validated process environment.');
  const target=assertSyrvePreflightIntent(mode,env),require=createRequire(import.meta.url);
  const {DataSource}=require('typeorm');
  const {readSyrveSchemaPreflight,schemaPreflight}=require('../dist/syrve/syrve-schema-preflight.js');
  const source=new DataSource({type:'postgres',url:target.url,ssl:{rejectUnauthorized:true},synchronize:false,
    migrations:[],logging:false,extra:{connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=750'}});
  try {
    await source.initialize();
    const facts=await readSyrveSchemaPreflight(source);
    return schemaPreflight(facts);
  } finally {if(source.isInitialized) await source.destroy();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  runSyrveSchemaPreflight(process.argv[2] || '--check').then(report=>{process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=report.status==='prepared'?0:report.status==='plan_requires_review'?2:3;})
    .catch(error=>{console.error(error instanceof SyrvePreflightGuardError ? error.message : 'Read-only Syrve preflight failed; inspect private database logs.');process.exitCode=1;});
}
