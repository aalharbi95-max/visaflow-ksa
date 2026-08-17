import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.match(projectRef, /^[a-z]{20}$/i, "SUPABASE_PROJECT_REF is invalid");

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    let diagnostic = {};
    try { diagnostic = await response.json(); } catch { diagnostic = {}; }
    const code = String(diagnostic.code || diagnostic.error_code || "unknown").slice(0, 80);
    const message = String(diagnostic.message || diagnostic.error || "query rejected").slice(0, 500);
    throw new Error(`Staging security smoke query failed with HTTP ${response.status} (${code}): ${message}`);
  }
  return response.json();
}

const companyA = randomUUID();
const companyB = randomUUID();
const companyAUser = randomUUID();
const companyBUser = randomUUID();
const agencyA = randomUUID();
const agencyB = randomUUID();
const agencyAUser = randomUUID();
const agencyBUser = randomUUID();
const runTag = randomUUID();

await query(`
  begin;
  insert into public.companies(id,name,status)
  values
    ('${companyA}','RLS Company A ${runTag}','Active'),
    ('${companyB}','RLS Company B ${runTag}','Active');
  insert into public.users(name,email,role,status,is_active,company_id,auth_user_id)
  values
    ('RLS Company A Admin','company-a-${runTag}@example.invalid','Company Admin','Active',true,'${companyA}','${companyAUser}'),
    ('RLS Company B Admin','company-b-${runTag}@example.invalid','Company Admin','Active',true,'${companyB}','${companyBUser}');
  insert into public.agencies(id,name,status,company_id)
  values
    ('${agencyA}','RLS Agency A ${runTag}','Active','${companyA}'),
    ('${agencyB}','RLS Agency B ${runTag}','Active','${companyA}');
  insert into public.users(name,email,role,status,is_active,agency_id,auth_user_id)
  values
    ('RLS Agency A User','agency-a-${runTag}@example.invalid','Agency','Active',true,'${agencyA}','${agencyAUser}'),
    ('RLS Agency B User','agency-b-${runTag}@example.invalid','Agency','Active',true,'${agencyB}','${agencyBUser}');
  insert into public.agency_members(id,agency_id,user_id,role,status)
  select gen_random_uuid(),u.agency_id,u.id,'Agency','Active'
  from public.users u where u.auth_user_id in ('${agencyAUser}'::uuid,'${agencyBUser}'::uuid);
  insert into public.agency_penalties(id,company_id,penalty_no,agency_id,agency_name,status,agency_evidence)
  values
    (gen_random_uuid(),'${companyA}','RLS-A-${runTag}','${agencyA}','RLS Agency A','Open','[]'::jsonb),
    (gen_random_uuid(),'${companyA}','RLS-B-${runTag}','${agencyB}','RLS Agency B','Open','[]'::jsonb);
  insert into public.local_content_settings(
    company_id,saudi_labor_weight,non_saudi_labor_weight,default_target_percent,
    forecast_days,expiring_window_days,default_monthly_penalty_percent)
  values
    ('${companyA}',1,1,1,30,30,1),
    ('${companyB}',1,1,1,30,30,1)
  on conflict(company_id) do nothing;
  select set_config('request.jwt.claim.sub','${companyAUser}',true);
  set local role authenticated;
  do $smoke$
  declare pipeline jsonb; affected integer;
  begin
    if public.current_app_user_company_id() <> '${companyA}'::uuid then
      raise exception 'COMPANY_ACTOR_CONTEXT_FAILED';
    end if;
    if exists(select 1 from public.local_content_settings where company_id='${companyB}'::uuid) then
      raise exception 'COMPANY_CROSS_TENANT_READ';
    end if;
    if not exists(select 1 from public.local_content_settings where company_id='${companyA}'::uuid) then
      raise exception 'COMPANY_OWN_TENANT_READ_FAILED';
    end if;
    update public.local_content_settings set forecast_days=31 where company_id='${companyA}'::uuid;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'COMPANY_OWN_TENANT_WRITE_FAILED'; end if;
    update public.local_content_settings set forecast_days=32 where company_id='${companyB}'::uuid;
    get diagnostics affected = row_count;
    if affected<>0 then raise exception 'COMPANY_CROSS_TENANT_UPDATE'; end if;
    delete from public.local_content_settings where company_id='${companyB}'::uuid;
    get diagnostics affected = row_count;
    if affected<>0 then raise exception 'COMPANY_CROSS_TENANT_DELETE'; end if;
    if exists(select 1 from public.invoices where company_id<>'${companyA}'::uuid)
       or exists(select 1 from public.company_email_settings where company_id<>'${companyA}'::uuid)
       or exists(select 1 from public.ai_interview_sessions where company_id<>'${companyA}'::uuid) then
      raise exception 'SENSITIVE_COMPANY_CROSS_TENANT_READ';
    end if;
    pipeline := public.list_company_hiring_pipeline();
    if jsonb_typeof(pipeline)<>'object' or not (pipeline ? 'jobs') or not (pipeline ? 'applications') then
      raise exception 'HIRING_PIPELINE_SMOKE_FAILED';
    end if;
  end $smoke$;
  reset role;
  select set_config('request.jwt.claim.sub','${companyBUser}',true);
  set local role authenticated;
  do $smoke$
  declare affected integer;
  begin
    if exists(select 1 from public.local_content_settings where company_id='${companyA}'::uuid) then
      raise exception 'COMPANY_B_TO_A_CROSS_TENANT_READ';
    end if;
    update public.local_content_settings set forecast_days=33 where company_id='${companyA}'::uuid;
    get diagnostics affected = row_count;
    if affected<>0 then raise exception 'COMPANY_B_TO_A_CROSS_TENANT_UPDATE'; end if;
    update public.local_content_settings set forecast_days=34 where company_id='${companyB}'::uuid;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'COMPANY_B_OWN_TENANT_WRITE_FAILED'; end if;
  end $smoke$;
  reset role;
  select set_config('request.jwt.claim.sub','${agencyAUser}',true);
  set local role authenticated;
  do $smoke$
  declare affected integer;
  begin
    if public.current_app_user_agency_id() <> '${agencyA}'::uuid then
      raise exception 'AGENCY_ACTOR_CONTEXT_FAILED';
    end if;
    if exists(select 1 from public.agency_members where agency_id='${agencyB}'::uuid) then
      raise exception 'AGENCY_CROSS_TENANT_READ';
    end if;
    if not exists(select 1 from public.agency_members where agency_id='${agencyA}'::uuid) then
      raise exception 'AGENCY_OWN_TENANT_READ_FAILED';
    end if;
    if exists(select 1 from public.agency_penalties where agency_id='${agencyB}'::uuid) then
      raise exception 'SENSITIVE_AGENCY_CROSS_TENANT_READ';
    end if;
    update public.agency_penalties set decision_notes='own-tenant-smoke' where agency_id='${agencyA}'::uuid;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'AGENCY_OWN_TENANT_WRITE_FAILED'; end if;
    update public.agency_penalties set decision_notes='cross-tenant-smoke' where agency_id='${agencyB}'::uuid;
    get diagnostics affected = row_count;
    if affected<>0 then raise exception 'AGENCY_CROSS_TENANT_UPDATE'; end if;
  end $smoke$;
  reset role;
  select set_config('request.jwt.claim.sub','${agencyBUser}',true);
  set local role authenticated;
  do $smoke$
  declare affected integer;
  begin
    if exists(select 1 from public.agency_members where agency_id='${agencyA}'::uuid)
       or exists(select 1 from public.agency_penalties where agency_id='${agencyA}'::uuid) then
      raise exception 'AGENCY_B_TO_A_CROSS_TENANT_READ';
    end if;
    update public.agency_penalties set decision_notes='cross-tenant-smoke' where agency_id='${agencyA}'::uuid;
    get diagnostics affected = row_count;
    if affected<>0 then raise exception 'AGENCY_B_TO_A_CROSS_TENANT_UPDATE'; end if;
    update public.agency_penalties set decision_notes='own-tenant-smoke' where agency_id='${agencyB}'::uuid;
    get diagnostics affected = row_count;
    if affected<>1 then raise exception 'AGENCY_B_OWN_TENANT_WRITE_FAILED'; end if;
  end $smoke$;
  rollback;`);

const releaseSafety = await query(`
  select
    count(*) filter(where action_type='REASSIGN_REQUEST_QUANTITY' and executed_at is not null)::integer as executed_reassignments,
    count(*) filter(where action_type='REASSIGN_REQUEST_QUANTITY' and approval_status='Approved' and executed_at is null)::integer as safely_paused_approvals
  from public.ai_agent_approval_requests`);
assert.equal(releaseSafety[0]?.executed_reassignments, 0, "Unsupported request reassignment executed");

console.log("Staging security smoke PASS: Company A/B isolation, Agency A/B isolation, canonical Hiring Pipeline RPC, and no reassignment execution.");
