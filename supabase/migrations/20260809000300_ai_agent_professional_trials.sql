-- AI Agent Professional entitlement and secure seven-day company trials.

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

create index if not exists idx_platform_clients_ai_agent_company
  on public.platform_clients (operational_company_id)
  where ai_agent_enabled = true;

create or replace function public.sync_ai_agent_professional_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.operational_company_id is null then return new; end if;

  if new.ai_agent_enabled
     and new.ai_agent_plan in ('Professional', 'Professional Trial')
     and (new.ai_agent_plan <> 'Professional Trial' or new.ai_agent_trial_end >= current_date) then
    insert into public.ai_agent_settings (
      company_id, is_active, mode, auto_manager_approval,
      auto_followup_agencies, allow_auto_agency_emails,
      run_in_background, client_auto_enabled, daily_brief_enabled
    ) values (
      new.operational_company_id, true, 'auto_notify_manager', true,
      true, false, true, false, true
    )
    on conflict (company_id) do update set
      is_active = true,
      run_in_background = true,
      updated_at = now();
  else
    update public.ai_agent_settings
    set is_active = false, updated_at = now()
    where company_id = new.operational_company_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_ai_agent_professional_settings on public.platform_clients;
create trigger trg_sync_ai_agent_professional_settings
after insert or update of ai_agent_enabled, ai_agent_plan, ai_agent_trial_end, operational_company_id
on public.platform_clients
for each row execute function public.sync_ai_agent_professional_settings();

create table if not exists public.company_trial_requests (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  admin_name text not null,
  email text not null,
  phone text,
  job_title text,
  team_size text,
  website text,
  status text not null default 'Pending',
  operational_company_id uuid references public.companies(id) on delete set null,
  platform_client_id uuid references public.platform_clients(id) on delete set null,
  request_ip_hash text,
  source text not null default 'Public Landing',
  accepted_terms_at timestamptz not null default now(),
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  constraint company_trial_requests_status_check check (status in ('Pending', 'Provisioned', 'Rejected', 'Failed'))
);

create unique index if not exists idx_company_trial_requests_email_once
  on public.company_trial_requests (lower(email));
create index if not exists idx_company_trial_requests_ip_created
  on public.company_trial_requests (request_ip_hash, created_at desc);

alter table public.company_trial_requests enable row level security;
revoke all on public.company_trial_requests from public, anon, authenticated;
grant all on public.company_trial_requests to service_role;
grant select on public.company_trial_requests to authenticated;

drop policy if exists company_trial_requests_owner_select on public.company_trial_requests;
create policy company_trial_requests_owner_select
on public.company_trial_requests for select to authenticated
using (public.is_current_platform_user());

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
  constraint ai_agent_usage_nonnegative_check check (input_tokens >= 0 and output_tokens >= 0 and total_tokens >= 0 and credits_debited >= 0)
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

create or replace function public.get_my_ai_agent_entitlement()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $function$
  select coalesce((
    select jsonb_build_object(
      'enabled', client.ai_agent_enabled,
      'ai_agent_plan', client.ai_agent_plan,
      'ai_agent_trial_start', client.ai_agent_trial_start,
      'ai_agent_trial_end', client.ai_agent_trial_end,
      'ai_agent_monthly_credit_limit', client.ai_agent_monthly_credit_limit,
      'available', client.ai_agent_enabled
        and client.ai_agent_plan in ('Professional', 'Professional Trial')
        and (client.ai_agent_plan <> 'Professional Trial' or client.ai_agent_trial_end >= current_date)
    )
    from public.users actor
    join public.platform_clients client on client.operational_company_id = actor.company_id
    where actor.auth_user_id = auth.uid()
      and actor.status = 'Active'
      and actor.is_active = true
    limit 1
  ), jsonb_build_object('enabled', false, 'available', false, 'ai_agent_plan', 'Standard'));
$function$;

revoke all on function public.get_my_ai_agent_entitlement() from public, anon;
grant execute on function public.get_my_ai_agent_entitlement() to authenticated, service_role;

create or replace function public.guard_ai_agent_professional_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Internal workers use the service role without an end-user auth uid.
  if auth.uid() is null or new.is_active is not true then return new; end if;
  if public.is_current_platform_user() then return new; end if;

  if not exists (
    select 1
    from public.users actor
    join public.platform_clients client on client.operational_company_id = actor.company_id
    where actor.auth_user_id = auth.uid()
      and actor.company_id = new.company_id
      and actor.status = 'Active'
      and actor.is_active = true
      and client.ai_agent_enabled = true
      and client.ai_agent_plan in ('Professional', 'Professional Trial')
      and (client.ai_agent_plan <> 'Professional Trial' or client.ai_agent_trial_end >= current_date)
  ) then
    raise exception 'AI_AGENT_PROFESSIONAL_NOT_ENABLED' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_ai_agent_professional_entitlement on public.ai_agent_settings;
create trigger trg_guard_ai_agent_professional_entitlement
before insert or update of is_active on public.ai_agent_settings
for each row execute function public.guard_ai_agent_professional_entitlement();
