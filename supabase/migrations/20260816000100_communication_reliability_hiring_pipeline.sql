-- Reliable candidate communications and a tenant-scoped hiring pipeline.

alter table public.email_logs
  add column if not exists channel text not null default 'Email',
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists response_status text,
  add column if not exists response_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists max_retries integer not null default 3,
  add column if not exists primary_provider text,
  add column if not exists fallback_provider text,
  add column if not exists fallback_used_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists retry_claimed_at timestamptz;

alter table public.email_logs
  drop constraint if exists email_logs_response_status_check;
alter table public.email_logs
  add constraint email_logs_response_status_check
  check (response_status is null or response_status in ('Approved', 'Declined', 'Accepted', 'Rejected'));

create index if not exists email_logs_retry_queue_idx
  on public.email_logs(next_retry_at, created_at)
  where status = 'Failed' and next_retry_at is not null;

create or replace function public.schedule_failed_email_retry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'Failed' and new.retry_count < coalesce(new.max_retries, 3) then
    new.next_retry_at := coalesce(new.next_retry_at, now() + case new.retry_count when 0 then interval '2 minutes' when 1 then interval '10 minutes' else interval '30 minutes' end);
  elsif new.status in ('Sent', 'Delivered', 'Opened') then
    new.next_retry_at := null;
    new.retry_claimed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_failed_email_retry on public.email_logs;
create trigger schedule_failed_email_retry
before insert or update of status, retry_count on public.email_logs
for each row execute function public.schedule_failed_email_retry();

create or replace function public.claim_email_retry_jobs(p_limit integer default 10)
returns table (
  email_log_id uuid, message_type text, related_id text, company_id uuid,
  agency_id uuid, idempotency_key text, recipient text
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with jobs as (
    select log.id
    from public.email_logs log
    where log.status = 'Failed'
      and log.retry_count < coalesce(log.max_retries, 3)
      and coalesce(log.next_retry_at, now()) <= now()
      and (log.retry_claimed_at is null or log.retry_claimed_at < now() - interval '10 minutes')
      and log.event_type in ('AI_INTERVIEW_INVITATION', 'TALENT_INTERVIEW_INVITATION', 'IMPORTED_TALENT_INTERVIEW_INVITATION', 'AGENCY_USER_INVITATION')
      and nullif(log.related_id, '') is not null
      and nullif(log.idempotency_key, '') is not null
    order by log.next_retry_at, log.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 10), 1), 25)
  ), claimed as (
    update public.email_logs log
    set retry_claimed_at = now(), last_attempt_at = now()
    from jobs where log.id = jobs.id
    returning log.*
  )
  select claimed.id, claimed.event_type, claimed.related_id, claimed.company_id,
    claimed.agency_id, claimed.idempotency_key, coalesce(claimed.recipient, claimed.to_email)
  from claimed;
end;
$$;

create or replace function public.trigger_visaflow_email_retry_worker()
returns bigint
language plpgsql security definer set search_path = public, extensions, vault, net as $$
declare v_url text; v_secret text; v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'visaflow_email_retry_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'visaflow_email_retry_worker_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return null; end if;
  select net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-visaflow-retry-secret',v_secret),
    body := '{"max_jobs":10}'::jsonb, timeout_milliseconds := 300000) into v_request;
  return v_request;
end;
$$;

revoke all on function public.claim_email_retry_jobs(integer) from public, anon, authenticated;
revoke all on function public.trigger_visaflow_email_retry_worker() from public, anon, authenticated;
grant execute on function public.claim_email_retry_jobs(integer) to service_role;
grant execute on function public.trigger_visaflow_email_retry_worker() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'visaflow-email-retry-every-minute';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('visaflow-email-retry-every-minute', '* * * * *', 'select public.trigger_visaflow_email_retry_worker();');
end $$;

