import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {FIELD_REUSED_TEMPLATES} from '../scripts/field-interview-reuse.mjs';
import {FIELD_INTERVIEW_CATALOG} from './fieldInterviewCatalog.mjs';
import {sectors,roles} from '../scripts/field-interview-data.mjs';
test('field expansion adds 75 complete templates, reuses eight, preserves prior content and isolates campaigns',async()=>{
 const db=new PGlite();
 try{
  const base=await readFile(new URL('../supabase/bootstrap/staging/production-schema-snapshot-20260727.sql',import.meta.url),'utf8');
  for(const t of ['ai_interview_templates','ai_interview_questions']) await db.exec(base.match(new RegExp(`CREATE TABLE public\\.${t} \\([^]*?\\n\\);`))[0]);
  const eng=await readFile(new URL('../supabase/migrations/20260812000100_talent_engineering_campaign.sql',import.meta.url),'utf8');
  await db.exec(eng.match(/create table if not exists public\.talent_public_campaigns \([^]*?\n\);/)[0]);
  await db.exec('create role anon;create role authenticated;create role service_role;create table public.companies(id uuid,created_at timestamptz default now());');
  const owner=FIELD_REUSED_TEMPLATES[0].company_id;
  assert.ok(FIELD_REUSED_TEMPLATES.every(t=>t.company_id===owner));
  await db.query('insert into public.companies(id) values($1)',[owner]);
  for(const file of ['20260911000100_talent_junior_accountant_campaign.sql','20260911000200_expand_interview_library.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  for(const t of FIELD_REUSED_TEMPLATES){
   await db.query("insert into public.ai_interview_templates(id,company_id,template_name,profession,profession_category,status,approval_status,is_active,is_global) values($1,$2,$3,$4,$5,'Active','Approved',true,true)",[t.id,owner,t.template_name,t.profession,t.profession_category]);
   await db.query("insert into public.ai_interview_questions(company_id,template_id,question_order,question_text) select $1,$2,n,'Legacy fixture question' from generate_series(1,$3::integer) n",[owner,t.id,t.question_count]);
  }
  const snapshot=async()=>({templates:(await db.query("select * from public.ai_interview_templates where coalesce(ai_analysis->>'catalog_release','') <> 'VF-FIELD-20260911' order by id")).rows,questions:(await db.query("select q.* from public.ai_interview_questions q join public.ai_interview_templates t on t.id=q.template_id where coalesce(t.ai_analysis->>'catalog_release','')<>'VF-FIELD-20260911' order by q.id")).rows});
  const before=await snapshot();
  const sql=await readFile(new URL('../supabase/migrations/20260911000300_field_interview_library.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual(await snapshot(),before);
  const ts=(await db.query("select * from public.ai_interview_templates where ai_analysis->>'catalog_release'='VF-FIELD-20260911'")).rows;
  assert.equal(ts.length,75);assert.equal(roles.length,25);
  assert.deepEqual(ts.map(t=>t.profession).sort(),FIELD_INTERVIEW_CATALOG.map(t=>t.profession).sort());
  for(const t of ts){
   assert.ok(t.is_global&&t.is_active&&t.is_locked&&t.is_current_version);assert.equal(t.approval_status,'Approved');
   const qs=(await db.query('select * from public.ai_interview_questions where template_id=$1 order by question_order',[t.id])).rows;
   assert.equal(qs.length,8);assert.equal(qs.reduce((a,q)=>a+Number(q.weight),0),100);
   assert.ok(qs.every(q=>q.question_text_ar&&q.question_text_en&&q.ideal_answer&&q.key_points.length>=3));
   assert.equal(qs[3].competency,'Practical verification');assert.doesNotMatch(qs[3].question_text,/In a sample of 100 instances/);
  }
  for(const s of sectors){
   const [{id}]=(await db.query('select id from public.talent_public_campaigns where slug=$1',[s.slug])).rows;
   const eligible=(await db.query('select id from public.ai_interview_templates where public.talent_campaign_template_is_eligible($1,id)',[id])).rows;
   assert.equal(eligible.length,15+s.reuseIds.length);
   for(const reused of s.reuseIds)assert.ok(eligible.some(t=>t.id===reused));
  }
  const [{id:campaign}]=(await db.query("select id from public.talent_public_campaigns where slug='technical-maintenance-2026'")).rows;
  const reused=FIELD_REUSED_TEMPLATES[0].id;
  await db.query("update public.ai_interview_templates set approval_status='Draft' where id=$1",[reused]);
  assert.equal((await db.query('select public.talent_campaign_template_is_eligible($1,$2) as ok',[campaign,reused])).rows[0].ok,false);
  await db.query("update public.ai_interview_templates set approval_status='Approved',company_id=gen_random_uuid() where id=$1",[reused]);
  assert.equal((await db.query('select public.talent_campaign_template_is_eligible($1,$2) as ok',[campaign,reused])).rows[0].ok,false);
 }finally{await db.close();}
});
