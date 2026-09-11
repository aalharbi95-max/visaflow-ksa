create or replace function public.get_owner_talent_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_records bigint;
  v_email_confirmed bigint;
  v_cv_uploaded bigint;
  v_profile_completed bigint;
  v_ai_analyzed bigint;
  v_approved bigint;
  v_latest_profiles jsonb;
  v_country_distribution jsonb;
  v_profession_distribution jsonb;
  v_status_distribution jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.users as platform_user
    where platform_user.auth_user_id = auth.uid()
      and lower(coalesce(platform_user.status, '')) = 'active'
      and platform_user.is_active is true
      and platform_user.company_id is null
      and platform_user.role in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'access denied';
  end if;

  select count(*)
  into v_profile_records
  from public.talent_candidates;

  select count(distinct candidate.id)
  into v_email_confirmed
  from public.talent_candidates as candidate
  join auth.users as auth_user
    on auth_user.id = candidate.auth_user_id
  where auth_user.email_confirmed_at is not null;

  select count(distinct candidate.id)
  into v_cv_uploaded
  from public.talent_candidate_documents as document
  join public.talent_candidates as candidate
    on candidate.id = document.candidate_id
  where document.document_type = 'CV'
    and document.is_primary is true;

  select count(*)
  into v_profile_completed
  from public.talent_candidates as candidate
  where candidate.submitted_at is not null;

  select count(*)
  into v_ai_analyzed
  from public.talent_candidates as candidate
  where candidate.ai_cv_status = 'Completed';

  select count(*)
  into v_approved
  from public.talent_candidates as candidate
  where candidate.marketplace_status = 'Approved'
    and candidate.employer_sharing_consent is true;

  select coalesce(jsonb_agg(to_jsonb(latest_profile) order by latest_profile.created_at desc), '[]'::jsonb)
  into v_latest_profiles
  from (
    select
      candidate.full_name,
      candidate.email,
      candidate.country_of_residence,
      candidate.profession,
      candidate.marketplace_status,
      candidate.created_at
    from public.talent_candidates as candidate
    order by candidate.created_at desc
    limit 10
  ) as latest_profile;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_country_distribution
  from (
    select coalesce(nullif(trim(candidate.country_of_residence), ''), 'Not specified') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.country_of_residence), ''), 'Not specified')
    order by total desc
    limit 10
  ) as grouped;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_profession_distribution
  from (
    select coalesce(nullif(trim(candidate.profession), ''), 'Not specified') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.profession), ''), 'Not specified')
    order by total desc
    limit 10
  ) as grouped;

  select coalesce(jsonb_agg(jsonb_build_object('value', grouped.value, 'count', grouped.total) order by grouped.total desc, grouped.value), '[]'::jsonb)
  into v_status_distribution
  from (
    select coalesce(nullif(trim(candidate.marketplace_status), ''), 'Draft') as value, count(*) as total
    from public.talent_candidates as candidate
    group by coalesce(nullif(trim(candidate.marketplace_status), ''), 'Draft')
    order by total desc
    limit 10
  ) as grouped;

  return jsonb_build_object(
    'profile_records', v_profile_records,
    'email_confirmed', v_email_confirmed,
    'email_confirmed_available', true,
    'cv_uploaded', v_cv_uploaded,
    'profile_completed', v_profile_completed,
    'ai_analyzed', v_ai_analyzed,
    'approved', v_approved,
    'latest_profiles', v_latest_profiles,
    'distributions', jsonb_build_object(
      'country_of_residence', v_country_distribution,
      'profession', v_profession_distribution,
      'marketplace_status', v_status_distribution
    )
  );
end;
$$;

revoke all on function public.get_owner_talent_dashboard() from public;
revoke all on function public.get_owner_talent_dashboard() from anon;
grant execute on function public.get_owner_talent_dashboard() to authenticated;
