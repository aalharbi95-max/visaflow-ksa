import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const project=process.env.SUPABASE_PROJECT_REF;
assert.equal(project,'zeocbftriydodzfgixjv');
assert.equal(process.env.CONFIRM_PROJECT_REF,project);
assert.ok(process.env.SUPABASE_ACCESS_TOKEN);
const version='20260911000400';
const sql=await readFile(`supabase/migrations/${version}_accountant_readiness.sql`,'utf8');
const checksum=createHash('sha256').update(sql).digest('hex');
async function query(statement) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:statement,read_only:false}),signal:AbortSignal.timeout(60000),
  });
  if(!response.ok)throw new Error(`Database query failed: ${response.status} ${(await response.text()).slice(0,500)}`);
  return response.json();
}
const snapshot="select slug,public.get_public_talent_campaign(slug)->'templates' as templates from public.talent_public_campaigns where status='Active' order by slug";
const before=await query(snapshot);
const history=await query(`select version,statements from supabase_migrations.schema_migrations where version='${version}'`);
if(!history.length) {
  const [existing]=await query("select to_regclass('public.talent_readiness_tasks')::text as relation");
  assert.equal(existing.relation,null,'Untracked readiness tables require review');
  await query(`begin; set local statement_timeout='45s'; ${sql}
    insert into supabase_migrations.schema_migrations(version,name,statements)
      values('${version}','accountant_readiness',ARRAY['-- Reviewed readiness pilot SHA256 ${checksum}']); commit;`);
} else assert.ok(history[0].statements.join('\n').includes(checksum),'Applied migration checksum differs');
assert.deepEqual(await query(snapshot),before,'Existing campaigns must not change');
const tasks=await query(`select code,version,skill,jsonb_array_length(definition->'fields') as fields,
  (select sum((f->>'weight')::integer) from jsonb_array_elements(definition->'fields') f)::integer as weights,
  definition::text like '%"expected"%' as exposed_key from public.talent_readiness_tasks where active order by code`);
assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.weights===100&&!t.exposed_key));
const tables=await query(`select c.relname,c.relrowsecurity,
  has_table_privilege('anon',c.oid,'SELECT') as anon_read,has_table_privilege('authenticated',c.oid,'SELECT') as client_read,
  has_table_privilege('authenticated',c.oid,'UPDATE') as client_write
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('talent_readiness_tasks','talent_readiness_attempts','talent_readiness_review_events')`);
assert.equal(tables.length,3);assert.ok(tables.every(t=>t.relrowsecurity&&!t.anon_read&&!t.client_read&&!t.client_write));
console.log(JSON.stringify({activated:true,tasks,protectedTables:tables.length,existingCampaignsVerified:before.length,version}));
