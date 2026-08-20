-- Consolidated, fail-closed alignment for the two confirmed Production
-- Security Advisor root causes. This migration contains no row DML.
-- Canonical sources: 20260817000500, 20260817000700, 20260817000800,
-- 20260817001300, and the view-only portion of 20260817001400.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- All integrity and prerequisite checks intentionally precede the first
-- privilege, RLS, policy, or view change. Any failure aborts the transaction.
do $precheck$
declare
  v_table text;
  v_function text;
  v_count bigint;
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.agencies') is null then
    raise exception using
      errcode = '55000',
      message = 'PRODUCTION_SECURITY_PREREQUISITE_MISSING: companies or agencies';
  end if;

  foreach v_function in array array[
    'public.current_app_user_company_id()',
    'public.current_app_user_role()',
    'public.current_app_user_agency_id()',
    'public.current_app_user_has_role(text[])',
    'public.is_current_platform_user()',
    'public.agency_recruitment_access_allowed(uuid,uuid,text)',
    'public.agency_candidate_access_allowed(uuid,text,text)'
  ] loop
    if to_regprocedure(v_function) is null then
      raise exception using
        errcode = '55000',
        message = format('PRODUCTION_SECURITY_FUNCTION_MISSING: %s', v_function);
    end if;
  end loop;

  foreach v_table in array array[
    'agency_client_access','agency_members','agency_penalties','agency_scores',
    'ai_agent_action_locks','ai_agent_jobs','ai_agent_settings','ai_agent_worker_runs',
    'ai_interview_answers','ai_interview_generation_runs','ai_interview_questions',
    'ai_interview_sessions','ai_interview_templates','candidate_technical_profiles',
    'collections','company_agency_users','company_email_settings','demobilizations',
    'education_institutions','email_templates','employees','interviews','invoice_items',
    'invoices','local_content_project_targets','local_content_settings',
    'marketplace_deal_workers','marketplace_deals','marketplace_requests','mobilizations',
    'onboarding_validations','platform_clients','profession_aliases','subscription_invoices'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception using
        errcode = '42P01',
        message = format('PRODUCTION_SECURITY_TABLE_MISSING: public.%I', v_table);
    end if;
  end loop;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'ai_agent_hourly_activity' and c.relkind = 'v'
  ) then
    raise exception using
      errcode = '55000',
      message = 'PRODUCTION_SECURITY_VIEW_MISSING: public.ai_agent_hourly_activity';
  end if;

  if to_regclass('public.employees_id_seq') is null
     or to_regclass('public.mobilizations_id_seq') is null then
    raise exception using
      errcode = '55000',
      message = 'PRODUCTION_SECURITY_SEQUENCE_MISSING: employees_id_seq or mobilizations_id_seq';
  end if;

  -- Tenant-operational tables must never contain an unowned row.
  foreach v_table in array array[
    'agency_client_access','agency_penalties','agency_scores','ai_agent_action_locks',
    'ai_agent_jobs','ai_agent_settings','ai_agent_worker_runs','ai_interview_answers',
    'ai_interview_generation_runs','ai_interview_questions','ai_interview_sessions',
    'ai_interview_templates','candidate_technical_profiles','collections',
    'company_agency_users','company_email_settings','demobilizations','email_templates',
    'employees','interviews','invoice_items','invoices','local_content_project_targets',
    'local_content_settings','marketplace_deal_workers','marketplace_deals',
    'marketplace_requests','mobilizations','onboarding_validations'
  ] loop
    execute format('select count(*) from public.%I where company_id is null', v_table)
      into v_count;
    if v_count > 0 then
      raise exception using
        errcode = '23502',
        message = format('PRODUCTION_SECURITY_NULL_TENANT: public.%I has %s row(s)', v_table, v_count);
    end if;
  end loop;

  -- Every non-global company_id must resolve to an existing company. The two
  -- reference tables explicitly permit company_id IS NULL for global rows.
  foreach v_table in array array[
    'agency_client_access','agency_penalties','agency_scores','ai_agent_action_locks',
    'ai_agent_jobs','ai_agent_settings','ai_agent_worker_runs','ai_interview_answers',
    'ai_interview_generation_runs','ai_interview_questions','ai_interview_sessions',
    'ai_interview_templates','candidate_technical_profiles','collections',
    'company_agency_users','company_email_settings','demobilizations',
    'education_institutions','email_templates','employees','interviews','invoice_items',
    'invoices','local_content_project_targets','local_content_settings',
    'marketplace_deal_workers','marketplace_deals','marketplace_requests','mobilizations',
    'onboarding_validations','profession_aliases'
  ] loop
    execute format(
      'select count(*) from public.%I scoped left join public.companies tenant on tenant.id = scoped.company_id where scoped.company_id is not null and tenant.id is null',
      v_table
    ) into v_count;
    if v_count > 0 then
      raise exception using
        errcode = '23503',
        message = format('PRODUCTION_SECURITY_ORPHAN_TENANT: public.%I has %s row(s)', v_table, v_count);
    end if;
  end loop;

  -- Agency-owned rows must resolve to an existing agency. Nullable agency_id
  -- remains allowed only where the canonical Staging schema permits it.
  foreach v_table in array array[
    'agency_client_access','agency_members','agency_penalties','ai_agent_action_locks',
    'company_agency_users','interviews','onboarding_validations'
  ] loop
    execute format(
      'select count(*) from public.%I scoped left join public.agencies agency on agency.id = scoped.agency_id where scoped.agency_id is not null and agency.id is null',
      v_table
    ) into v_count;
    if v_count > 0 then
      raise exception using
        errcode = '23503',
        message = format('PRODUCTION_SECURITY_ORPHAN_AGENCY: public.%I has %s row(s)', v_table, v_count);
    end if;
  end loop;

  -- Parent links that carry tenant data may be nullable, but when present they
  -- must exist and must not cross company boundaries.
  select count(*) into v_count
  from public.ai_interview_answers child
  left join public.ai_interview_sessions parent on parent.id = child.session_id
  where parent.id is null or parent.company_id is distinct from child.company_id;
  if v_count > 0 then
    raise exception using errcode = '23503',
      message = format('PRODUCTION_SECURITY_SESSION_TENANT_MISMATCH: ai_interview_answers has %s row(s)', v_count);
  end if;

  select count(*) into v_count
  from public.invoice_items child
  left join public.invoices parent on parent.id = child.invoice_id
  where child.invoice_id is not null
    and (parent.id is null or parent.company_id is distinct from child.company_id);
  if v_count > 0 then
    raise exception using errcode = '23503',
      message = format('PRODUCTION_SECURITY_INVOICE_TENANT_MISMATCH: invoice_items has %s row(s)', v_count);
  end if;

  select count(*) into v_count
  from public.collections child
  left join public.invoices parent on parent.id = child.invoice_id
  where child.invoice_id is not null
    and (parent.id is null or parent.company_id is distinct from child.company_id);
  if v_count > 0 then
    raise exception using errcode = '23503',
      message = format('PRODUCTION_SECURITY_COLLECTION_TENANT_MISMATCH: collections has %s row(s)', v_count);
  end if;

  select count(*) into v_count
  from public.marketplace_deal_workers child
  left join public.marketplace_deals parent on parent.id::text = child.deal_id
  where child.deal_id is not null
    and (parent.id is null or parent.company_id is distinct from child.company_id);
  if v_count > 0 then
    raise exception using errcode = '23503',
      message = format('PRODUCTION_SECURITY_DEAL_TENANT_MISMATCH: marketplace_deal_workers has %s row(s)', v_count);
  end if;

  select count(*) into v_count
  from public.platform_clients client
  left join public.companies tenant on tenant.id = client.operational_company_id
  where client.operational_company_id is not null and tenant.id is null;
  if v_count > 0 then
    raise exception using errcode = '23503',
      message = format('PRODUCTION_SECURITY_PLATFORM_CLIENT_ORPHAN: platform_clients has %s row(s)', v_count);
  end if;

  select count(*) into v_count
  from public.subscription_invoices invoice
  left join public.platform_clients client on client.id = invoice.client_id
  where invoice.client_id is not null and client.id is null;
  if v_count > 0 then
    raise exception using errcode = '23503',
      message = format('PRODUCTION_SECURITY_SUBSCRIPTION_CLIENT_ORPHAN: subscription_invoices has %s row(s)', v_count);
  end if;
