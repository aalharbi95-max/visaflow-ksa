import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const COMPANY_A = "10000000-0000-4000-8000-000000000001";
const COMPANY_B = "10000000-0000-4000-8000-000000000002";
const AGENCY_A = "20000000-0000-4000-8000-000000000001";
const ADMIN_AUTH = "30000000-0000-4000-8000-000000000001";
const AGENCY_AUTH = "30000000-0000-4000-8000-000000000002";
const VIEWER_AUTH = "30000000-0000-4000-8000-000000000003";
const ADMIN_B_AUTH = "30000000-0000-4000-8000-000000000004";
const REQUEST_A = "40000000-0000-4000-8000-000000000001";
let db;

const fixture = `
create schema auth;
create role anon; create role authenticated; create role service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.companies (id uuid primary key, name text, status text);
create table public.agencies (id uuid primary key, name text, email text, status text);
create table public.users (
  id bigint generated always as identity primary key, auth_user_id uuid, name text,
  email text, role text, status text, is_active boolean, company_id uuid, agency_id uuid, agency_name text,
  updated_at timestamptz default now()
);
create table public.company_agency_access (company_id uuid, agency_id uuid, status text, primary key(company_id, agency_id));
create table public.agency_company_user_access (
  id uuid default gen_random_uuid() primary key, company_id uuid, agency_id uuid, user_id bigint,
  role text default 'Agency User', status text default 'Active', can_view_requests boolean default true,
  can_upload_candidates boolean default true, can_update_candidates boolean default true,
  can_view_interviews boolean default true, created_at timestamptz default now(), unique(company_id,agency_id,user_id)
);
create table public.agency_provisioning_requests (
  id uuid primary key, idempotency_key uuid, company_id uuid, agency_id uuid,
  requested_by_user_id bigint, requested_by_auth_user_id uuid, agency_name text,
  country text, contact_person text, admin_email text, phone text, permissions jsonb default '{}'::jsonb,
  send_invitation boolean default true, status text, auth_user_id uuid, public_user_id bigint,
  attempt_count integer default 0, failure_code text, failure_metadata jsonb default '{}'::jsonb,
  invitation_sent_at timestamptz, activated_at timestamptz, failed_at timestamptz,
  failure_stage text, last_successful_operation text, created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint agency_provisioning_requests_status_check check (status in ('Draft','Provisioning','Invitation Sent','Active','Failed','Suspended'))
);
grant select on public.users, public.agencies, public.company_agency_access, public.agency_company_user_access to authenticated;
create table public.agency_provisioning_events (
  id uuid default gen_random_uuid() primary key, request_id uuid, event_key text, company_id uuid,
  agency_id uuid, actor_user_id bigint, actor_auth_user_id uuid, event_type text,
  from_status text, to_status text, event_data jsonb default '{}'::jsonb, created_at timestamptz default now(), unique(request_id,event_key)
);
create table public.system_activity_logs (
  id uuid default gen_random_uuid(), company_id uuid, module_name text, record_id text,
  action_type text, action_title text, changed_by_user_id bigint, changed_by_role text,
  notes text, source text, created_at timestamptz default now()
);
create table public.countries (id bigint generated always as identity primary key, name text, nationality text, iso_code text, active boolean default true);
create table public.agency_agreements (
  id uuid primary key, company_id uuid, agency_name text, status text default 'Draft',
  signed_by_agency text, agency_signature text, agency_accepted_by text,
  agency_accepted_email text, agency_accepted_at timestamptz, updated_at timestamptz default now(),
  created_at timestamptz default now()
);
create table public.email_logs (
  id uuid default gen_random_uuid() primary key, company_id uuid, event_type text, status text default 'Queued',
  provider text, from_email text, to_emails text, cc_emails text, bcc_emails text, subject text,
  message_id text, error_message text, related_table text, related_id text, payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(), type text default 'EMAIL', to_email text, cc_email text, bcc_email text
);
alter table public.email_logs enable row level security;
grant select, insert, update, delete, truncate on public.email_logs to authenticated;
grant truncate on public.email_logs to anon;
create function public.current_log_actor() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',u.id,'company_id',u.company_id,'role',u.role)
  from public.users u where u.auth_user_id=auth.uid() and u.status='Active' and u.is_active is true
$$;
create function public.is_current_platform_user() returns boolean language sql stable as $$ select false $$;
create policy secure_email_log_select on public.email_logs for select to authenticated using (
  company_id::text=public.current_log_actor()->>'company_id'
);
create policy secure_email_log_insert on public.email_logs for insert to authenticated with check (
  company_id::text=public.current_log_actor()->>'company_id'
);
create function public.agency_provisioning_public_result(request_row public.agency_provisioning_requests)
returns jsonb language sql stable as $$ select jsonb_build_object('id', request_row.id, 'agency_id', request_row.agency_id,
  'status', request_row.status, 'attempt_count', request_row.attempt_count, 'updated_at', request_row.updated_at) $$;
create function public.agency_invitation_begin_v2(uuid, jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.agency_invitation_record_auth_user_v2(uuid, uuid, uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
`;

