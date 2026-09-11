-- Public engineering Talent campaign. Engineering roles are resolved at runtime
-- from the Platform Owner's approved, active global interview templates.

-- Keep this campaign migration safe on projects that have not yet received the
-- standalone Talent interview workflow migration.
alter table public.talent_candidates
  add column if not exists employer_contact_sharing_consent boolean not null default false;

alter table public.talent_candidate_consents
  drop constraint if exists talent_consents_type_check;
alter table public.talent_candidate_consents
  add constraint talent_consents_type_check check (consent_type = any (array[
    'Platform Terms'::text, 'Privacy Policy'::text, 'Employer Sharing'::text,
    'Employer Contact Sharing'::text, 'AI CV Analysis'::text, 'AI Interview'::text,
    'Evaluation Email'::text, 'Marketing Communications'::text
  ]));

alter table public.platform_clients
  add column if not exists talent_access_enabled boolean not null default false,
  add column if not exists talent_profile_limit integer not null default 0,
  add column if not exists talent_access_tier text not null default 'None';

create table if not exists public.talent_public_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_ar text not null,
  description_en text not null default '',
  description_ar text not null default '',
  template_owner_company_id uuid not null,
  status text not null default 'Draft',
  registration_starts_at timestamptz,
  registration_ends_at timestamptz,
  cv_sharing_required boolean not null default true,
  result_sharing_optional boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint talent_public_campaign_status_check
    check (status = any (array['Draft'::text, 'Active'::text, 'Paused'::text, 'Closed'::text]))
);

create table if not exists public.talent_public_campaign_applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.talent_public_campaigns(id) on delete cascade,
  candidate_id uuid not null references public.talent_candidates(id) on delete cascade,
  template_id uuid not null references public.ai_interview_templates(id) on delete restrict,
  cv_document_id uuid not null references public.talent_candidate_documents(id) on delete restrict,
  ai_interview_session_id uuid references public.ai_interview_sessions(id) on delete set null,
  profession text not null,
  cv_sharing_consent boolean not null,
  cv_sharing_consent_at timestamptz not null,
  cv_sharing_consent_version text not null default 'ENGINEERING-CAMPAIGN-CV-1.0',
  result_sharing_consent boolean not null default false,
  result_sharing_consent_at timestamptz,
  source text not null default 'Direct',
  source_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'Registered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, candidate_id),
  constraint talent_campaign_application_cv_consent_check check (cv_sharing_consent is true),
  constraint talent_campaign_application_status_check check (status = any (array[
    'Registered'::text, 'Invited'::text, 'Opened'::text, 'In Progress'::text,
    'Processing'::text, 'Completed'::text, 'Expired'::text, 'Cancelled'::text, 'Failed'::text
  ]))
);

create index if not exists talent_public_campaign_applications_campaign_idx
  on public.talent_public_campaign_applications(campaign_id, status, created_at desc);
create index if not exists talent_public_campaign_applications_candidate_idx
  on public.talent_public_campaign_applications(candidate_id, created_at desc);

alter table public.talent_public_campaigns enable row level security;
alter table public.talent_public_campaign_applications enable row level security;
revoke all on table public.talent_public_campaigns from public, anon, authenticated;
revoke all on table public.talent_public_campaign_applications from public, anon, authenticated;

insert into public.talent_public_campaigns (
  id, slug, name_en, name_ar, description_en, description_ar,
  template_owner_company_id, status, registration_starts_at, settings
) values (
  '3bd5c1d5-d74b-4b35-995d-25f8a2f58a01',
  'saudi-engineers-2026',
  'VisaFlow Engineering Talent Campaign',
  'حملة VisaFlow للمواهب الهندسية',
  'A public registration and AI interview campaign for every engineering profession with an approved Platform Owner template.',
  'حملة تسجيل واختبار بالذكاء الاصطناعي لجميع التخصصات الهندسية التي لها قالب معتمد في منصة المالك.',
  coalesce((
    select template.company_id
    from public.ai_interview_templates template
    where template.is_active is true and template.is_current_version is true
      and template.status = 'Active' and template.approval_status = 'Approved'
      and (lower(coalesce(template.profession_category, '')) like '%engineer%'
        or lower(template.profession) like '%engineer%'
        or lower(template.profession) like '%engineering%')
    order by template.is_global desc, template.updated_at desc
    limit 1
  ), '9b3010d8-e926-4644-bacb-feace89eb5a0'::uuid),
  'Active',
  now(),
  jsonb_build_object('market', 'Saudi Arabia', 'channel', 'LinkedIn')
) on conflict (slug) do update set
  name_en = excluded.name_en,
  name_ar = excluded.name_ar,
  description_en = excluded.description_en,
  description_ar = excluded.description_ar,
  template_owner_company_id = excluded.template_owner_company_id,
  updated_at = now();

