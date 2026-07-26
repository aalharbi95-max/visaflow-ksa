-- Browser product contracts layered after the shared application security migration.

drop policy if exists vf_candidates_agency_select on public.candidates;
drop policy if exists vf_candidates_agency_insert on public.candidates;
drop policy if exists vf_candidates_agency_update on public.candidates;
drop policy if exists vf_interviews_agency_select on public.interviews;
drop policy if exists vf_interviews_agency_insert on public.interviews;
drop policy if exists vf_interviews_agency_update on public.interviews;

create policy vf_candidates_agency_select on public.candidates
  for select to authenticated
  using (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'read'));
create policy vf_candidates_agency_insert on public.candidates
  for insert to authenticated
  with check (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'upload_candidates'));
create policy vf_candidates_agency_update on public.candidates
  for update to authenticated
  using (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'update_candidates'))
  with check (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'update_candidates'));

create policy vf_interviews_agency_select on public.interviews
  for select to authenticated
  using (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'view_interviews'));
create policy vf_interviews_agency_insert on public.interviews
  for insert to authenticated
  with check (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'update_candidates'));
create policy vf_interviews_agency_update on public.interviews
  for update to authenticated
  using (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'update_candidates'))
  with check (agency_id is not null and public.visaflow_agency_can(company_id, agency_id, 'update_candidates'));

create or replace function public.list_authorized_ai_interview_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_rows jsonb;
begin
  v_actor := private.require_workspace_actor(array['Admin','Company Admin','CEO','Operations Manager','Recruitment Manager','Recruitment Officer','Platform Owner']);
  select coalesce(jsonb_agg(to_jsonb(s) - 'access_token' - 'invitation_url' order by s.created_at desc), '[]'::jsonb)
    into v_rows from public.ai_interview_sessions s
    where (v_actor.role = 'Platform Owner' and v_actor.company_id is null) or s.company_id = v_actor.company_id;
  return v_rows;
end;
$$;
revoke all on function public.list_authorized_ai_interview_sessions() from public, anon;
grant execute on function public.list_authorized_ai_interview_sessions() to authenticated;

-- A table-level SELECT grant overrides column-level revocations in PostgreSQL.
-- Replace it with an explicit safe-column grant so legacy invitation material can
-- never be returned by PostgREST to an authenticated browser.
revoke select on table public.ai_interview_sessions from authenticated;
do $grant_safe_session_columns$
declare
  v_columns text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.ai_interview_sessions'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('access_token', 'invitation_url');

  if v_columns is null then
    raise exception 'Unable to resolve safe ai_interview_sessions columns';
  end if;

  execute format(
    'grant select (%s) on table public.ai_interview_sessions to authenticated',
    v_columns
  );
end
$grant_safe_session_columns$;

create or replace function public.list_authorized_ai_interview_invitation_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_rows jsonb;
begin
  v_actor := private.require_workspace_actor(array['Admin','Company Admin','CEO','Operations Manager','Recruitment Manager','Recruitment Officer']);
  if v_actor.company_id is null then raise exception 'access denied' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'company_id', j.company_id, 'campaign_id', j.campaign_id,
    'campaign_candidate_id', j.campaign_candidate_id, 'session_id', j.session_id,
    'job_type', j.job_type, 'recipient_email', j.recipient_email,
    'recipient_name', j.recipient_name, 'language', j.language, 'status', j.status,
    'priority', j.priority, 'attempt_count', j.attempt_count, 'max_attempts', j.max_attempts,
    'available_at', j.available_at, 'sent_at', j.sent_at, 'message_id', j.message_id,
    'last_error', j.last_error, 'created_at', j.created_at, 'updated_at', j.updated_at
  ) order by j.created_at desc), '[]'::jsonb)
    into v_rows from public.ai_interview_invitation_jobs j where j.company_id = v_actor.company_id;
  return v_rows;
end;
$$;
revoke all on function public.list_authorized_ai_interview_invitation_jobs() from public, anon;
grant execute on function public.list_authorized_ai_interview_invitation_jobs() to authenticated;
revoke select on table public.ai_interview_invitation_jobs from authenticated;

