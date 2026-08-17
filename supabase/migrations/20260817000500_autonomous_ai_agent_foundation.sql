-- VisaFlow autonomous AI Agent Phase 1: cases, resumable runs, controlled tools,
-- approvals, operational memory, and tenant-safe queueing.

-- Keep this migration deployable on Staging baselines that have the original
-- Agent Worker tables but have not yet received the Professional entitlement
-- ledger migration. These definitions are identical and remain additive on
-- environments where the Professional migration already ran.
alter table public.platform_clients
  add column if not exists ai_agent_enabled boolean not null default false,
  add column if not exists ai_agent_plan text not null default 'Standard',
  add column if not exists ai_agent_trial_start date,
  add column if not exists ai_agent_trial_end date,
  add column if not exists ai_agent_monthly_credit_limit bigint not null default 0;

alter table public.platform_clients drop constraint if exists platform_clients_ai_agent_plan_check;
alter table public.platform_clients
  add constraint platform_clients_ai_agent_plan_check
  check (ai_agent_plan in ('Standard', 'Professional', 'Professional Trial'));
alter table public.platform_clients drop constraint if exists platform_clients_ai_agent_credit_limit_check;
alter table public.platform_clients
  add constraint platform_clients_ai_agent_credit_limit_check
  check (ai_agent_monthly_credit_limit >= 0);

create table if not exists public.ai_agent_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_id uuid,
  action_key text not null,
  feature text not null,
  model_name text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  credits_debited bigint not null default 0,
  status text not null default 'Completed',
  created_at timestamptz not null default now(),
  constraint ai_agent_usage_nonnegative_check check (
    input_tokens >= 0 and output_tokens >= 0 and total_tokens >= 0 and credits_debited >= 0
  )
);

create unique index if not exists idx_ai_agent_usage_action_key
  on public.ai_agent_usage_ledger (company_id, action_key);
create index if not exists idx_ai_agent_usage_company_month
  on public.ai_agent_usage_ledger (company_id, created_at desc);
alter table public.ai_agent_usage_ledger enable row level security;
revoke all on public.ai_agent_usage_ledger from public, anon, authenticated;
grant all on public.ai_agent_usage_ledger to service_role;
grant select on public.ai_agent_usage_ledger to authenticated;
drop policy if exists ai_agent_usage_tenant_select on public.ai_agent_usage_ledger;
create policy ai_agent_usage_tenant_select
on public.ai_agent_usage_ledger for select to authenticated
using (
  public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
);

alter table public.ai_agent_settings
  add column if not exists allowed_auto_actions jsonb not null default '["send_agency_followup","create_followup_task","escalate_to_manager"]'::jsonb,
  add column if not exists blocked_actions jsonb not null default '[]'::jsonb,
  add column if not exists max_agent_steps integer not null default 12,
  add column if not exists max_agent_actions_per_day integer not null default 50,
  add column if not exists agent_working_hours jsonb not null default '{"timezone":"Asia/Riyadh","start":"07:00","end":"19:00"}'::jsonb,
  add column if not exists agent_language text not null default 'Arabic',
  add column if not exists email_language text not null default 'English',
  add column if not exists candidate_stale_days integer not null default 3,
  add column if not exists interview_followup_hours integer not null default 24,
  add column if not exists medical_followup_days integer not null default 3,
  add column if not exists mobilization_followup_days integer not null default 3,
  add column if not exists auto_internal_notification boolean not null default true;

alter table public.ai_agent_settings drop constraint if exists ai_agent_settings_max_steps_check;
alter table public.ai_agent_settings add constraint ai_agent_settings_max_steps_check check (max_agent_steps between 1 and 20);
alter table public.ai_agent_settings drop constraint if exists ai_agent_settings_daily_actions_check;
alter table public.ai_agent_settings add constraint ai_agent_settings_daily_actions_check check (max_agent_actions_per_day between 1 and 1000);

