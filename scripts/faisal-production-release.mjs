import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const ref = 'zeocbftriydodzfgixjv';
assert.equal(process.env.SUPABASE_PROJECT_REF, ref, 'Production identity mismatch');
assert.equal(process.env.SUPABASE_URL, `https://${ref}.supabase.co`);
assert.ok(process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_ANON_KEY, 'Missing credentials');
const mode = process.argv[2];
assert.ok(['preflight', 'apply', 'verify'].includes(mode), 'Explicit release mode required');
const sql = await readFile('supabase/migrations/20260914000100_faisal_sales_agent_mvp.sql', 'utf8');
const platformSql = await readFile('supabase/migrations/20260914000200_faisal_platform_sales_workspace.sql', 'utf8');
const tables = ['sales_leads', 'sales_tasks', 'sales_interactions', 'sales_agent_runs', 'sales_agent_approvals'];
const literal = value => `'${value.replaceAll("'", "''")}'`;
const report = { project_ref: ref, mode, commit: process.env.GITHUB_SHA, started_at: new Date().toISOString(), migration_sha256: createHash('sha256').update(sql).digest('hex'), delivery_enabled: false, checks: [] };
async function management(path, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { ...options, headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, `Management ${path} HTTP ${response.status}`);
  const body = await response.text(); return body ? JSON.parse(body) : null;
}
const query = sql => management('/database/query', { method: 'POST', body: JSON.stringify({ query: sql }) });
async function preflight() {
  const project = await management('');
  assert.equal(project.id, ref); assert.equal(project.status, 'ACTIVE_HEALTHY');
  report.checks.push('exact_healthy_production');
  const columns = await query("select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('companies','users')");
  for (const [table, column, type] of [['companies','id','uuid'],['companies','status','text'],['users','auth_user_id','uuid'],['users','company_id','uuid'],['users','role','text'],['users','status','text'],['users','is_active','boolean']]) {
    assert.ok(columns.some(x => x.table_name === table && x.column_name === column && x.data_type === type), `Missing dependency ${table}.${column}:${type}`);
  }
  report.checks.push('existing_auth_and_tenant_columns_compatible');
  const history = await query("select statements from supabase_migrations.schema_migrations where version='20260914000100'");
  if (history.length) {
    assert.equal(history[0].statements.join('\n').trim(), sql.trim(), 'Recorded migration differs');
    report.checks.push('exact_migration_already_applied');
  } else {
    const collisions = await query(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in (${tables.map(literal).join(',')})`);
    assert.equal(collisions.length, 0, 'Sales relations exist without matching migration');
    const functions = [...sql.matchAll(/create(?: or replace)? function public\.(\w+)\(/gi)].map(m => m[1]);
    const existing = await query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in (${functions.map(literal).join(',')})`);
    assert.equal(existing.length, 0, 'Sales function name collision');
    report.checks.push('new_sales_objects_have_no_collisions');
  }
  const platformHistory = await query("select statements from supabase_migrations.schema_migrations where version='20260914000200'");
  if(platformHistory.length) {
    assert.equal(platformHistory[0].statements.join('\n').trim(),platformSql.trim(),'Platform migration differs');
    report.checks.push('exact_platform_migration_already_applied');
  } else {
    assert.equal((await query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname='sales_workspaces'")).length,0,'Platform workspace collision');
  }
  report.platform_migration_applied = platformHistory.length > 0;
  const secrets = await management('/secrets');
  assert.ok(secrets.some(x => x.name === 'OPENAI_API_KEY'), 'Production OpenAI key is missing');
  report.openai_key_configured = true;
  report.sales_model_configured = secrets.some(x => x.name === 'OPENAI_SALES_AGENT_MODEL');
  return { applied: history.length > 0, secrets };
}
try {
  const state = await preflight();
  if (mode === 'apply') {
    if (!state.applied) {
      await query(`begin; set local lock_timeout='5s'; set local statement_timeout='60s'; select pg_advisory_xact_lock(hashtext('faisal-production-migration')); ${sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('20260914000100','faisal_sales_agent_mvp',array[${literal(sql)}]); commit;`);
      report.checks.push('only_faisal_migration_applied_atomically');
    }
    if (!report.platform_migration_applied) {
      await query(`begin; set local lock_timeout='5s'; set local statement_timeout='60s'; ${platformSql}
insert into supabase_migrations.schema_migrations(version,name,statements) values('20260914000200','faisal_platform_sales_workspace',array[${literal(platformSql)}]); commit;`);
      report.checks.push('platform_sales_upgrade_applied_atomically');
    }
    if (!report.sales_model_configured) {
      await management('/secrets', { method: 'POST', body: JSON.stringify([{ name: 'OPENAI_SALES_AGENT_MODEL', value: 'gpt-4.1-mini-2025-04-14' }]) });
      report.checks.push('staging_validated_sales_model_configured');
    }
    await query("notify pgrst, 'reload schema'");
  }
  if (mode === 'verify') {
    assert.ok(state.applied && report.platform_migration_applied, 'Migrations not recorded');
    assert.equal((await query("select id from public.sales_workspaces where scope='platform' and status='Active'")).length,1);
    report.checks.push('one_active_platform_sales_workspace');
    const secured = await query(`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in (${tables.map(literal).join(',')})`);
    assert.equal(secured.length, 5); assert.ok(secured.every(x => x.relrowsecurity));
    report.checks.push('all_five_sales_tables_have_rls');
    const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/visaflow-sales-agent`, { method:'POST', headers:{ apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json' },body:JSON.stringify({action:'daily_brief'}),signal:AbortSignal.timeout(30000) });
    assert.ok([401,403].includes(response.status), `Anonymous request HTTP ${response.status}`);
    report.checks.push('deployed_function_rejects_anonymous_requests');
  }
  report.ok = true;
} catch (error) { report.ok = false; report.error = error.message; process.exitCode = 1; }
report.completed_at = new Date().toISOString();
await writeFile('faisal-production-result.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
