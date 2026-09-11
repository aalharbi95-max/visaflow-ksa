import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {accountantTasks} from '../scripts/accountant-readiness-data.mjs';
import {normalizeReadinessAmount,readinessState,validateReadinessAnswers} from './accountantReadiness.mjs';

test('readiness distinguishes unmeasured, objective score and human review; amounts never coerce blank to zero',()=>{
  const task={definition:{...accountantTasks[0],threshold:80}};
  assert.equal(readinessState(task),'NotStarted');
  assert.equal(readinessState({...task,attempt:{status:'Submitted',objective_score:100,review_status:'Pending'}}),'Pending');
  assert.equal(readinessState({...task,attempt:{status:'Submitted',objective_score:75,review_status:'Confirmed'}}),'NeedsDevelopment');
  assert.equal(readinessState({...task,attempt:{status:'Submitted',objective_score:100,review_status:'Confirmed'}}),'Confirmed');
  assert.equal(normalizeReadinessAmount('١٢٣٫٥٠'),'123.50');
  assert.equal(normalizeReadinessAmount('۱۲۳'),'123');
  assert.equal(validateReadinessAnswers(task,{},true),'required');
  assert.equal(validateReadinessAnswers(task,{correct_amount:' '},false),'amount');
  assert.equal(validateReadinessAnswers(task,{correct_amount:'Infinity'},false),'amount');
});

