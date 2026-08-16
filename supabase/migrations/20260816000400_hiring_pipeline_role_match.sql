-- Enforce job-to-candidate profession matching when Talent profiles enter a pipeline.

create or replace function public.normalize_hiring_role(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
      regexp_replace(lower(coalesce(p_value, '')), '\m(senior|sr|junior|jr)\M', ' ', 'g'),
      'human resources', 'hr'),
      'director of hr', 'hr director'),
      'information technology', 'it'),
      'business development', 'bd'),
      'quality assurance', 'qa'),
      'quality control', 'qc'),
      'facilities management', 'fm'),
      'مدير الموارد البشرية', 'hr director'),
      'الموارد البشرية', 'hr'),
    '[^a-z0-9\u0600-\u06ff]+', ' ', 'g'
  ));
$$;

create or replace function public.add_talent_candidate_to_hiring_pipeline(p_job_id uuid, p_candidate_source text, p_candidate_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_application public.company_hiring_pipeline;
  v_inserted boolean := false;
  v_job_title text;
  v_candidate_role text;
begin
  if auth.uid() is null or v_company_id is null or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;

  select job.title into v_job_title
  from public.company_hiring_jobs job
  where job.id = p_job_id and job.company_id = v_company_id and job.status = 'Active';
  if v_job_title is null then
    raise exception using errcode = 'P0002', message = 'Active hiring job was not found.';
  end if;

  if p_candidate_source = 'Registered Talent' then
    select coalesce(candidate.profession, candidate.current_job_title) into v_candidate_role
    from public.talent_candidates candidate
    where candidate.id = p_candidate_id and candidate.marketplace_status = 'Approved' and candidate.is_verified is true;
  elsif p_candidate_source = 'Imported Talent' then
    select coalesce(prospect.current_title, prospect.source_job_title) into v_candidate_role
    from public.talent_imported_prospects prospect
    where prospect.id = p_candidate_id and prospect.marketplace_profile_consent is true and prospect.claimed_candidate_id is null;
  elsif p_candidate_source = 'Company Candidate' then
    select candidate.profession into v_candidate_role
    from public.candidates candidate
    where candidate.id = p_candidate_id and candidate.company_id = v_company_id;
  else
    raise exception using errcode = '22023', message = 'Unsupported candidate source.';
  end if;

  if v_candidate_role is null then
    raise exception using errcode = 'P0002', message = 'Talent candidate was not found or has no profession.';
  end if;
  if public.normalize_hiring_role(v_candidate_role) <> public.normalize_hiring_role(v_job_title) then
    raise exception using errcode = '22023', message = 'Candidate profession does not match the selected hiring job.';
  end if;

  insert into public.company_hiring_pipeline(company_id, job_id, candidate_source, candidate_id, created_by_auth_user_id)
  values(v_company_id, p_job_id, p_candidate_source, p_candidate_id, auth.uid())
  on conflict(company_id, job_id, candidate_source, candidate_id) do nothing
  returning * into v_application;
  if v_application.id is not null then v_inserted := true;
  else select application.* into v_application from public.company_hiring_pipeline application
    where application.company_id = v_company_id and application.job_id = p_job_id and application.candidate_source = p_candidate_source and application.candidate_id = p_candidate_id;
  end if;
  return jsonb_build_object('application_id', v_application.id, 'stage', v_application.stage, 'inserted', v_inserted, 'duplicate_prevented', not v_inserted);
end;
$$;

revoke all on function public.normalize_hiring_role(text) from public, anon;
grant execute on function public.normalize_hiring_role(text) to authenticated;
revoke all on function public.add_talent_candidate_to_hiring_pipeline(uuid,text,uuid) from public, anon;
grant execute on function public.add_talent_candidate_to_hiring_pipeline(uuid,text,uuid) to authenticated;
