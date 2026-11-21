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
if(process.argv.includes('--correct-cv-experience')){
  assert.equal(ref,'zeocbftriydodzfgixjv');
  report.corrected=await query(`update public.talent_candidates c set years_experience=5.5
    from public.talent_guest_submissions g where g.candidate_id=c.id
    and g.request_id='711f5a9d-284e-47c0-81e6-689d8dd85016'::uuid
    and c.public_reference='VF-TAL-A2C2BE9599' and c.years_experience=9
    returning c.public_reference,c.years_experience`);
}
if(history.length){
  report.liveSubmission=await query(`select c.public_reference, c.auth_user_id is null as without_account,
    c.marketplace_status, c.profile_visibility, c.years_experience, c.published_at is not null as published,
    c.employer_sharing_consent, c.employer_contact_sharing_consent,
    public.is_consented_guest_cv(c.id) as guest_eligible,
    d.size_bytes, exists(select 1 from storage.objects o where o.bucket_id=d.storage_bucket and o.name=d.storage_path) as file_exists
    from public.talent_guest_submissions g join public.talent_candidates c on c.id=g.candidate_id
    join public.talent_candidate_documents d on d.id=g.document_id
    where g.request_id='711f5a9d-284e-47c0-81e6-689d8dd85016'::uuid`);
}
if(process.argv.includes('--apply')&&!history.length){
  const literal=s=>`'${s.replaceAll("'","''")}'`;
  const sql=migration.replace(/commit;\s*$/i,()=>`insert into supabase_migrations.schema_migrations(version,name,statements) values ('${version}','guest_cv_upload',array[${literal(migration)}]);\ncommit;`);
  await query(sql);report.applied=true;
}
await writeFile('guest-cv-release-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
