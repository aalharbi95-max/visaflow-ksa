-- Scalable company talent marketplace: server-side search and pagination.
-- The response is capped to a small page even when the marketplace contains 100k+ candidates.

create index if not exists talent_candidates_marketplace_published_idx
  on public.talent_candidates (published_at desc, id)
  where marketplace_status = 'Approved'
    and is_verified is true
    and published_at is not null
    and employer_sharing_consent is true;

create index if not exists talent_candidate_skills_candidate_name_idx
  on public.talent_candidate_skills (candidate_id, lower(skill_name));

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

  with eligible as materialized (
    select candidate.*
    from public.talent_candidates candidate
    where candidate.marketplace_status = 'Approved'
      and candidate.is_verified is true
      and candidate.published_at is not null
      and candidate.employer_sharing_consent is true
      and candidate.profile_visibility in ('Anonymized', 'Public')
    order by candidate.published_at desc, candidate.id
    limit case when v_entitlement_limit >= 100000 then null else v_entitlement_limit end
  ), filtered as materialized (
    select candidate.*
    from eligible candidate
    where v_query is null
       or lower(coalesce(candidate.full_name, '') || ' ' || coalesce(candidate.public_reference, '') || ' ' ||
         coalesce(candidate.headline, '') || ' ' || coalesce(candidate.profession, '') || ' ' ||
         coalesce(candidate.nationality, '') || ' ' || coalesce(candidate.city, '') || ' ' ||
         coalesce(candidate.country_of_residence, '')) like '%' || v_query || '%'
       or exists (
         select 1 from public.talent_candidate_skills skill
         where skill.candidate_id = candidate.id and lower(skill.skill_name) like '%' || v_query || '%'
       )
  ), page as materialized (
    select candidate.* from filtered candidate
    order by candidate.published_at desc, candidate.id
    limit v_page_limit offset v_page_offset
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(jsonb_build_object(
      'candidate_id', candidate.id,
      'public_reference', candidate.public_reference,
      'headline', candidate.headline,
      'profession', candidate.profession,
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
    ) order by candidate.published_at desc, candidate.id), '[]'::jsonb)
  into v_total, v_profiles
  from page candidate
  left join lateral (
    select jsonb_agg(jsonb_build_object('name', skill.skill_name, 'level', skill.proficiency_level) order by skill.confidence desc) items
    from public.talent_candidate_skills skill where skill.candidate_id = candidate.id
  ) skills on true
  left join lateral (
    select invitation.status, invitation.interview_type, invitation.scheduled_at
    from public.talent_interview_invitations invitation
    where invitation.company_id = v_company_id and invitation.candidate_id = candidate.id
    order by invitation.created_at desc limit 1
  ) latest on true
  left join lateral (
    select true available
    from public.talent_public_campaign_applications application
    join public.talent_candidate_documents document on document.id = application.cv_document_id
    where application.candidate_id = candidate.id and application.cv_sharing_consent is true
    order by application.created_at desc limit 1
  ) cv on true;

  return jsonb_build_object('total', coalesce(v_total, 0), 'profiles', coalesce(v_profiles, '[]'::jsonb));
end;
$$;

revoke all on function public.list_company_talent_marketplace_page(text, integer, integer) from public, anon;
grant execute on function public.list_company_talent_marketplace_page(text, integer, integer) to authenticated;

