-- Release hardening for the 27 public tables reported without RLS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regprocedure('public.current_app_user_company_id()') is null
     or to_regprocedure('public.current_app_user_role()') is null
     or to_regprocedure('public.current_app_user_agency_id()') is null
     or to_regprocedure('public.is_current_platform_user()') is null then
    raise exception 'FULL_RLS_PREREQUISITE_MISSING';
  end if;
end $$;

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

do $$ declare v_table text; v_policy record; begin
  foreach v_table in array array[
    'agency_members','agency_penalties','agency_scores','ai_agent_worker_runs','ai_interview_answers',
    'ai_interview_generation_runs','ai_interview_questions','ai_interview_sessions','ai_interview_templates',
    'candidate_technical_profiles','collections','company_agency_users','company_email_settings','demobilizations',
    'education_institutions','email_templates','invoice_items','invoices','local_content_project_targets',
    'local_content_settings','marketplace_deal_workers','marketplace_deals','marketplace_requests',
    'onboarding_validations','platform_clients','profession_aliases','subscription_invoices'
  ] loop
    if to_regclass(format('public.%I',v_table)) is null then raise exception 'FULL_RLS_TABLE_MISSING: %',v_table; end if;
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from anon, authenticated',v_table);
    execute format('grant all on table public.%I to service_role',v_table);
    for v_policy in select policyname from pg_policies where schemaname='public' and tablename=v_table loop
      execute format('drop policy %I on public.%I',v_policy.policyname,v_table);
    end loop;
  end loop;
end $$;

-- Normal tenant-owned operational rows.
do $$ declare v_table text; begin
  foreach v_table in array array[
    'ai_interview_generation_runs','candidate_technical_profiles','collections','demobilizations','email_templates',
    'invoice_items','invoices','local_content_project_targets','local_content_settings','marketplace_deal_workers',
    'marketplace_deals','marketplace_requests','onboarding_validations'
  ] loop
    execute format('grant select,insert,update,delete on public.%I to authenticated',v_table);
    execute format('create policy %I on public.%I for all to authenticated using
      (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))
      with check (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))',
      v_table||'_tenant_scope',v_table);
  end loop;
end $$;

-- Reference rows can be global but are never anonymous or anonymously mutable.
do $$ declare v_table text; begin
  foreach v_table in array array['education_institutions','profession_aliases'] loop
    execute format('grant select,insert,update,delete on public.%I to authenticated',v_table);
    execute format('create policy %I on public.%I for select to authenticated using
      (public.is_current_platform_user() or company_id is null or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))',v_table||'_read',v_table);
    execute format('create policy %I on public.%I for all to authenticated using
      (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))
      with check (public.is_current_platform_user() or (public.current_app_user_role()<>''Agency'' and company_id=public.current_app_user_company_id()))',v_table||'_write',v_table);
  end loop;
end $$;

grant select on public.ai_agent_worker_runs to authenticated;
create policy ai_agent_worker_runs_tenant_read on public.ai_agent_worker_runs for select to authenticated
using(public.is_current_platform_user() or company_id=public.current_app_user_company_id());
grant select,insert,update,delete on public.company_email_settings to authenticated;
create policy company_email_settings_admin on public.company_email_settings for all to authenticated
using(public.is_current_platform_user() or (company_id=public.current_app_user_company_id() and public.current_app_user_role() in ('Admin','Company Admin')))
with check(public.is_current_platform_user() or (company_id=public.current_app_user_company_id() and public.current_app_user_role() in ('Admin','Company Admin')));

grant select on public.agency_members to authenticated;
create policy agency_members_identity on public.agency_members for select to authenticated
using(public.is_current_platform_user() or agency_id=public.current_app_user_agency_id());
grant select,insert,update,delete on public.company_agency_users,public.agency_penalties,public.agency_scores to authenticated;
create policy company_agency_users_scope on public.company_agency_users for all to authenticated
using(public.is_current_platform_user() or company_id=public.current_app_user_company_id() or agency_id=public.current_app_user_agency_id())
with check(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()));
create policy agency_penalties_scope on public.agency_penalties for all to authenticated
using(public.is_current_platform_user() or company_id=public.current_app_user_company_id() or agency_id=public.current_app_user_agency_id())
with check(public.is_current_platform_user() or company_id=public.current_app_user_company_id() or agency_id=public.current_app_user_agency_id());
create policy agency_scores_read on public.agency_scores for select to authenticated
using(public.is_current_platform_user() or company_id=public.current_app_user_company_id() or public.agency_candidate_access_allowed(company_id,agency_name,'select'));
create policy agency_scores_write on public.agency_scores for all to authenticated
using(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()))
with check(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()));

grant select,insert,update,delete on public.platform_clients,public.subscription_invoices to authenticated;
create policy platform_clients_owner on public.platform_clients for all to authenticated using(public.is_current_platform_user()) with check(public.is_current_platform_user());
create policy subscription_invoices_owner on public.subscription_invoices for all to authenticated using(public.is_current_platform_user()) with check(public.is_current_platform_user());

-- Company and exact-token candidate access to interview data.
grant select,insert,update,delete on public.ai_interview_sessions,public.ai_interview_answers,public.ai_interview_templates,public.ai_interview_questions to authenticated;
grant select,insert,update on public.ai_interview_sessions,public.ai_interview_answers to anon;
grant select on public.ai_interview_templates,public.ai_interview_questions to anon;
create policy ai_sessions_company on public.ai_interview_sessions for all to authenticated
using(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()))
with check(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()));
create policy ai_sessions_token_read on public.ai_interview_sessions for select to anon using(access_token=public.current_ai_interview_access_token());
create policy ai_sessions_token_update on public.ai_interview_sessions for update to anon using(access_token=public.current_ai_interview_access_token()) with check(access_token=public.current_ai_interview_access_token());
create policy ai_answers_company on public.ai_interview_answers for all to authenticated
using(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()))
with check(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()));
create policy ai_answers_token_read on public.ai_interview_answers for select to anon using(public.ai_interview_session_token_allowed(session_id));
create policy ai_answers_token_insert on public.ai_interview_answers for insert to anon with check(public.ai_interview_session_token_allowed(session_id));
create policy ai_answers_token_update on public.ai_interview_answers for update to anon using(public.ai_interview_session_token_allowed(session_id)) with check(public.ai_interview_session_token_allowed(session_id));
create policy ai_templates_company on public.ai_interview_templates for all to authenticated
using(public.is_current_platform_user() or is_global is true or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()))
with check(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()));
create policy ai_templates_token_read on public.ai_interview_templates for select to anon using(exists(
  select 1 from public.ai_interview_sessions s where s.template_id=ai_interview_templates.id and s.access_token=public.current_ai_interview_access_token()));
create policy ai_questions_company on public.ai_interview_questions for all to authenticated
using(public.is_current_platform_user() or is_global is true or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()))
with check(public.is_current_platform_user() or (public.current_app_user_role()<>'Agency' and company_id=public.current_app_user_company_id()));
create policy ai_questions_token_read on public.ai_interview_questions for select to anon using(exists(
  select 1 from public.ai_interview_sessions s where s.template_id=ai_interview_questions.template_id and s.access_token=public.current_ai_interview_access_token()));

commit;