create table if not exists public.email_delivery_events (
  id bigint generated always as identity primary key,
  email_log_id uuid references public.email_logs(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_request_id uuid references public.talent_company_contact_requests(id) on delete cascade,
  event_type text not null,
  provider text,
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint email_delivery_event_type_check check (event_type in (
    'Queued', 'Sending', 'Sent', 'Delivered', 'Opened', 'Failed',
    'Retry Scheduled', 'Fallback Used', 'Approved', 'Declined', 'Duplicate Prevented'
  ))
);

create unique index if not exists email_delivery_provider_event_unique
  on public.email_delivery_events(provider, provider_event_id)
  where provider_event_id is not null;
create index if not exists email_delivery_events_company_time_idx
  on public.email_delivery_events(company_id, occurred_at desc);
create index if not exists email_delivery_events_contact_idx
  on public.email_delivery_events(contact_request_id, occurred_at desc)
  where contact_request_id is not null;

alter table public.email_delivery_events enable row level security;
revoke all on table public.email_delivery_events from public, anon, authenticated;

create or replace function public.capture_email_log_delivery_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := case when new.status in ('Queued', 'Sending', 'Sent', 'Delivered', 'Opened', 'Failed') then new.status else 'Queued' end;
  elsif new.status is distinct from old.status then
    v_event := case when new.status in ('Queued', 'Sending', 'Sent', 'Delivered', 'Opened', 'Failed') then new.status else null end;
  elsif new.opened_at is distinct from old.opened_at and new.opened_at is not null then
    v_event := 'Opened';
  elsif new.delivered_at is distinct from old.delivered_at and new.delivered_at is not null then
    v_event := 'Delivered';
  elsif new.response_status is distinct from old.response_status and new.response_status is not null then
    v_event := case when new.response_status = 'Approved' then 'Approved' when new.response_status = 'Declined' then 'Declined' else null end;
  end if;
  if v_event is not null then
    insert into public.email_delivery_events(email_log_id, company_id, event_type, provider, metadata)
    values (new.id, new.company_id, v_event, coalesce(new.provider, new.primary_provider),
      jsonb_build_object('retry_count', coalesce(new.retry_count, 0), 'channel', coalesce(new.channel, 'Email')));
  end if;
  if tg_op = 'UPDATE' and new.fallback_used_at is distinct from old.fallback_used_at and new.fallback_used_at is not null then
    insert into public.email_delivery_events(email_log_id, company_id, event_type, provider, metadata)
    values(new.id, new.company_id, 'Fallback Used', coalesce(new.fallback_provider, new.provider),
      jsonb_build_object('retry_count', coalesce(new.retry_count, 0), 'channel', coalesce(new.channel, 'Email')));
  end if;
  return new;
end;
$$;

drop trigger if exists capture_email_log_delivery_event on public.email_logs;
create trigger capture_email_log_delivery_event
after insert or update of status, delivered_at, opened_at, response_status on public.email_logs
for each row execute function public.capture_email_log_delivery_event();

alter table public.talent_company_contact_requests
  add column if not exists retry_count integer not null default 0,
  add column if not exists max_retries integer not null default 3,
  add column if not exists next_retry_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists primary_provider text not null default 'Primary SMTP',
  add column if not exists provider_used text,
  add column if not exists fallback_provider text default 'Fallback SMTP',
  add column if not exists fallback_used_at timestamptz,
  add column if not exists channel text not null default 'Email';

alter table public.talent_company_contact_requests
  drop constraint if exists talent_company_contact_email_status_check;
alter table public.talent_company_contact_requests
  add constraint talent_company_contact_email_status_check
  check (email_delivery_status in ('Queued', 'Sending', 'Sent', 'Delivered', 'Opened', 'Failed'));

create index if not exists talent_contact_retry_queue_idx
  on public.talent_company_contact_requests(next_retry_at, requested_at)
  where status = 'Pending' and email_delivery_status = 'Failed';

create or replace function public.capture_talent_contact_delivery_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'Queued';
  elsif new.status is distinct from old.status then
    v_event := case new.status when 'Approved' then 'Approved' when 'Declined' then 'Declined' else null end;
  elsif new.email_delivery_status is distinct from old.email_delivery_status then
    v_event := case when new.email_delivery_status in ('Queued', 'Sending', 'Sent', 'Delivered', 'Opened', 'Failed') then new.email_delivery_status else null end;
  elsif new.fallback_used_at is distinct from old.fallback_used_at and new.fallback_used_at is not null then
    v_event := 'Fallback Used';
  end if;
  if v_event is not null then
    insert into public.email_delivery_events(company_id, contact_request_id, event_type, provider, metadata)
    values (new.company_id, new.id, v_event, coalesce(new.provider_used, new.primary_provider),
      jsonb_build_object('retry_count', new.retry_count, 'prospect_id', new.prospect_id));
  end if;
  if tg_op = 'UPDATE' and new.fallback_used_at is distinct from old.fallback_used_at and new.fallback_used_at is not null then
    insert into public.email_delivery_events(company_id, contact_request_id, event_type, provider, metadata)
    values(new.company_id, new.id, 'Fallback Used', coalesce(new.fallback_provider, new.provider_used),
      jsonb_build_object('retry_count', new.retry_count, 'prospect_id', new.prospect_id));
  end if;
  return new;
end;
$$;

drop trigger if exists capture_talent_contact_delivery_event on public.talent_company_contact_requests;
create trigger capture_talent_contact_delivery_event
after insert or update of status, email_delivery_status, fallback_used_at on public.talent_company_contact_requests
for each row execute function public.capture_talent_contact_delivery_event();

create or replace function public.claim_talent_company_contact_email_job(p_worker text)
returns table (request_id uuid, decision_token uuid, recipient text, candidate_name text, company_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.talent_company_contact_requests request
  set email_delivery_status = 'Failed',
      email_error_message = 'Email worker claim expired.',
      next_retry_at = now() + interval '2 minutes',
      updated_at = now()
  where request.status = 'Pending'
    and request.email_delivery_status = 'Sending'
    and request.email_last_attempt_at < now() - interval '10 minutes';

  return query
  with next_job as (
    select request.id
    from public.talent_company_contact_requests request
    where request.status = 'Pending'
      and request.expires_at > now()
      and (
        request.email_delivery_status = 'Queued'
        or (
          request.email_delivery_status = 'Failed'
          and request.retry_count < request.max_retries
          and coalesce(request.next_retry_at, now()) <= now()
        )
      )
    order by coalesce(request.next_retry_at, request.requested_at), request.created_at
    for update skip locked
    limit 1
  ), claimed as (
    update public.talent_company_contact_requests request
    set email_delivery_status = 'Sending',
        email_last_attempt_at = now(),
        next_retry_at = null,
        updated_at = now()
    from next_job job
    where request.id = job.id
    returning request.*
  )
  select claimed.id, claimed.decision_token, prospect.email, prospect.full_name, claimed.company_name_snapshot
  from claimed
  join public.talent_imported_prospects prospect on prospect.id = claimed.prospect_id;
end;
$$;

create or replace function public.complete_talent_company_contact_email_v2(
  p_request_id uuid, p_provider_id text, p_provider text, p_fallback_used boolean default false
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.talent_company_contact_requests
  set email_delivery_status = 'Sent',
      email_provider_message_id = nullif(btrim(p_provider_id), ''),
      provider_used = nullif(btrim(p_provider), ''),
      fallback_used_at = case when p_fallback_used then now() else fallback_used_at end,
      email_error_message = null,
      next_retry_at = null,
      updated_at = now()
  where id = p_request_id;
$$;

create or replace function public.fail_talent_company_contact_email(p_request_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.talent_company_contact_requests
  set email_delivery_status = 'Failed',
      retry_count = retry_count + 1,
      next_retry_at = case retry_count
        when 0 then now() + interval '2 minutes'
        when 1 then now() + interval '10 minutes'
        else now() + interval '30 minutes'
      end,
      email_error_message = left(coalesce(p_error, 'send_failed'), 1000),
      updated_at = now()
  where id = p_request_id;
$$;

create or replace function public.record_talent_contact_email_open(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_token uuid;
begin
  begin v_token := p_token::uuid;
  exception when invalid_text_representation then return false;
  end;
  update public.talent_company_contact_requests request
  set opened_at = coalesce(request.opened_at, now()),
      delivered_at = coalesce(request.delivered_at, now()),
      email_delivery_status = case when request.email_delivery_status in ('Sent', 'Delivered') then 'Opened' else request.email_delivery_status end,
      updated_at = now()
  where request.decision_token = v_token and request.expires_at > now();
  return found;
end;
$$;

create or replace function public.record_email_provider_event(
  p_provider_message_id text, p_event_type text, p_provider_event_id text default null, p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_log public.email_logs;
begin
  if p_event_type not in ('Delivered', 'Opened', 'Failed') then
    raise exception using errcode = '22023', message = 'Unsupported provider event.';
  end if;
  select log.* into v_log from public.email_logs log
  where coalesce(log.provider_message_id, log.message_id) = p_provider_message_id
  order by log.created_at desc limit 1;
  if v_log.id is null then return false; end if;
  if p_provider_event_id is not null and exists (
    select 1 from public.email_delivery_events event
    where event.provider = coalesce(v_log.provider, v_log.primary_provider)
      and event.provider_event_id = p_provider_event_id
  ) then return true; end if;
  update public.email_logs set
    status = p_event_type,
    delivered_at = case when p_event_type in ('Delivered', 'Opened') then coalesce(delivered_at, now()) else delivered_at end,
    opened_at = case when p_event_type = 'Opened' then coalesce(opened_at, now()) else opened_at end,
    failed_at = case when p_event_type = 'Failed' then now() else failed_at end
  where id = v_log.id;
  if p_provider_event_id is not null then
    update public.email_delivery_events
    set provider_event_id = p_provider_event_id, metadata = coalesce(p_metadata, '{}'::jsonb)
    where id = (select max(id) from public.email_delivery_events where email_log_id = v_log.id and event_type = p_event_type);
  end if;
  return true;
end;
$$;

revoke all on function public.record_talent_contact_email_open(text) from public;
grant execute on function public.record_talent_contact_email_open(text) to anon, authenticated, service_role;
revoke all on function public.complete_talent_company_contact_email_v2(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.record_email_provider_event(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_talent_company_contact_email_v2(uuid, text, text, boolean) to service_role;
grant execute on function public.record_email_provider_event(text, text, text, jsonb) to service_role;

create or replace function public.fail_claimed_email_retry(p_email_log_id uuid, p_error text)
returns void
language sql security definer set search_path = '' as $$
  update public.email_logs
  set status = 'Failed', retry_count = retry_count + 1,
      retry_claimed_at = null, next_retry_at = null,
      error_code = 'retry_handoff_failed',
      error_message = left(coalesce(p_error, 'retry_handoff_failed'), 1000),
      failed_at = now(), last_attempt_at = now()
  where id = p_email_log_id and status = 'Failed';
$$;
revoke all on function public.fail_claimed_email_retry(uuid,text) from public, anon, authenticated;
grant execute on function public.fail_claimed_email_retry(uuid,text) to service_role;

drop function if exists public.email_log_list_v1();
create function public.email_log_list_v1()
returns table (
  id uuid, company_id uuid, agency_id uuid, user_id bigint,
  event_type text, type text, status text, recipient text, to_email text,
  subject text, provider text, provider_message_id text, message_id text,
  error_code text, error_message text, retry_count integer,
  created_at timestamptz, sent_at timestamptz, failed_at timestamptz,
  delivered_at timestamptz, opened_at timestamptz, response_status text,
  response_at timestamptz, next_retry_at timestamptz, max_retries integer,
  channel text, primary_provider text, fallback_provider text, fallback_used_at timestamptz
)
language plpgsql security definer stable set search_path = '' as $$
declare actor public.users%rowtype;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active' and app_user.is_active is true
    and app_user.company_id is not null
    and app_user.role not in ('Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User');
  if actor.id is null then raise exception 'EMAIL_LOG_UNAUTHORIZED'; end if;
  return query
  select log.id, log.company_id, log.agency_id, log.user_id,
    log.event_type, log.type, log.status,
    case when actor.role in ('Admin', 'Company Admin') then coalesce(log.recipient, log.to_email)
      when position('@' in coalesce(log.recipient, log.to_email, '')) > 1 then left(split_part(coalesce(log.recipient, log.to_email), '@', 1), 2) || '***@' || split_part(coalesce(log.recipient, log.to_email), '@', 2) else null end,
    case when actor.role in ('Admin', 'Company Admin') then log.to_email
      when position('@' in coalesce(log.to_email, log.recipient, '')) > 1 then left(split_part(coalesce(log.to_email, log.recipient), '@', 1), 2) || '***@' || split_part(coalesce(log.to_email, log.recipient), '@', 2) else null end,
    log.subject, log.provider, log.provider_message_id, log.message_id,
    case when log.status = 'Failed' then log.error_code else null end,
    case when log.status = 'Failed' and log.error_message is not null then 'Email delivery failed at the provider.' else null end,
    log.retry_count, log.created_at, log.sent_at,
    case when log.status = 'Failed' then log.failed_at else null end,
    log.delivered_at, log.opened_at, log.response_status, log.response_at,
    log.next_retry_at, log.max_retries, log.channel, log.primary_provider,
    log.fallback_provider, log.fallback_used_at
  from public.email_logs log
  where log.company_id = actor.company_id
  order by log.created_at desc
  limit 500;
end;
$$;
revoke all on function public.email_log_list_v1() from public, anon;
grant execute on function public.email_log_list_v1() to authenticated;

create table if not exists public.company_hiring_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_code text not null,
  title text not null,
  department text,
  location text,
  source text not null default 'VisaFlow',
  external_job_id text,
  status text not null default 'Active',
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_hiring_job_status_check check (status in ('Draft', 'Active', 'Paused', 'Closed')),
  constraint company_hiring_job_unique unique(company_id, job_code)
);

create table if not exists public.company_hiring_pipeline (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.company_hiring_jobs(id) on delete cascade,
  candidate_source text not null,
  candidate_id uuid not null,
  stage text not null default 'Applicant',
  stage_entered_at timestamptz not null default now(),
  owner_auth_user_id uuid,
  notes text,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_hiring_candidate_source_check check (candidate_source in ('Registered Talent', 'Imported Talent', 'Company Candidate')),
  constraint company_hiring_stage_check check (stage in ('Applicant', 'Screening', 'Contact Requested', 'Interview', 'Offer', 'Hired', 'Rejected')),
  constraint company_hiring_pipeline_unique unique(company_id, job_id, candidate_source, candidate_id)
);

create table if not exists public.company_hiring_pipeline_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  application_id uuid not null references public.company_hiring_pipeline(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  note text,
  changed_by_auth_user_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists company_hiring_jobs_company_status_idx on public.company_hiring_jobs(company_id, status, created_at desc);
create index if not exists company_hiring_pipeline_job_stage_idx on public.company_hiring_pipeline(company_id, job_id, stage, stage_entered_at desc);

alter table public.company_hiring_jobs enable row level security;
alter table public.company_hiring_pipeline enable row level security;
alter table public.company_hiring_pipeline_events enable row level security;
revoke all on public.company_hiring_jobs, public.company_hiring_pipeline, public.company_hiring_pipeline_events from public, anon, authenticated;

create or replace function public.create_company_hiring_job(
  p_title text, p_department text default null, p_location text default null,
  p_source text default 'VisaFlow', p_external_job_id text default null, p_job_code text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_job_id uuid; v_code text;
begin
  if auth.uid() is null or v_company_id is null or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  if nullif(btrim(p_title), '') is null then raise exception using errcode = '22023', message = 'Job title is required.'; end if;
  v_code := coalesce(nullif(btrim(p_job_code), ''), 'JOB-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
  insert into public.company_hiring_jobs(company_id, job_code, title, department, location, source, external_job_id, created_by_auth_user_id)
  values(v_company_id, v_code, btrim(p_title), nullif(btrim(p_department), ''), nullif(btrim(p_location), ''), coalesce(nullif(btrim(p_source), ''), 'VisaFlow'), nullif(btrim(p_external_job_id), ''), auth.uid())
  returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.add_talent_candidate_to_hiring_pipeline(p_job_id uuid, p_candidate_source text, p_candidate_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_application public.company_hiring_pipeline; v_inserted boolean := false;
begin
  if auth.uid() is null or v_company_id is null or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  if not exists(select 1 from public.company_hiring_jobs job where job.id = p_job_id and job.company_id = v_company_id and job.status = 'Active') then
    raise exception using errcode = 'P0002', message = 'Active hiring job was not found.';
  end if;
  if p_candidate_source = 'Registered Talent' then
    if not exists(select 1 from public.talent_candidates candidate where candidate.id = p_candidate_id and candidate.marketplace_status = 'Approved' and candidate.is_verified is true) then
      raise exception using errcode = 'P0002', message = 'Talent candidate was not found.';
    end if;
  elsif p_candidate_source = 'Imported Talent' then
    if not exists(select 1 from public.talent_imported_prospects prospect where prospect.id = p_candidate_id and prospect.marketplace_profile_consent is true and prospect.claimed_candidate_id is null) then
      raise exception using errcode = 'P0002', message = 'Imported Talent candidate was not found.';
    end if;
  elsif p_candidate_source = 'Company Candidate' then
    if not exists(select 1 from public.candidates candidate where candidate.id = p_candidate_id and candidate.company_id = v_company_id) then
      raise exception using errcode = 'P0002', message = 'Company candidate was not found.';
    end if;
  else raise exception using errcode = '22023', message = 'Unsupported candidate source.';
  end if;
  insert into public.company_hiring_pipeline(company_id, job_id, candidate_source, candidate_id, created_by_auth_user_id)
  values(v_company_id, p_job_id, p_candidate_source, p_candidate_id, auth.uid())
  on conflict(company_id, job_id, candidate_source, candidate_id) do nothing
  returning * into v_application;
  if v_application.id is not null then v_inserted := true;
  else select application.* into v_application from public.company_hiring_pipeline application
    where application.company_id = v_company_id and application.job_id = p_job_id and application.candidate_source = p_candidate_source and application.candidate_id = p_candidate_id;
  end if;
  return jsonb_build_object('application_id', v_application.id, 'stage', v_application.stage, 'inserted', v_inserted, 'duplicate_prevented', not v_inserted);
end;
$$;

create or replace function public.move_company_hiring_stage(p_application_id uuid, p_to_stage text, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_application public.company_hiring_pipeline; v_allowed boolean := false;
begin
  if auth.uid() is null or v_company_id is null or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  select application.* into v_application from public.company_hiring_pipeline application
  where application.id = p_application_id and application.company_id = v_company_id for update;
  if v_application.id is null then raise exception using errcode = 'P0002', message = 'Pipeline application was not found.'; end if;
  v_allowed := case v_application.stage
    when 'Applicant' then p_to_stage in ('Screening','Rejected')
    when 'Screening' then p_to_stage in ('Contact Requested','Rejected')
    when 'Contact Requested' then p_to_stage in ('Interview','Rejected')
    when 'Interview' then p_to_stage in ('Offer','Rejected')
    when 'Offer' then p_to_stage in ('Hired','Rejected')
    else false end;
  if not v_allowed then raise exception using errcode = '22023', message = 'Invalid hiring stage transition.'; end if;
  update public.company_hiring_pipeline set stage = p_to_stage, stage_entered_at = now(), notes = coalesce(nullif(btrim(p_note), ''), notes), updated_at = now()
  where id = v_application.id;
  insert into public.company_hiring_pipeline_events(company_id, application_id, from_stage, to_stage, note, changed_by_auth_user_id)
  values(v_company_id, v_application.id, v_application.stage, p_to_stage, nullif(btrim(p_note), ''), auth.uid());
  return p_to_stage;
end;
$$;

create or replace function public.list_company_hiring_pipeline()
returns jsonb
language plpgsql security definer stable set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_jobs jsonb; v_applications jsonb;
begin
  if auth.uid() is null or v_company_id is null then raise exception using errcode = '42501', message = 'Company authentication is required.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', job.id, 'job_code', job.job_code, 'title', job.title, 'department', job.department, 'location', job.location, 'source', job.source, 'external_job_id', job.external_job_id, 'status', job.status, 'created_at', job.created_at) order by job.created_at desc), '[]'::jsonb)
  into v_jobs from public.company_hiring_jobs job where job.company_id = v_company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', application.id, 'job_id', application.job_id, 'candidate_source', application.candidate_source,
    'candidate_id', application.candidate_id, 'stage', application.stage, 'stage_entered_at', application.stage_entered_at,
    'notes', application.notes, 'created_at', application.created_at,
    'candidate_name', case application.candidate_source
      when 'Registered Talent' then coalesce(case when registered.employer_contact_sharing_consent then registered.full_name end, registered.public_reference, 'Confidential candidate')
      when 'Imported Talent' then coalesce(case when contact.status = 'Approved' then imported.full_name end, 'VF-IMP-' || upper(substr(replace(imported.id::text, '-', ''), 1, 10)))
      else coalesce(company_candidate.candidate_name, 'Candidate') end,
    'profession', coalesce(registered.profession, imported.current_title, imported.source_job_title, company_candidate.profession),
    'contact_status', case application.candidate_source when 'Registered Talent' then case when registered.employer_contact_sharing_consent then 'Shared' else 'Private' end when 'Imported Talent' then coalesce(contact.status, 'Private') else 'Shared' end
  ) order by application.updated_at desc), '[]'::jsonb)
  into v_applications
  from public.company_hiring_pipeline application
  left join public.talent_candidates registered on application.candidate_source = 'Registered Talent' and registered.id = application.candidate_id
  left join public.talent_imported_prospects imported on application.candidate_source = 'Imported Talent' and imported.id = application.candidate_id
  left join public.talent_company_contact_requests contact on application.candidate_source = 'Imported Talent' and contact.company_id = v_company_id and contact.prospect_id = application.candidate_id
  left join public.candidates company_candidate on application.candidate_source = 'Company Candidate' and company_candidate.company_id = v_company_id and company_candidate.id = application.candidate_id
  where application.company_id = v_company_id;
  return jsonb_build_object('jobs', v_jobs, 'applications', v_applications);
end;
$$;

revoke all on function public.create_company_hiring_job(text,text,text,text,text,text) from public, anon;
revoke all on function public.add_talent_candidate_to_hiring_pipeline(uuid,text,uuid) from public, anon;
revoke all on function public.move_company_hiring_stage(uuid,text,text) from public, anon;
revoke all on function public.list_company_hiring_pipeline() from public, anon;
grant execute on function public.create_company_hiring_job(text,text,text,text,text,text) to authenticated;
grant execute on function public.add_talent_candidate_to_hiring_pipeline(uuid,text,uuid) to authenticated;
grant execute on function public.move_company_hiring_stage(uuid,text,text) to authenticated;
grant execute on function public.list_company_hiring_pipeline() to authenticated;

create table if not exists public.talent_imported_interview_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  prospect_id uuid not null references public.talent_imported_prospects(id) on delete cascade,
  requested_by_auth_user_id uuid not null,
  interview_type text not null,
  scheduled_at timestamptz not null,
  timezone text not null default 'Asia/Riyadh',
  meeting_url text,
  location text,
  notes text,
  status text not null default 'Scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint talent_imported_interview_type_check check (interview_type in ('Online Video','Phone','In Person')),
  constraint talent_imported_interview_status_check check (status in ('Scheduled','Accepted','Declined','Completed','Cancelled')),
  constraint talent_imported_interview_destination_check check (
    (interview_type = 'Online Video' and nullif(btrim(meeting_url), '') is not null)
    or (interview_type = 'In Person' and nullif(btrim(location), '') is not null)
    or interview_type = 'Phone'
  )
);

create index if not exists talent_imported_interviews_company_prospect_idx
  on public.talent_imported_interview_invitations(company_id, prospect_id, scheduled_at desc);
alter table public.talent_imported_interview_invitations enable row level security;
revoke all on table public.talent_imported_interview_invitations from public, anon, authenticated;

create or replace function public.schedule_imported_talent_interview(
  p_prospect_id uuid, p_interview_type text, p_scheduled_at timestamptz,
  p_meeting_url text default null, p_location text default null, p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company_id uuid := public.current_app_user_company_id(); v_invitation_id uuid;
begin
  if auth.uid() is null or v_company_id is null or not public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager','Recruitment Officer','HR/Recruitment']) then
    raise exception using errcode = '42501', message = 'Recruitment permission is required.';
  end if;
  if p_scheduled_at <= now() then raise exception using errcode = '22023', message = 'Interview time must be in the future.'; end if;
  if p_interview_type not in ('Online Video','Phone','In Person') then raise exception using errcode = '22023', message = 'Invalid interview type.'; end if;
  if p_interview_type = 'Online Video' and (nullif(btrim(p_meeting_url), '') is null or btrim(p_meeting_url) !~* '^https://') then
    raise exception using errcode = '22023', message = 'A secure meeting link is required.';
  end if;
  if p_interview_type = 'In Person' and nullif(btrim(p_location), '') is null then raise exception using errcode = '22023', message = 'Interview location is required.'; end if;
  if not exists(
    select 1 from public.talent_company_contact_requests request
    join public.talent_imported_prospects prospect on prospect.id = request.prospect_id
    where request.company_id = v_company_id and request.prospect_id = p_prospect_id
      and request.status = 'Approved' and nullif(btrim(prospect.email), '') is not null
  ) then raise exception using errcode = '42501', message = 'Candidate contact approval is required.'; end if;
  insert into public.talent_imported_interview_invitations(company_id, prospect_id, requested_by_auth_user_id, interview_type, scheduled_at, meeting_url, location, notes)
  values(v_company_id, p_prospect_id, auth.uid(), p_interview_type, p_scheduled_at, nullif(btrim(p_meeting_url), ''), nullif(btrim(p_location), ''), nullif(btrim(p_notes), ''))
  returning id into v_invitation_id;
  return v_invitation_id;
end;
$$;

revoke all on function public.schedule_imported_talent_interview(uuid,text,timestamptz,text,text,text) from public, anon;
grant execute on function public.schedule_imported_talent_interview(uuid,text,timestamptz,text,text,text) to authenticated;
