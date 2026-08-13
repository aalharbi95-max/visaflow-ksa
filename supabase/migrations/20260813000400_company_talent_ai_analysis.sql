create or replace function public.get_company_talent_ai_analysis(p_candidate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_result jsonb;
begin
  if auth.uid() is null or v_company_id is null or not exists (
    select 1
    from public.platform_clients client
    where client.operational_company_id = v_company_id
      and client.talent_access_enabled is true
      and lower(coalesce(client.subscription_status, '')) in ('active', 'trial')
  ) then
    raise exception using errcode = '42501', message = 'Active Talent access is required.';
  end if;

  select jsonb_build_object(
    'candidate_id', candidate.id,
    'status', candidate.ai_cv_status,
    'overall_score', candidate.ai_cv_summary -> 'overall_score',
    'ats_score', candidate.ai_cv_summary -> 'ats_score',
    'clarity_score', candidate.ai_cv_summary -> 'clarity_score',
    'impact_score', candidate.ai_cv_summary -> 'impact_score',
    'executive_summary', candidate.ai_cv_summary -> 'executive_summary',
    'strengths', coalesce(candidate.ai_cv_summary -> 'strengths', '[]'::jsonb),
    'development_areas', coalesce(candidate.ai_cv_summary -> 'development_areas', '[]'::jsonb),
    'recommended_roles', coalesce(candidate.ai_cv_summary -> 'recommended_roles', '[]'::jsonb),
    'analyzed_at', candidate.updated_at
  )
  into v_result
  from public.talent_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.marketplace_status = 'Approved'
    and candidate.is_verified is true
    and candidate.published_at is not null
    and candidate.employer_sharing_consent is true
    and candidate.ai_cv_status = 'Completed'
    and candidate.ai_cv_summary is not null
    and exists (
      select 1
      from public.talent_candidate_consents consent
      where consent.candidate_id = candidate.id
        and consent.consent_type = 'AI CV Analysis'
        and consent.is_granted is true
    )
    and exists (
      select 1
      from public.talent_candidate_consents consent
      where consent.candidate_id = candidate.id
        and consent.consent_type = 'Employer Sharing'
        and consent.is_granted is true
    );

  if v_result is null then
    raise exception using errcode = '42501', message = 'A shared AI CV analysis is not available for this candidate.';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_company_talent_ai_analysis(uuid) from public, anon;
grant execute on function public.get_company_talent_ai_analysis(uuid) to authenticated, service_role;
