import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const COMPANY_A = "10000000-0000-4000-8000-000000000001";
const COMPANY_B = "10000000-0000-4000-8000-000000000002";
const AGENCY_A = "20000000-0000-4000-8000-000000000001";
const AGENCY_B = "20000000-0000-4000-8000-000000000002";
const ADMIN_A = "30000000-0000-4000-8000-000000000001";
const AGENT_A = "30000000-0000-4000-8000-000000000002";
let db;

async function auth(id, fn) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

async function list(id, company = COMPANY_A) {
  return auth(id, () => db.query("select id,type from notification_center_list_v1($1)", [company]));
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth; create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table users(id bigint generated always as identity primary key,auth_user_id uuid,company_id uuid,agency_id uuid,role text,status text,is_active boolean);
    create table agency_company_user_access(user_id bigint,company_id uuid,agency_id uuid,status text);
    create table notification_events(
      id bigint generated always as identity primary key,status text not null default 'Unread',data jsonb default '{}'::jsonb,
      delivery_status text,error_message text,created_at timestamptz default now(),sent_at timestamptz,company_id uuid,user_id uuid,
      agency_id uuid,type text,title text,message text,priority text,related_table text,related_id text,read_at timestamptz,
      request_no text,agency_name text,response_status text,response_at timestamptz,rejection_reason text,sla_started_at timestamptz,
      sla_days integer,sla_due_at timestamptz,dedupe_key text,recipient_role text
    );
    create function current_log_actor() returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object('id',u.id,'company_id',u.company_id,'agency_id',u.agency_id,'role',u.role)
      from public.users u where u.auth_user_id=auth.uid() and u.status='Active' and u.is_active is true
    $$;
    create function notification_event_mutate(p_operation text,p_notification_id bigint default null,p_payload jsonb default '{}'::jsonb)
      returns jsonb language plpgsql security definer set search_path='' as $$declare r public.notification_events%rowtype; begin
        if p_operation='create' then
          insert into public.notification_events(company_id,agency_id,type,status)
          values((p_payload->>'workspace_company_id')::uuid,nullif(p_payload->>'agency_id','')::uuid,p_payload->>'type','Unread') returning * into r;
        elsif p_operation='agency_response' then
          update public.notification_events set response_status=p_payload->>'response_status' where id=p_notification_id returning * into r;
        end if; return to_jsonb(r); end$$;
    insert into users(auth_user_id,company_id,role,status,is_active) values('${ADMIN_A}','${COMPANY_A}','Company Admin','Active',true);
    insert into users(auth_user_id,agency_id,role,status,is_active) values('${AGENT_A}','${AGENCY_A}','Agency','Active',true);
    insert into agency_company_user_access select id,'${COMPANY_A}','${AGENCY_A}','Active' from users where auth_user_id='${AGENT_A}';
    grant usage on schema public,auth to authenticated; grant execute on function auth.uid(),current_log_actor() to authenticated;
    grant select,insert,update,delete on notification_events to authenticated;
  `);
  const migration = await readFile(new URL("../supabase/migrations/20260802000700_notification_center_recipient_isolation.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(`
    insert into notification_events(company_id,agency_id,recipient_role,type,status) values
      ('${COMPANY_A}','${AGENCY_A}','Agency','AUTHORIZATION_SENT','Unread'),
      ('${COMPANY_A}','${AGENCY_A}','Company','AGENCY_TALENT_POOL_UPLOAD','Unread'),
      ('${COMPANY_A}','${AGENCY_B}','Agency','OTHER_OFFICE','Unread'),
      ('${COMPANY_B}','${AGENCY_A}','Agency','OTHER_COMPANY','Unread'),
      ('${COMPANY_A}',null,null,'LEGACY_COMPANY','Read'),
      ('${COMPANY_A}','${AGENCY_A}','Agency','EXPLICIT_COMPANY','Unread');
    update notification_events set user_id='${ADMIN_A}' where type='EXPLICIT_COMPANY';
  `);
});

after(async () => db?.close());

test("Agency list is strict by recipient, office and active company", async () => {
  const result = await list(AGENT_A);
  assert.deepEqual(result.rows.map((row) => row.type), ["AUTHORIZATION_SENT"]);
  assert.equal((await list(AGENT_A, COMPANY_B)).rows.length, 0);
});

test("Company list excludes Agency rows unless explicitly addressed", async () => {
  const result = await list(ADMIN_A);
  assert.deepEqual(new Set(result.rows.map((row) => row.type)), new Set(["EXPLICIT_COMPANY", "LEGACY_COMPANY", "AGENCY_TALENT_POOL_UPLOAD"]));
});

test("mark read and delete reject notifications outside the same visibility rule", async () => {
  const companyId = (await db.query("select id from notification_events where type='AGENCY_TALENT_POOL_UPLOAD'")).rows[0].id;
  const agencyId = (await db.query("select id from notification_events where type='AUTHORIZATION_SENT'")).rows[0].id;
  await assert.rejects(
    auth(AGENT_A, () => db.query("select notification_event_mutate('mark_read',$1,$2)", [companyId, { workspace_company_id: COMPANY_A }])),
    /notification_access_denied/
  );
  await assert.rejects(
    auth(AGENT_A, () => db.query("select notification_event_mutate('delete',$1,$2)", [agencyId, { workspace_company_id: COMPANY_B }])),
    /notification_access_denied/
  );
  await auth(AGENT_A, () => db.query("select notification_event_mutate('mark_read',$1,$2)", [agencyId, { workspace_company_id: COMPANY_A }]));
  assert.equal((await db.query("select status from notification_events where id=$1", [agencyId])).rows[0].status, "Read");
});
