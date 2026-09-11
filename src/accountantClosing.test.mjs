import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {closingCases} from '../scripts/accountant-closing-data.mjs';
import {validateReadinessAnswers,readinessState} from './accountantReadiness.mjs';

const explanation='I identify the recognition period from the underlying agreement and evidence, correct the existing posting without duplicating cash, and reconcile the effect on the accounts before approval.';
const rationale=explanation+' I obtain completion and cutoff evidence and a supported cost estimate. A draft purchase order does not establish service delivery. Confirmed October work is accrued even if the invoice arrives later.';
const complete=(variant)=>({
 e1_debit:'1300',e1_credit:'5000',e1_amount:variant==='a'?11000:5500,e1_reason:explanation,
 e2_debit:'5100',e2_credit:'2100',e2_amount:variant==='a'?900:1400,e2_reason:explanation,
 e3_debit:'4000',e3_credit:'2200',e3_amount:variant==='a'?4000:7000,e3_reason:explanation,
 e4_debit:'4000',e4_credit:'1200',e4_amount:variant==='a'?2500:3500,e4_reason:explanation,
 profit_direction:variant==='a'?'up':'down',profit_amount:variant==='a'?3600:6400,
 assets_direction:'up',assets_amount:variant==='a'?8500:2000,rationale,
});
test('closing cases require substantive explanations and distinguish direction from amount',()=>{
 for(const [index,c] of closingCases.entries()){
  const answers=complete(index===0?'a':'b');
  assert.equal(validateReadinessAnswers({definition:c},answers,true),null);
  assert.equal(validateReadinessAnswers({definition:c},{...answers,e1_reason:'rent'},true),'explanation');
  assert.equal(validateReadinessAnswers({definition:c},{...answers,rationale:'short'},true),'explanation');
  for(const f of c.fields.filter(f=>f.type!=='text'))assert.equal(answers[f.key],f.expected);
  assert.equal(c.fields.reduce((n,f)=>n+f.weight,0),100);
 }
 assert.equal(readinessState({archived:true}),'Archived');
});
test('versioned close assigns one case, prevents variant switching, preserves historical attempts and grades four entries plus statement impact',async()=>{
 const db=new PGlite();
 const a='00000000-0000-0000-0000-000000000001',b='01000000-0000-0000-0000-000000000002';
 const asUser=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const dashboard=async()=>(await db.query('select public.get_my_accountant_readiness() as d')).rows[0].d;
 const save=async(code,answers,rev,submit)=>(await db.query('select public.save_accountant_readiness($1,$2,$3,$4,true) as d',[code,JSON.stringify(answers),rev,submit])).rows[0].d;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;
   create table public.talent_candidates(id uuid primary key,auth_user_id uuid,full_name text);
   create table public.users(auth_user_id uuid,company_id uuid,role text,is_active boolean,status text);
   insert into public.talent_candidates values('${a}','${a}','A'),('${b}','${b}','B');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260911000400_accountant_readiness.sql',import.meta.url),'utf8'));
  await asUser(a);await save('invoice-review-v1',{duplicate:'D3'},0,false);
  await db.exec('reset role');
  const before=(await db.query('select to_jsonb(a) as a from public.talent_readiness_attempts a')).rows;
  const definitions=(await db.query("select code,definition,answer_key from public.talent_readiness_tasks order by code")).rows;
  const sql=await readFile(new URL('../supabase/migrations/20260911000500_accountant_month_close.sql',import.meta.url),'utf8');
  try{await db.exec(sql);await db.exec(sql);}catch(e){throw new Error(e.message);}
  assert.deepEqual((await db.query('select to_jsonb(a) as a from public.talent_readiness_attempts a')).rows,before);
  assert.deepEqual((await db.query("select code,definition,answer_key from public.talent_readiness_tasks where version=1 order by code")).rows,definitions);
  await asUser(a);
  let data=await dashboard();assert.equal(data.tasks.length,2);assert.equal(data.tasks[0].code,'accountant-close-v2-a');assert.equal(data.tasks[1].archived,true);
  assert.doesNotMatch(JSON.stringify(data),/expected|answer_key|review_guide/);
  await assert.rejects(save('accountant-close-v2-b',complete('b'),0,true),/assigned case/);
  await assert.rejects(save('invoice-review-v1',{},1,false),/unavailable/);
  await assert.rejects(save('accountant-close-v2-a',{...complete('a'),e2_reason:''},0,true),/Complete every answer/);
  await assert.rejects(save('accountant-close-v2-a',{...complete('a'),e2_reason:'accrue'},0,true),/substantive explanation/);
  await assert.rejects(save('accountant-close-v2-a',{...complete('a'),rationale:'short'},0,true),/minimum length/);
  let draft=await save('accountant-close-v2-a',{e1_reason:'Draft'},0,false);assert.equal(draft.evidence,null);
  await assert.rejects(save('accountant-close-v2-a',complete('a'),0,true),/Draft changed/);
  const submitted=await save('accountant-close-v2-a',complete('a'),1,true);
  assert.equal(submitted.objective_score,100);assert.equal(submitted.review_status,'Pending');assert.equal(submitted.evidence.length,16);
  assert.equal((await save('accountant-close-v2-a',complete('a'),1,true)).id,submitted.id);
  await assert.rejects(save('accountant-close-v2-a',{...complete('a'),e1_amount:0},2,true),/locked/);
  await asUser(b);data=await dashboard();assert.equal(data.tasks.length,1);assert.equal(data.tasks[0].code,'accountant-close-v2-b');assert.equal(data.tasks[0].attempt,null);
  const partial=await save('accountant-close-v2-b',{...complete('b'),profit_direction:'up',e1_debit:'1001'},0,true);
  assert.equal(partial.objective_score,89);assert.equal(partial.review_status,'Pending');
  await assert.rejects(db.query('select * from public.talent_readiness_tasks'),/permission denied/);
  await assert.rejects(db.query('select public.get_accountant_readiness_reviews(0)'),/owner access/);
 }finally{await db.close();}
});