test('Postgres pilot protects keys and candidate isolation, scores on server, locks submissions, checks revisions and audits owner reviews',async()=>{
  const db=new PGlite();
  const user1='00000000-0000-0000-0000-000000000001',user2='00000000-0000-0000-0000-000000000002',owner='00000000-0000-0000-0000-000000000003';
  const rationale='I compare the original invoices and bank evidence, document corrections and request approval while preserving the audit trail.';
  const correct=Object.fromEntries(accountantTasks.map(t=>[t.code,{...Object.fromEntries(t.fields.map(f=>[f.key,f.expected])),rationale}]));
  async function asUser(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
  const dashboard=async()=> (await db.query('select public.get_my_accountant_readiness() as data')).rows[0].data;
  const save=async(code,answers,revision,submit=false,consent=true)=>(await db.query('select public.save_accountant_readiness($1,$2,$3,$4,$5) as data',[code,JSON.stringify(answers),revision,submit,consent])).rows[0].data;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon;
      create table public.talent_candidates(id uuid primary key default gen_random_uuid(),auth_user_id uuid unique,full_name text);
      create table public.users(auth_user_id uuid,company_id uuid,role text,is_active boolean,status text);
      insert into public.talent_candidates(auth_user_id,full_name) values('${user1}','Candidate One'),('${user2}','Candidate Two');
      insert into public.users values('${owner}',null,'Platform Owner',true,'Active');`);
    const migration=await readFile(new URL('../supabase/migrations/20260911000400_accountant_readiness.sql',import.meta.url),'utf8');
    try {await db.exec(migration);await db.exec(migration);}catch(e){throw new Error(e.message);}
    assert.equal((await db.query('select count(*)::integer as n from public.talent_readiness_tasks')).rows[0].n,2);
    await db.exec('set role anon');
    await assert.rejects(dashboard,/permission denied/);
    await asUser(user1);
    const initial=await dashboard();assert.equal(initial.tasks.length,2);assert.ok(initial.tasks.every(t=>t.attempt===null));
    assert.doesNotMatch(JSON.stringify(initial),/answer_key|expected|review_guide|reviewer/);
    for(const table of ['talent_readiness_tasks','talent_readiness_attempts','talent_readiness_review_events']){
      await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);
      await assert.rejects(db.query(`delete from public.${table}`),/permission denied/);
    }
    await assert.rejects(db.query('select public.get_accountant_readiness_reviews(0)'),/owner access/);
    await assert.rejects(save('invoice-review-v1',{},0,false,false),/Consent/);
    await assert.rejects(save('invoice-review-v1',{objective_score:100},0),/Unknown answer/);
    await assert.rejects(save('invoice-review-v1',{correct_amount:'NaN'},0),/valid nonnegative/);
    await assert.rejects(save('invoice-review-v1',{duplicate:'unknown'},0),/listed option/);
    await assert.rejects(save('invoice-review-v1',{rationale},0,true),/Complete every answer/);
    await assert.rejects(save('invoice-review-v1',{},0,true),/Explain your approach/);
    let draft=await save('invoice-review-v1',{duplicate:'D3'},0);
    assert.equal(draft.objective_score,null);assert.equal(draft.evidence,null);assert.equal(draft.revision,1);
    assert.equal((await dashboard()).tasks.find(t=>t.code==='invoice-review-v1').attempt.answers.duplicate,'D3');
    await assert.rejects(save('invoice-review-v1',{duplicate:'D2'},0),/Draft changed/);
    let submitted=await save('invoice-review-v1',correct['invoice-review-v1'],1,true);
    assert.equal(submitted.objective_score,100);assert.equal(submitted.status,'Submitted');assert.equal(submitted.review_status,'Pending');assert.equal(submitted.evidence.length,4);
    const repeated=await save('invoice-review-v1',correct['invoice-review-v1'],1,true);assert.equal(repeated.id,submitted.id);assert.equal(repeated.revision,2);
    await assert.rejects(save('invoice-review-v1',{...correct['invoice-review-v1'],correct_total:0},2,true),/locked/);
    const bank=await save('bank-reconciliation-v1',correct['bank-reconciliation-v1'],0,true);assert.equal(bank.objective_score,100);
    await asUser(user2);
    assert.ok((await dashboard()).tasks.every(t=>t.attempt===null));
    await assert.rejects(db.query('select public.request_accountant_readiness_review($1,$2)',[submitted.id,'Please review the explanation']),/unavailable/);
    const wrong=await save('invoice-review-v1',{...correct['invoice-review-v1'],correct_total:0},0,true);assert.equal(wrong.objective_score,75);
    await asUser(owner);
    const queue=(await db.query('select public.get_accountant_readiness_reviews(0) as data')).rows[0].data;
    assert.equal(queue.total,3);assert.ok(queue.items[0].answer_key);
    await assert.rejects(db.query('select public.review_accountant_readiness($1,$2,$3,$4)',[submitted.id,0,'Confirmed',rationale]),/Review changed/);
    await db.query('select public.review_accountant_readiness($1,$2,$3,$4)',[submitted.id,2,'Confirmed',rationale]);
    await asUser(user1);
    let reviewed=(await dashboard()).tasks.find(t=>t.code==='invoice-review-v1');assert.equal(readinessState(reviewed),'Confirmed');
    await db.query('select public.request_accountant_readiness_review($1,$2)',[submitted.id,'Please check my correction explanation']);
    await db.query('select public.request_accountant_readiness_review($1,$2)',[submitted.id,'Please check my correction explanation']);
    reviewed=(await dashboard()).tasks.find(t=>t.code==='invoice-review-v1');assert.equal(reviewed.attempt.review_status,'Pending');assert.equal(reviewed.attempt.revision,4);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::integer as n from public.talent_readiness_review_events')).rows[0].n,2);
    await db.query('update public.users set is_active=false where auth_user_id=$1',[owner]);await asUser(owner);
    await assert.rejects(db.query('select public.get_accountant_readiness_reviews(0)'),/owner access/);
    await db.exec('reset role');await db.query('update public.users set is_active=true,company_id=gen_random_uuid() where auth_user_id=$1',[owner]);await asUser(owner);
    await assert.rejects(db.query('select public.get_accountant_readiness_reviews(0)'),/owner access/);
    await asUser('');await assert.rejects(dashboard,/authentication/);
  } finally {await db.close();}
});