end
$precheck$;

-- Exact canonical helper from 20260817000500. Its two dependencies are
-- verified by the prerequisite block above before any security change.
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

create or replace function public.current_ai_interview_access_token()
returns text language sql stable set search_path = '' as $$
  select nullif(left(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-ai-interview-token',''),256),'')
$$;
create or replace function public.ai_interview_session_token_allowed(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.ai_interview_sessions s where s.id=p_session_id
    and s.access_token=public.current_ai_interview_access_token()
    and (s.expires_at is null or s.expires_at>=now() or s.status in ('Completed','Cancelled')))
$$;
revoke all on function public.current_ai_interview_access_token() from public;
revoke all on function public.ai_interview_session_token_allowed(uuid) from public;
grant execute on function public.current_ai_interview_access_token() to anon,authenticated,service_role;
grant execute on function public.ai_interview_session_token_allowed(uuid) to anon,authenticated,service_role;

-- Canonical operational-table grants and RLS from 20260817000700/00800.
revoke all on table public.employees, public.interviews, public.mobilizations,
  public.agency_client_access from anon;
revoke all on table public.employees, public.interviews, public.mobilizations,
  public.agency_client_access from authenticated;
grant select, insert, update, delete on table
  public.employees, public.interviews, public.mobilizations to authenticated;
grant all on table public.employees, public.interviews, public.mobilizations,
  public.agency_client_access to service_role;

alter table public.employees enable row level security;
alter table public.interviews enable row level security;
alter table public.mobilizations enable row level security;
alter table public.agency_client_access enable row level security;

do $policies$
declare v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename = any(array['employees','interviews','mobilizations','agency_client_access'])
  loop
    execute format('drop policy %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
  end loop;
end
$policies$;

create policy employees_select_tenant_policy on public.employees
for select to authenticated using (
  public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
);
create policy employees_insert_tenant_policy on public.employees
for insert to authenticated with check (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager']))
);
create policy employees_update_tenant_policy on public.employees
for update to authenticated using (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager']))
) with check (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager']))
);
create policy employees_delete_tenant_policy on public.employees
for delete to authenticated using (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager']))
);

create policy interviews_select_tenant_policy on public.interviews
for select to authenticated using (
  public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'view_interviews'))
);
create policy interviews_insert_tenant_policy on public.interviews
for insert to authenticated with check (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer']))
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
);
create policy interviews_update_tenant_policy on public.interviews
for update to authenticated using (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer']))
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
) with check (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer']))
  or (agency_id is not null and public.agency_recruitment_access_allowed(company_id, agency_id, 'update'))
);
create policy interviews_delete_tenant_policy on public.interviews
for delete to authenticated using (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager']))
);

create policy mobilizations_select_tenant_policy on public.mobilizations
for select to authenticated using (
  public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id())
);
create policy mobilizations_insert_tenant_policy on public.mobilizations
for insert to authenticated with check (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager','Recruitment Manager','Recruitment Officer']))
);
create policy mobilizations_update_tenant_policy on public.mobilizations
for update to authenticated using (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager','Recruitment Manager','Recruitment Officer']))
) with check (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager','Recruitment Manager','Recruitment Officer']))
);
create policy mobilizations_delete_tenant_policy on public.mobilizations
for delete to authenticated using (
  public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id()
      and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Project Manager','Recruitment Manager','Recruitment Officer']))
);