create table if not exists public.ai_agent_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  goal_type text not null default 'RECRUITMENT_REQUEST_REVIEW',
  goal text not null,
  target_type text not null,
  target_id text not null,
  status text not null default 'open',
  priority text not null default 'Medium',
  current_summary text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_agent_run_at timestamptz,
  next_check_at timestamptz,
  escalation_level integer not null default 0,
  closed_at timestamptz,
  closed_reason text,
  stable_case_key text not null,
  constraint ai_agent_cases_status_check check (status in ('open','in_progress','awaiting_external_response','awaiting_human_approval','blocked','failed','closed')),
  constraint ai_agent_cases_escalation_check check (escalation_level between 0 and 10),
  unique (company_id, stable_case_key)
);

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid not null references public.ai_agent_cases(id) on delete cascade,
  trigger_type text not null default 'user_goal',
  requested_by uuid,
  status text not null default 'in_progress',
  plan jsonb not null default '{}'::jsonb,
  current_step integer not null default 0,
  max_steps integer not null default 12,
  completed_steps integer not null default 0,
  failed_step integer,
  retry_count integer not null default 0,
  last_error text,
  next_retry_at timestamptz,
  termination_reason text,
  result_summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_agent_runs_status_check check (status in ('in_progress','completed','awaiting_external_response','awaiting_human_approval','blocked','failed')),
  constraint ai_agent_runs_max_steps_check check (max_steps between 1 and 20),
  constraint ai_agent_runs_termination_check check (termination_reason is null or termination_reason in ('completed','awaiting_external_response','awaiting_human_approval','blocked','failed','max_steps_reached'))
);

create table if not exists public.ai_agent_execution_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid not null references public.ai_agent_cases(id) on delete cascade,
  run_id uuid not null references public.ai_agent_runs(id) on delete cascade,
  step_no integer not null,
  tool_name text not null,
  risk_level text not null,
  approval_required boolean not null default false,
  status text not null default 'pending',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  idempotency_key text,
  attempt_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_agent_execution_steps_risk_check check (risk_level in ('GREEN','YELLOW','RED')),
  constraint ai_agent_execution_steps_status_check check (status in ('pending','running','completed','skipped','awaiting_approval','failed')),
  unique (run_id, step_no)
);

create table if not exists public.ai_agent_case_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid not null references public.ai_agent_cases(id) on delete cascade,
  run_id uuid references public.ai_agent_runs(id) on delete set null,
  event_type text not null,
  tool_name text,
  action jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_agent_case_memory (
  case_id uuid primary key references public.ai_agent_cases(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  facts jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint ai_agent_case_memory_version_check check (version > 0)
);

create table if not exists public.ai_agent_followup_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid not null references public.ai_agent_cases(id) on delete cascade,
  run_id uuid references public.ai_agent_runs(id) on delete set null,
  request_id bigint references public.requests(id) on delete cascade,
  request_no text not null,
  agency_id uuid references public.agencies(id) on delete set null,
  task_type text not null default 'AGENCY_FOLLOWUP_CHECK',
  status text not null default 'Open',
  priority text not null default 'Medium',
  due_at timestamptz not null,
  summary text not null,
  stable_action_key text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_agent_followup_tasks_status_check check (status in ('Open','Completed','Cancelled')),
  unique (company_id, stable_action_key)
);

create table if not exists public.ai_agent_approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid not null references public.ai_agent_cases(id) on delete cascade,
  agent_run_id uuid not null references public.ai_agent_runs(id) on delete cascade,
  action_type text not null,
  tool_name text not null,
  target_type text not null,
  target_id text not null,
  proposed_payload jsonb not null default '{}'::jsonb,
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(4,3),
  risk_level text not null default 'YELLOW',
  requested_by_agent_at timestamptz not null default now(),
  approval_status text not null default 'Pending',
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  executed_at timestamptz,
  execution_result jsonb not null default '{}'::jsonb,
  stable_action_key text not null,
  constraint ai_agent_approval_risk_check check (risk_level = 'YELLOW'),
  constraint ai_agent_approval_status_check check (approval_status in ('Pending','Approved','Rejected','Expired','Executed','Execution Failed')),
  constraint ai_agent_approval_confidence_check check (confidence is null or confidence between 0 and 1),
  unique (company_id, stable_action_key)
);