create or replace function private.require_campaign_actor(p_campaign_id uuid)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_company_id uuid;
begin
  v_actor := private.require_workspace_actor(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer']);
  select c.company_id into v_company_id from public.ai_interview_campaigns c where c.id = p_campaign_id;
  if v_company_id is null or v_actor.company_id is distinct from v_company_id then
    raise exception 'campaign unavailable' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function private.require_campaign_actor(uuid) from public, anon, authenticated;
grant execute on function private.require_campaign_actor(uuid) to service_role;

create or replace function public.secure_create_ai_interview_template_version(p_template_id uuid, p_version_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_company_id uuid;
begin
  v_actor := private.require_workspace_actor(array['Admin','Company Admin','Recruitment Manager']);
  select t.company_id into v_company_id from public.ai_interview_templates t where t.id = p_template_id;
  if v_company_id is null or v_actor.company_id is distinct from v_company_id then raise exception 'template unavailable' using errcode = '42501'; end if;
  return public.create_ai_interview_template_version(p_template_id, p_version_notes);
end;
$$;
revoke all on function public.secure_create_ai_interview_template_version(uuid, text) from public, anon;
grant execute on function public.secure_create_ai_interview_template_version(uuid, text) to authenticated;

create or replace function public.secure_add_candidates_to_ai_interview_campaign(p_campaign_id uuid, p_candidate_ids text[])
returns table(requested_count integer, inserted_count integer, duplicate_count integer, valid_count integer, invalid_count integer)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_campaign_actor(p_campaign_id);
  if exists (select 1 from public.candidates c where c.id::text = any(p_candidate_ids) and c.company_id is distinct from (select company_id from public.ai_interview_campaigns where id = p_campaign_id)) then
    raise exception 'candidate tenant mismatch' using errcode = '42501';
  end if;
  return query select * from public.add_candidates_to_ai_interview_campaign(p_campaign_id, p_candidate_ids);
end $$;

create or replace function public.secure_remove_candidates_from_ai_interview_campaign(p_campaign_id uuid, p_campaign_candidate_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
begin perform private.require_campaign_actor(p_campaign_id);
  if exists (select 1 from public.ai_interview_campaign_candidates cc where cc.id = any(p_campaign_candidate_ids) and cc.campaign_id <> p_campaign_id) then
    raise exception 'candidate tenant mismatch' using errcode = '42501'; end if;
  return public.remove_candidates_from_ai_interview_campaign(p_campaign_id, p_campaign_candidate_ids);
end $$;

create or replace function public.secure_revalidate_ai_interview_campaign_candidates(p_campaign_id uuid)
returns table(total_count integer, valid_count integer, invalid_count integer, duplicate_count integer, ready_to_launch boolean)
language plpgsql security definer set search_path = '' as $$
begin perform private.require_campaign_actor(p_campaign_id);
  return query select * from public.revalidate_ai_interview_campaign_candidates(p_campaign_id);
end $$;

create or replace function public.secure_launch_ai_interview_campaign(p_campaign_id uuid, p_app_base_url text default 'https://visaflowksa.com')
returns table(campaign_id uuid, campaign_status text, valid_candidates integer, sessions_created integer, existing_sessions integer, invitation_jobs_queued integer, invalid_candidates_skipped integer)
language plpgsql security definer set search_path = '' as $$
begin perform private.require_campaign_actor(p_campaign_id);
  return query select * from public.launch_ai_interview_campaign(p_campaign_id, p_app_base_url);
  update public.ai_interview_sessions set invitation_url = '', updated_at = now() where campaign_id = p_campaign_id;
  update public.ai_interview_invitation_jobs
    set payload = payload - 'invitation_url' - 'access_token', updated_at = now()
    where campaign_id = p_campaign_id;
end $$;

revoke all on function public.secure_add_candidates_to_ai_interview_campaign(uuid, text[]) from public, anon;
revoke all on function public.secure_remove_candidates_from_ai_interview_campaign(uuid, uuid[]) from public, anon;
revoke all on function public.secure_revalidate_ai_interview_campaign_candidates(uuid) from public, anon;
revoke all on function public.secure_launch_ai_interview_campaign(uuid, text) from public, anon;
grant execute on function public.secure_add_candidates_to_ai_interview_campaign(uuid, text[]) to authenticated;
grant execute on function public.secure_remove_candidates_from_ai_interview_campaign(uuid, uuid[]) to authenticated;
grant execute on function public.secure_revalidate_ai_interview_campaign_candidates(uuid) to authenticated;
grant execute on function public.secure_launch_ai_interview_campaign(uuid, text) to authenticated;

revoke execute on function public.create_ai_interview_template_version(uuid, text) from public, anon, authenticated;
revoke execute on function public.add_candidates_to_ai_interview_campaign(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.remove_candidates_from_ai_interview_campaign(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.revalidate_ai_interview_campaign_candidates(uuid) from public, anon, authenticated;
revoke execute on function public.launch_ai_interview_campaign(uuid, text) from public, anon, authenticated;

-- Invitation queues are service contracts. Browsers can inspect their own
-- tenant queue through RLS, but can never claim, complete, or fail jobs.
revoke execute on function public.claim_ai_interview_invitation_jobs(integer, text) from public, anon, authenticated;
revoke execute on function public.complete_ai_interview_invitation_job(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.fail_ai_interview_invitation_job(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_interview_invitation_jobs(integer, text) to service_role;
grant execute on function public.complete_ai_interview_invitation_job(uuid, text, text) to service_role;
grant execute on function public.fail_ai_interview_invitation_job(uuid, text, integer) to service_role;