create or replace function public.get_public_talent_campaign(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_campaign public.talent_public_campaigns%rowtype;
  v_templates jsonb;
begin
  select * into v_campaign
  from public.talent_public_campaigns campaign
  where campaign.slug = nullif(btrim(p_slug), '')
    and campaign.status = 'Active'
    and (campaign.registration_starts_at is null or campaign.registration_starts_at <= now())
    and (campaign.registration_ends_at is null or campaign.registration_ends_at >= now());

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', template.id,
    'profession', template.profession,
    'template_name', template.template_name,
    'language', template.language,
    'interview_mode', template.interview_mode,
    'duration_minutes', template.duration_minutes,
    'question_count', (select count(*) from public.ai_interview_questions question
      where question.template_id = template.id and question.is_active is true)
  ) order by template.profession, template.template_name), '[]'::jsonb)
  into v_templates
  from public.ai_interview_templates template
  where template.company_id = v_campaign.template_owner_company_id
    and template.is_active is true
    and template.is_current_version is true
    and template.status = 'Active'
    and template.approval_status = 'Approved'
    and nullif(btrim(template.profession), '') is not null
    and (
      lower(coalesce(template.profession_category, '')) like '%engineer%'
      or lower(template.profession) like '%engineer%'
      or lower(template.profession) like '%engineering%'
    );

  return jsonb_build_object(
    'id', v_campaign.id,
    'slug', v_campaign.slug,
    'name_en', v_campaign.name_en,
    'name_ar', v_campaign.name_ar,
    'description_en', v_campaign.description_en,
    'description_ar', v_campaign.description_ar,
    'cv_sharing_required', v_campaign.cv_sharing_required,
    'result_sharing_optional', v_campaign.result_sharing_optional,
    'registration_ends_at', v_campaign.registration_ends_at,
    'templates', v_templates
  );
end;
$$;