create index if not exists idx_ai_agent_cases_next_check on public.ai_agent_cases(company_id, status, next_check_at);
create index if not exists idx_ai_agent_runs_case_started on public.ai_agent_runs(company_id, case_id, started_at desc);
create index if not exists idx_ai_agent_steps_run on public.ai_agent_execution_steps(run_id, step_no);
create index if not exists idx_ai_agent_events_case on public.ai_agent_case_events(company_id, case_id, created_at desc);
create index if not exists idx_ai_agent_followups_due on public.ai_agent_followup_tasks(company_id, status, due_at);
create index if not exists idx_ai_agent_approvals_pending on public.ai_agent_approval_requests(company_id, approval_status, requested_by_agent_at desc);

alter table public.ai_agent_usage_ledger add column if not exists case_id uuid references public.ai_agent_cases(id) on delete set null;
alter table public.ai_agent_usage_ledger add column if not exists tool_name text;
alter table public.ai_agent_usage_ledger add column if not exists cost_estimate_usd numeric(12,6) not null default 0;
alter table public.ai_agent_usage_ledger add column if not exists execution_status text;

do $block$
declare v_table text;
begin
  foreach v_table in array array[
    'ai_agent_cases','ai_agent_runs','ai_agent_execution_steps','ai_agent_case_events',
    'ai_agent_case_memory','ai_agent_followup_tasks','ai_agent_approval_requests'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
  end loop;
end
$block$;

create or replace function public.can_read_ai_agent_company(p_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $function$
  select public.is_current_platform_user()
    or p_company_id = public.current_app_user_company_id();
$function$;

revoke all on function public.can_read_ai_agent_company(uuid) from public, anon;
grant execute on function public.can_read_ai_agent_company(uuid) to authenticated, service_role;

do $block$
declare v_table text;
begin
  foreach v_table in array array[
    'ai_agent_cases','ai_agent_runs','ai_agent_execution_steps','ai_agent_case_events',
    'ai_agent_case_memory','ai_agent_followup_tasks','ai_agent_approval_requests'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_tenant_select', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_ai_agent_company(company_id))',
      v_table || '_tenant_select', v_table
    );
  end loop;
end
$block$;

-- Existing browser writes remain supported, but company identity is enforced by RLS.
alter table public.ai_agent_settings enable row level security;
revoke all on public.ai_agent_settings from public, anon, authenticated;
grant all on public.ai_agent_settings to service_role;
grant select, insert, update on public.ai_agent_settings to authenticated;
drop policy if exists ai_agent_settings_tenant_select on public.ai_agent_settings;
create policy ai_agent_settings_tenant_select on public.ai_agent_settings for select to authenticated
using (public.can_read_ai_agent_company(company_id));
drop policy if exists ai_agent_settings_tenant_insert on public.ai_agent_settings;
create policy ai_agent_settings_tenant_insert on public.ai_agent_settings for insert to authenticated
with check (
  company_id = public.current_app_user_company_id()
  and public.current_app_user_has_role(array['Admin','Company Admin'])
);
drop policy if exists ai_agent_settings_tenant_update on public.ai_agent_settings;
create policy ai_agent_settings_tenant_update on public.ai_agent_settings for update to authenticated
using (company_id = public.current_app_user_company_id() and public.current_app_user_has_role(array['Admin','Company Admin']))
with check (company_id = public.current_app_user_company_id() and public.current_app_user_has_role(array['Admin','Company Admin']));

alter table public.ai_agent_jobs enable row level security;
revoke all on public.ai_agent_jobs from public, anon, authenticated;
grant all on public.ai_agent_jobs to service_role;
grant select, insert on public.ai_agent_jobs to authenticated;
drop policy if exists ai_agent_jobs_tenant_select on public.ai_agent_jobs;
create policy ai_agent_jobs_tenant_select on public.ai_agent_jobs for select to authenticated
using (public.can_read_ai_agent_company(company_id));
drop policy if exists ai_agent_jobs_tenant_insert on public.ai_agent_jobs;
create policy ai_agent_jobs_tenant_insert on public.ai_agent_jobs for insert to authenticated
with check (
  company_id = public.current_app_user_company_id()
  and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer'])
  and (requested_by is null or requested_by = auth.uid())
);

alter table public.ai_agent_action_locks enable row level security;
revoke all on public.ai_agent_action_locks from public, anon, authenticated;
grant all on public.ai_agent_action_locks to service_role;
grant select on public.ai_agent_action_locks to authenticated;
drop policy if exists ai_agent_locks_tenant_select on public.ai_agent_action_locks;
create policy ai_agent_locks_tenant_select on public.ai_agent_action_locks for select to authenticated
using (public.can_read_ai_agent_company(company_id));

create or replace function public.ai_agent_try_acquire_lock(
  p_company_id uuid, p_action_key text, p_action_type text default 'AI_AGENT_ACTION',
  p_related_table text default null, p_related_id text default null,
  p_agency_id uuid default null, p_cooldown_minutes integer default 60
) returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare v_acquired boolean; v_cooldown integer;
begin
  if auth.uid() is not null and (
    public.current_app_user_company_id() is distinct from p_company_id
    or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer'])
  ) then raise exception 'AI_AGENT_TENANT_OR_ROLE_DENIED' using errcode = '42501'; end if;
  if nullif(trim(p_action_key), '') is null or length(p_action_key) > 500 then raise exception 'AI_AGENT_INVALID_ACTION_KEY'; end if;
  if p_agency_id is not null and not exists(select 1 from public.agencies a where a.id = p_agency_id and a.company_id = p_company_id) then
    raise exception 'AI_AGENT_AGENCY_TENANT_MISMATCH' using errcode = '42501';
  end if;
  v_cooldown := greatest(least(coalesce(p_cooldown_minutes, 60), 10080), 5);
  insert into public.ai_agent_action_locks(company_id,action_key,action_type,related_table,related_id,agency_id,status,attempts,locked_until,run_id,updated_at)
  values(p_company_id,p_action_key,coalesce(p_action_type,'AI_AGENT_ACTION'),p_related_table,p_related_id,p_agency_id,'running',1,now()+make_interval(mins=>v_cooldown),gen_random_uuid(),now())
  on conflict(company_id,action_key) do update set
    action_type=excluded.action_type, related_table=excluded.related_table, related_id=excluded.related_id,
    agency_id=excluded.agency_id, status='running', attempts=public.ai_agent_action_locks.attempts+1,
    locked_until=now()+make_interval(mins=>v_cooldown), run_id=gen_random_uuid(), updated_at=now()
  where public.ai_agent_action_locks.locked_until < now()
     or (public.ai_agent_action_locks.status in ('failed','completed','skipped')
         and coalesce(public.ai_agent_action_locks.last_executed_at,timestamptz '2000-01-01') < now()-make_interval(mins=>v_cooldown))
  returning true into v_acquired;
  return coalesce(v_acquired,false);
end;
$function$;

create or replace function public.ai_agent_release_lock(p_company_id uuid,p_action_key text,p_status text default 'completed',p_error_message text default null)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is not null and public.current_app_user_company_id() is distinct from p_company_id then
    raise exception 'AI_AGENT_TENANT_DENIED' using errcode = '42501';
  end if;
  update public.ai_agent_action_locks set status=coalesce(p_status,'completed'),last_error=p_error_message,
    last_executed_at=case when coalesce(p_status,'completed')='completed' then now() else last_executed_at end,updated_at=now()
  where company_id=p_company_id and action_key=p_action_key;
end;
$function$;

revoke all on function public.ai_agent_try_acquire_lock(uuid,text,text,text,text,uuid,integer) from public, anon;
grant execute on function public.ai_agent_try_acquire_lock(uuid,text,text,text,text,uuid,integer) to authenticated, service_role;
revoke all on function public.ai_agent_release_lock(uuid,text,text,text) from public, anon;
grant execute on function public.ai_agent_release_lock(uuid,text,text,text) to authenticated, service_role;

create or replace function public.enqueue_ai_agent_request_review(p_request_id bigint, p_goal text default null)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare v_company_id uuid; v_actor_id uuid; v_job_id uuid; v_request_no text; v_key text;
begin
  select u.company_id, u.auth_user_id into v_company_id, v_actor_id
  from public.users u where u.auth_user_id=auth.uid() and u.status='Active' and u.is_active=true
    and u.role in ('Admin','Company Admin','Recruitment Manager','Recruitment Officer') limit 1;
  if v_company_id is null then raise exception 'AI_AGENT_FORBIDDEN' using errcode='42501'; end if;
  select r.request_no into v_request_no from public.requests r where r.id=p_request_id and r.company_id=v_company_id;
  if v_request_no is null then raise exception 'AI_AGENT_REQUEST_NOT_FOUND' using errcode='P0002'; end if;
  v_key := 'orchestrator_request_review:'||v_company_id::text||':'||p_request_id::text||':'||to_char(now() at time zone 'UTC','YYYYMMDDHH24');
  insert into public.ai_agent_jobs(company_id,job_key,job_type,status,priority,payload,requested_by,max_attempts,scheduled_for)
  values(v_company_id,v_key,'orchestrator_request_review','queued',80,
    jsonb_build_object('request_ref',v_request_no,'goal',coalesce(nullif(trim(p_goal),''),'Review and safely resolve recruitment blockers for '||v_request_no)),
    v_actor_id,3,now())
  on conflict(company_id,job_key) do update set updated_at=now()
  returning id into v_job_id;
  return v_job_id;
end;
$function$;

revoke all on function public.enqueue_ai_agent_request_review(bigint,text) from public, anon;
grant execute on function public.enqueue_ai_agent_request_review(bigint,text) to authenticated;

create or replace function public.decide_ai_agent_approval(p_approval_id uuid,p_decision text,p_rejection_reason text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_actor public.users%rowtype; v_row public.ai_agent_approval_requests%rowtype; v_status text;
begin
  select * into v_actor from public.users u where u.auth_user_id=auth.uid() and u.status='Active' and u.is_active=true
    and u.role in ('Admin','Company Admin','Recruitment Manager') limit 1;
  if v_actor.id is null then raise exception 'AI_AGENT_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  select * into v_row from public.ai_agent_approval_requests a where a.id=p_approval_id and a.company_id=v_actor.company_id and a.approval_status='Pending' for update;
  if v_row.id is null then raise exception 'AI_AGENT_APPROVAL_NOT_FOUND' using errcode='P0002'; end if;
  if lower(trim(p_decision))='approve' then
    update public.ai_agent_approval_requests set approval_status='Approved',approved_by=v_actor.auth_user_id,approved_at=now() where id=v_row.id;
    update public.ai_agent_cases set status='open',updated_at=now() where id=v_row.case_id and company_id=v_actor.company_id;
    insert into public.ai_agent_jobs(company_id,job_key,job_type,status,priority,payload,requested_by,max_attempts,scheduled_for)
    values(v_actor.company_id,'approval_resume:'||v_row.id::text,'orchestrator_approval_resume','queued',90,jsonb_build_object('case_id',v_row.case_id,'approval_id',v_row.id),v_actor.auth_user_id,3,now())
    on conflict(company_id,job_key) do nothing;
    v_status := 'Approved';
  elsif lower(trim(p_decision))='reject' then
    if nullif(trim(p_rejection_reason),'') is null then raise exception 'AI_AGENT_REJECTION_REASON_REQUIRED'; end if;
    update public.ai_agent_approval_requests set approval_status='Rejected',rejected_by=v_actor.auth_user_id,rejected_at=now(),rejection_reason=left(p_rejection_reason,2000) where id=v_row.id;
    v_status := 'Rejected';
  else raise exception 'AI_AGENT_INVALID_APPROVAL_DECISION'; end if;
  insert into public.ai_agent_case_events(company_id,case_id,run_id,event_type,tool_name,action,result,summary)
  values(v_actor.company_id,v_row.case_id,v_row.agent_run_id,'HUMAN_FEEDBACK','approval_workflow',jsonb_build_object('approval_id',v_row.id),jsonb_build_object('decision',v_status,'actor_id',v_actor.auth_user_id),v_status||' by authorized manager');
  return jsonb_build_object('ok',true,'approval_id',v_row.id,'status',v_status,'case_id',v_row.case_id);
end;
$function$;

revoke all on function public.decide_ai_agent_approval(uuid,text,text) from public, anon;
grant execute on function public.decide_ai_agent_approval(uuid,text,text) to authenticated;

comment on table public.ai_agent_case_memory is 'Structured operational facts only. Never store hidden chain-of-thought or unrestricted model transcripts.';
comment on table public.ai_agent_approval_requests is 'YELLOW-risk proposals. Approval does not bypass tool permission, tenant, verification, or audit checks.';