revoke all on sequence public.employees_id_seq, public.mobilizations_id_seq from anon;
revoke all on sequence public.employees_id_seq, public.mobilizations_id_seq from authenticated;
grant usage, select on sequence public.employees_id_seq, public.mobilizations_id_seq to authenticated;
grant all on sequence public.employees_id_seq, public.mobilizations_id_seq to service_role;

-- Canonical AI Agent table policies from 20260817000500.
alter table public.ai_agent_settings enable row level security;
revoke all on public.ai_agent_settings from public, anon, authenticated;
grant all on public.ai_agent_settings to service_role;
grant select, insert, update on public.ai_agent_settings to authenticated;
drop policy if exists ai_agent_settings_tenant_select on public.ai_agent_settings;
create policy ai_agent_settings_tenant_select on public.ai_agent_settings for select to authenticated
using (public.can_read_ai_agent_company(company_id));
drop policy if exists ai_agent_settings_tenant_insert on public.ai_agent_settings;
create policy ai_agent_settings_tenant_insert on public.ai_agent_settings for insert to authenticated
with check (company_id = public.current_app_user_company_id()
  and public.current_app_user_has_role(array['Admin','Company Admin']));
drop policy if exists ai_agent_settings_tenant_update on public.ai_agent_settings;
create policy ai_agent_settings_tenant_update on public.ai_agent_settings for update to authenticated
using (company_id = public.current_app_user_company_id()
  and public.current_app_user_has_role(array['Admin','Company Admin']))
