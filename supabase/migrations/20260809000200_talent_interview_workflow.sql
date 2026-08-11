-- Candidate-authorized identity sharing and company interview scheduling.

alter table public.talent_candidates
  add column if not exists employer_contact_sharing_consent boolean not null default false;

alter table public.talent_candidate_consents
  drop constraint if exists talent_consents_type_check;

alter table public.talent_candidate_consents
  add constraint talent_consents_type_check check (consent_type = any (array[
    'Platform Terms'::text,
    'Privacy Policy'::text,
    'Employer Sharing'::text,
    'Employer Contact Sharing'::text,
    'AI CV Analysis'::text,
    'AI Interview'::text,
    'Evaluation Email'::text,
    'Marketing Communications'::text
  ]));

create table if not exists public.talent_interview_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null references public.talent_candidates(id) on delete cascade,
  requested_by_auth_user_id uuid not null,
  interview_type text not null,
  scheduled_at timestamptz not null,
  timezone text not null default 'Asia/Riyadh',
  meeting_url text,
  location text,
  notes text,
  status text not null default 'Scheduled',
  candidate_response_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint talent_interview_type_check check (interview_type = any (array['Online Video', 'Phone', 'In Person'])),
  constraint talent_interview_status_check check (status = any (array['Scheduled', 'Accepted', 'Declined', 'Completed', 'Cancelled'])),
  constraint talent_interview_destination_check check (
    (interview_type = 'Online Video' and nullif(btrim(meeting_url), '') is not null)
    or (interview_type = 'In Person' and nullif(btrim(location), '') is not null)
    or interview_type = 'Phone'
  )
);

create index if not exists talent_interviews_company_candidate_idx
  on public.talent_interview_invitations(company_id, candidate_id, scheduled_at desc);
create index if not exists talent_interviews_candidate_schedule_idx
  on public.talent_interview_invitations(candidate_id, scheduled_at desc);

alter table public.talent_interview_invitations enable row level security;
revoke all on table public.talent_interview_invitations from public, anon, authenticated;