async function authenticate(authUserId) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [authUserId]);
  await db.exec("set role authenticated");
}

before(async () => {
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(`
    insert into public.companies values ('${COMPANY_A}','Company A','Active'),('${COMPANY_B}','Company B','Active');
    insert into public.agencies values ('${AGENCY_A}','Agency A','agency@example.test','Active');
    insert into auth.users values ('${ADMIN_AUTH}','admin@example.test'),('${AGENCY_AUTH}','agency@example.test'),('${VIEWER_AUTH}','viewer@example.test'),('${ADMIN_B_AUTH}','admin-b@example.test');
    insert into public.users (auth_user_id,name,email,role,status,is_active,company_id) values
      ('${ADMIN_AUTH}','Admin','admin@example.test','Company Admin','Active',true,'${COMPANY_A}');
    insert into public.users (auth_user_id,name,email,role,status,is_active,company_id) values
      ('${VIEWER_AUTH}','Viewer','viewer@example.test','Viewer','Active',true,'${COMPANY_A}');
    insert into public.users (auth_user_id,name,email,role,status,is_active,company_id) values
      ('${ADMIN_B_AUTH}','Admin B','admin-b@example.test','Company Admin','Active',true,'${COMPANY_B}');
    insert into public.users (auth_user_id,name,email,role,status,is_active,agency_id) values
      ('${AGENCY_AUTH}','Agency User','agency@example.test','Agency','Active',true,'${AGENCY_A}');
    insert into public.company_agency_access values ('${COMPANY_A}','${AGENCY_A}','Active');
    insert into public.agency_company_user_access (company_id,agency_id,user_id,role,status)
      select '${COMPANY_A}','${AGENCY_A}',id,'Agency User','Active' from public.users where auth_user_id='${AGENCY_AUTH}';
    insert into public.agency_provisioning_requests (
      id,idempotency_key,company_id,agency_id,requested_by_user_id,requested_by_auth_user_id,
      agency_name,admin_email,status,auth_user_id,public_user_id,attempt_count,updated_at
    ) select '${REQUEST_A}',gen_random_uuid(),'${COMPANY_A}','${AGENCY_A}',admin.id,'${ADMIN_AUTH}',
      'Agency A','agency@example.test','Failed','${AGENCY_AUTH}',agency_user.id,1,now()-interval '2 minutes'
      from public.users admin cross join public.users agency_user
      where admin.auth_user_id='${ADMIN_AUTH}' and agency_user.auth_user_id='${AGENCY_AUTH}';
    insert into public.countries (name,nationality,iso_code) values ('India','Indian','IN');
    insert into public.agency_agreements (id,company_id,agency_name,status,created_at)
      values (gen_random_uuid(),'${COMPANY_A}','Agency A','Pending Signature',now());
    insert into public.agency_agreements (id,company_id,agency_name,status,created_at)
      values (gen_random_uuid(),'${COMPANY_B}','Agency A','Pending Signature',now());
    insert into public.email_logs (company_id,event_type,status,to_email,error_message)
      values ('${COMPANY_A}','TEST','Failed','recipient@example.test','password=secret provider detail');
  `);
  const migration = await readFile(new URL("../supabase/migrations/20260801000200_remaining_notes_agency_security.sql", import.meta.url), "utf8");
  await db.exec(migration);
  const deliveryMigration = await readFile(new URL("../supabase/migrations/20260802000100_email_delivery_observability.sql", import.meta.url), "utf8");
  await db.exec(deliveryMigration);
  const dispatcherSecurityMigration = await readFile(new URL("../supabase/migrations/20260802000200_email_dispatcher_early_failure_security.sql", import.meta.url), "utf8");
  await db.exec(dispatcherSecurityMigration);
});

after(async () => { await db?.close(); });