with check (company_id = public.current_app_user_company_id()
  and public.current_app_user_has_role(array['Admin','Company Admin']));

alter table public.ai_agent_jobs enable row level security;
revoke all on public.ai_agent_jobs from public, anon, authenticated;
grant all on public.ai_agent_jobs to service_role;
grant select, insert on public.ai_agent_jobs to authenticated;
drop policy if exists ai_agent_jobs_tenant_select on public.ai_agent_jobs;
create policy ai_agent_jobs_tenant_select on public.ai_agent_jobs for select to authenticated
using (public.can_read_ai_agent_company(company_id));
drop policy if exists ai_agent_jobs_tenant_insert on public.ai_agent_jobs;
create policy ai_agent_jobs_tenant_insert on public.ai_agent_jobs for insert to authenticated
with check (company_id = public.current_app_user_company_id()
  and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer'])
  and (requested_by is null or requested_by = auth.uid()));

alter table public.ai_agent_action_locks enable row level security;
revoke all on public.ai_agent_action_locks from public, anon, authenticated;
grant all on public.ai_agent_action_locks to service_role;
grant select on public.ai_agent_action_locks to authenticated;
drop policy if exists ai_agent_locks_tenant_select on public.ai_agent_action_locks;
create policy ai_agent_locks_tenant_select on public.ai_agent_action_locks for select to authenticated
using (public.can_read_ai_agent_company(company_id));

-- Canonical policies for the remaining 27 affected tables from 20260817001300.
do $tables$
declare v_table text; v_policy record;
begin
  foreach v_table in array array[
    'agency_members','agency_penalties','agency_scores','ai_agent_worker_runs','ai_interview_answers',
    'ai_interview_generation_runs','ai_interview_questions','ai_interview_sessions','ai_interview_templates',
    'candidate_technical_profiles','collections','company_agency_users','company_email_settings','demobilizations',
    'education_institutions','email_templates','invoice_items','invoices','local_content_project_targets',
    'local_content_settings','marketplace_deal_workers','marketplace_deals','marketplace_requests',
    'onboarding_validations','platform_clients','profession_aliases','subscription_invoices'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
    for v_policy in
      select policyname from pg_policies where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end
$tables$;

do $tenant_policies$
declare v_table text;
begin
  foreach v_table in array array[
    'ai_interview_generation_runs','candidate_technical_profiles','collections','demobilizations','email_templates',
    'invoice_items','invoices','local_content_project_targets','local_content_settings','marketplace_deal_workers',
    'marketplace_deals','marketplace_requests','onboarding_validations'
  ] loop
    execute format('grant select,insert,update,delete on public.%I to authenticated', v_table);
    execute format('create policy %I on public.%I for all to authenticated using
      (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))
      with check (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))',
      v_table || '_tenant_scope', v_table);
  end loop;
end
$tenant_policies$;

do $reference_policies$
declare v_table text;
begin
  foreach v_table in array array['education_institutions','profession_aliases'] loop
    execute format('grant select,insert,update,delete on public.%I to authenticated', v_table);
    execute format('create policy %I on public.%I for select to authenticated using
      (public.is_current_platform_user() or company_id is null or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))',
      v_table || '_read', v_table);
    execute format('create policy %I on public.%I for all to authenticated using
      (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))
      with check (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))',
      v_table || '_write', v_table);
  end loop;
end
$reference_policies$;

grant select on public.ai_agent_worker_runs to authenticated;
create policy ai_agent_worker_runs_tenant_read on public.ai_agent_worker_runs for select to authenticated
using (public.is_current_platform_user() or company_id = public.current_app_user_company_id());

