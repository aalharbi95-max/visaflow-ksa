import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const COMPANY_A="10000000-0000-4000-8000-000000000001";
const COMPANY_B="10000000-0000-4000-8000-000000000002";
const AGENCY_A="20000000-0000-4000-8000-000000000001";
const AGENCY_B="20000000-0000-4000-8000-000000000002";
const ADMIN_A="30000000-0000-4000-8000-000000000001";
const ADMIN_B="30000000-0000-4000-8000-000000000002";
const AGENT_A="30000000-0000-4000-8000-000000000003";
const AGENT_B="30000000-0000-4000-8000-000000000004";
let db;

async function auth(id, fn) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

before(async()=>{
  db=new PGlite();
  await db.exec(`
    create schema auth; create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table companies(id uuid primary key,name text); create table agencies(id uuid primary key,name text,status text);
    create table users(id bigint generated always as identity primary key,auth_user_id uuid,company_id uuid,agency_id uuid,name text,email text,role text,status text,is_active boolean);
    create table company_agency_access(company_id uuid,agency_id uuid,status text);
    create table agency_company_user_access(user_id bigint,company_id uuid,agency_id uuid,status text,can_upload_candidates boolean,can_update_candidates boolean);
    create table candidates(id uuid default gen_random_uuid() primary key,company_id uuid references companies(id),agency text,candidate_name text not null,nationality text,civil_id_no text,civil_id_expiry_date date,status text,request_no text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table candidate_documents(id uuid default gen_random_uuid(),candidate_id uuid references candidates(id),label text);
    create table system_activity_logs(id uuid default gen_random_uuid(),company_id uuid,module_name text,record_id text,record_label text,action_type text,action_title text,old_values jsonb,new_values jsonb,changed_fields jsonb,changed_by_user_id bigint,changed_by_name text,changed_by_email text,changed_by_role text,notes text,source text,created_at timestamptz default now());
    create function current_app_user_company_id() returns uuid language sql stable as $$select company_id from users where auth_user_id=auth.uid()$$;
    create function current_app_user_role() returns text language sql stable as $$select role from users where auth_user_id=auth.uid()$$;
    insert into companies values('${COMPANY_A}','A'),('${COMPANY_B}','B');
    insert into agencies values('${AGENCY_A}','Agency A','Active'),('${AGENCY_B}','Agency B','Active');
    insert into users(auth_user_id,company_id,name,email,role,status,is_active) values('${ADMIN_A}','${COMPANY_A}','Admin A','a@test','Company Admin','Active',true),('${ADMIN_B}','${COMPANY_B}','Admin B','b@test','Company Admin','Active',true);
    insert into users(auth_user_id,agency_id,name,email,role,status,is_active) values('${AGENT_A}','${AGENCY_A}','Agent A','aa@test','Agency','Active',true),('${AGENT_B}','${AGENCY_B}','Agent B','ab@test','Agency','Active',true);
    insert into company_agency_access values('${COMPANY_A}','${AGENCY_A}','Active'),('${COMPANY_B}','${AGENCY_B}','Active');
    insert into agency_company_user_access select id,'${COMPANY_A}','${AGENCY_A}','Active',true,true from users where auth_user_id='${AGENT_A}';
    insert into agency_company_user_access select id,'${COMPANY_B}','${AGENCY_B}','Active',true,true from users where auth_user_id='${AGENT_B}';
    grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;
  `);
  const migration=await readFile(new URL("../supabase/migrations/20260802000600_candidate_upload_batches_soft_delete.sql",import.meta.url),"utf8");
  await db.exec(migration);
});
after(async()=>db?.close());

