-- Imported Talent cards are visible to entitled companies with anonymized identity.
-- Contact details are released only to the company that receives candidate approval.

alter table public.talent_imported_prospects
  add column if not exists marketplace_profile_consent boolean not null default false,
  add column if not exists marketplace_profile_consent_basis text,
  add column if not exists marketplace_profile_consent_recorded_at timestamptz;

alter table public.talent_imported_prospects
  drop constraint if exists talent_imported_prospects_marketplace_consent_check;

alter table public.talent_imported_prospects
  add constraint talent_imported_prospects_marketplace_consent_check check (
    marketplace_profile_consent is false
    or (
      nullif(btrim(marketplace_profile_consent_basis), '') is not null
      and marketplace_profile_consent_recorded_at is not null
    )
  );

-- The Platform Owner confirmed that all applicant reports imported up to this
-- migration carry approval for anonymized marketplace display. This does not
-- grant any company access to contact details or former-employer names.
update public.talent_imported_prospects
set
  marketplace_profile_consent = true,
  marketplace_profile_consent_basis = coalesce(
    nullif(btrim(marketplace_profile_consent_basis), ''),
    'Documented applicant approval for anonymized marketplace display confirmed by Platform Owner on 2026-08-15'
  ),
  marketplace_profile_consent_recorded_at = coalesce(marketplace_profile_consent_recorded_at, now()),
  updated_at = now();

create index if not exists talent_imported_prospects_marketplace_cards_idx
  on public.talent_imported_prospects (marketplace_profile_consent_recorded_at desc, id)
  where marketplace_profile_consent is true and claimed_candidate_id is null;

create table if not exists public.talent_company_contact_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  prospect_id uuid not null references public.talent_imported_prospects(id) on delete cascade,
  requested_by_auth_user_id uuid not null,
  company_name_snapshot text not null,
  decision_token uuid not null default gen_random_uuid(),
  status text not null default 'Pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  email_delivery_status text not null default 'Queued',
  email_last_attempt_at timestamptz,
  email_provider_message_id text,
  email_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint talent_company_contact_request_unique unique (company_id, prospect_id),
  constraint talent_company_contact_request_token_unique unique (decision_token),
  constraint talent_company_contact_request_status_check check (status in ('Pending', 'Approved', 'Declined')),
  constraint talent_company_contact_email_status_check check (email_delivery_status in ('Queued', 'Sending', 'Sent', 'Failed'))
);

create index if not exists talent_company_contact_request_queue_idx
  on public.talent_company_contact_requests (created_at)
  where status = 'Pending' and email_delivery_status = 'Queued';
create index if not exists talent_company_contact_request_decision_idx
  on public.talent_company_contact_requests (decision_token, status, expires_at);

alter table public.talent_company_contact_requests enable row level security;
revoke all on table public.talent_company_contact_requests from public, anon, authenticated;

create or replace function public.trigger_talent_prospect_email_worker()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault, net
as $$
declare
  v_url text;
  v_secret text;
  v_request bigint;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'visaflow_talent_prospect_email_worker_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'visaflow_talent_prospect_worker_secret';

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-visaflow-worker-secret', v_secret
    ),
    body := '{"max_jobs":20}'::jsonb,
    timeout_milliseconds := 300000
  ) into v_request;
  return v_request;
end;
$$;

revoke all on function public.trigger_talent_prospect_email_worker() from public, anon, authenticated;
grant execute on function public.trigger_talent_prospect_email_worker() to service_role;

