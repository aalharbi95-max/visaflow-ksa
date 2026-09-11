import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {EXPANDED_INTERVIEW_CATALOG} from './expandedInterviewCatalog.mjs';
import {EXPANDED_TALENT_CAMPAIGNS} from './expandedTalentCampaigns.mjs';
import {getAvailableTalentCampaigns} from './talentCampaign.mjs';
test('90 approved templates execute twice safely, match the catalog and isolate six campaigns',async()=>{
  const db=new PGlite();
  try {
    const snapshot=await readFile(new URL('../supabase/bootstrap/staging/production-schema-snapshot-20260727.sql',import.meta.url),'utf8');
    for(const table of ['ai_interview_templates','ai_interview_questions']) await db.exec(snapshot.match(new RegExp(`CREATE TABLE public\\.${table} \\([^]*?\\n\\);`))[0]);
    const eng=await readFile(new URL('../supabase/migrations/20260812000100_talent_engineering_campaign.sql',import.meta.url),'utf8');
    await db.exec(eng.match(/create table if not exists public\.talent_public_campaigns \([^]*?\n\);/)[0]);
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.companies (id uuid default gen_random_uuid(), created_at timestamptz default now()); insert into public.companies default values;`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260911000100_talent_junior_accountant_campaign.sql',import.meta.url),'utf8'));
    const before=(await db.query('select * from public.ai_interview_templates')).rows;
    await db.query("insert into public.ai_interview_templates(company_id,template_name,profession,profession_category,is_global,is_active,status,approval_status) values($1,'Existing procurement','Existing procurement','Procurement & Supply Chain',true,true,'Active','Approved')",[before[0].company_id]);
    const sql=await readFile(new URL('../supabase/migrations/20260911000200_expand_interview_library.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    assert.deepEqual((await db.query('select * from public.ai_interview_templates where id=$1',[before[0].id])).rows,before);
    const ts=(await db.query("select * from public.ai_interview_templates where ai_analysis->>'catalog_release'='VF-EXPANSION-20260911'")).rows;
    assert.equal(ts.length,90);
    assert.equal(new Set(ts.map(t=>t.profession)).size,90);
    assert.deepEqual(ts.map(t=>t.profession).sort(),EXPANDED_INTERVIEW_CATALOG.map(t=>t.profession).sort());
    for(const t of ts) {
      assert.equal(t.approval_status,'Approved'); assert.equal(t.status,'Active'); assert.ok(t.is_global && t.is_locked && t.is_current_version);
      const qs=(await db.query('select * from public.ai_interview_questions where template_id=$1 order by question_order',[t.id])).rows;
      assert.equal(qs.length,8); assert.equal(qs.reduce((s,q)=>s+Number(q.weight),0),100);
      assert.equal(new Set(qs.map(q=>q.question_text)).size,8);
      assert.deepEqual(qs.map(q=>q.question_order),[1,2,3,4,5,6,7,8]);
      assert.ok(qs.every(q=>q.question_text_ar && q.question_text_en && q.ideal_answer && q.key_points.length>=3 && q.scoring_guide.excellent));
    }
    const campaigns=(await db.query("select * from public.talent_public_campaigns where settings->>'catalog_release'='VF-EXPANSION-20260911'")).rows;
    assert.equal(campaigns.length,6);
    for(const c of campaigns) {
      const eligible=(await db.query('select id,profession_category,ai_analysis from public.ai_interview_templates where public.talent_campaign_template_is_eligible($1,id)',[c.id])).rows;
      assert.equal(eligible.length,15); assert.equal(new Set(eligible.map(t=>t.profession_category)).size,1);
      for(const level of ['entry','professional','supervisor']) assert.equal(eligible.filter(t=>t.ai_analysis.level===level).length,5);
    }
    const first=ts[0]; const c=campaigns.find(c=>c.name_en.includes(first.profession_category));
    await db.query("update public.ai_interview_templates set approval_status='Draft' where id=$1",[first.id]);
    assert.equal((await db.query('select public.talent_campaign_template_is_eligible($1,$2) as ok',[c.id,first.id])).rows[0].ok,false);
    await db.query("update public.ai_interview_templates set approval_status='Approved',company_id=gen_random_uuid() where id=$1",[first.id]);
    assert.equal((await db.query('select public.talent_campaign_template_is_eligible($1,$2) as ok',[c.id,first.id])).rows[0].ok,false);
    assert.equal(EXPANDED_TALENT_CAMPAIGNS.length,6);
    for(const language of ['AR','EN']) assert.equal(getAvailableTalentCampaigns(language).length,16);
  }finally{await db.close();}
});
