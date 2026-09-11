import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const project=process.env.SUPABASE_PROJECT_REF;
assert.equal(project,'zeocbftriydodzfgixjv');
assert.equal(process.env.CONFIRM_PROJECT_REF,project);
assert.ok(process.env.SUPABASE_ACCESS_TOKEN);
const version='20260911000500';
const sql=await readFile(`supabase/migrations/${version}_accountant_month_close.sql`,'utf8');
const prior=await readFile('supabase/migrations/20260911000400_accountant_readiness.sql','utf8');
const checksum=createHash('sha256').update(sql).digest('hex');
async function query(statement) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:statement,read_only:false}),signal:AbortSignal.timeout(60000),
  });
  if(!response.ok)throw new Error(`Database query failed: ${response.status}`);
  return response.json();
}
const snapshots=[
  "select count(*) as n,md5(coalesce(string_agg(to_jsonb(a)::text,'|' order by a.id),'')) as digest from public.talent_readiness_attempts a",
  "select md5(string_agg((to_jsonb(t)-'active')::text,'|' order by code)) as digest from public.talent_readiness_tasks t where code in ('invoice-review-v1','bank-reconciliation-v1')",
  "select slug,public.get_public_talent_campaign(slug)->'templates' as templates from public.talent_public_campaigns where status='Active' order by slug",
];
const before=[];for(const q of snapshots)before.push(await query(q));
const history=await query(`select version,statements from supabase_migrations.schema_migrations where version='${version}'`);
if(!history.length) {
  const normalize=s=>s.replace(/\s+/g,' ').trim();
  for(const name of ['get_my_accountant_readiness','save_accountant_readiness']) {
    const expected=prior.match(new RegExp(`create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,'i'))?.[1];
    assert.ok(expected,`Missing prior function ${name}`);
    const rows=await query(`select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${name}'`);
    assert.ok(rows.length===1&&normalize(rows[0].prosrc)===normalize(expected),`Production function changed: ${name}`);
  }
  await query(`begin; set local statement_timeout='45s'; ${sql}
    insert into supabase_migrations.schema_migrations(version,name,statements)
    values('${version}','accountant_month_close',ARRAY['-- Reviewed month-close case SHA256 ${checksum}']); commit;`);
} else assert.ok(history[0].statements.join('\n').includes(checksum),'Applied migration checksum differs');
for(let i=0;i<snapshots.length;i++)assert.deepEqual(await query(snapshots[i]),before[i],`Preserved data snapshot ${i}`);
const tasks=await query(`select code,version,jsonb_array_length(definition->'fields') as fields,
  (select sum((f->>'weight')::integer) from jsonb_array_elements(definition->'fields') f)::integer as weights,
  definition::text like '%"expected"%' as exposed_key from public.talent_readiness_tasks where active order by code`);
assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.version===2&&t.fields===20&&t.weights===100&&!t.exposed_key));
console.log(JSON.stringify({activated:true,version,tasks,preservedAttempts:before[0][0].n,preservedCampaigns:before[2].length}));
