import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sectors} from './field-interview-data.mjs';
const project=process.env.SUPABASE_PROJECT_REF;
assert.equal(project,'zeocbftriydodzfgixjv');
assert.ok(process.env.SUPABASE_ACCESS_TOKEN);
const release='VF-FIELD-20260911';
const migration=await readFile('supabase/migrations/20260911000300_field_interview_library.sql','utf8');
async function query(sql) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:false}),signal:AbortSignal.timeout(120000),
  });
  if(!response.ok) throw new Error(`Database query failed HTTP ${response.status}: ${(await response.text()).slice(0,700)}`);
  return response.json();
}
const body=sql=>sql.match(/as (\$[a-z_]*\$)([^]*?)\1/i)?.[2]?.replace(/\s+/g,' ').trim();
const previous=await readFile('supabase/migrations/20260911000200_expand_interview_library.sql','utf8');
const [definition]=await query("select pg_get_functiondef('public.talent_campaign_template_is_eligible(uuid,uuid)'::regprocedure) as definition");
assert.ok([body(previous),body(migration)].includes(body(definition.definition)),'Production eligibility differs from reviewed version');
const snapshotSql=`select slug, public.get_public_talent_campaign(slug)->'templates' as templates from public.talent_public_campaigns where status='Active' and coalesce(settings->>'catalog_release','')<>'${release}' order by slug`;
const before=await query(snapshotSql);
const history=await query("select version from supabase_migrations.schema_migrations where version='20260911000300'");
if(!history.length) {
  // Keep requests below the Management API body limit. Each seed batch is atomic
  // and idempotent. Campaigns become available only after all templates exist.
  const catalog=JSON.parse(migration.match(/\$catalog\$([^]*?)\$catalog\$/)[1]);
  const seedOnly=migration.slice(0,migration.indexOf('create or replace function public.talent_campaign_template_is_eligible'));
  for(let offset=0;offset<catalog.length;offset+=3) {
    const batch=seedOnly.replace(/\$catalog\$[^]*?\$catalog\$/,()=>`$catalog$${JSON.stringify(catalog.slice(offset,offset+3))}$catalog$`)
      .replace(/\$campaigns\$[^]*?\$campaigns\$/,()=>'$campaigns$[]$campaigns$');
    await query(`begin; set local statement_timeout='45s'; ${batch} commit;`);
    console.log(`Verified template batch ${Math.min(offset+3,catalog.length)}/${catalog.length}`);
  }
  const [{count}]=await query(`select count(*)::integer as count from public.ai_interview_templates where ai_analysis->>'catalog_release'='${release}'`);
  assert.equal(count,75);
  const finalize=migration.replace(/\$catalog\$[^]*?\$catalog\$/,()=>'$catalog$[]$catalog$');
  const checksum=createHash('sha256').update(migration).digest('hex');
  await query(`begin; set local statement_timeout='45s'; ${finalize}
    insert into supabase_migrations.schema_migrations(version,name,statements)
      values('20260911000300','field_interview_library',ARRAY['-- Applied reviewed migration in idempotent template batches; SHA256 ${checksum}']); commit;`);
}
assert.deepEqual(await query(snapshotSql),before,'Previous campaign templates changed');
const summaries=[];
for(const s of sectors) {
  const [{campaign}]=await query(`select public.get_public_talent_campaign('${s.slug}') as campaign`);
  assert.equal(campaign?.templates?.length,15+s.reuseIds.length);
  assert.ok(campaign.templates.every(t=>s.reuseIds.includes(t.id) || t.question_count===8));
  summaries.push({slug:s.slug,name:campaign.name_ar,templates:campaign.templates.length});
}
const [counts]=await query(`select count(*)::integer as templates,
  count(*) filter(where is_global and is_active and is_locked and is_current_version and status='Active' and approval_status='Approved')::integer as approved,
  (select count(*)::integer from public.ai_interview_questions q join public.ai_interview_templates t on t.id=q.template_id where t.ai_analysis->>'catalog_release'='${release}' and q.is_active) as questions
  from public.ai_interview_templates where ai_analysis->>'catalog_release'='${release}'`);
assert.equal(counts.templates,75);assert.equal(counts.approved,75);assert.equal(counts.questions,600);
console.log(JSON.stringify({activated:true,...counts,campaigns:summaries,existingCampaignsVerified:before.length}));

console.log(JSON.stringify(await query("select count(*)::integer as global_approved_total from public.ai_interview_templates where is_global and is_active and is_current_version and status='Active' and approval_status='Approved'")));