create or replace function public.get_my_talent_campaign_application(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(result)
  from (
    select application.id, application.status, application.profession,
      application.result_sharing_consent, application.created_at,
      session.id as session_id, session.invitation_url, session.status as interview_status,
      session.overall_score, session.ai_recommendation
    from public.talent_public_campaign_applications application
    join public.talent_public_campaigns campaign on campaign.id = application.campaign_id
    join public.talent_candidates candidate on candidate.id = application.candidate_id
    left join public.ai_interview_sessions session on session.id = application.ai_interview_session_id
    where auth.uid() is not null
      and candidate.auth_user_id = auth.uid()
      and campaign.slug = nullif(btrim(p_slug), '')
    limit 1
  ) result;
$$;

create or replace function public.enroll_in_talent_campaign(
  p_slug text,
  p_template_id uuid,
  p_result_sharing_consent boolean default false,
  p_source text default 'Direct',
  p_source_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.talent_public_campaigns%rowtype;
  v_candidate public.talent_candidates%rowtype;
  v_template public.ai_interview_templates%rowtype;
  v_document public.talent_candidate_documents%rowtype;
  v_application public.talent_public_campaign_applications%rowtype;
  v_session_id uuid;
  v_access_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_invitation_url text;
  v_question_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Candidate authentication is required.';
  end if;

  select * into v_campaign from public.talent_public_campaigns campaign
  where campaign.slug = nullif(btrim(p_slug), '') and campaign.status = 'Active'
    and (campaign.registration_starts_at is null or campaign.registration_starts_at <= now())
    and (campaign.registration_ends_at is null or campaign.registration_ends_at >= now())
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'This Talent campaign is not available.'; end if;

  select * into v_candidate from public.talent_candidates candidate
  where candidate.auth_user_id = auth.uid() for update;
  if not found then raise exception using errcode = 'P0002', message = 'Complete your Talent profile first.'; end if;
  if nullif(btrim(coalesce(v_candidate.full_name, '')), '') is null
     or nullif(btrim(coalesce(v_candidate.phone, '')), '') is null then
    raise exception using errcode = '22023', message = 'Name and mobile number are required.';
  end if;

  if not coalesce(v_candidate.employer_sharing_consent, false)
     or not coalesce(v_candidate.employer_contact_sharing_consent, false)
     or not exists (select 1 from public.talent_candidate_consents consent
       where consent.candidate_id = v_candidate.id and consent.consent_type = 'Employer Sharing' and consent.is_granted is true)
     or not exists (select 1 from public.talent_candidate_consents consent
       where consent.candidate_id = v_candidate.id and consent.consent_type = 'Employer Contact Sharing' and consent.is_granted is true)
     or not exists (select 1 from public.talent_candidate_consents consent
       where consent.candidate_id = v_candidate.id and consent.consent_type = 'AI Interview' and consent.is_granted is true) then
    raise exception using errcode = '22023', message = 'CV, contact and AI interview consents are required before the test.';
  end if;

  select * into v_document from public.talent_candidate_documents document
  where document.candidate_id = v_candidate.id and document.document_type = 'CV' and document.is_primary is true
  order by document.uploaded_at desc limit 1;
  if not found then raise exception using errcode = '22023', message = 'Upload your CV before the test.'; end if;

  select * into v_template from public.ai_interview_templates template
  where template.id = p_template_id
    and template.company_id = v_campaign.template_owner_company_id
    and template.is_active is true
    and template.is_current_version is true and template.status = 'Active'
    and template.approval_status = 'Approved'
    and (lower(coalesce(template.profession_category, '')) like '%engineer%'
      or lower(template.profession) like '%engineer%'
      or lower(template.profession) like '%engineering%');
  if not found then raise exception using errcode = '22023', message = 'Select an approved engineering interview template.'; end if;

  select * into v_application from public.talent_public_campaign_applications application
  where application.campaign_id = v_campaign.id and application.candidate_id = v_candidate.id;
  if found and v_application.ai_interview_session_id is not null then
    update public.talent_public_campaign_applications
    set result_sharing_consent = coalesce(p_result_sharing_consent, false),
        result_sharing_consent_at = case when coalesce(p_result_sharing_consent, false) then now() else null end,
        updated_at = now()
    where id = v_application.id;
    update public.ai_interview_sessions
    set employer_sharing_consent = coalesce(p_result_sharing_consent, false),
        employer_sharing_consent_at = case when coalesce(p_result_sharing_consent, false) then now() else null end
    where id = v_application.ai_interview_session_id;
    return (select to_jsonb(result) from (
      select v_application.id as application_id, session.id as session_id,
        session.invitation_url, session.status, true as existing
      from public.ai_interview_sessions session where session.id = v_application.ai_interview_session_id
    ) result);
  end if;

  select count(*)::integer into v_question_count from public.ai_interview_questions question
  where question.template_id = v_template.id and question.is_active is true;
  if v_question_count <= 0 then raise exception using errcode = '22023', message = 'The selected template has no active questions.'; end if;

  v_invitation_url := 'https://www.visaflowksa.com/?ai_interview=' || v_access_token;
  insert into public.ai_interview_sessions (
    company_id, template_id, candidate_id, candidate_name, candidate_email,
    candidate_mobile, profession, nationality, language, interview_mode,
    interaction_mode, camera_mode, access_token, invitation_url, status,
    invitation_sent_at, expires_at, total_questions, employer_sharing_consent,
    employer_sharing_consent_at, created_by, updated_by
  ) values (
    v_template.company_id, v_template.id, v_candidate.id::text, v_candidate.full_name,
    coalesce(v_candidate.email, ''), coalesce(v_candidate.phone, ''), v_template.profession,
    coalesce(v_candidate.nationality, ''), v_template.language, v_template.interview_mode,
    v_template.interaction_mode, v_template.camera_mode, v_access_token, v_invitation_url, 'Invited',
    now(), least(coalesce(v_campaign.registration_ends_at, now() + interval '14 days'), now() + interval '14 days'),
    v_question_count, coalesce(p_result_sharing_consent, false),
    case when coalesce(p_result_sharing_consent, false) then now() else null end,
    'Talent Public Campaign', 'Talent Public Campaign'
  ) returning id into v_session_id;

  insert into public.talent_public_campaign_applications (
    campaign_id, candidate_id, template_id, cv_document_id, ai_interview_session_id,
    profession, cv_sharing_consent, cv_sharing_consent_at,
    result_sharing_consent, result_sharing_consent_at, source, source_metadata, status
  ) values (
    v_campaign.id, v_candidate.id, v_template.id, v_document.id, v_session_id,
    v_template.profession, true, now(), coalesce(p_result_sharing_consent, false),
    case when coalesce(p_result_sharing_consent, false) then now() else null end,
    coalesce(nullif(btrim(p_source), ''), 'Direct'), coalesce(p_source_metadata, '{}'::jsonb), 'Invited'
  ) returning * into v_application;

  perform set_config('visaflow.talent_internal_update', '1', true);
  update public.talent_candidates set profession = v_template.profession,
    ai_interview_status = 'Invited', latest_ai_interview_session_id = v_session_id,
    last_active_at = now(), updated_at = now() where id = v_candidate.id;

  return jsonb_build_object('application_id', v_application.id, 'session_id', v_session_id,
    'invitation_url', v_invitation_url, 'status', 'Invited', 'existing', false);
end;
$$;

create or replace function public.update_my_talent_campaign_result_consent(p_slug text, p_is_granted boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_session_id uuid;
begin
  update public.talent_public_campaign_applications application
  set result_sharing_consent = coalesce(p_is_granted, false),
      result_sharing_consent_at = case when coalesce(p_is_granted, false) then now() else null end,
      updated_at = now()
  from public.talent_public_campaigns campaign, public.talent_candidates candidate
  where application.campaign_id = campaign.id and application.candidate_id = candidate.id
    and campaign.slug = nullif(btrim(p_slug), '') and candidate.auth_user_id = auth.uid()
  returning application.ai_interview_session_id into v_session_id;
  if v_session_id is null then return false; end if;
  update public.ai_interview_sessions set employer_sharing_consent = coalesce(p_is_granted, false),
    employer_sharing_consent_at = case when coalesce(p_is_granted, false) then now() else null end
  where id = v_session_id;
  return true;
end;
$$;

create or replace function public.sync_talent_public_campaign_application()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.talent_public_campaign_applications application
  set status = case new.status
      when 'In Progress' then 'In Progress' when 'Processing' then 'Processing'
      when 'Completed' then 'Completed' when 'Expired' then 'Expired'
      when 'Cancelled' then 'Cancelled' when 'Failed' then 'Failed'
      when 'Opened' then 'Opened' else application.status end,
      updated_at = now()
  where application.ai_interview_session_id = new.id;
  if new.status in ('Opened', 'In Progress', 'Completed', 'Failed') then
    perform set_config('visaflow.talent_internal_update', '1', true);
    update public.talent_candidates candidate
    set ai_interview_status = case new.status when 'Opened' then 'Opened' when 'In Progress' then 'In Progress'
        when 'Completed' then 'Completed' else 'Failed' end,
      latest_ai_interview_score = case when new.status = 'Completed' then new.overall_score else candidate.latest_ai_interview_score end,
      latest_ai_recommendation = case when new.status = 'Completed' then new.ai_recommendation else candidate.latest_ai_recommendation end,
      updated_at = now()
    where candidate.id::text = new.candidate_id
      and exists (select 1 from public.talent_public_campaign_applications application
        where application.ai_interview_session_id = new.id and application.candidate_id = candidate.id);
  end if;
  return new;
end;
$$;

drop trigger if exists talent_public_campaign_session_sync on public.ai_interview_sessions;
create trigger talent_public_campaign_session_sync
after update of status, overall_score, ai_recommendation on public.ai_interview_sessions
for each row execute function public.sync_talent_public_campaign_application();

create or replace function public.get_owner_talent_campaign_dashboard(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.users platform_user
    where platform_user.auth_user_id = auth.uid() and platform_user.company_id is null
      and platform_user.is_active is true and lower(coalesce(platform_user.status, '')) = 'active'
      and platform_user.role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')) then
    raise exception using errcode = '42501', message = 'access denied';
  end if;
  select jsonb_build_object(
    'campaign', jsonb_build_object('id', campaign.id, 'slug', campaign.slug, 'name_en', campaign.name_en, 'name_ar', campaign.name_ar, 'status', campaign.status),
    'registered', count(application.id),
    'started', count(application.id) filter (where application.status in ('Opened','In Progress','Processing','Completed')),
    'completed', count(application.id) filter (where application.status = 'Completed'),
    'result_sharing_granted', count(application.id) filter (where application.result_sharing_consent is true),
    'applications', coalesce(jsonb_agg(jsonb_build_object(
      'id', application.id, 'candidate_reference', candidate.public_reference,
      'candidate_name', candidate.full_name, 'profession', application.profession,
      'status', application.status, 'result_sharing_consent', application.result_sharing_consent,
      'score', case when application.result_sharing_consent then session.overall_score else null end,
      'created_at', application.created_at
    ) order by application.created_at desc) filter (where application.id is not null), '[]'::jsonb)
  ) into v_result
  from public.talent_public_campaigns campaign
  left join public.talent_public_campaign_applications application on application.campaign_id = campaign.id
  left join public.talent_candidates candidate on candidate.id = application.candidate_id
  left join public.ai_interview_sessions session on session.id = application.ai_interview_session_id
  where campaign.slug = nullif(btrim(p_slug), '') group by campaign.id;
  return v_result;
end;
$$;

create or replace function public.get_company_talent_campaign_cv(p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_result jsonb;
begin
  if auth.uid() is null or v_company_id is null or not exists (
    select 1 from public.platform_clients client where client.operational_company_id = v_company_id
      and client.talent_access_enabled is true and lower(coalesce(client.subscription_status, '')) in ('active','trial')
  ) then raise exception using errcode = '42501', message = 'Active Talent access is required.'; end if;
  select jsonb_build_object('bucket', document.storage_bucket, 'path', document.storage_path,
    'file_name', document.file_name, 'mime_type', document.mime_type)
  into v_result from public.talent_candidates candidate
  join public.talent_public_campaign_applications application on application.candidate_id = candidate.id and application.cv_sharing_consent is true
  join public.talent_candidate_documents document on document.id = application.cv_document_id
  where candidate.id = p_candidate_id and candidate.marketplace_status = 'Approved'
    and candidate.published_at is not null and candidate.employer_sharing_consent is true
    and candidate.employer_contact_sharing_consent is true
  order by application.created_at desc limit 1;
  return v_result;
end;
$$;

drop policy if exists talent_cv_subscribed_company_read on storage.objects;
create policy talent_cv_subscribed_company_read on storage.objects for select to authenticated
using (bucket_id = 'talent-cv' and exists (
  select 1 from public.talent_candidate_documents document
  join public.talent_candidates candidate on candidate.id = document.candidate_id
  join public.talent_public_campaign_applications application on application.cv_document_id = document.id
  join public.platform_clients client on client.operational_company_id = public.current_app_user_company_id()
  where document.storage_path = storage.objects.name and application.cv_sharing_consent is true
    and candidate.marketplace_status = 'Approved' and candidate.published_at is not null
    and candidate.employer_sharing_consent is true and candidate.employer_contact_sharing_consent is true
    and client.talent_access_enabled is true and lower(coalesce(client.subscription_status, '')) in ('active','trial')
));

revoke all on function public.get_public_talent_campaign(text) from public;
grant execute on function public.get_public_talent_campaign(text) to anon, authenticated, service_role;
revoke all on function public.get_my_talent_campaign_application(text) from public, anon;
grant execute on function public.get_my_talent_campaign_application(text) to authenticated;
revoke all on function public.enroll_in_talent_campaign(text, uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.enroll_in_talent_campaign(text, uuid, boolean, text, jsonb) to authenticated;
revoke all on function public.update_my_talent_campaign_result_consent(text, boolean) from public, anon;
grant execute on function public.update_my_talent_campaign_result_consent(text, boolean) to authenticated;
revoke all on function public.get_owner_talent_campaign_dashboard(text) from public, anon;
grant execute on function public.get_owner_talent_campaign_dashboard(text) to authenticated;
revoke all on function public.get_company_talent_campaign_cv(uuid) from public, anon;
grant execute on function public.get_company_talent_campaign_cv(uuid) to authenticated;
