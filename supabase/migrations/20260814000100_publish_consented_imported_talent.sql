-- Publish the specifically consented LinkedIn applicant import to authenticated
-- companies with an active VisaFlow Talent entitlement. Future imports remain
-- private until their sharing basis is recorded explicitly.

alter table public.talent_imported_prospects
  add column if not exists employer_contact_sharing_consent boolean not null default false,
  add column if not exists employer_contact_sharing_basis text,
  add column if not exists employer_contact_sharing_recorded_at timestamptz;

alter table public.talent_imported_prospects
  drop constraint if exists talent_imported_prospects_contact_sharing_check;

alter table public.talent_imported_prospects
  add constraint talent_imported_prospects_contact_sharing_check check (
    employer_contact_sharing_consent is false
    or (
      nullif(btrim(employer_contact_sharing_basis), '') is not null
      and employer_contact_sharing_recorded_at is not null
    )
  );

update public.talent_imported_prospects
set
  employer_contact_sharing_consent = true,
  employer_contact_sharing_basis = 'Documented applicant consent confirmed by Platform Owner for the linked Job Applicant Report on 2026-08-14',
  employer_contact_sharing_recorded_at = coalesce(employer_contact_sharing_recorded_at, now()),
  updated_at = now()
where source_file ilike 'Job_Applicant_Report_2026-02-08_2026-02-07%';

create index if not exists talent_imported_prospects_company_marketplace_idx
  on public.talent_imported_prospects (employer_contact_sharing_recorded_at desc, id)
  where employer_contact_sharing_consent is true and status <> 'Archived';

