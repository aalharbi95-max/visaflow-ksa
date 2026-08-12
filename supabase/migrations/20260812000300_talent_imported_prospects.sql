-- Private Talent prospect staging for externally sourced applicants.
-- Imported people remain invisible to companies until they claim a profile and
-- explicitly grant employer-sharing consent through the Talent portal.

create table if not exists public.talent_imported_prospects (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'LinkedIn',
  source_file text,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  full_name text not null,
  first_name text,
  last_name text,
  phone text,
  general_location text,
  headline text,
  current_title text,
  current_company text,
  education_degree text,
  education_institution text,
  linkedin_url text,
  applied_at date,
  source_stage text,
  source_job_id text,
  source_job_title text,
  source_job_url text,
  source_project_id text,
  source_project_title text,
  screening_responses text,
  status text not null default 'Awaiting Candidate',
  invitation_sent_at timestamptz,
  claimed_at timestamptz,
  claimed_candidate_id uuid references public.talent_candidates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint talent_imported_prospects_email_check check (position('@' in email_normalized) > 1),
  constraint talent_imported_prospects_status_check check (status in (
    'Awaiting Candidate', 'Invitation Queued', 'Invitation Sent', 'Claimed', 'Archived'
  ))
);

create unique index if not exists talent_imported_prospects_email_uidx
  on public.talent_imported_prospects(email_normalized);
create index if not exists talent_imported_prospects_status_created_idx
  on public.talent_imported_prospects(status, created_at desc);

alter table public.talent_imported_prospects enable row level security;
revoke all on table public.talent_imported_prospects from public, anon, authenticated;

create or replace function public.import_talent_prospects(p_rows jsonb, p_source_file text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_email text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.users platform_user
    where platform_user.auth_user_id = auth.uid()
      and platform_user.company_id is null
      and platform_user.role = 'Platform Owner'
      and platform_user.is_active is true
      and lower(coalesce(platform_user.status, '')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'platform owner access required';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'p_rows must be a JSON array';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_email := lower(btrim(coalesce(v_row->>'email', '')));
    if v_email = '' or position('@' in v_email) <= 1 then
      continue;
    end if;

    if exists (select 1 from public.talent_imported_prospects p where p.email_normalized = v_email) then
      v_updated := v_updated + 1;
    else
      v_inserted := v_inserted + 1;
    end if;

    insert into public.talent_imported_prospects (
      source, source_file, email, full_name, first_name, last_name, phone,
      general_location, headline, current_title, current_company,
      education_degree, education_institution, linkedin_url, applied_at,
      source_stage, source_job_id, source_job_title, source_job_url,
      source_project_id, source_project_title, screening_responses, updated_at
    ) values (
      coalesce(nullif(btrim(v_row->>'source'), ''), 'LinkedIn'),
      nullif(btrim(p_source_file), ''), v_email,
      coalesce(nullif(btrim(v_row->>'full_name'), ''), v_email),
      nullif(btrim(v_row->>'first_name'), ''), nullif(btrim(v_row->>'last_name'), ''),
      nullif(btrim(v_row->>'phone'), ''), nullif(btrim(v_row->>'general_location'), ''),
      nullif(btrim(v_row->>'headline'), ''), nullif(btrim(v_row->>'current_title'), ''),
      nullif(btrim(v_row->>'current_company'), ''), nullif(btrim(v_row->>'education_degree'), ''),
      nullif(btrim(v_row->>'education_institution'), ''), nullif(btrim(v_row->>'linkedin_url'), ''),
      case when coalesce(v_row->>'applied_at', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row->>'applied_at')::date else null end,
      nullif(btrim(v_row->>'source_stage'), ''), nullif(btrim(v_row->>'source_job_id'), ''),
      nullif(btrim(v_row->>'source_job_title'), ''), nullif(btrim(v_row->>'source_job_url'), ''),
      nullif(btrim(v_row->>'source_project_id'), ''), nullif(btrim(v_row->>'source_project_title'), ''),
      nullif(btrim(v_row->>'screening_responses'), ''), now()
    )
    on conflict (email_normalized) do update set
      source_file = coalesce(excluded.source_file, talent_imported_prospects.source_file),
      full_name = excluded.full_name,
      first_name = coalesce(excluded.first_name, talent_imported_prospects.first_name),
      last_name = coalesce(excluded.last_name, talent_imported_prospects.last_name),
      phone = coalesce(excluded.phone, talent_imported_prospects.phone),
      general_location = coalesce(excluded.general_location, talent_imported_prospects.general_location),
      headline = coalesce(excluded.headline, talent_imported_prospects.headline),
      current_title = coalesce(excluded.current_title, talent_imported_prospects.current_title),
      current_company = coalesce(excluded.current_company, talent_imported_prospects.current_company),
      education_degree = coalesce(excluded.education_degree, talent_imported_prospects.education_degree),
      education_institution = coalesce(excluded.education_institution, talent_imported_prospects.education_institution),
      linkedin_url = coalesce(excluded.linkedin_url, talent_imported_prospects.linkedin_url),
      applied_at = coalesce(excluded.applied_at, talent_imported_prospects.applied_at),
      source_stage = coalesce(excluded.source_stage, talent_imported_prospects.source_stage),
      source_job_id = coalesce(excluded.source_job_id, talent_imported_prospects.source_job_id),
      source_job_title = coalesce(excluded.source_job_title, talent_imported_prospects.source_job_title),
      source_job_url = coalesce(excluded.source_job_url, talent_imported_prospects.source_job_url),
      source_project_id = coalesce(excluded.source_project_id, talent_imported_prospects.source_project_id),
      source_project_title = coalesce(excluded.source_project_title, talent_imported_prospects.source_project_title),
      screening_responses = coalesce(excluded.screening_responses, talent_imported_prospects.screening_responses),
      updated_at = now();
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'total', v_inserted + v_updated);
end;
$$;

create or replace function public.list_owner_talent_prospects(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.users platform_user
    where platform_user.auth_user_id = auth.uid()
      and platform_user.company_id is null
      and platform_user.role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
      and platform_user.is_active is true
      and lower(coalesce(platform_user.status, '')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'platform access required';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'awaiting_candidate', count(*) filter (where status = 'Awaiting Candidate'),
    'invited', count(*) filter (where status in ('Invitation Queued', 'Invitation Sent')),
    'claimed', count(*) filter (where status = 'Claimed')
  ) into v_result
  from public.talent_imported_prospects;
  return v_result;
end;
$$;

revoke all on function public.import_talent_prospects(jsonb, text) from public, anon, authenticated;
grant execute on function public.import_talent_prospects(jsonb, text) to authenticated;
revoke all on function public.list_owner_talent_prospects(integer) from public, anon;
grant execute on function public.list_owner_talent_prospects(integer) to authenticated;