test("remaining-notes migration adds deterministic agreement and email audit columns", async () => {
  const agreement = await db.query("select agency_id from public.agency_agreements where company_id=$1", [COMPANY_A]);
  assert.equal(agreement.rows[0].agency_id, AGENCY_A);
  const columns = await db.query("select column_name from information_schema.columns where table_name='email_logs'");
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const name of ["agency_id","user_id","recipient","provider_message_id","error_code","retry_count","sent_at","failed_at","idempotency_key"]) assert.ok(names.has(name));
  const requestColumns = await db.query("select column_name from information_schema.columns where table_name='agency_provisioning_requests'");
  assert.ok(requestColumns.rows.some((row) => row.column_name === "auth_identity_preexisting"));
  const agreementColumns = await db.query("select column_name from information_schema.columns where table_name='agency_agreements'");
  const agreementNames = new Set(agreementColumns.rows.map((row) => row.column_name));
  for (const name of ["email_delivery_status","email_provider_message_id","email_error_code","email_error_message","email_last_attempt_at","email_sent_at","email_failed_at"]) assert.ok(agreementNames.has(name));
});

test("new SECURITY DEFINER functions pin search_path and expose only intended roles", async () => {
  const names = ["agency_agreement_accept_v1", "email_log_list_v1", "platform_email_log_summary_v1",
    "agency_invitation_record_auth_user_v3", "agency_invitation_begin_v3", "agency_invitation_revoke_v1",
    "agency_user_lifecycle_mutate", "agency_user_lifecycle_list"];
  const functions = await db.query(`select proname,coalesce(array_to_string(proconfig,','),'') config
    from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
    where nspname='public' and proname=any($1::text[])`, [names]);
  assert.equal(functions.rows.length, names.length);
  for (const row of functions.rows) assert.match(row.config, /search_path=/);
  const privileges = await db.query(`select
    has_function_privilege('authenticated','public.agency_user_lifecycle_mutate(uuid,bigint,text,text)','execute') lifecycle,
    has_function_privilege('authenticated','public.agency_invitation_record_auth_user_v3(uuid,uuid,uuid,boolean)','execute') auth_record_browser,
    has_function_privilege('service_role','public.agency_invitation_record_auth_user_v3(uuid,uuid,uuid,boolean)','execute') auth_record_server,
    has_table_privilege('authenticated','public.email_logs','insert') email_insert`);
  assert.deepEqual(privileges.rows[0], { lifecycle: true, auth_record_browser: false, auth_record_server: true, email_insert: false });
});

test("agreement access is tenant-scoped and agency acceptance uses the protected RPC", async () => {
  await authenticate(ADMIN_AUTH);
  let visible = await db.query("select id,company_id from public.agency_agreements");
  assert.deepEqual(visible.rows.map((row) => row.company_id), [COMPANY_A]);
  const agreementId = visible.rows[0].id;
  await authenticate(AGENCY_AUTH);
  visible = await db.query("select id,company_id from public.agency_agreements");
  assert.deepEqual(visible.rows.map((row) => row.company_id), [COMPANY_A]);
  const directUpdate = await db.query("update public.agency_agreements set status='Active' where id=$1 returning id", [agreementId]);
  assert.equal(directUpdate.rows.length, 0);
  const accepted = await db.query("select public.agency_agreement_accept_v1($1) result", [agreementId]);
  assert.equal(accepted.rows[0].result.status, "Active");
  assert.equal(accepted.rows[0].result.company_id, COMPANY_A);
});

test("email logs are server-owned and non-admin recipients are masked by the RPC", async () => {
  await authenticate(VIEWER_AUTH);
  await assert.rejects(() => db.query("insert into public.email_logs(company_id,event_type) values($1,'BROWSER')", [COMPANY_A]), /permission denied/);
  const direct = await db.query("select id from public.email_logs");
  assert.equal(direct.rows.length, 0);
  const masked = await db.query("select * from public.email_log_list_v1()");
  assert.equal(masked.rows[0].recipient, "re***@example.test");
  assert.equal(masked.rows[0].error_message, "Email delivery failed at the provider.");
  await authenticate(ADMIN_AUTH);
  const full = await db.query("select * from public.email_log_list_v1()");
  assert.equal(full.rows[0].recipient, "recipient@example.test");
  await authenticate(ADMIN_B_AUTH);
  const otherTenant = await db.query("select * from public.email_log_list_v1()");
  assert.equal(otherTenant.rows.length, 0);
  await authenticate(AGENCY_AUTH);
  await assert.rejects(() => db.query("select * from public.email_log_list_v1()"), /EMAIL_LOG_UNAUTHORIZED/);
});

test("browser roles cannot mutate or truncate email logs", async () => {
  await db.exec("reset role");
  const privileges = await db.query(`select
    has_table_privilege('anon','public.email_logs','truncate') anon_truncate,
    has_table_privilege('authenticated','public.email_logs','insert') auth_insert,
    has_table_privilege('authenticated','public.email_logs','update') auth_update,
    has_table_privilege('authenticated','public.email_logs','delete') auth_delete,
    has_table_privilege('authenticated','public.email_logs','truncate') auth_truncate`);
  assert.deepEqual(privileges.rows[0], {
    anon_truncate: false, auth_insert: false, auth_update: false,
    auth_delete: false, auth_truncate: false,
  });
});

