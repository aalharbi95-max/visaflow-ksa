import assert from "node:assert/strict";

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
  if (!response.ok) throw new Error(`Staging security smoke query failed with HTTP ${response.status}`);
  return response.json();
}

function uuid(value, label) {
  const normalized = String(value || "");
  assert.match(normalized, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, `${label} is invalid`);
  return normalized;
}

const companyActors = await query(`
  select distinct on (u.company_id) u.auth_user_id::text, u.company_id::text
  from public.users u
  where u.auth_user_id is not null and u.company_id is not null
    and u.status='Active' and u.is_active is true and u.role in ('Admin','Company Admin')
  order by u.company_id, case when u.role='Company Admin' then 0 else 1 end, u.id
  limit 2`);
assert.equal(companyActors.length, 2, "Two active company-admin tenants are required for isolation smoke");
assert.notEqual(companyActors[0].company_id, companyActors[1].company_id, "Company smoke actors must belong to different tenants");
const companyAUser = uuid(companyActors[0].auth_user_id, "Company A auth user");
const companyA = uuid(companyActors[0].company_id, "Company A");
const companyB = uuid(companyActors[1].company_id, "Company B");

await query(`
  begin;
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
  declare pipeline jsonb;
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
  rollback;`);

const agencyActors = await query(`
  select distinct on (u.agency_id) u.id, u.auth_user_id::text, u.agency_id::text
  from public.users u
  where u.auth_user_id is not null and u.agency_id is not null
    and u.status='Active' and u.is_active is true and u.role='Agency'
  order by u.agency_id,u.id
  limit 2`);
assert.equal(agencyActors.length, 2, "Two active agency tenants are required for isolation smoke");
assert.notEqual(agencyActors[0].agency_id, agencyActors[1].agency_id, "Agency smoke actors must belong to different tenants");
const agencyAUser = uuid(agencyActors[0].auth_user_id, "Agency A auth user");
const agencyA = uuid(agencyActors[0].agency_id, "Agency A");
const agencyB = uuid(agencyActors[1].agency_id, "Agency B");
assert.match(String(agencyActors[0].id), /^\d+$/, "Agency A user id is invalid");
assert.match(String(agencyActors[1].id), /^\d+$/, "Agency B user id is invalid");

await query(`
  begin;
  insert into public.agency_members(id,agency_id,user_id,role,status)
  values
    (gen_random_uuid(),'${agencyA}',${agencyActors[0].id},'Agency','Active'),
    (gen_random_uuid(),'${agencyB}',${agencyActors[1].id},'Agency','Active')
  on conflict do nothing;
  select set_config('request.jwt.claim.sub','${agencyAUser}',true);
  set local role authenticated;
  do $smoke$
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
    if exists(select 1 from public.company_agency_users where agency_id<>'${agencyA}'::uuid)
       or exists(select 1 from public.agency_penalties where agency_id is not null and agency_id<>'${agencyA}'::uuid) then
      raise exception 'SENSITIVE_AGENCY_CROSS_TENANT_READ';
    end if;
  end $smoke$;
  rollback;`);

const releaseSafety = await query(`
  select
    count(*) filter(where action_type='REASSIGN_REQUEST_QUANTITY' and executed_at is not null)::integer as executed_reassignments,
    count(*) filter(where action_type='REASSIGN_REQUEST_QUANTITY' and approval_status='Approved' and executed_at is null)::integer as safely_paused_approvals
  from public.ai_agent_approval_requests`);
assert.equal(releaseSafety[0]?.executed_reassignments, 0, "Unsupported request reassignment executed");

console.log("Staging security smoke PASS: Company A/B isolation, Agency A/B isolation, canonical Hiring Pipeline RPC, and no reassignment execution.");
