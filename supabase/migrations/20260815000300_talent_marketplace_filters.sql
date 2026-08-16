-- Server-side Talent Marketplace filters and stable facets for company users.

create or replace function public.list_company_talent_marketplace_filtered_page(
  p_query text,
  p_limit integer,
  p_offset integer,
  p_profession text,
  p_location text,
  p_min_experience integer,
  p_max_experience integer,
  p_availability text,
  p_profile_source text,
  p_contact_access text,
  p_sort text
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
  v_profession text := lower(nullif(btrim(coalesce(p_profession, '')), ''));
  v_location text := lower(nullif(btrim(coalesce(p_location, '')), ''));
  v_availability text := lower(nullif(btrim(coalesce(p_availability, '')), ''));
  v_profile_source text := lower(nullif(btrim(coalesce(p_profile_source, '')), ''));
  v_contact_access text := lower(nullif(btrim(coalesce(p_contact_access, '')), ''));
  v_min_experience integer := case when p_min_experience is null then null else least(60, greatest(0, p_min_experience)) end;
  v_max_experience integer := case when p_max_experience is null then null else least(60, greatest(0, p_max_experience)) end;
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'Newest');
  v_total bigint := 0;
  v_profiles jsonb := '[]'::jsonb;
  v_facets jsonb := '{}'::jsonb;
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
    return jsonb_build_object('total', 0, 'profiles', '[]'::jsonb,
      'facets', jsonb_build_object('professions', '[]'::jsonb, 'locations', '[]'::jsonb, 'availability', '[]'::jsonb));
  end if;

  with available_profiles as materialized (
    select
      candidate.published_at sort_at,
      candidate.id sort_id,
      nullif(btrim(candidate.profession), '') profession_filter,
      nullif(btrim(coalesce(candidate.city, candidate.country_of_residence)), '') location_filter,
      candidate.years_experience::integer years_experience_filter,
      nullif(btrim(candidate.availability_status), '') availability_filter,
      'Registered'::text profile_source_filter,
      case when candidate.employer_contact_sharing_consent then 'Shared' else 'Private' end contact_access_filter,
      coalesce(candidate.profile_completeness, 0)::integer completeness_filter,
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

    select
      coalesce(prospect.marketplace_profile_consent_recorded_at, prospect.created_at),
      prospect.id,
      nullif(btrim(coalesce(prospect.cv_specialty, prospect.current_title)), ''),
      nullif(btrim(prospect.general_location), ''),
      prospect.cv_years_experience::integer,
      'Available'::text,
      'Imported'::text,
      case
        when contact_request.status = 'Approved' then 'Shared'
        when contact_request.status = 'Pending' then 'Pending'
        when contact_request.status = 'Declined' then 'Declined'
        else 'Private'
      end,
      case when prospect.cv_specialty is null then 70 else 85 end,
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
    select * from entitled
    where (v_query is null or searchable like '%' || v_query || '%')
      and (v_profession is null or lower(profession_filter) = v_profession)
      and (v_location is null or lower(location_filter) = v_location)
      and (v_min_experience is null or years_experience_filter >= v_min_experience)
      and (v_max_experience is null or years_experience_filter <= v_max_experience)
      and (v_availability is null or lower(availability_filter) = v_availability)
      and (v_profile_source is null or lower(profile_source_filter) = v_profile_source)
      and (v_contact_access is null or lower(contact_access_filter) = v_contact_access)
  ), page as materialized (
    select *, row_number() over (order by
      case when v_sort = 'Experience: high to low' then years_experience_filter end desc nulls last,
      case when v_sort = 'Profile completeness' then completeness_filter end desc nulls last,
      sort_at desc, sort_id
    ) page_order
    from filtered
    order by
      case when v_sort = 'Experience: high to low' then years_experience_filter end desc nulls last,
      case when v_sort = 'Profile completeness' then completeness_filter end desc nulls last,
      sort_at desc, sort_id
    limit v_page_limit offset v_page_offset
  ), facets as (
    select jsonb_build_object(
      'professions', coalesce((select jsonb_agg(value order by value) from (select distinct profession_filter value from entitled where profession_filter is not null limit 200) valueset), '[]'::jsonb),
      'locations', coalesce((select jsonb_agg(value order by value) from (select distinct location_filter value from entitled where location_filter is not null limit 200) valueset), '[]'::jsonb),
      'availability', coalesce((select jsonb_agg(value order by value) from (select distinct availability_filter value from entitled where availability_filter is not null limit 50) valueset), '[]'::jsonb)
    ) value
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(page.profile order by page.page_order), '[]'::jsonb),
    (select value from facets)
  into v_total, v_profiles, v_facets
  from page;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'profiles', coalesce(v_profiles, '[]'::jsonb),
    'facets', coalesce(v_facets, jsonb_build_object('professions', '[]'::jsonb, 'locations', '[]'::jsonb, 'availability', '[]'::jsonb))
  );
end;
$$;

revoke all on function public.list_company_talent_marketplace_filtered_page(
  text, integer, integer, text, text, integer, integer, text, text, text, text
) from public, anon;
grant execute on function public.list_company_talent_marketplace_filtered_page(
  text, integer, integer, text, text, integer, integer, text, text, text, text
) to authenticated;