create or replace function public.list_company_talent_marketplace_page(
  p_query text default '',
  p_limit integer default 24,
  p_offset integer default 0
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

  select case
      when client.talent_access_enabled is true
       and lower(coalesce(client.subscription_status, '')) in ('active', 'trial')
      then greatest(0, client.talent_profile_limit)
      else 0
    end
  into v_entitlement_limit
  from public.platform_clients client
  where client.operational_company_id = v_company_id
  order by client.created_at desc
  limit 1;

  if coalesce(v_entitlement_limit, 0) <= 0 then
    return jsonb_build_object('total', 0, 'profiles', '[]'::jsonb);
  end if;

  with available_profiles as materialized (
    select
      candidate.published_at as sort_at,
      candidate.id as sort_id,
      lower(concat_ws(' ', candidate.full_name, candidate.public_reference, candidate.headline,
        candidate.profession, candidate.nationality, candidate.city, candidate.country_of_residence,
        candidate.current_job_title, candidate.current_company, skills.searchable)) as searchable,
      jsonb_build_object(
        'candidate_id', candidate.id,
        'profile_source', 'Candidate Profile',
        'is_imported', false,
        'public_reference', candidate.public_reference,
        'headline', candidate.headline,
        'profession', candidate.profession,
        'current_title', candidate.current_job_title,
        'current_company', candidate.current_company,
        'education_degree', null,
        'education_institution', null,
        'source_job_title', null,
        'date_applied', null,
        'nationality', candidate.nationality,
        'country_of_residence', candidate.country_of_residence,
        'city', candidate.city,
        'years_experience', candidate.years_experience,
        'languages', candidate.languages,
        'availability_status', candidate.availability_status,
        'expected_salary', candidate.expected_salary,
        'expected_salary_currency', candidate.expected_salary_currency,
        'ai_cv_status', candidate.ai_cv_status,
        'profile_completeness', candidate.profile_completeness,
        'published_at', candidate.published_at,
        'professional_summary', candidate.professional_summary,
        'preferred_locations', candidate.preferred_locations,
        'preferred_employment_types', candidate.preferred_employment_types,
        'skills', coalesce(skills.items, '[]'::jsonb),
        'identity_shared', candidate.employer_contact_sharing_consent,
        'full_name', case when candidate.employer_contact_sharing_consent then candidate.full_name else null end,
        'email', case when candidate.employer_contact_sharing_consent then candidate.email else null end,
        'phone', case when candidate.employer_contact_sharing_consent then candidate.phone else null end,
        'latest_interview_status', latest.status,
        'latest_interview_type', latest.interview_type,
        'latest_interview_at', latest.scheduled_at,
        'cv_available', coalesce(cv.available, false)
      ) as profile
    from public.talent_candidates candidate
    left join lateral (
      select
        jsonb_agg(jsonb_build_object('name', skill.skill_name, 'level', skill.proficiency_level)
          order by skill.confidence desc) as items,
        string_agg(skill.skill_name, ' ') as searchable
      from public.talent_candidate_skills skill
      where skill.candidate_id = candidate.id
    ) skills on true
    left join lateral (
      select invitation.status, invitation.interview_type, invitation.scheduled_at
      from public.talent_interview_invitations invitation
      where invitation.company_id = v_company_id and invitation.candidate_id = candidate.id
      order by invitation.created_at desc limit 1
    ) latest on true
    left join lateral (
      select true as available
      from public.talent_public_campaign_applications application
      join public.talent_candidate_documents document on document.id = application.cv_document_id
      where application.candidate_id = candidate.id and application.cv_sharing_consent is true
      order by application.created_at desc limit 1
    ) cv on true
    where candidate.marketplace_status = 'Approved'
      and candidate.is_verified is true
      and candidate.published_at is not null
      and candidate.employer_sharing_consent is true
      and candidate.profile_visibility in ('Anonymized', 'Public')

    union all

    select
      coalesce(prospect.employer_contact_sharing_recorded_at, prospect.created_at) as sort_at,
      prospect.id as sort_id,
      lower(concat_ws(' ', prospect.full_name, prospect.headline, prospect.current_title,
        prospect.current_company, prospect.general_location, prospect.education_degree,
        prospect.education_institution, prospect.source_job_title, prospect.screening_responses)) as searchable,
      jsonb_build_object(
        'candidate_id', prospect.id,
        'profile_source', 'Imported Excel',
        'is_imported', true,
        'public_reference', 'VF-IMP-' || upper(substr(replace(prospect.id::text, '-', ''), 1, 10)),
        'headline', coalesce(prospect.headline, concat_ws(' · ', prospect.current_title, prospect.current_company)),
        'profession', coalesce(prospect.current_title, prospect.source_job_title),
        'current_title', prospect.current_title,
        'current_company', prospect.current_company,
        'education_degree', prospect.education_degree,
        'education_institution', prospect.education_institution,
        'source_job_title', prospect.source_job_title,
        'date_applied', prospect.applied_at,
        'nationality', null,
        'country_of_residence', prospect.general_location,
        'city', prospect.general_location,
        'years_experience', null,
        'languages', '[]'::jsonb,
        'availability_status', 'Applicant',
        'expected_salary', null,
        'expected_salary_currency', null,
        'ai_cv_status', 'Not Uploaded',
        'profile_completeness', 70,
        'published_at', coalesce(prospect.employer_contact_sharing_recorded_at, prospect.created_at),
        'professional_summary', concat_ws(' | ',
          nullif(prospect.headline, ''),
          nullif(concat_ws(' at ', prospect.current_title, prospect.current_company), ''),
          nullif(concat_ws(' - ', prospect.education_degree, prospect.education_institution), ''),
          case when prospect.source_job_title is not null then 'Applied for: ' || prospect.source_job_title else null end
        ),
        'preferred_locations', case when prospect.general_location is null then '[]'::jsonb else jsonb_build_array(prospect.general_location) end,
        'preferred_employment_types', '[]'::jsonb,
        'skills', '[]'::jsonb,
        'identity_shared', true,
        'full_name', prospect.full_name,
        'email', prospect.email,
        'phone', prospect.phone,
        'latest_interview_status', null,
        'latest_interview_type', null,
        'latest_interview_at', null,
        'cv_available', false
      ) as profile
    from public.talent_imported_prospects prospect
    where prospect.employer_contact_sharing_consent is true
      and prospect.status <> 'Archived'
  ), entitled as materialized (
    select *
    from available_profiles
    order by sort_at desc, sort_id
    limit case when v_entitlement_limit >= 100000 then null else v_entitlement_limit end
  ), filtered as materialized (
    select *
    from entitled
    where v_query is null or searchable like '%' || v_query || '%'
  ), page as materialized (
    select *
    from filtered
    order by sort_at desc, sort_id
    limit v_page_limit offset v_page_offset
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(page.profile order by page.sort_at desc, page.sort_id), '[]'::jsonb)
  into v_total, v_profiles
  from page;

  return jsonb_build_object('total', coalesce(v_total, 0), 'profiles', coalesce(v_profiles, '[]'::jsonb));
end;
$$;

revoke all on function public.list_company_talent_marketplace_page(text, integer, integer) from public, anon;
grant execute on function public.list_company_talent_marketplace_page(text, integer, integer) to authenticated;