grant select, insert, update, delete on public.company_email_settings to authenticated;
create policy company_email_settings_admin on public.company_email_settings for all to authenticated
using (public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id() and public.current_app_user_role() in ('Admin','Company Admin')))
with check (public.is_current_platform_user()
  or (company_id = public.current_app_user_company_id() and public.current_app_user_role() in ('Admin','Company Admin')));

grant select on public.agency_members to authenticated;
create policy agency_members_identity on public.agency_members for select to authenticated
using (public.is_current_platform_user() or agency_id = public.current_app_user_agency_id());

grant select, insert, update, delete on public.company_agency_users, public.agency_penalties, public.agency_scores to authenticated;
create policy company_agency_users_scope on public.company_agency_users for all to authenticated
using (public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
  or agency_id = public.current_app_user_agency_id())
with check (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()));
create policy agency_penalties_scope on public.agency_penalties for all to authenticated
using (public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
  or agency_id = public.current_app_user_agency_id())
with check (public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
  or agency_id = public.current_app_user_agency_id());
create policy agency_scores_read on public.agency_scores for select to authenticated
using (public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
  or public.agency_candidate_access_allowed(company_id, agency_name, 'select'));
create policy agency_scores_write on public.agency_scores for all to authenticated
using (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()))
with check (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()));

grant select, insert, update, delete on public.platform_clients, public.subscription_invoices to authenticated;
create policy platform_clients_owner on public.platform_clients for all to authenticated
using (public.is_current_platform_user()) with check (public.is_current_platform_user());
create policy subscription_invoices_owner on public.subscription_invoices for all to authenticated
using (public.is_current_platform_user()) with check (public.is_current_platform_user());

grant select, insert, update, delete on public.ai_interview_sessions, public.ai_interview_answers,
  public.ai_interview_templates, public.ai_interview_questions to authenticated;
grant select, insert, update on public.ai_interview_sessions, public.ai_interview_answers to anon;
grant select on public.ai_interview_templates, public.ai_interview_questions to anon;

create policy ai_sessions_company on public.ai_interview_sessions for all to authenticated
using (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()))
with check (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()));
create policy ai_sessions_token_read on public.ai_interview_sessions for select to anon
using (access_token = public.current_ai_interview_access_token());
create policy ai_sessions_token_update on public.ai_interview_sessions for update to anon
using (access_token = public.current_ai_interview_access_token())
with check (access_token = public.current_ai_interview_access_token());

create policy ai_answers_company on public.ai_interview_answers for all to authenticated
using (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()))
with check (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()));
create policy ai_answers_token_read on public.ai_interview_answers for select to anon
using (public.ai_interview_session_token_allowed(session_id));
create policy ai_answers_token_insert on public.ai_interview_answers for insert to anon
with check (public.ai_interview_session_token_allowed(session_id));
create policy ai_answers_token_update on public.ai_interview_answers for update to anon
using (public.ai_interview_session_token_allowed(session_id))
with check (public.ai_interview_session_token_allowed(session_id));

create policy ai_templates_company on public.ai_interview_templates for all to authenticated
using (public.is_current_platform_user() or is_global is true
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()))
with check (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()));
create policy ai_templates_token_read on public.ai_interview_templates for select to anon using (exists(
  select 1 from public.ai_interview_sessions s
  where s.template_id = ai_interview_templates.id
    and s.access_token = public.current_ai_interview_access_token()
));

create policy ai_questions_company on public.ai_interview_questions for all to authenticated
using (public.is_current_platform_user() or is_global is true
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()))
with check (public.is_current_platform_user()
  or (public.current_app_user_role() <> 'Agency' and company_id = public.current_app_user_company_id()));
create policy ai_questions_token_read on public.ai_interview_questions for select to anon using (exists(
  select 1 from public.ai_interview_sessions s
  where s.template_id = ai_interview_questions.template_id
    and s.access_token = public.current_ai_interview_access_token()
));

-- Canonical view-only remediation from 20260817001400.
alter view public.ai_agent_hourly_activity set (security_invoker = true);
revoke all on public.ai_agent_hourly_activity from public, anon, authenticated;
grant select on public.ai_agent_hourly_activity to service_role;

commit;