async function beginBatch(authId,companyId,agencyId,hash,count=1){
  return auth(authId,()=>db.query("select candidate_upload_batch_begin_v1($1,$2,'upload.xlsx',$3,$4) result",[companyId,agencyId,hash,count]));
}
async function seedCandidates(count,{company=COMPANY_A,agencyId=AGENCY_A,agency='Agency A',status='New',requestNo=''}={}){
  const batch=await beginBatch(agencyId===AGENCY_A?AGENT_A:AGENT_B,company,agencyId,`hash-${crypto.randomUUID()}`,count);
  const batchId=batch.rows[0].result.id;
  const ids=[];
  for(let i=0;i<count;i++){
    const row=await db.query("insert into candidates(company_id,agency,candidate_name,status,request_no,upload_batch_id,file_hash,uploaded_by_agency_id) values($1,$2,$3,$4,$5,$6,'hash',$7) returning id",[company,agency,`Candidate ${i}`,status,requestNo,batchId,agencyId]);
    ids.push(row.rows[0].id);
  }
  return {ids,batchId};
}

test("single soft delete and Company Admin restore preserve related records and create audit logs",async()=>{
  const {ids}=await seedCandidates(1); await db.query("insert into candidate_documents(candidate_id,label) values($1,'Passport')",[ids[0]]);
  await auth(AGENT_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'duplicate row',false,false)",[COMPANY_A,ids]));
  assert.equal((await db.query("select count(*)::int count from candidates where id=$1 and deleted_at is not null",[ids[0]])).rows[0].count,1);
  assert.equal((await db.query("select count(*)::int count from candidate_documents where candidate_id=$1",[ids[0]])).rows[0].count,1);
  await auth(ADMIN_A,()=>db.query("select candidate_restore_v1($1,$2,'reviewed')",[COMPANY_A,ids]));
  assert.equal((await db.query("select count(*)::int count from candidates where id=$1 and deleted_at is null",[ids[0]])).rows[0].count,1);
  assert.equal((await db.query("select count(*)::int count from system_activity_logs where action_type in ('SOFT_DELETE','RESTORE')")).rows[0].count,2);
});

test("selected and 198-row batch deletion update active counts without physical DELETE",async()=>{
  const selected=await seedCandidates(2); await auth(AGENT_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'selected cleanup',false,false)",[COMPANY_A,selected.ids]));
  const batch=await seedCandidates(198); await auth(AGENT_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'duplicate upload batch',false,false)",[COMPANY_A,batch.ids]));
  assert.equal((await db.query("select count(*)::int count from candidates where id=any($1) and deleted_at is null",[batch.ids])).rows[0].count,0);
  assert.equal((await db.query("select count(*)::int count from candidates where id=any($1)",[batch.ids])).rows[0].count,198);
});

test("agency and Company Admin cannot cross tenant or office boundaries",async()=>{
  const other=await seedCandidates(1,{company:COMPANY_B,agencyId:AGENCY_B,agency:'Agency B'});
  await assert.rejects(auth(AGENT_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'cross office',false,false)",[COMPANY_A,other.ids])),/cross-company|selection|required/);
  await assert.rejects(auth(ADMIN_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'cross company',false,false)",[COMPANY_B,other.ids])),/delete access denied/);
});

test("Joined candidates require Company Admin warning override",async()=>{
  const joined=await seedCandidates(1,{status:'Joined'});
  await assert.rejects(auth(AGENT_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'joined cleanup',false,false)",[COMPANY_A,joined.ids])),/protected candidate stage/);
  await auth(ADMIN_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'admin override',false,true)",[COMPANY_A,joined.ids]));
});

test("linked requests require extra confirmation and duplicate file hashes stay blocked",async()=>{
  const linked=await seedCandidates(1,{requestNo:'REQ-1'});
  await assert.rejects(auth(AGENT_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'linked cleanup',false,false)",[COMPANY_A,linked.ids])),/confirmation required/);
  await auth(AGENT_A,()=>db.query("select candidate_soft_delete_v1($1,$2,'linked cleanup',true,false)",[COMPANY_A,linked.ids]));
  await beginBatch(AGENT_A,COMPANY_A,AGENCY_A,'duplicate-file',1);
  await assert.rejects(beginBatch(AGENT_A,COMPANY_A,AGENCY_A,'duplicate-file',1),/already uploaded/);
});