create or replace function public.schedule_talent_interview(
  p_candidate_id uuid,
  p_interview_type text,
  p_scheduled_at timestamptz,
  p_meeting_url text default null,
  p_location text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_invitation_id uuid;
  v_has_access boolean;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception using errcode = '42501', message = 'Company authentication is required.';
  end if;
  if not public.current_app_user_has_role(array['Admin', 'Company Admin', 'Recruitment Manager', 'Recruitment Officer', 'HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  if p_scheduled_at <= now() then
    raise exception using errcode = '22023', message = 'Interview time must be in the future.';
  end if;
  if p_interview_type not in ('Online Video', 'Phone', 'In Person') then
    raise exception using errcode = '22023', message = 'Invalid interview type.';
  end if;
  if p_interview_type = 'Online Video' and nullif(btrim(p_meeting_url), '') is null then
    raise exception using errcode = '22023', message = 'Meeting link is required for an online interview.';
  end if;
  if p_interview_type = 'Online Video' and btrim(p_meeting_url) !~* '^https://' then
    raise exception using errcode = '22023', message = 'Online meeting link must use HTTPS.';
  end if;
  if p_interview_type = 'In Person' and nullif(btrim(p_location), '') is null then
    raise exception using errcode = '22023', message = 'Location is required for an in-person interview.';
  end if;

  select exists (
    select 1
    from public.platform_clients client
    where client.operational_company_id = v_company_id
      and client.talent_access_enabled is true
      and lower(coalesce(client.subscription_status, '')) in ('active', 'trial')
      and client.talent_profile_limit > 0
  ) into v_has_access;
  if not v_has_access then
    raise exception using errcode = '42501', message = 'VisaFlow Talent access is not active.';
  end if;

  if not exists (
    select 1 from public.talent_candidates candidate
    where candidate.id = p_candidate_id
      and candidate.marketplace_status = 'Approved'
      and candidate.is_verified is true
      and candidate.published_at is not null
      and candidate.employer_sharing_consent is true
      and candidate.employer_contact_sharing_consent is true
  ) then
    raise exception using errcode = '42501', message = 'Candidate has not authorized contact sharing.';
  end if;

  insert into public.talent_interview_invitations (
    company_id, candidate_id, requested_by_auth_user_id, interview_type,
    scheduled_at, meeting_url, location, notes
  ) values (
    v_company_id, p_candidate_id, auth.uid(), p_interview_type,
    p_scheduled_at, nullif(btrim(p_meeting_url), ''), nullif(btrim(p_location), ''), nullif(btrim(p_notes), '')
  ) returning id into v_invitation_id;

  return v_invitation_id;
end;
$$;

create or replace function public.list_candidate_talent_interviews()
returns table (
  invitation_id uuid,
  company_name text,
  interview_type text,
  scheduled_at timestamptz,
  timezone text,
  meeting_url text,
  location text,
  notes text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select invitation.id, company.name, invitation.interview_type,
    invitation.scheduled_at, invitation.timezone, invitation.meeting_url,
    invitation.location, invitation.notes, invitation.status, invitation.created_at
  from public.talent_interview_invitations invitation
  join public.talent_candidates candidate on candidate.id = invitation.candidate_id
  join public.companies company on company.id = invitation.company_id
  where auth.uid() is not null and candidate.auth_user_id = auth.uid()
  order by invitation.scheduled_at desc;
$$;

create or replace function public.respond_talent_interview(p_invitation_id uuid, p_response text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_response not in ('Accepted', 'Declined') then
    raise exception using errcode = '22023', message = 'Response must be Accepted or Declined.';
  end if;

  update public.talent_interview_invitations invitation
  set status = p_response, candidate_response_at = now(), updated_at = now()
  from public.talent_candidates candidate
  where invitation.id = p_invitation_id
    and candidate.id = invitation.candidate_id
    and candidate.auth_user_id = auth.uid()
    and invitation.status = 'Scheduled'
  returning invitation.status into v_status;

  if v_status is null then
    raise exception using errcode = 'P0002', message = 'Interview invitation is not available.';
  end if;
  return v_status;
end;
$$;

drop function if exists public.list_company_talent_marketplace();

create function public.list_company_talent_marketplace()
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
  published_at timestamptz,
  professional_summary text,
  preferred_locations jsonb,
  preferred_employment_types jsonb,
  skills jsonb,
  identity_shared boolean,
  full_name text,
  email text,
  phone text,
  latest_interview_status text,
  latest_interview_type text,
  latest_interview_at timestamptz
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

  select case when client.talent_access_enabled is true
      and lower(coalesce(client.subscription_status, '')) in ('active', 'trial')
      then greatest(0, client.talent_profile_limit) else 0 end
  into v_limit
  from public.platform_clients client
  where client.operational_company_id = v_company_id
  order by client.created_at desc limit 1;
  if coalesce(v_limit, 0) <= 0 then return; end if;

  return query
  select candidate.id, candidate.public_reference, candidate.headline,
    candidate.profession, candidate.nationality, candidate.country_of_residence,
    candidate.city, candidate.years_experience, candidate.languages,
    candidate.availability_status, candidate.expected_salary,
    candidate.expected_salary_currency, candidate.ai_cv_status,
    candidate.profile_completeness, candidate.published_at,
    candidate.professional_summary, candidate.preferred_locations,
    candidate.preferred_employment_types,
    coalesce((select jsonb_agg(jsonb_build_object('name', skill.skill_name, 'level', skill.proficiency_level) order by skill.confidence desc)
      from public.talent_candidate_skills skill where skill.candidate_id = candidate.id), '[]'::jsonb),
    candidate.employer_contact_sharing_consent,
    case when candidate.employer_contact_sharing_consent then candidate.full_name else null end,
    case when candidate.employer_contact_sharing_consent then candidate.email else null end,
    case when candidate.employer_contact_sharing_consent then candidate.phone else null end,
    latest.status, latest.interview_type, latest.scheduled_at
  from public.talent_candidates candidate
  left join lateral (
    select invitation.status, invitation.interview_type, invitation.scheduled_at
    from public.talent_interview_invitations invitation
    where invitation.company_id = v_company_id and invitation.candidate_id = candidate.id
    order by invitation.created_at desc limit 1
  ) latest on true
  where candidate.marketplace_status = 'Approved'
    and candidate.is_verified is true
    and candidate.published_at is not null
    and candidate.employer_sharing_consent is true
    and candidate.profile_visibility in ('Anonymized', 'Public')
  order by candidate.published_at desc
  limit case when v_limit >= 100000 then null else v_limit end;
end;
$$;

revoke all on function public.schedule_talent_interview(uuid, text, timestamptz, text, text, text) from public, anon;
grant execute on function public.schedule_talent_interview(uuid, text, timestamptz, text, text, text) to authenticated;
revoke all on function public.list_candidate_talent_interviews() from public, anon;
grant execute on function public.list_candidate_talent_interviews() to authenticated;
revoke all on function public.respond_talent_interview(uuid, text) from public, anon;
grant execute on function public.respond_talent_interview(uuid, text) to authenticated;
revoke all on function public.list_company_talent_marketplace() from public, anon;
grant execute on function public.list_company_talent_marketplace() to authenticated;