create or replace function public.request_imported_talent_contact(p_prospect_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := public.current_app_user_company_id();
  v_company_name text;
  v_request public.talent_company_contact_requests;
begin
  if auth.uid() is null or v_company_id is null then
    raise exception using errcode = '42501', message = 'Company authentication is required.';
  end if;
  if not public.current_app_user_has_role(array['Admin', 'Company Admin', 'Recruitment Manager', 'Recruitment Officer', 'HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  if not exists (
    select 1 from public.platform_clients client
    where client.operational_company_id = v_company_id
      and client.talent_access_enabled is true
      and lower(coalesce(client.subscription_status, '')) in ('active', 'trial')
      and client.talent_profile_limit > 0
  ) then
    raise exception using errcode = '42501', message = 'VisaFlow Talent access is not active.';
  end if;
  if not exists (
    select 1 from public.talent_imported_prospects prospect
    where prospect.id = p_prospect_id
      and prospect.marketplace_profile_consent is true
      and prospect.claimed_candidate_id is null
      and nullif(btrim(prospect.email), '') is not null
  ) then
    raise exception using errcode = 'P0002', message = 'This imported Talent card is not available for contact approval.';
  end if;

  select coalesce(nullif(btrim(company.name), ''), 'A company using VisaFlow Talent')
  into v_company_name
  from public.companies company
  where company.id = v_company_id;

  select request.* into v_request
  from public.talent_company_contact_requests request
  where request.company_id = v_company_id and request.prospect_id = p_prospect_id;

  if v_request.status = 'Approved' then
    return jsonb_build_object('request_id', v_request.id, 'status', v_request.status, 'already_approved', true);
  end if;
  if v_request.status = 'Pending' and v_request.expires_at > now() and v_request.email_delivery_status in ('Queued', 'Sending', 'Sent') then
    return jsonb_build_object('request_id', v_request.id, 'status', v_request.status, 'already_pending', true);
  end if;

  insert into public.talent_company_contact_requests (
    company_id, prospect_id, requested_by_auth_user_id, company_name_snapshot,
    decision_token, status, expires_at, requested_at, decided_at,
    email_delivery_status, email_last_attempt_at, email_provider_message_id,
    email_error_message, updated_at
  ) values (
    v_company_id, p_prospect_id, auth.uid(), v_company_name,
    gen_random_uuid(), 'Pending', now() + interval '14 days', now(), null,
    'Queued', null, null, null, now()
  )
  on conflict (company_id, prospect_id) do update set
    requested_by_auth_user_id = excluded.requested_by_auth_user_id,
    company_name_snapshot = excluded.company_name_snapshot,
    decision_token = excluded.decision_token,
    status = 'Pending',
    expires_at = excluded.expires_at,
    requested_at = excluded.requested_at,
    decided_at = null,
    email_delivery_status = 'Queued',
    email_last_attempt_at = null,
    email_provider_message_id = null,
    email_error_message = null,
    updated_at = now()
  returning * into v_request;

  perform public.trigger_talent_prospect_email_worker();
  return jsonb_build_object('request_id', v_request.id, 'status', v_request.status);
end;
$$;

create or replace function public.respond_imported_talent_contact(p_token text, p_response text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
  v_request public.talent_company_contact_requests;
begin
  if p_response not in ('Approved', 'Declined') then
    raise exception using errcode = '22023', message = 'Response must be Approved or Declined.';
  end if;
  begin
    v_token := p_token::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'The response link is invalid.';
  end;

  update public.talent_company_contact_requests request
  set status = p_response, decided_at = now(), updated_at = now()
  where request.decision_token = v_token
    and request.status = 'Pending'
    and request.expires_at > now()
  returning * into v_request;

  if v_request.id is null then
    select request.* into v_request
    from public.talent_company_contact_requests request
    where request.decision_token = v_token;
    if v_request.id is null then
      raise exception using errcode = 'P0002', message = 'The response link is invalid.';
    end if;
    if v_request.status in ('Approved', 'Declined') then
      return jsonb_build_object('status', v_request.status, 'company_name', v_request.company_name_snapshot, 'already_decided', true);
    end if;
    raise exception using errcode = '22023', message = 'The response link has expired.';
  end if;

  return jsonb_build_object('status', v_request.status, 'company_name', v_request.company_name_snapshot);
end;
$$;

create or replace function public.claim_talent_company_contact_email_job(p_worker text)
returns table (
  request_id uuid,
  decision_token uuid,
  recipient text,
  candidate_name text,
  company_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with next_job as (
    select request.id
    from public.talent_company_contact_requests request
    where request.status = 'Pending'
      and request.email_delivery_status = 'Queued'
      and request.expires_at > now()
    order by request.created_at
    for update skip locked
    limit 1
  ), claimed as (
    update public.talent_company_contact_requests request
    set email_delivery_status = 'Sending', email_last_attempt_at = now(), updated_at = now()
    from next_job job
    where request.id = job.id
    returning request.*
  )
  select claimed.id, claimed.decision_token, prospect.email, prospect.full_name, claimed.company_name_snapshot
  from claimed
  join public.talent_imported_prospects prospect on prospect.id = claimed.prospect_id;
end;
$$;

create or replace function public.complete_talent_company_contact_email(p_request_id uuid, p_provider_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.talent_company_contact_requests
  set email_delivery_status = 'Sent', email_provider_message_id = p_provider_id,
      email_error_message = null, updated_at = now()
  where id = p_request_id;
$$;

create or replace function public.fail_talent_company_contact_email(p_request_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.talent_company_contact_requests
  set email_delivery_status = 'Failed', email_error_message = left(p_error, 1000), updated_at = now()
  where id = p_request_id;
$$;

create or replace function public.record_talent_import_marketplace_consent(p_source_file text, p_basis text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_updated integer;
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
  if nullif(btrim(p_source_file), '') is null or nullif(btrim(p_basis), '') is null then
    raise exception using errcode = '22023', message = 'Source file and documented consent basis are required.';
  end if;
  update public.talent_imported_prospects prospect
  set marketplace_profile_consent = true,
      marketplace_profile_consent_basis = btrim(p_basis),
      marketplace_profile_consent_recorded_at = now(),
      updated_at = now()
  where prospect.source_file = btrim(p_source_file);
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.import_talent_prospects_with_marketplace_consent(
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
  v_consented integer;
begin
  -- Both called functions independently enforce Platform Owner access and
  -- validate the documented consent basis.
  v_result := public.import_talent_prospects(p_rows, p_source_file);
  v_consented := public.record_talent_import_marketplace_consent(p_source_file, p_consent_basis);
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('marketplace_cards_enabled', v_consented);
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
      lower(concat_ws(' ', prospect.current_title, prospect.general_location,
        prospect.education_degree, prospect.education_institution, prospect.source_job_title)),
      jsonb_build_object(
        'candidate_id', prospect.id, 'profile_source', 'Imported Excel', 'is_imported', true,
        'public_reference', 'VF-IMP-' || upper(substr(replace(prospect.id::text, '-', ''), 1, 10)),
        'headline', coalesce(prospect.current_title, prospect.source_job_title, 'Professional candidate'),
        'profession', coalesce(prospect.current_title, prospect.source_job_title),
        'current_title', prospect.current_title, 'current_company', null,
        'education_degree', prospect.education_degree, 'education_institution', prospect.education_institution,
        'source_job_title', prospect.source_job_title, 'date_applied', prospect.applied_at,
        'nationality', null, 'country_of_residence', prospect.general_location,
        'city', prospect.general_location, 'years_experience', null, 'languages', '[]'::jsonb,
        'availability_status', 'Applicant', 'expected_salary', null, 'expected_salary_currency', null,
        'ai_cv_status', 'Not Uploaded', 'profile_completeness', 70,
        'published_at', coalesce(prospect.marketplace_profile_consent_recorded_at, prospect.created_at),
        'professional_summary', concat_ws(' | ', nullif(prospect.current_title, ''),
          nullif(prospect.education_degree, ''),
          case when prospect.source_job_title is not null then 'Applied for: ' || prospect.source_job_title else null end,
          nullif(prospect.general_location, '')),
        'preferred_locations', case when prospect.general_location is null then '[]'::jsonb else jsonb_build_array(prospect.general_location) end,
        'preferred_employment_types', '[]'::jsonb, 'skills', '[]'::jsonb,
        'identity_shared', coalesce(contact_request.status = 'Approved', false),
        'full_name', case when contact_request.status = 'Approved' then prospect.full_name else null end,
        'email', case when contact_request.status = 'Approved' then prospect.email else null end,
        'phone', case when contact_request.status = 'Approved' then prospect.phone else null end,
        'contact_request_status', contact_request.status,
        'contact_request_email_status', contact_request.email_delivery_status,
        'latest_interview_status', null, 'latest_interview_type', null,
        'latest_interview_at', null, 'cv_available', false
      )
    from public.talent_imported_prospects prospect
    left join public.talent_company_contact_requests contact_request
      on contact_request.company_id = v_company_id and contact_request.prospect_id = prospect.id
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

drop function if exists public.get_talent_public_stats();
create function public.get_talent_public_stats()
returns table(registered_candidates bigint, marketplace_ready bigint, completed_ai_interviews bigint, imported_prospects bigint)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*)::bigint from public.talent_candidates),
    ((select count(*)::bigint from public.talent_candidates candidate
      where candidate.marketplace_status = 'Approved' and candidate.is_verified is true
        and candidate.published_at is not null and candidate.employer_sharing_consent is true
        and candidate.profile_visibility in ('Anonymized', 'Public'))
     +
     (select count(*)::bigint from public.talent_imported_prospects prospect
      where prospect.marketplace_profile_consent is true and prospect.claimed_candidate_id is null)),
    (select count(*)::bigint from public.talent_candidates candidate where candidate.ai_interview_status = 'Completed'),
    (select count(*)::bigint from public.talent_imported_prospects);
$$;

revoke all on function public.request_imported_talent_contact(uuid) from public, anon;
grant execute on function public.request_imported_talent_contact(uuid) to authenticated;
revoke all on function public.respond_imported_talent_contact(text, text) from public;
grant execute on function public.respond_imported_talent_contact(text, text) to anon, authenticated;
revoke all on function public.claim_talent_company_contact_email_job(text) from public, anon, authenticated;
revoke all on function public.complete_talent_company_contact_email(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_talent_company_contact_email(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_talent_company_contact_email_job(text) to service_role;
grant execute on function public.complete_talent_company_contact_email(uuid, text) to service_role;
grant execute on function public.fail_talent_company_contact_email(uuid, text) to service_role;
revoke all on function public.record_talent_import_marketplace_consent(text, text) from public, anon, authenticated;
grant execute on function public.record_talent_import_marketplace_consent(text, text) to authenticated;
revoke all on function public.import_talent_prospects_with_marketplace_consent(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.import_talent_prospects_with_marketplace_consent(jsonb, text, text) to authenticated;
revoke all on function public.list_company_talent_marketplace_page(text, integer, integer) from public, anon;
grant execute on function public.list_company_talent_marketplace_page(text, integer, integer) to authenticated;
revoke all on function public.get_talent_public_stats() from public;
grant execute on function public.get_talent_public_stats() to anon, authenticated, service_role;
