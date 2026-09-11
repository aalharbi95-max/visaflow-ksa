-- Treat the existing maximum entitlement value as an Unlimited package.
-- This avoids a schema-breaking change while allowing the marketplace query
-- to return every approved profile instead of applying a numeric LIMIT.

create or replace function public.get_current_company_talent_entitlement()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce(client.talent_access_enabled, false)
      and lower(coalesce(client.subscription_status, '')) in ('active', 'trial'),
    'tier', coalesce(client.talent_access_tier, 'None'),
    'profile_limit', coalesce(client.talent_profile_limit, 0),
    'unlimited', coalesce(client.talent_profile_limit, 0) >= 100000
  )
  from public.platform_clients as client
  where client.operational_company_id = public.current_app_user_company_id()
  order by client.created_at desc
  limit 1;
$$;

create or replace function public.list_company_talent_marketplace()
returns table (
  candidate_id uuid,
  public_reference text,
  headline text,
  profession text,
  nationality text,
  country_of_residence text,
  city text,
  years_experience numeric,
  languages jsonb,
  availability_status text,
  expected_salary numeric,
  expected_salary_currency text,
  ai_cv_status text,
  profile_completeness integer,
  published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_limit integer;
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
  into v_limit
  from public.platform_clients as client
  where client.operational_company_id = v_company_id
  order by client.created_at desc
  limit 1;

  if coalesce(v_limit, 0) <= 0 then
    return;
  end if;

  return query
  select
    candidate.id,
    candidate.public_reference,
    candidate.headline,
    candidate.profession,
    candidate.nationality,
    candidate.country_of_residence,
    candidate.city,
    candidate.years_experience,
    candidate.languages,
    candidate.availability_status,
    candidate.expected_salary,
    candidate.expected_salary_currency,
    candidate.ai_cv_status,
    candidate.profile_completeness,
    candidate.published_at
  from public.talent_candidates as candidate
  where candidate.marketplace_status = 'Approved'
    and candidate.is_verified is true
    and candidate.published_at is not null
    and candidate.employer_sharing_consent is true
    and candidate.profile_visibility in ('Anonymized', 'Public')
  order by candidate.published_at desc
  limit case when v_limit >= 100000 then null else v_limit end;
end;
$$;

revoke all on function public.get_current_company_talent_entitlement() from public, anon;
grant execute on function public.get_current_company_talent_entitlement() to authenticated;
revoke all on function public.list_company_talent_marketplace() from public, anon;
grant execute on function public.list_company_talent_marketplace() to authenticated;

