-- CV-derived marketplace profiles for imported applicants.
-- Source job metadata remains private and is never used as the public profession.

alter table public.talent_imported_prospects
  add column if not exists cv_source_filename text,
  add column if not exists cv_specialty text,
  add column if not exists cv_professional_summary text,
  add column if not exists cv_years_experience smallint,
  add column if not exists cv_skills jsonb not null default '[]'::jsonb,
  add column if not exists cv_analyzed_at timestamptz;

alter table public.talent_imported_prospects
  drop constraint if exists talent_imported_prospects_cv_years_check;
alter table public.talent_imported_prospects
  add constraint talent_imported_prospects_cv_years_check
    check (cv_years_experience is null or cv_years_experience between 0 and 60);
alter table public.talent_imported_prospects
  drop constraint if exists talent_imported_prospects_cv_skills_check;
alter table public.talent_imported_prospects
  add constraint talent_imported_prospects_cv_skills_check
    check (jsonb_typeof(cv_skills) = 'array');

create or replace function public.import_talent_cv_profiles(
  p_rows jsonb,
  p_source_file text,
  p_consent_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_row jsonb;
  v_email text;
  v_enriched integer := 0;
  v_consented integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.users platform_user
    where platform_user.auth_user_id = auth.uid()
      and platform_user.company_id is null
      and platform_user.role = 'Platform Owner'
      and platform_user.is_active is true
      and lower(coalesce(platform_user.status, '')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Platform Owner access is required.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or nullif(btrim(p_source_file), '') is null
      or nullif(btrim(p_consent_basis), '') is null then
    raise exception using errcode = '22023', message = 'Rows, source file and documented consent basis are required.';
  end if;

  v_result := public.import_talent_prospects(p_rows, p_source_file);
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_email := lower(btrim(coalesce(v_row->>'email', '')));
    if v_email = '' or position('@' in v_email) <= 1
        or nullif(btrim(v_row->>'cv_specialty'), '') is null
        or nullif(btrim(v_row->>'cv_professional_summary'), '') is null then
      continue;
    end if;
    update public.talent_imported_prospects prospect
    set cv_source_filename = nullif(btrim(v_row->>'cv_filename'), ''),
        cv_specialty = btrim(v_row->>'cv_specialty'),
        cv_professional_summary = btrim(v_row->>'cv_professional_summary'),
        cv_years_experience = case
          when coalesce(v_row->>'cv_years_experience', '') ~ '^\d{1,2}$'
            then (v_row->>'cv_years_experience')::smallint else null end,
        cv_skills = case when jsonb_typeof(v_row->'cv_skills') = 'array'
          then v_row->'cv_skills' else '[]'::jsonb end,
        cv_analyzed_at = now(),
        marketplace_profile_consent = true,
        marketplace_profile_consent_basis = btrim(p_consent_basis),
        marketplace_profile_consent_recorded_at = coalesce(prospect.marketplace_profile_consent_recorded_at, now()),
        updated_at = now()
    where prospect.email_normalized = v_email;
    if found then v_enriched := v_enriched + 1; end if;
  end loop;
  select count(*) into v_consented
  from public.talent_imported_prospects prospect
  where prospect.source_file = btrim(p_source_file)
    and prospect.marketplace_profile_consent is true
    and nullif(btrim(prospect.cv_specialty), '') is not null;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'cv_profiles_enriched', v_enriched,
    'marketplace_cards_enabled', v_consented
  );
end;
$$;

create or replace function public.list_company_talent_marketplace_page(
  p_query text default '', p_limit integer default 24, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_entitlement_limit integer;
  v_page_limit integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_page_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := lower(nullif(btrim(coalesce(p_query, '')), ''));
  v_total bigint := 0;
  v_profiles jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception using errcode = '42501', message = 'Company authentication is required.';
  end if;
  select case when client.talent_access_enabled is true
      and lower(coalesce(client.subscription_status, '')) in ('active', 'trial')
    then greatest(0, client.talent_profile_limit) else 0 end
  into v_entitlement_limit
  from public.platform_clients client
  where client.operational_company_id = v_company_id
  order by client.created_at desc limit 1;
  if coalesce(v_entitlement_limit, 0) <= 0 then
    return jsonb_build_object('total', 0, 'profiles', '[]'::jsonb);
  end if;

  with available_profiles as materialized (
    select candidate.published_at sort_at, candidate.id sort_id,
      lower(concat_ws(' ', candidate.full_name, candidate.public_reference, candidate.headline,
        candidate.profession, candidate.nationality, candidate.city, candidate.country_of_residence,
        candidate.current_job_title, candidate.current_company, skills.searchable)) searchable,
      jsonb_build_object(
        'candidate_id', candidate.id, 'profile_source', 'Candidate Profile', 'is_imported', false,
        'public_reference', candidate.public_reference, 'headline', candidate.headline,
        'profession', candidate.profession, 'current_title', candidate.current_job_title,
        'current_company', candidate.current_company, 'education_degree', null,
        'education_institution', null, 'source_job_title', null, 'date_applied', null,
        'nationality', candidate.nationality, 'country_of_residence', candidate.country_of_residence,
        'city', candidate.city, 'years_experience', candidate.years_experience,
        'languages', candidate.languages, 'availability_status', candidate.availability_status,
        'expected_salary', candidate.expected_salary, 'expected_salary_currency', candidate.expected_salary_currency,
        'ai_cv_status', candidate.ai_cv_status, 'profile_completeness', candidate.profile_completeness,
        'published_at', candidate.published_at, 'professional_summary', candidate.professional_summary,
        'preferred_locations', candidate.preferred_locations,
        'preferred_employment_types', candidate.preferred_employment_types,
        'skills', coalesce(skills.items, '[]'::jsonb),
        'identity_shared', candidate.employer_contact_sharing_consent,
        'full_name', case when candidate.employer_contact_sharing_consent then candidate.full_name else null end,
        'email', case when candidate.employer_contact_sharing_consent then candidate.email else null end,
        'phone', case when candidate.employer_contact_sharing_consent then candidate.phone else null end,
        'contact_request_status', null, 'contact_request_email_status', null,
        'latest_interview_status', latest.status, 'latest_interview_type', latest.interview_type,
        'latest_interview_at', latest.scheduled_at, 'cv_available', coalesce(cv.available, false)
      ) profile
    from public.talent_candidates candidate
    left join lateral (
      select jsonb_agg(jsonb_build_object('name', skill.skill_name, 'level', skill.proficiency_level)
        order by skill.confidence desc) items, string_agg(skill.skill_name, ' ') searchable
      from public.talent_candidate_skills skill where skill.candidate_id = candidate.id
    ) skills on true
    left join lateral (
      select invitation.status, invitation.interview_type, invitation.scheduled_at
      from public.talent_interview_invitations invitation
      where invitation.company_id = v_company_id and invitation.candidate_id = candidate.id
      order by invitation.created_at desc limit 1
    ) latest on true
    left join lateral (
      select true available from public.talent_public_campaign_applications application
      join public.talent_candidate_documents document on document.id = application.cv_document_id
      where application.candidate_id = candidate.id and application.cv_sharing_consent is true
      order by application.created_at desc limit 1
    ) cv on true
    where candidate.marketplace_status = 'Approved' and candidate.is_verified is true
      and candidate.published_at is not null and candidate.employer_sharing_consent is true
      and candidate.profile_visibility in ('Anonymized', 'Public')

    union all

    select coalesce(prospect.marketplace_profile_consent_recorded_at, prospect.created_at), prospect.id,
      lower(concat_ws(' ', prospect.cv_specialty, prospect.cv_professional_summary,
        prospect.general_location, prospect.education_degree, prospect.education_institution,
        prospect.cv_skills::text)),
      jsonb_build_object(
        'candidate_id', prospect.id, 'profile_source', 'CV Import', 'is_imported', true,
        'public_reference', 'VF-IMP-' || upper(substr(replace(prospect.id::text, '-', ''), 1, 10)),
        'headline', coalesce(prospect.cv_specialty, prospect.current_title, 'Professional candidate'),
        'profession', coalesce(prospect.cv_specialty, prospect.current_title),
        'current_title', coalesce(prospect.cv_specialty, prospect.current_title), 'current_company', null,
        'education_degree', prospect.education_degree, 'education_institution', prospect.education_institution,
        'source_job_title', null, 'date_applied', null,
        'nationality', null, 'country_of_residence', prospect.general_location,
        'city', prospect.general_location, 'years_experience', prospect.cv_years_experience,
        'languages', '[]'::jsonb, 'availability_status', 'Available',
        'expected_salary', null, 'expected_salary_currency', null,
        'ai_cv_status', case when prospect.cv_source_filename is null then 'Not Uploaded' else 'CV Reviewed' end,
        'profile_completeness', case when prospect.cv_specialty is null then 70 else 85 end,
        'published_at', coalesce(prospect.marketplace_profile_consent_recorded_at, prospect.created_at),
        'professional_summary', coalesce(prospect.cv_professional_summary, prospect.current_title),
        'preferred_locations', case when prospect.general_location is null then '[]'::jsonb else jsonb_build_array(prospect.general_location) end,
        'preferred_employment_types', '[]'::jsonb,
        'skills', coalesce(cv_skills.items, '[]'::jsonb),
        'identity_shared', coalesce(contact_request.status = 'Approved', false),
        'full_name', case when contact_request.status = 'Approved' then prospect.full_name else null end,
        'email', case when contact_request.status = 'Approved' then prospect.email else null end,
        'phone', case when contact_request.status = 'Approved' then prospect.phone else null end,
        'contact_request_status', contact_request.status,
        'contact_request_email_status', contact_request.email_delivery_status,
        'latest_interview_status', null, 'latest_interview_type', null,
        'latest_interview_at', null, 'cv_available', prospect.cv_source_filename is not null
      )
    from public.talent_imported_prospects prospect
    left join public.talent_company_contact_requests contact_request
      on contact_request.company_id = v_company_id and contact_request.prospect_id = prospect.id
    left join lateral (
      select jsonb_agg(jsonb_build_object('name', skill.value, 'level', null) order by skill.ordinality) items
      from jsonb_array_elements_text(prospect.cv_skills) with ordinality as skill(value, ordinality)
    ) cv_skills on true
    where prospect.marketplace_profile_consent is true and prospect.claimed_candidate_id is null
  ), entitled as materialized (
    select * from available_profiles order by sort_at desc, sort_id
    limit case when v_entitlement_limit >= 100000 then null else v_entitlement_limit end
  ), filtered as materialized (
    select * from entitled where v_query is null or searchable like '%' || v_query || '%'
  ), page as materialized (
    select * from filtered order by sort_at desc, sort_id limit v_page_limit offset v_page_offset
  )
  select (select count(*) from filtered),
    coalesce(jsonb_agg(page.profile order by page.sort_at desc, page.sort_id), '[]'::jsonb)
  into v_total, v_profiles from page;
  return jsonb_build_object('total', coalesce(v_total, 0), 'profiles', coalesce(v_profiles, '[]'::jsonb));
end;
$$;

revoke all on function public.import_talent_cv_profiles(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.import_talent_cv_profiles(jsonb, text, text) to authenticated;
revoke all on function public.list_company_talent_marketplace_page(text, integer, integer) from public, anon;
grant execute on function public.list_company_talent_marketplace_page(text, integer, integer) to authenticated;
