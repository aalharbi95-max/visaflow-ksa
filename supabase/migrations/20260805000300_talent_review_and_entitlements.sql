-- Complete the Talent review/publish lifecycle and make employer access an
-- explicit owner-controlled subscription entitlement.

alter table public.platform_clients
  add column if not exists talent_access_enabled boolean not null default false,
  add column if not exists talent_profile_limit integer not null default 0,
  add column if not exists talent_access_tier text not null default 'None';

alter table public.platform_clients
  drop constraint if exists platform_clients_talent_profile_limit_check;
alter table public.platform_clients
  add constraint platform_clients_talent_profile_limit_check
  check (talent_profile_limit >= 0 and talent_profile_limit <= 100000);

create or replace function public.review_talent_candidate(
  p_candidate_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := lower(trim(coalesce(p_action, '')));
  v_candidate public.talent_candidates%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.users as platform_user
    where platform_user.auth_user_id = auth.uid()
      and lower(coalesce(platform_user.status, 'active')) = 'active'
      and platform_user.is_active is true
      and platform_user.company_id is null
      and platform_user.role = 'Platform Owner'
  ) then
    raise exception using errcode = '42501', message = 'Only an active Platform Owner can review talent profiles.';
  end if;

  select * into v_candidate
  from public.talent_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Talent candidate was not found.';
  end if;

  if v_action = 'approve' then
    if v_candidate.marketplace_status not in ('Submitted', 'Under Review', 'Approved') then
      raise exception 'Only submitted or under-review profiles can be approved.';
    end if;
    if not coalesce(v_candidate.employer_sharing_consent, false) then
      raise exception 'Employer sharing consent is required before approval.';
    end if;

    perform set_config('visaflow.talent_internal_update', '1', true);
    update public.talent_candidates
    set marketplace_status = 'Approved',
        is_verified = true,
        verified_at = coalesce(verified_at, now()),
        published_at = null,
        updated_at = now()
    where id = p_candidate_id;

  elsif v_action = 'publish' then
    if v_candidate.marketplace_status <> 'Approved' then
      raise exception 'Approve the talent profile before publishing it.';
    end if;
    if not coalesce(v_candidate.employer_sharing_consent, false)
       or v_candidate.profile_visibility not in ('Anonymized', 'Public') then
      raise exception 'Publishing requires employer sharing consent and Anonymized or Public visibility.';
    end if;

    perform set_config('visaflow.talent_internal_update', '1', true);
    update public.talent_candidates
    set is_verified = true,
        verified_at = coalesce(verified_at, now()),
        published_at = now(),
        updated_at = now()
    where id = p_candidate_id;

  elsif v_action = 'reject' then
    perform set_config('visaflow.talent_internal_update', '1', true);
    update public.talent_candidates
    set marketplace_status = 'Rejected',
        is_verified = false,
        verified_at = null,
        published_at = null,
        updated_at = now()
    where id = p_candidate_id;

  elsif v_action = 'suspend' then
    perform set_config('visaflow.talent_internal_update', '1', true);
    update public.talent_candidates
    set marketplace_status = 'Suspended',
        published_at = null,
        updated_at = now()
    where id = p_candidate_id;
  else
    raise exception 'Unsupported talent review action.';
  end if;

  return jsonb_build_object('candidate_id', p_candidate_id, 'action', initcap(v_action), 'ok', true);
end;
$$;

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
    'profile_limit', coalesce(client.talent_profile_limit, 0)
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
  limit v_limit;
end;
$$;

create or replace function public.get_talent_public_stats()
returns table(registered_candidates bigint, marketplace_ready bigint, completed_ai_interviews bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (
      where marketplace_status = 'Approved'
        and is_verified is true
        and published_at is not null
        and employer_sharing_consent = true
        and profile_visibility in ('Anonymized', 'Public')
    )::bigint,
    count(*) filter (where ai_interview_status = 'Completed')::bigint
  from public.talent_candidates;
$$;

-- Add stable identifiers and publication state to the owner review queue.
create or replace function public.get_owner_talent_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_latest_profiles jsonb;
  v_country_distribution jsonb;
  v_profession_distribution jsonb;
  v_status_distribution jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.users as platform_user
    where platform_user.auth_user_id = auth.uid()
      and lower(coalesce(platform_user.status, '')) = 'active'
      and platform_user.is_active is true
      and platform_user.company_id is null
      and platform_user.role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
  ) then
    raise exception using errcode = '42501', message = 'access denied';
  end if;

  select coalesce(jsonb_agg(to_jsonb(latest_profile) order by latest_profile.created_at desc), '[]'::jsonb)
  into v_latest_profiles
  from (
    select candidate.id, candidate.public_reference, candidate.full_name,
      candidate.email, candidate.country_of_residence, candidate.profession,
      candidate.marketplace_status, candidate.is_verified, candidate.published_at,
      candidate.employer_sharing_consent, candidate.profile_visibility,
      candidate.profile_completeness, candidate.created_at
    from public.talent_candidates as candidate
    order by
      case candidate.marketplace_status when 'Submitted' then 0 when 'Under Review' then 1 else 2 end,
      candidate.created_at desc
    limit 50
  ) as latest_profile;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_country_distribution
  from (
    select coalesce(nullif(trim(candidate.country_of_residence), ''), 'Not specified') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.country_of_residence), ''), 'Not specified')
    order by total desc limit 10
  ) as grouped;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_profession_distribution
  from (
    select coalesce(nullif(trim(candidate.profession), ''), 'Not specified') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.profession), ''), 'Not specified')
    order by total desc limit 10
  ) as grouped;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_status_distribution
  from (
    select coalesce(nullif(trim(candidate.marketplace_status), ''), 'Draft') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.marketplace_status), ''), 'Draft')
    order by total desc limit 10
  ) as grouped;

  select jsonb_build_object(
    'profile_records', count(*),
    'email_confirmed', count(*) filter (where auth_user.email_confirmed_at is not null),
    'email_confirmed_available', true,
    'cv_uploaded', count(*) filter (where exists (
      select 1 from public.talent_candidate_documents as document
      where document.candidate_id = candidate.id and document.document_type = 'CV' and document.is_primary is true
    )),
    'profile_completed', count(*) filter (where candidate.submitted_at is not null),
    'ai_analyzed', count(*) filter (where candidate.ai_cv_status = 'Completed'),
    'approved', count(*) filter (where candidate.marketplace_status = 'Approved' and candidate.employer_sharing_consent is true),
    'latest_profiles', v_latest_profiles,
    'distributions', jsonb_build_object(
      'country_of_residence', v_country_distribution,
      'profession', v_profession_distribution,
      'marketplace_status', v_status_distribution
    )
  ) into v_result
  from public.talent_candidates as candidate
  left join auth.users as auth_user on auth_user.id = candidate.auth_user_id;

  return v_result;
end;
$$;

revoke all on function public.review_talent_candidate(uuid, text) from public, anon;
grant execute on function public.review_talent_candidate(uuid, text) to authenticated;
revoke all on function public.get_current_company_talent_entitlement() from public, anon;
grant execute on function public.get_current_company_talent_entitlement() to authenticated;
revoke all on function public.list_company_talent_marketplace() from public, anon;
grant execute on function public.list_company_talent_marketplace() to authenticated;
revoke all on function public.get_talent_public_stats() from public;
grant execute on function public.get_talent_public_stats() to anon, authenticated, service_role;
revoke all on function public.get_owner_talent_dashboard() from public, anon;
grant execute on function public.get_owner_talent_dashboard() to authenticated;
