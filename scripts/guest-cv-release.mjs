import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF;
assert.ok(['zeocbftriydodzfgixjv','iijhdilfzndqlguefipn'].includes(ref),'Known project required');
assert.equal(process.env.SUPABASE_URL,`https://${ref}.supabase.co`);
assert.ok(process.env.SUPABASE_ACCESS_TOKEN);
async function query(sql){
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});
  if(!response.ok) throw Error(`Database request failed: ${response.status} ${(await response.text()).slice(0,1000)}`);
  return response.json();
}
const version='20261121000100';
const migration=await readFile('supabase/migrations/20261121000100_guest_cv_upload.sql','utf8');
const history=await query(`select version from supabase_migrations.schema_migrations where version='${version}'`);
const functions=await query(`select proname, pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname in ('list_company_talent_marketplace_page','list_company_talent_marketplace_filtered_page','get_company_talent_campaign_cv','can_current_company_read_talent_cv')`);
assert.equal(functions.length,4,'Expected marketplace functions');
if(!history.length){for(const f of functions.filter(f=>f.proname.startsWith('list_company'))){assert.ok(f.definition.includes('candidate.is_verified is true'));assert.ok(f.definition.includes('coalesce(cv.available, false)'));}}
const size=await query(`select pg_database_size(current_database())::text database_bytes,
  (select count(*)::text from storage.objects) storage_objects,
  (select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end),0)::text from storage.objects) storage_bytes`);
const report={project:ref,priorMigration:history.length>0,size,functions:functions.map(f=>f.proname),applied:false};
if(process.argv.includes('--apply')&&!history.length){
  const literal=s=>`'${s.replaceAll("'","''")}'`;
  const sql=migration.replace(/commit;\s*$/i,`insert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','guest_cv_upload',array[${literal(migration)}]);\ncommit;`);
  await query(sql);report.applied=true;
}
await writeFile('guest-cv-release-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