test("resend enforces tenant role, cooldown and idempotent state transition", async () => {
  await authenticate(ADMIN_AUTH);
  const result = await db.query("select public.agency_invitation_begin_v3($1,$2::jsonb,'resend_invitation') result", [AGENCY_A, JSON.stringify({ can_view_requests:true,can_upload_candidates:true,can_update_candidates:true,can_view_interviews:true })]);
  assert.equal(result.rows[0].result.status, "Provisioning");
  assert.equal(result.rows[0].result.attempt_count, 2);
  await assert.rejects(() => db.query("select public.agency_invitation_begin_v3($1,$2::jsonb,'resend_invitation')", [AGENCY_A, JSON.stringify({ can_view_requests:true,can_upload_candidates:true,can_update_candidates:true,can_view_interviews:true })]), /AGENCY_INVITATION_IN_PROGRESS|AGENCY_INVITATION_RESEND_COOLDOWN/);
});

test("revoke and lifecycle actions retain identities and audit tenant-scoped access", async () => {
  await authenticate(ADMIN_AUTH);
  const revoked = await db.query("select public.agency_invitation_revoke_v1($1) result", [AGENCY_A]);
  assert.equal(revoked.rows[0].result.status, "Revoked");
  await db.exec("reset role");
  const user = await db.query("select id from public.users where auth_user_id=$1", [AGENCY_AUTH]);
  const userId = user.rows[0].id;
  await authenticate(ADMIN_AUTH);
  const disabled = await db.query("select public.agency_user_lifecycle_mutate($1,$2,'disable',null) result", [AGENCY_A,userId]);
  assert.equal(disabled.rows[0].result.status, "Suspended");
  await db.exec("reset role");
  let target = await db.query("select status,is_active,agency_id from public.users where id=$1", [userId]);
  assert.deepEqual(target.rows[0], { status: "Inactive", is_active: false, agency_id: AGENCY_A });
  await authenticate(ADMIN_AUTH);
  const reactivated = await db.query("select public.agency_user_lifecycle_mutate($1,$2,'reactivate',null) result", [AGENCY_A,userId]);
  assert.equal(reactivated.rows[0].result.status, "Active");
  await db.exec("reset role");
  target = await db.query("select status,is_active,agency_id from public.users where id=$1", [userId]);
  assert.deepEqual(target.rows[0], { status: "Active", is_active: true, agency_id: AGENCY_A });
  await authenticate(ADMIN_AUTH);
  await assert.rejects(() => db.query("select public.agency_user_lifecycle_mutate($1,$2,'change_role','Company Admin')", [AGENCY_A,userId]), /AGENCY_USER_ROLE_NOT_ALLOWED/);
  const unlinked = await db.query("select public.agency_user_lifecycle_mutate($1,$2,'unlink',null) result", [AGENCY_A,userId]);
  assert.equal(unlinked.rows[0].result.status, "Inactive");
  assert.equal(unlinked.rows[0].result.auth_user_deleted, false);
  await db.exec("reset role");
  await db.query("insert into public.company_agency_access values($1,$2,'Active')", [COMPANY_B, AGENCY_A]);
  await db.query("insert into public.agency_company_user_access(company_id,agency_id,user_id,role,status) values($1,$2,$3,'Agency User','Suspended')", [COMPANY_B, AGENCY_A, userId]);
  await authenticate(ADMIN_B_AUTH);
  const companyBReactivated = await db.query("select public.agency_user_lifecycle_mutate($1,$2,'reactivate',null) result", [AGENCY_A,userId]);
  assert.equal(companyBReactivated.rows[0].result.status, "Active");
  await authenticate(ADMIN_AUTH);
  await db.query("select public.agency_user_lifecycle_mutate($1,$2,'change_role','Agency Manager')", [AGENCY_A,userId]);
  await db.exec("reset role");
  const scopedAccess = await db.query("select company_id,role,status from public.agency_company_user_access where user_id=$1 order by company_id", [userId]);
  assert.deepEqual(scopedAccess.rows, [
    { company_id: COMPANY_A, role: "Agency Manager", status: "Inactive" },
    { company_id: COMPANY_B, role: "Agency User", status: "Active" },
  ]);
  target = await db.query("select status,is_active,agency_id from public.users where id=$1", [userId]);
  assert.deepEqual(target.rows[0], { status: "Active", is_active: true, agency_id: AGENCY_A });
  const audits = await db.query("select count(*)::int count from public.system_activity_logs where company_id=$1", [COMPANY_A]);
  assert.ok(audits.rows[0].count >= 3);
});
