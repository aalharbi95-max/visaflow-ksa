import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('automatic introductions enforce owner settings, caps, suppression, deduplication and no quote sending',async()=>{
 const db=new PGlite();const owner='40000000-0000-0000-0000-000000000001',customer='40000000-0000-0000-0000-000000000002';
 try {
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to authenticated,anon,service_role;
   create table companies(id uuid primary key,status text);create table users(id bigint primary key,auth_user_id uuid,company_id uuid,role text,status text,is_active boolean);
   insert into users values(1,'${owner}',null,'Platform Owner','Active',true),(2,'${customer}',null,'Admin','Active',true);`);
  for(const file of ['20260914000100_faisal_sales_agent_mvp','20260914000200_faisal_platform_sales_workspace','20260914000300_faisal_automatic_introductions'])await db.exec(await readFile(new URL(`../supabase/migrations/${file}.sql`,import.meta.url),'utf8'));
  const w=(await db.query("select id from sales_workspaces where scope='platform'")).rows[0].id;
  const actor=async id=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
  await actor(customer);await assert.rejects(db.query('select sales_configure_automation(true,10)'),/forbidden/);
  await actor(owner);await db.query('select sales_configure_automation(true,10)');
  await assert.rejects(db.query('select sales_claim_intro_delivery()'),/permission denied/);
  await assert.rejects(db.query('select unsubscribe_token from sales_intro_deliveries'),/permission denied/);
  await db.exec('reset role;set role service_role');
  const register=async email=>(await db.query('select sales_register_discovered_intro($1,$2,$3,$4,$5,$6) id',[w,'Example',email,'https://example.com','https://example.com/contact','FM'])).rows[0].id;
  assert.ok(await register('a@example.com'));assert.equal(await register('a@example.com'),null);
  assert.ok(await register('b@example.com'));assert.ok(await register('c@example.com'));
  const first=(await db.query('select to_jsonb(sales_claim_intro_delivery()) d')).rows[0].d;
  assert.equal(first.status,'sending');assert.equal((await db.query('select sales_intro_may_send($1) ok',[first.id])).rows[0].ok,true);
  assert.equal((await db.query('select to_jsonb(sales_claim_intro_delivery()) d')).rows[0].d.status,'sending');
  assert.equal((await db.query('select to_jsonb(sales_claim_intro_delivery()) d')).rows[0].d,null,'Hourly capacity counts reservations, not only sent rows');
  await db.query('select sales_intro_suppress($1)',[first.unsubscribe_token]);
  assert.equal((await db.query('select sales_intro_may_send($1) ok',[first.id])).rows[0].ok,false);
  assert.equal(await register(first.email),null);
  await actor(customer);assert.equal((await db.query('select id,email,status from sales_intro_deliveries')).rows.length,0);
  await actor(owner);await db.query('select sales_configure_automation(false,10)');
  await db.exec('reset role;set role service_role');assert.equal((await db.query('select to_jsonb(sales_claim_intro_delivery()) d')).rows[0].d,null);
  await assert.rejects(db.query(`update sales_intro_deliveries set template_version='pricing-quote'`),/check constraint/);
 }finally{await db.close();}
});

test('Platform subscription sales upgrade preserves legacy data and enforces owner-only access', async () => {
 const db = new PGlite();
 const company='20000000-0000-0000-0000-000000000001';
 const owner='30000000-0000-0000-0000-000000000001', customer='30000000-0000-0000-0000-000000000002';
 try {
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to authenticated,anon,service_role;
   create table companies(id uuid primary key,status text);
   create table users(id bigint primary key,auth_user_id uuid,company_id uuid,role text,status text,is_active boolean);
   insert into companies values('${company}','Active');
   insert into users values(1,'${owner}',null,'Platform Owner','Active',true),(2,'${customer}','${company}','Admin','Active',true);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260914000100_faisal_sales_agent_mvp.sql',import.meta.url),'utf8'));
  await db.exec(`insert into sales_leads(company_id,company_name) values('${company}','Existing tenant lead')`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260914000200_faisal_platform_sales_workspace.sql',import.meta.url),'utf8'));
  const workspace=(await db.query("select id from sales_workspaces where scope='platform'")).rows[0].id;
  assert.equal((await db.query('select count(*)::int n from companies')).rows[0].n,1,'No synthetic company created');
  assert.equal((await db.query(`select count(*)::int n from sales_leads where workspace_id='${company}'`)).rows[0].n,1,'Legacy data preserved');
  const actor=async id=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
  await actor(owner);
  assert.equal((await db.query('select * from sales_workspaces')).rows.length,1);
  assert.equal((await db.query('select * from sales_leads')).rows.length,0,'Owner cannot silently consume legacy tenant leads');
  const lead=(await db.query(`insert into sales_leads(workspace_id,company_name,contact_email) values('${workspace}','Potential subscriber','prospect@example.invalid') returning id`)).rows[0].id;
  await assert.rejects(db.query(`insert into sales_leads(workspace_id,company_name) values('${company}','Forged scope')`),/row-level security/);
  await actor(customer);
  for(const table of ['sales_workspaces','sales_leads','sales_tasks','sales_interactions','sales_agent_runs','sales_agent_approvals']) assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
  await assert.rejects(db.query(`insert into sales_leads(workspace_id,company_name) values('${workspace}','Customer attack')`),/row-level security/);
  await db.exec('reset role;set role service_role');
  await assert.rejects(db.query('select sales_start_run($1,$2,$3,$4,$5,false)',[workspace,lead,'draft_outreach',customer,{}]),/forbidden/);
  await assert.rejects(db.query('select sales_start_run($1,$2,$3,$4,$5,false)',[company,null,'daily_brief',owner,{}]),/workspace_not_found/);
  const start=async action=>(await db.query('select sales_start_run($1,$2,$3,$4,$5,false) id',[workspace,lead,action,owner,{reply_text:'pricing'}])).rows[0].id;
  const finish=async(run,result)=>(await db.query('select sales_complete_run($1,$2,$3,null) result',[workspace,run,result])).rows[0].result;
  const run=await start('draft_outreach'), draft=await finish(run,{subject:'VisaFlow subscription',body:'Draft only'});
  assert.equal(draft.status,'pending'); assert.equal((await finish(run,{subject:'Replay',body:'Replay'})).approval_id,draft.approval_id);
  await db.query(`insert into sales_tasks(workspace_id,lead_id,task_type,title) values('${workspace}','${lead}','FOLLOW_UP','Review subscription interest')`);
  const legacyLead=(await db.query(`select id from sales_leads where workspace_id='${company}'`)).rows[0].id;
  await assert.rejects(db.query(`insert into sales_tasks(workspace_id,lead_id,task_type,title) values('${workspace}','${legacyLead}','FOLLOW_UP','Cross workspace')`),/foreign key/);
  const pricing=await finish(await start('classify_reply'),{classification:'REQUEST_PRICING',requires_ceo_approval:false,follow_up_days:null});
  await actor(customer);
  for(const table of ['sales_leads','sales_tasks','sales_interactions','sales_agent_runs','sales_agent_approvals']) assert.equal((await db.query(`select * from ${table}`)).rows.length,0,'Customer cannot read populated platform sales tables');
  await assert.rejects(db.query('select sales_decide_approval($1,$2,$3)',[pricing.approval_id,'approved','']),/forbidden/);
  await actor(owner);
  await assert.rejects(db.query(`update sales_agent_approvals set status='approved'`),/permission denied/);
  const decision=(await db.query('select sales_decide_approval($1,$2,$3) result',[pricing.approval_id,'approved','Owner reviewed'])).rows[0].result;
  assert.equal(decision.delivery_enabled,false);
  await db.exec('reset role;set role service_role');
  const stale=await start('draft_outreach');
  await finish(await start('classify_reply'),{classification:'UNSUBSCRIBE',follow_up_days:3});
  await assert.rejects(finish(stale,{subject:'Stale',body:'Stale'}),/lead_do_not_contact/);
  assert.equal((await db.query(`select count(*)::int n from sales_agent_approvals where workspace_id='${workspace}' and status in ('pending','approved')`)).rows[0].n,0);
  await assert.rejects(db.query(`insert into sales_interactions(workspace_id,lead_id,direction,interaction_type) values('${workspace}','${lead}','outbound','email')`),/check constraint/);
  await actor(owner);await assert.rejects(db.query(`update sales_leads set do_not_contact=false where id='${lead}'`),/cannot_be_cleared/);
  await db.exec(`reset role;update users set is_active=false where auth_user_id='${owner}'`);
  await actor(owner);assert.equal((await db.query('select * from sales_leads')).rows.length,0);
 } finally { await db.close(); }
});

const A='00000000-0000-0000-0000-000000000001', B='00000000-0000-0000-0000-000000000002';
const uid=n=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('Faisal PostgreSQL authorization and transactional safety', async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      create table companies(id uuid primary key,status text);
      create table users(id bigint primary key,auth_user_id uuid,company_id uuid,role text,status text,is_active boolean);
      insert into companies values('${A}','Active'),('${B}','Active');
      insert into users values(1,'${uid(1)}','${A}','Admin','Active',true),(2,'${uid(2)}','${B}','Admin','Active',true),
      (3,'${uid(3)}','${A}','Agency','Active',true),(4,'${uid(4)}','${A}','Recruitment Officer','Active',true),
      (5,'${uid(5)}','${A}','Recruitment Manager','Active',true),(6,'${uid(6)}','${A}','CEO','Active',true),
      (7,'${uid(7)}',null,'Platform Owner','Active',true),(8,'${uid(8)}','${A}','Admin','Inactive',false),
      (9,'${uid(9)}','${A}','Admin','Active',true),(10,'${uid(9)}','${A}','Admin','Inactive',false);`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260914000100_faisal_sales_agent_mvp.sql',import.meta.url),'utf8'));
    const leadA=(await db.query(`insert into sales_leads(company_id,company_name,contact_email) values('${A}','Lead A','a@example.test') returning id`)).rows[0].id;
    const leadB=(await db.query(`insert into sales_leads(company_id,company_name) values('${B}','Lead B') returning id`)).rows[0].id;
    const actor=async n=>{await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(n)}',false)`);};
    const root=()=>db.exec('reset role');
    const start=async(action,lead=leadA,tenant=A)=>{
      await root();await db.exec('set role service_role');
      return (await db.query(`select sales_start_run($1,$2,$3,$4,$5,false) id`,[tenant,lead,action,uid(1),{reply_text:'Please send pricing'}])).rows[0].id;
    };
    const finish=async(run,result)=>{await root();await db.exec('set role service_role');return (await db.query('select sales_complete_run($1,$2,$3,null) result',[A,run,result])).rows[0].result;};
    await t.test('all five tables enforce RLS and foreign tenant reads/writes are denied',async()=>{
      const protectedRows=await db.query("select relname from pg_class where relname in ('sales_leads','sales_tasks','sales_interactions','sales_agent_runs','sales_agent_approvals') and relrowsecurity");assert.equal(protectedRows.rows.length,5);
      await actor(1);assert.equal((await db.query('select * from sales_leads')).rows.length,1);
      await assert.rejects(db.query(`insert into sales_leads(company_id,company_name) values('${B}','forged')`),/row-level security/);
      assert.equal((await db.query(`update sales_leads set company_name='forged' where id='${leadB}' returning id`)).rows.length,0);
      await assert.rejects(db.query(`update sales_leads set company_id='${B}' where id='${leadA}'`),/permission denied/);
      await assert.rejects(db.query(`insert into sales_tasks(company_id,lead_id,task_type,title) values('${A}','${leadB}','FOLLOW_UP','forged')`),/foreign key/);
      for(const n of [3,8,9]) {await actor(n);assert.equal((await db.query('select * from sales_leads')).rows.length,0);}
      await root();await db.exec('set role anon');await assert.rejects(db.query('select * from sales_leads'),/permission denied/);
      await actor(7);assert.equal((await db.query('select * from sales_leads')).rows.length,2);
    });
    let draftId;
    await t.test('draft and approval commit atomically, replay is idempotent, cross tenant links rejected',async()=>{
      const run=await start('draft_outreach');const result=await finish(run,{subject:'Subject',body:'Draft'});draftId=result.approval_id;
      assert.equal(result.status,'pending');assert.equal((await finish(run,{subject:'Changed',body:'Changed'})).approval_id,draftId);
      const count=(await db.query('select count(*)::integer n from sales_interactions')).rows[0].n;assert.equal(count,1);
      await assert.rejects(db.query(`insert into sales_interactions(company_id,lead_id,direction,interaction_type) values('${A}','${leadB}','internal','note')`),/foreign key/);
      await assert.rejects(db.query(`insert into sales_interactions(company_id,lead_id,direction,interaction_type) values('${A}','${leadA}','outbound','email')`),/check constraint/);
      await assert.rejects(db.query(`insert into sales_agent_approvals(company_id,lead_id,run_id,approval_type) values('${B}','${leadB}','${run}','PRICING')`),/foreign key/);
      await actor(2);for(const table of ['sales_interactions','sales_agent_runs','sales_agent_approvals']) assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
      await actor(1);await assert.rejects(db.query(`update sales_agent_approvals set status='approved' where id='${draftId}'`),/permission denied/);
      await assert.rejects(db.query(`select sales_complete_run('${A}','${run}','{}',null)`),/permission denied/);
      await actor(4);await assert.rejects(db.query(`select sales_decide_approval('${draftId}','approved','')`),/forbidden/);
      await actor(2);await assert.rejects(db.query(`select sales_decide_approval('${draftId}','approved','')`),/forbidden/);
    });
    await t.test('pricing always creates approval despite false model flag and only senior roles decide',async()=>{
      const run=await start('classify_reply');const result=await finish(run,{classification:'REQUEST_PRICING',requires_ceo_approval:false,follow_up_days:null});
      assert.ok(result.approval_id);assert.equal(result.requires_ceo_approval,true);
      await actor(5);await assert.rejects(db.query(`select sales_decide_approval('${result.approval_id}','approved','')`),/pricing_approval_forbidden/);
      await actor(6);const approved=(await db.query(`select sales_decide_approval('${result.approval_id}','approved','Reviewed') result`)).rows[0].result;
      assert.equal(approved.delivery_enabled,false);
      await assert.rejects(db.query(`select sales_decide_approval('${result.approval_id}','rejected','')`),/already_decided/);
    });
    await t.test('DNC cancels pending/approved work, cannot be cleared, blocks stale AI draft on commit',async()=>{
      const stale=await start('draft_outreach');const unsub=await start('classify_reply');
      await db.query(`insert into sales_tasks(company_id,lead_id,task_type,title) values('${A}','${leadA}','FOLLOW_UP','Follow up')`);
      await finish(unsub,{classification:'UNSUBSCRIBE',follow_up_days:3});
      const lead=(await db.query(`select * from sales_leads where id='${leadA}'`)).rows[0];assert.equal(lead.do_not_contact,true);assert.equal(lead.next_follow_up_at,null);
      assert.equal((await db.query(`select status from sales_agent_approvals where id='${draftId}'`)).rows[0].status,'cancelled');
      assert.equal((await db.query(`select status from sales_tasks where lead_id='${leadA}'`)).rows[0].status,'cancelled');
      await assert.rejects(finish(stale,{subject:'stale',body:'stale draft'}),/lead_do_not_contact/);
      assert.equal((await db.query("select count(*)::integer n from sales_interactions where interaction_type='ai_draft'")).rows[0].n,1);
      await actor(1);await assert.rejects(db.query(`update sales_leads set do_not_contact=false where id='${leadA}'`),/cannot_be_cleared/);
      await assert.rejects(db.query(`select sales_decide_approval('${draftId}','approved','')`),/already_decided/);
      await actor(2);assert.equal((await db.query('select * from sales_tasks')).rows.length,0);
    });
    await t.test('inactive company access, service-only run start, and budget cap are enforced',async()=>{
      await actor(1);await assert.rejects(db.query(`select sales_start_run('${A}','${leadA}','qualify_lead','${uid(1)}','{}',false)`),/permission denied/);
      await root();await db.exec(`update companies set status='Inactive' where id='${A}'`);
      await actor(1);assert.equal((await db.query('select * from sales_leads')).rows.length,0);
      await root();await db.exec(`update companies set status='Active' where id='${A}'; insert into sales_agent_runs(company_id,action) select '${A}','daily_brief' from generate_series(1,100)`);
      await assert.rejects(start('daily_brief',null),/rate_limit/);
      assert.ok((await db.query(`select sales_start_run('${A}','${leadA}','classify_reply','${uid(1)}','{}',true) id`)).rows[0].id);
    });
  } finally {await db.close();}
});
