-- Guest CVs are explicitly consented, published profiles, not verified identities.
begin;
alter table public.talent_candidates alter column auth_user_id drop not null;

create table public.talent_guest_submissions (
  request_id uuid primary key,
  candidate_id uuid not null unique references public.talent_candidates(id) on delete cascade,
  document_id uuid not null unique references public.talent_candidate_documents(id) on delete cascade,
  consent_version text not null default 'guest-cv-2026-11-21',
  consent_at timestamptz not null default now(),
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);
alter table public.talent_guest_submissions enable row level security;
revoke all on public.talent_guest_submissions from public, anon, authenticated;
grant all on public.talent_guest_submissions to service_role;

create table public.talent_guest_rate_limits (
  key text primary key, window_start timestamptz not null, attempts integer not null
);
alter table public.talent_guest_rate_limits enable row level security;
revoke all on public.talent_guest_rate_limits from public, anon, authenticated;
grant all on public.talent_guest_rate_limits to service_role;

create function public.claim_guest_cv_attempt(p_key text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_global integer;
begin
  if p_key !~ '^[a-f0-9]{64}$' then return false; end if;
  -- One lock serializes quota decisions, including concurrent callers.
  perform pg_advisory_xact_lock(21112026);
  delete from public.talent_guest_rate_limits where window_start < now() - interval '2 hours';
  insert into public.talent_guest_rate_limits values ('global', date_trunc('hour', now()), 1)
  on conflict (key) do update set
    attempts = case when talent_guest_rate_limits.window_start = date_trunc('hour', now()) then talent_guest_rate_limits.attempts + 1 else 1 end,
    window_start = date_trunc('hour', now()) returning attempts into v_global;
  insert into public.talent_guest_rate_limits values (p_key, date_trunc('hour', now()), 1)
  on conflict (key) do update set
    attempts = case when talent_guest_rate_limits.window_start = date_trunc('hour', now()) then talent_guest_rate_limits.attempts + 1 else 1 end,
    window_start = date_trunc('hour', now()) returning attempts into v_count;
  return v_count <= 5 and v_global <= 100;
end $$;
revoke all on function public.claim_guest_cv_attempt(text) from public, anon, authenticated;
grant execute on function public.claim_guest_cv_attempt(text) to service_role;

create function public.is_consented_guest_cv(p_candidate_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.talent_guest_submissions where candidate_id = p_candidate_id)
$$;
revoke all on function public.is_consented_guest_cv(uuid) from public, anon, authenticated;
grant execute on function public.is_consented_guest_cv(uuid) to service_role;

create function public.publish_guest_cv(p_request_id uuid, p_candidate_id uuid, p_data jsonb,
  p_path text, p_filename text, p_mime text, p_size bigint, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_document uuid; v_reference text;
begin
  if p_data->>'consent' is distinct from 'yes' or p_size not between 1 and 10485760
    or p_path not like 'guest/' || p_candidate_id::text || '/%'
    or p_mime not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or length(btrim(p_data->>'full_name')) not between 2 and 160
    or coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then raise exception 'Invalid guest submission'; end if;
  perform set_config('visaflow.talent_internal_update', '1', true);
  insert into public.talent_candidates (id, auth_user_id, full_name, email, phone, profession,
    headline, city, years_experience, marketplace_status, profile_visibility,
    employer_sharing_consent, employer_contact_sharing_consent, published_at, submitted_at,
    is_verified, ai_cv_status)
  values (p_candidate_id, null, btrim(p_data->>'full_name'), lower(btrim(p_data->>'email')),
    p_data->>'phone', p_data->>'profession', p_data->>'profession', p_data->>'location',
    (p_data->>'years_experience')::numeric, 'Approved', 'Public', true, true, now(), now(), false, 'Pending')
  returning public_reference into v_reference;
  insert into public.talent_candidate_documents(candidate_id,file_name,storage_path,mime_type,size_bytes)
  values(p_candidate_id,p_filename,p_path,p_mime,p_size) returning id into v_document;
  insert into public.talent_guest_submissions(request_id,candidate_id,document_id,fingerprint)
  values(p_request_id,p_candidate_id,v_document,p_fingerprint);
  insert into public.talent_candidate_consents(candidate_id,consent_type,consent_version,is_granted,granted_at,source,metadata)
  values(p_candidate_id,'Employer Sharing','guest-cv-2026-11-21',true,now(),'Public CV Upload',
    '{"cv_sharing":true,"contact_sharing":true,"identity_verified":false}'::jsonb);
  return jsonb_build_object('reference',v_reference);
end $$;
revoke all on function public.publish_guest_cv(uuid,uuid,jsonb,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.publish_guest_cv(uuid,uuid,jsonb,text,text,text,bigint,text) to service_role;

-- Extend existing marketplace queries in place, retaining tenant limits, filters,
-- imported profiles and any production fixes. Abort if the expected contract drifted.
do $$
declare v_proc record; v_sql text; v_count integer := 0;
begin
  for v_proc in select oid, proname from pg_proc where pronamespace='public'::regnamespace
    and proname in ('list_company_talent_marketplace_page','list_company_talent_marketplace_filtered_page')
  loop
    v_sql := pg_get_functiondef(v_proc.oid);
    if position('candidate.is_verified is true' in v_sql)=0 or position('coalesce(cv.available, false)' in v_sql)=0 then
      raise exception 'Guest CV migration: marketplace contract changed: %',v_proc.proname;
    end if;
    v_sql := replace(v_sql, 'candidate.is_verified is true',
      '(candidate.is_verified is true or public.is_consented_guest_cv(candidate.id))');
    v_sql := replace(v_sql, 'coalesce(cv.available, false)',
      '(coalesce(cv.available, false) or public.is_consented_guest_cv(candidate.id))');
    v_sql := replace(v_sql, '''profile_source'', ''Candidate Profile''',
      '''profile_source'', case when public.is_consented_guest_cv(candidate.id) then ''Guest CV'' else ''Candidate Profile'' end');
    v_sql := replace(v_sql, '''Registered''::text profile_source_filter',
      'case when public.is_consented_guest_cv(candidate.id) then ''Guest'' else ''Registered'' end::text profile_source_filter');
    execute v_sql;
    v_count := v_count + 1;
  end loop;
  if v_count <> 2 then raise exception 'Expected both marketplace RPCs'; end if;
end $$;

alter function public.get_company_talent_campaign_cv(uuid) rename to get_company_talent_campaign_cv_before_guest;
revoke all on function public.get_company_talent_campaign_cv_before_guest(uuid) from public, anon, authenticated;
create function public.get_company_talent_campaign_cv(p_candidate_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  -- The original function enforces company membership and Talent entitlement.
  v_result := public.get_company_talent_campaign_cv_before_guest(p_candidate_id);
  if v_result is not null then return v_result; end if;
  select jsonb_build_object('bucket',d.storage_bucket,'path',d.storage_path,'file_name',d.file_name,'mime_type',d.mime_type)
  into v_result from public.talent_guest_submissions g
  join public.talent_candidates c on c.id=g.candidate_id
  join public.talent_candidate_documents d on d.id=g.document_id
  where c.id=p_candidate_id and c.marketplace_status='Approved' and c.published_at is not null
    and c.profile_visibility='Public' and c.employer_sharing_consent and c.employer_contact_sharing_consent;
  return v_result;
end $$;
revoke all on function public.get_company_talent_campaign_cv(uuid) from public, anon;
grant execute on function public.get_company_talent_campaign_cv(uuid) to authenticated,service_role;

alter function public.can_current_company_read_talent_cv(text) rename to can_current_company_read_talent_cv_before_guest;
revoke all on function public.can_current_company_read_talent_cv_before_guest(text) from public,anon,authenticated;
create function public.can_current_company_read_talent_cv(p_storage_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_current_company_read_talent_cv_before_guest(p_storage_path) or (
    auth.uid() is not null and exists (
      select 1 from public.talent_guest_submissions g
      join public.talent_candidates c on c.id=g.candidate_id
      join public.talent_candidate_documents d on d.id=g.document_id
      join public.platform_clients client on client.operational_company_id=public.current_app_user_company_id()
      where d.storage_path=p_storage_path and d.storage_bucket='talent-cv'
        and c.marketplace_status='Approved' and c.published_at is not null and c.profile_visibility='Public'
        and c.employer_sharing_consent and c.employer_contact_sharing_consent
        and client.talent_access_enabled and lower(coalesce(client.subscription_status,'')) in ('active','trial')
    )
  )
$$;
revoke all on function public.can_current_company_read_talent_cv(text) from public,anon;
grant execute on function public.can_current_company_read_talent_cv(text) to authenticated,service_role;
drop policy if exists talent_cv_subscribed_company_read on storage.objects;
create policy talent_cv_subscribed_company_read on storage.objects for select to authenticated
using(bucket_id='talent-cv' and public.can_current_company_read_talent_cv(name));
commit;
