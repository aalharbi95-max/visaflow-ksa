-- Agency provisioning state, tenant policies, and transactional RPCs.
-- Auth invitation itself remains outside PostgreSQL and is handled as a saga.

begin;

create table if not exists public.agency_provisioning_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  agency_id uuid null references public.agencies(id) on delete restrict,
  requested_by_user_id bigint not null references public.users(id) on delete restrict,
  requested_by_auth_user_id uuid not null references auth.users(id) on delete restrict,
  agency_name text not null,
  country text null,
  contact_person text null,
  admin_email text not null,
  phone text null,
  permissions jsonb not null default '{}'::jsonb,
  send_invitation boolean not null default true,
  status text not null default 'Draft',
  auth_user_id uuid null references auth.users(id) on delete restrict,
  public_user_id bigint null references public.users(id) on delete restrict,
  attempt_count integer not null default 0,
  failure_code text null,
  failure_metadata jsonb not null default '{}'::jsonb,
  invitation_sent_at timestamptz null,
  activated_at timestamptz null,
  failed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_provisioning_requests_status_check check (
    status in (
      'Draft', 'Provisioning', 'Invitation Sent',
      'Active', 'Failed', 'Suspended'
    )
  ),
  constraint agency_provisioning_requests_company_idempotency_key
    unique (company_id, idempotency_key)
);

create unique index if not exists agency_provisioning_active_email_unique
  on public.agency_provisioning_requests (
    company_id,
    lower(btrim(admin_email))
  )
  where status in ('Draft', 'Provisioning', 'Invitation Sent');

create index if not exists agency_provisioning_requests_company_status_idx
  on public.agency_provisioning_requests (company_id, status, created_at desc);
create index if not exists agency_provisioning_requests_auth_user_idx
  on public.agency_provisioning_requests (auth_user_id)
  where auth_user_id is not null;

create table if not exists public.agency_provisioning_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null
    references public.agency_provisioning_requests(id) on delete cascade,
  event_key text not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  agency_id uuid null references public.agencies(id) on delete restrict,
  actor_user_id bigint null references public.users(id) on delete restrict,
  actor_auth_user_id uuid null references auth.users(id) on delete restrict,
  event_type text not null,
  from_status text null,
  to_status text null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agency_provisioning_events_request_event_key
    unique (request_id, event_key)
);

create index if not exists agency_provisioning_events_company_request_idx
  on public.agency_provisioning_events (company_id, request_id, created_at);

alter table public.agency_provisioning_requests enable row level security;
alter table public.agency_provisioning_events enable row level security;

revoke all on table public.agency_provisioning_requests
  from public, anon, authenticated;
revoke all on table public.agency_provisioning_events
  from public, anon, authenticated;
grant select on table public.agency_provisioning_requests to authenticated;
grant select on table public.agency_provisioning_events to authenticated;

drop policy if exists agency_provisioning_requests_tenant_select
  on public.agency_provisioning_requests;
drop policy if exists agency_provisioning_events_tenant_select
  on public.agency_provisioning_events;

create policy agency_provisioning_requests_tenant_select
on public.agency_provisioning_requests
for select to authenticated
using (
  company_id::text = public.current_agency_access_actor()->>'company_id'
  or auth_user_id = auth.uid()
  or (
    public.current_agency_access_actor()->>'role'
      in ('Platform Owner', 'Platform Accounts User')
    and public.current_agency_access_actor()->>'company_id' is null
  )
);

create policy agency_provisioning_events_tenant_select
on public.agency_provisioning_events
for select to authenticated
using (
  company_id::text = public.current_agency_access_actor()->>'company_id'
  or exists (
    select 1
    from public.agency_provisioning_requests as request
    where request.id = agency_provisioning_events.request_id
      and request.auth_user_id = auth.uid()
  )
  or (
    public.current_agency_access_actor()->>'role'
      in ('Platform Owner', 'Platform Accounts User')
    and public.current_agency_access_actor()->>'company_id' is null
  )
);

do $status_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_agency_access_provisioning_status_check'
      and conrelid = 'public.company_agency_access'::regclass
  ) then
    alter table public.company_agency_access
      add constraint company_agency_access_provisioning_status_check
      check (
        status in (
          'Provisioning', 'Invitation Sent', 'Active',
          'Failed', 'Suspended', 'Inactive'
        )
      ) not valid;
    alter table public.company_agency_access
      validate constraint company_agency_access_provisioning_status_check;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'agency_company_user_access_provisioning_status_check'
      and conrelid = 'public.agency_company_user_access'::regclass
  ) then
    alter table public.agency_company_user_access
      add constraint agency_company_user_access_provisioning_status_check
      check (
        status in (
          'Provisioning', 'Invitation Sent', 'Active',
          'Failed', 'Suspended', 'Inactive'
        )
      ) not valid;
    alter table public.agency_company_user_access
      validate constraint agency_company_user_access_provisioning_status_check;
  end if;
end;
$status_constraints$;

create or replace function public.guard_agency_company_user_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  user_role text;
  user_agency_id uuid;
begin
  if new.company_id is null or new.agency_id is null or new.user_id is null then
    raise exception
      'SECURITY BLOCK: company_id, agency_id, and user_id are required for agency user access.';
  end if;

  select app_user.role, app_user.agency_id
  into user_role, user_agency_id
  from public.users as app_user
  where app_user.id = new.user_id;

  if user_role is null or user_role <> 'Agency' then
    raise exception
      'SECURITY BLOCK: only Agency role users can be granted agency workspace access.';
  end if;
  if user_agency_id is null or user_agency_id <> new.agency_id then
    raise exception
      'SECURITY BLOCK: Agency user agency_id must match the granted agency_id.';
  end if;
  if not exists (
    select 1
    from public.company_agency_access as access
    where access.company_id = new.company_id
      and access.agency_id = new.agency_id
      and access.status in ('Provisioning', 'Invitation Sent', 'Active')
  ) then
    raise exception
      'SECURITY BLOCK: matching company_agency_access is required before agency user access.';
  end if;
  if new.status = 'Active' and not exists (
    select 1
    from public.company_agency_access as access
    where access.company_id = new.company_id
      and access.agency_id = new.agency_id
      and access.status = 'Active'
  ) then
    raise exception
      'SECURITY BLOCK: active agency user access requires active company agency access.';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_agency_company_user_access()
  from public, anon, authenticated;
grant execute on function public.guard_agency_company_user_access()
  to service_role;

create or replace function public.agency_provisioning_public_result(
  request_row public.agency_provisioning_requests
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', request_row.id,
    'idempotency_key', request_row.idempotency_key,
    'company_id', request_row.company_id,
    'agency_id', request_row.agency_id,
    'agency_name', request_row.agency_name,
    'country', request_row.country,
    'contact_person', request_row.contact_person,
    'admin_email', request_row.admin_email,
    'phone', request_row.phone,
    'permissions', request_row.permissions,
    'send_invitation', request_row.send_invitation,
    'status', request_row.status,
    'attempt_count', request_row.attempt_count,
    'failure_code', request_row.failure_code,
    'invitation_sent_at', request_row.invitation_sent_at,
    'activated_at', request_row.activated_at,
    'failed_at', request_row.failed_at,
    'created_at', request_row.created_at,
    'updated_at', request_row.updated_at
  );
$function$;

create or replace function public.agency_provisioning_create_draft(
  p_actor_auth_user_id uuid,
  p_idempotency_key uuid,
  p_agency_name text,
  p_country text,
  p_contact_person text,
  p_admin_email text,
  p_phone text,
  p_permissions jsonb,
  p_send_invitation boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
  normalized_permissions jsonb;
begin
  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true;

  if actor.id is null
    or actor.company_id is null
    or actor.role not in ('Admin', 'Company Admin', 'Recruitment Manager') then
    raise exception 'AGENCY_PROVISIONING_UNAUTHORIZED';
  end if;

  if nullif(btrim(p_agency_name), '') is null
    or nullif(btrim(p_admin_email), '') is null then
    raise exception 'AGENCY_PROVISIONING_INVALID_INPUT';
  end if;

  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.company_id = actor.company_id
    and request.idempotency_key = p_idempotency_key;

  if request_row.id is not null then
    return public.agency_provisioning_public_result(request_row);
  end if;

  normalized_permissions := jsonb_build_object(
    'can_view_requests', coalesce((p_permissions->>'can_view_requests')::boolean, true),
    'can_upload_candidates', coalesce((p_permissions->>'can_upload_candidates')::boolean, true),
    'can_update_candidates', coalesce((p_permissions->>'can_update_candidates')::boolean, true),
    'can_view_interviews', coalesce((p_permissions->>'can_view_interviews')::boolean, true)
  );

  insert into public.agency_provisioning_requests (
    idempotency_key, company_id, requested_by_user_id,
    requested_by_auth_user_id, agency_name, country, contact_person,
    admin_email, phone, permissions, send_invitation, status
  ) values (
    p_idempotency_key, actor.company_id, actor.id,
    actor.auth_user_id, btrim(p_agency_name), nullif(btrim(p_country), ''),
    nullif(btrim(p_contact_person), ''), lower(btrim(p_admin_email)),
    nullif(btrim(p_phone), ''), normalized_permissions,
    coalesce(p_send_invitation, true), 'Draft'
  )
  returning * into request_row;

  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, actor_user_id,
    actor_auth_user_id, event_type, to_status
  ) values (
    request_row.id, 'draft-created', request_row.company_id, actor.id,
    actor.auth_user_id, 'Draft Created', 'Draft'
  );

  return public.agency_provisioning_public_result(request_row);
exception
  when unique_violation then
    select request.* into request_row
    from public.agency_provisioning_requests as request
    where request.company_id = actor.company_id
      and request.idempotency_key = p_idempotency_key;
    if request_row.id is not null then
      return public.agency_provisioning_public_result(request_row);
    end if;
    raise exception 'AGENCY_PROVISIONING_DUPLICATE_ACTIVE_REQUEST';
end;
$function$;

create or replace function public.agency_provisioning_begin(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
  agency_row public.agencies%rowtype;
  auth_row auth.users%rowtype;
  next_attempt integer;
  previous_status text;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true;

  if actor.id is null or actor.company_id is null
    or actor.role not in ('Admin', 'Company Admin') then
    raise exception 'AGENCY_PROVISIONING_UNAUTHORIZED';
  end if;

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;

  if request_row.id is null then
    raise exception 'AGENCY_PROVISIONING_REQUEST_NOT_FOUND';
  end if;
  if request_row.status in ('Invitation Sent', 'Active') then
    return to_jsonb(request_row);
  end if;
  if request_row.status = 'Provisioning'
    and request_row.updated_at > now() - interval '5 minutes' then
    raise exception 'AGENCY_PROVISIONING_IN_PROGRESS';
  end if;
  if request_row.status not in ('Draft', 'Failed', 'Provisioning') then
    raise exception 'AGENCY_PROVISIONING_INVALID_STATE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      lower(btrim(request_row.agency_name)),
      0::bigint
    )
  );

  if exists (
    select 1
    from public.agency_provisioning_requests as other_request
    where other_request.id <> request_row.id
      and lower(btrim(other_request.agency_name)) =
        lower(btrim(request_row.agency_name))
      and other_request.status in ('Provisioning', 'Invitation Sent', 'Active')
  ) then
    raise exception 'EXISTING_AGENCY_REQUIRES_MANUAL_REVIEW';
  end if;

  select agency.* into agency_row
  from public.agencies as agency
  where lower(btrim(agency.name)) = lower(btrim(request_row.agency_name))
  limit 1;

  if (
    select count(*)
    from public.agencies as matching_agency
    where lower(btrim(matching_agency.name)) =
      lower(btrim(request_row.agency_name))
  ) > 1 then
    raise exception 'EXISTING_AGENCY_REQUIRES_MANUAL_REVIEW';
  end if;

  if agency_row.id is not null
    and (
      exists (
        select 1
        from public.users as app_user
        where app_user.agency_id = agency_row.id
          and app_user.role = 'Agency'
      )
      or exists (
        select 1
        from auth.users as auth_user
        where lower(btrim(auth_user.email)) = lower(btrim(request_row.admin_email))
          and coalesce(
            auth_user.raw_user_meta_data->>'provisioning_request_id',
            ''
          ) <> request_row.id::text
      )
    ) then
    raise exception 'EXISTING_AGENCY_REQUIRES_MANUAL_REVIEW';
  end if;

  if agency_row.id is null then
    insert into public.agencies (
      name, country, contact_person, email, phone, status, company_id
    ) values (
      request_row.agency_name, request_row.country,
      request_row.contact_person, request_row.admin_email,
      request_row.phone, 'Provisioning', null
    )
    returning * into agency_row;
  end if;

  if exists (
    select 1
    from public.users as app_user
    where lower(btrim(app_user.email)) = lower(btrim(request_row.admin_email))
      and (
        request_row.public_user_id is null
        or app_user.id <> request_row.public_user_id
      )
  ) then
    raise exception 'EMAIL_ALREADY_ASSIGNED';
  end if;

  select auth_user.* into auth_row
  from auth.users as auth_user
  where lower(btrim(auth_user.email)) = lower(btrim(request_row.admin_email))
  limit 1;

  if auth_row.id is not null then
    if auth_row.raw_user_meta_data->>'provisioning_request_id'
      = request_row.id::text then
      request_row.auth_user_id := auth_row.id;
    else
      raise exception 'EMAIL_ALREADY_ASSIGNED';
    end if;
  end if;

  insert into public.company_agency_access (
    company_id, agency_id, status,
    can_view_requests, can_upload_candidates,
    can_update_candidates, can_view_interviews
  ) values (
    actor.company_id, agency_row.id, 'Provisioning',
    coalesce((request_row.permissions->>'can_view_requests')::boolean, true),
    coalesce((request_row.permissions->>'can_upload_candidates')::boolean, true),
    coalesce((request_row.permissions->>'can_update_candidates')::boolean, true),
    coalesce((request_row.permissions->>'can_view_interviews')::boolean, true)
  )
  on conflict (company_id, agency_id) do update set
    status = case
      when public.company_agency_access.status = 'Active' then 'Active'
      else 'Provisioning'
    end,
    can_view_requests = excluded.can_view_requests,
    can_upload_candidates = excluded.can_upload_candidates,
    can_update_candidates = excluded.can_update_candidates,
    can_view_interviews = excluded.can_view_interviews;

  previous_status := request_row.status;
  next_attempt := request_row.attempt_count + 1;
  update public.agency_provisioning_requests
  set agency_id = agency_row.id,
      auth_user_id = coalesce(request_row.auth_user_id, auth_user_id),
      status = 'Provisioning',
      attempt_count = next_attempt,
      failure_code = null,
      failure_metadata = '{}'::jsonb,
      failed_at = null,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status
  ) values (
    request_row.id, 'provisioning-attempt-' || next_attempt,
    request_row.company_id, request_row.agency_id, actor.id,
    actor.auth_user_id, 'Provisioning Started', previous_status, 'Provisioning'
  )
  on conflict (request_id, event_key) do nothing;

  return to_jsonb(request_row);
end;
$function$;

create or replace function public.agency_provisioning_complete_invitation(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
  agency_row public.agencies%rowtype;
  app_user public.users%rowtype;
begin
  select actor_user.* into actor
  from public.users as actor_user
  where actor_user.auth_user_id = p_actor_auth_user_id
    and actor_user.status = 'Active'
    and actor_user.is_active is true
    and actor_user.role in ('Admin', 'Company Admin');

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
  for update;

  if actor.id is null
    or request_row.id is null
    or request_row.company_id <> actor.company_id
    or request_row.agency_id is null
    or request_row.status not in ('Provisioning', 'Invitation Sent') then
    raise exception 'AGENCY_PROVISIONING_INVALID_STATE';
  end if;
  if request_row.status = 'Invitation Sent'
    and request_row.auth_user_id = p_auth_user_id
    and request_row.public_user_id is not null then
    return public.agency_provisioning_public_result(request_row);
  end if;

  if not exists (
    select 1 from auth.users as auth_user
    where auth_user.id = p_auth_user_id
      and lower(btrim(auth_user.email)) =
        lower(btrim(request_row.admin_email))
      and auth_user.raw_user_meta_data->>'provisioning_request_id'
        = request_row.id::text
  ) then
    raise exception 'AGENCY_PROVISIONING_AUTH_USER_MISMATCH';
  end if;

  select existing_user.* into app_user
  from public.users as existing_user
  where existing_user.auth_user_id = p_auth_user_id
     or lower(btrim(existing_user.email)) =
        lower(btrim(request_row.admin_email))
  limit 1;

  if app_user.id is not null
    and (
      request_row.public_user_id is null
      or app_user.id <> request_row.public_user_id
    ) then
    raise exception 'EMAIL_ALREADY_ASSIGNED';
  end if;

  select agency.* into agency_row
  from public.agencies as agency
  where agency.id = request_row.agency_id;

  if app_user.id is null then
    insert into public.users (
      name, email, role, agency_name, status, is_active,
      company_id, agency_id, auth_user_id
    ) values (
      coalesce(request_row.contact_person, request_row.agency_name),
      request_row.admin_email, 'Agency', agency_row.name,
      'Invitation Sent', false, null, request_row.agency_id,
      p_auth_user_id
    )
    returning * into app_user;
  end if;

  insert into public.agency_company_user_access (
    company_id, agency_id, user_id, role, status,
    can_view_requests, can_upload_candidates,
    can_update_candidates, can_view_interviews
  ) values (
    request_row.company_id, request_row.agency_id, app_user.id,
    'Agency User', 'Invitation Sent',
    coalesce((request_row.permissions->>'can_view_requests')::boolean, true),
    coalesce((request_row.permissions->>'can_upload_candidates')::boolean, true),
    coalesce((request_row.permissions->>'can_update_candidates')::boolean, true),
    coalesce((request_row.permissions->>'can_view_interviews')::boolean, true)
  )
  on conflict (company_id, agency_id, user_id) do update set
    status = case
      when public.agency_company_user_access.status = 'Active' then 'Active'
      else 'Invitation Sent'
    end,
    can_view_requests = excluded.can_view_requests,
    can_upload_candidates = excluded.can_upload_candidates,
    can_update_candidates = excluded.can_update_candidates,
    can_view_interviews = excluded.can_view_interviews;

  update public.company_agency_access
  set status = case when status = 'Active' then 'Active' else 'Invitation Sent' end
  where company_id = request_row.company_id
    and agency_id = request_row.agency_id;

  update public.agency_provisioning_requests
  set auth_user_id = p_auth_user_id,
      public_user_id = app_user.id,
      status = 'Invitation Sent',
      invitation_sent_at = coalesce(invitation_sent_at, now()),
      failure_code = null,
      failure_metadata = '{}'::jsonb,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status
  ) values (
    request_row.id, 'invitation-sent-' || request_row.attempt_count,
    request_row.company_id, request_row.agency_id,
    actor.id, actor.auth_user_id,
    'Invitation Sent', 'Provisioning', 'Invitation Sent'
  )
  on conflict (request_id, event_key) do nothing;

  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (
    request_row.company_id, 'Agency Provisioning', request_row.id::text,
    'Invitation Sent', 'Agency invitation sent',
    actor.id, actor.role,
    'Provisioning state changed without storing invitation tokens or links.',
    'Edge Function'
  );

  return public.agency_provisioning_public_result(request_row);
end;
$function$;

create or replace function public.agency_provisioning_record_auth_user(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin');

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;

  if actor.id is null or request_row.id is null then
    raise exception 'AGENCY_PROVISIONING_UNAUTHORIZED';
  end if;
  if request_row.status not in ('Provisioning', 'Failed') then
    raise exception 'AGENCY_PROVISIONING_INVALID_STATE';
  end if;
  if request_row.auth_user_id is not null
    and request_row.auth_user_id <> p_auth_user_id then
    raise exception 'AGENCY_PROVISIONING_AUTH_USER_MISMATCH';
  end if;
  if not exists (
    select 1 from auth.users as auth_user
    where auth_user.id = p_auth_user_id
      and lower(btrim(auth_user.email)) = lower(btrim(request_row.admin_email))
      and auth_user.raw_user_meta_data->>'provisioning_request_id' = request_row.id::text
  ) then
    raise exception 'AGENCY_PROVISIONING_AUTH_USER_MISMATCH';
  end if;

  update public.agency_provisioning_requests
  set auth_user_id = p_auth_user_id,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return to_jsonb(request_row);
end;
$function$;

create or replace function public.agency_provisioning_mark_failed(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin');

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;

  if actor.id is null or request_row.id is null then
    raise exception 'AGENCY_PROVISIONING_UNAUTHORIZED';
  end if;
  if request_row.status = 'Active' then
    return public.agency_provisioning_public_result(request_row);
  end if;

  update public.agency_provisioning_requests
  set status = 'Failed',
      failure_code = left(coalesce(p_failure_code, 'INVITATION_FAILED'), 120),
      failure_metadata = '{}'::jsonb,
      failed_at = now(),
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  update public.company_agency_access
  set status = case when status = 'Active' then 'Active' else 'Failed' end
  where company_id = request_row.company_id
    and agency_id = request_row.agency_id;

  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status, event_data
  ) values (
    request_row.id, 'failed-' || request_row.attempt_count,
    request_row.company_id, request_row.agency_id, actor.id,
    actor.auth_user_id, 'Provisioning Failed', 'Provisioning', 'Failed',
    jsonb_build_object('failure_code', request_row.failure_code)
  )
  on conflict (request_id, event_key) do nothing;

  return public.agency_provisioning_public_result(request_row);
end;
$function$;

create or replace function public.agency_provisioning_prepare_resend(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin');

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;

  if actor.id is null or request_row.id is null then
    raise exception 'AGENCY_PROVISIONING_UNAUTHORIZED';
  end if;
  if request_row.status not in ('Invitation Sent', 'Failed')
    or request_row.auth_user_id is null then
    raise exception 'AGENCY_PROVISIONING_INVALID_STATE';
  end if;

  update public.agency_provisioning_requests
  set status = 'Provisioning',
      attempt_count = attempt_count + 1,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return to_jsonb(request_row);
end;
$function$;

create or replace function public.agency_provisioning_record_resend(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
  previous_status text;
begin
  select actor_user.* into actor
  from public.users as actor_user
  where actor_user.auth_user_id = p_actor_auth_user_id
    and actor_user.status = 'Active'
    and actor_user.is_active is true
    and actor_user.role in ('Admin', 'Company Admin');

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
  for update;

  if actor.id is null
    or request_row.id is null
    or request_row.company_id <> actor.company_id
    or request_row.auth_user_id is null
    or request_row.status <> 'Provisioning' then
    raise exception 'AGENCY_PROVISIONING_INVALID_STATE';
  end if;

  previous_status := request_row.status;
  update public.agency_provisioning_requests
  set status = 'Invitation Sent',
      invitation_sent_at = now(),
      failure_code = null,
      failed_at = null,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  update public.company_agency_access
  set status = case when status = 'Active' then 'Active' else 'Invitation Sent' end
  where company_id = request_row.company_id
    and agency_id = request_row.agency_id;

  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status
  ) values (
    request_row.id, 'invitation-resent-' || request_row.attempt_count,
    request_row.company_id, request_row.agency_id,
    actor.id, actor.auth_user_id,
    'Invitation Resent', previous_status, 'Invitation Sent'
  )
  on conflict (request_id, event_key) do nothing;

  return public.agency_provisioning_public_result(request_row);
end;
$function$;

create or replace function public.agency_provisioning_activate(
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_row public.agency_provisioning_requests%rowtype;
  app_user public.users%rowtype;
begin
  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.auth_user_id = p_actor_auth_user_id
  order by request.created_at desc
  limit 1
  for update;

  if request_row.id is null then
    raise exception 'AGENCY_PROVISIONING_REQUEST_NOT_FOUND';
  end if;
  if request_row.status = 'Active' then
    return public.agency_provisioning_public_result(request_row);
  end if;
  if request_row.status <> 'Invitation Sent'
    or request_row.public_user_id is null
    or request_row.agency_id is null then
    raise exception 'AGENCY_PROVISIONING_INVALID_STATE';
  end if;

  select existing_user.* into app_user
  from public.users as existing_user
  where existing_user.id = request_row.public_user_id
    and existing_user.auth_user_id = p_actor_auth_user_id
    and existing_user.agency_id = request_row.agency_id
    and existing_user.role = 'Agency'
  for update;

  if app_user.id is null then
    raise exception 'AGENCY_PROVISIONING_AUTH_USER_MISMATCH';
  end if;

  update public.users
  set status = 'Active', is_active = true, updated_at = now()
  where id = app_user.id
    and auth_user_id = p_actor_auth_user_id;

  update public.company_agency_access
  set status = 'Active'
  where company_id = request_row.company_id
    and agency_id = request_row.agency_id;

  update public.agency_company_user_access
  set status = 'Active'
  where company_id = request_row.company_id
    and agency_id = request_row.agency_id
    and user_id = app_user.id;

  update public.agencies
  set status = 'Active', updated_at = now()
  where id = request_row.agency_id
    and status <> 'Suspended';

  update public.agency_provisioning_requests
  set status = 'Active',
      activated_at = now(),
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status
  ) values (
    request_row.id, 'activated', request_row.company_id,
    request_row.agency_id, app_user.id, p_actor_auth_user_id,
    'Agency Activated', 'Invitation Sent', 'Active'
  )
  on conflict (request_id, event_key) do nothing;

  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (
    request_row.company_id, 'Agency Provisioning', request_row.id::text,
    'Activated', 'Agency access activated', app_user.id, 'Agency',
    'Invitation accepted and first authenticated activation completed.',
    'Edge Function'
  );

  return public.agency_provisioning_public_result(request_row);
end;
$function$;

create or replace function public.agency_provisioning_get_status(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id;

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and (
      request.auth_user_id = p_actor_auth_user_id
      or (
        actor.id is not null
        and actor.status = 'Active'
        and actor.is_active is true
        and actor.company_id = request.company_id
      )
    );

  if request_row.id is null then
    raise exception 'AGENCY_PROVISIONING_REQUEST_NOT_FOUND';
  end if;

  return public.agency_provisioning_public_result(request_row);
end;
$function$;

create or replace function public.workspace_admin_update_company_settings(
  p_actor_auth_user_id uuid,
  p_target_company_id uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  company_row public.companies%rowtype;
  target_company_id uuid;
  is_platform_owner boolean;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true;

  is_platform_owner := actor.role = 'Platform Owner'
    and actor.company_id is null;

  if actor.id is null
    or (
      not is_platform_owner
      and (
        actor.role not in ('Admin', 'Company Admin')
        or actor.company_id is null
      )
    ) then
    raise exception 'WORKSPACE_ADMIN_UNAUTHORIZED';
  end if;

  target_company_id := case
    when is_platform_owner then p_target_company_id
    else actor.company_id
  end;

  if target_company_id is null then
    raise exception 'COMPANY_ID_REQUIRED';
  end if;
  if not is_platform_owner
    and p_target_company_id is not null
    and p_target_company_id <> actor.company_id then
    raise exception 'TENANT_MISMATCH';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object'
    or p_updates = '{}'::jsonb then
    raise exception 'COMPANY_SETTINGS_INVALID_FIELDS';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_updates) as field_name
    where field_name not in ('name', 'domain', 'notes')
      and (
        not is_platform_owner
        or field_name not in (
          'status', 'subscription_plan', 'subscription_status',
          'subscription_start', 'subscription_end', 'max_users'
        )
      )
  ) then
    raise exception 'COMPANY_SETTINGS_INVALID_FIELDS';
  end if;
  if p_updates ? 'name'
    and nullif(btrim(p_updates->>'name'), '') is null then
    raise exception 'COMPANY_NAME_REQUIRED';
  end if;
  if p_updates ? 'max_users'
    and (
      jsonb_typeof(p_updates->'max_users') <> 'number'
      or (p_updates->>'max_users')::integer < 1
    ) then
    raise exception 'COMPANY_MAX_USERS_INVALID';
  end if;

  select company.* into company_row
  from public.companies as company
  where company.id = target_company_id
  for update;

  if company_row.id is null then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  update public.companies
  set name = case
        when p_updates ? 'name' then btrim(p_updates->>'name')
        else name
      end,
      domain = case
        when p_updates ? 'domain' then btrim(coalesce(p_updates->>'domain', ''))
        else domain
      end,
      notes = case
        when p_updates ? 'notes' then btrim(coalesce(p_updates->>'notes', ''))
        else notes
      end,
      status = case
        when is_platform_owner and p_updates ? 'status'
          then p_updates->>'status'
        else status
      end,
      subscription_plan = case
        when is_platform_owner and p_updates ? 'subscription_plan'
          then p_updates->>'subscription_plan'
        else subscription_plan
      end,
      subscription_status = case
        when is_platform_owner and p_updates ? 'subscription_status'
          then p_updates->>'subscription_status'
        else subscription_status
      end,
      subscription_start = case
        when is_platform_owner and p_updates ? 'subscription_start'
          then nullif(p_updates->>'subscription_start', '')::date
        else subscription_start
      end,
      subscription_end = case
        when is_platform_owner and p_updates ? 'subscription_end'
          then nullif(p_updates->>'subscription_end', '')::date
        else subscription_end
      end,
      max_users = case
        when is_platform_owner and p_updates ? 'max_users'
          then (p_updates->>'max_users')::integer
        else max_users
      end,
      updated_at = now()
  where id = target_company_id
  returning * into company_row;

  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (
    target_company_id, 'Company Settings', target_company_id::text,
    'Updated', 'Company settings updated', actor.id, actor.role,
    case
      when is_platform_owner
        then 'Platform Owner updated whitelisted company settings.'
      else 'Tenant administrator updated non-subscription company settings.'
    end,
    'Edge Function'
  );

  return jsonb_build_object(
    'id', company_row.id,
    'name', company_row.name,
    'domain', company_row.domain,
    'notes', company_row.notes,
    'status', company_row.status,
    'subscription_plan', company_row.subscription_plan,
    'subscription_status', company_row.subscription_status,
    'subscription_start', company_row.subscription_start,
    'subscription_end', company_row.subscription_end,
    'max_users', company_row.max_users,
    'updated_at', company_row.updated_at
  );
end;
$function$;

create or replace function public.workspace_admin_update_agency(
  p_actor_auth_user_id uuid,
  p_agency_id uuid,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  agency_row public.agencies%rowtype;
  linked_company_count integer;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;

  if actor.id is null then
    raise exception 'WORKSPACE_ADMIN_UNAUTHORIZED';
  end if;
  if not exists (
    select 1
    from public.company_agency_access as access
    where access.company_id = actor.company_id
      and access.agency_id = p_agency_id
      and coalesce(access.status, 'Active') <> 'Inactive'
  ) then
    raise exception 'AGENCY_NOT_LINKED';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'object'
    or p_updates = '{}'::jsonb then
    raise exception 'AGENCY_UPDATE_INVALID_FIELDS';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_updates) as field_name
    where field_name not in (
      'name', 'country', 'contact_person', 'email', 'phone'
    )
  ) then
    raise exception 'AGENCY_UPDATE_INVALID_FIELDS';
  end if;
  if p_updates ? 'name'
    and nullif(btrim(p_updates->>'name'), '') is null then
    raise exception 'AGENCY_NAME_REQUIRED';
  end if;

  select agency.* into agency_row
  from public.agencies as agency
  where agency.id = p_agency_id
  for update;

  if agency_row.id is null then
    raise exception 'AGENCY_NOT_FOUND';
  end if;

  select count(distinct access.company_id)::integer
  into linked_company_count
  from public.company_agency_access as access
  where access.agency_id = p_agency_id
    and coalesce(access.status, 'Active') <> 'Inactive';

  if linked_company_count > 1 then
    raise exception 'SHARED_AGENCY_REQUIRES_MANUAL_REVIEW';
  end if;
  if exists (
    select 1
    from public.agencies as duplicate
    where duplicate.id <> p_agency_id
      and lower(btrim(duplicate.name)) = lower(btrim(
        case
          when p_updates ? 'name' then p_updates->>'name'
          else agency_row.name
        end
      ))
  ) then
    raise exception 'DUPLICATE_AGENCY_REQUIRES_MANUAL_REVIEW';
  end if;

  update public.agencies
  set name = case
        when p_updates ? 'name' then btrim(p_updates->>'name')
        else name
      end,
      country = case
        when p_updates ? 'country' then btrim(coalesce(p_updates->>'country', ''))
        else country
      end,
      contact_person = case
        when p_updates ? 'contact_person'
          then btrim(coalesce(p_updates->>'contact_person', ''))
        else contact_person
      end,
      email = case
        when p_updates ? 'email'
          then lower(btrim(coalesce(p_updates->>'email', '')))
        else email
      end,
      phone = case
        when p_updates ? 'phone' then btrim(coalesce(p_updates->>'phone', ''))
        else phone
      end,
      updated_at = now()
  where id = p_agency_id
  returning * into agency_row;

  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (
    actor.company_id, 'Agency Management', p_agency_id::text,
    'Updated', 'Unshared agency details updated', actor.id, actor.role,
    'Only whitelisted global agency fields were updated after single-company validation.',
    'Edge Function'
  );

  return jsonb_build_object(
    'id', agency_row.id,
    'name', agency_row.name,
    'country', agency_row.country,
    'contact_person', agency_row.contact_person,
    'email', agency_row.email,
    'phone', agency_row.phone,
    'status', agency_row.status,
    'updated_at', agency_row.updated_at
  );
end;
$function$;

create or replace function public.workspace_admin_unlink_agency(
  p_actor_auth_user_id uuid,
  p_agency_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  has_related_access boolean;
  unlink_status text;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;

  if actor.id is null then
    raise exception 'WORKSPACE_ADMIN_UNAUTHORIZED';
  end if;

  perform 1
  from public.company_agency_access as access
  where access.company_id = actor.company_id
    and access.agency_id = p_agency_id
  for update;

  if not found then
    raise exception 'AGENCY_NOT_LINKED';
  end if;

  has_related_access := exists (
    select 1
    from public.agency_company_user_access as user_access
    where user_access.company_id = actor.company_id
      and user_access.agency_id = p_agency_id
  ) or exists (
    select 1
    from public.agency_provisioning_requests as request
    where request.company_id = actor.company_id
      and request.agency_id = p_agency_id
  );

  unlink_status := case when has_related_access then 'Suspended' else 'Inactive' end;

  -- Disable user access while the parent company link is still in an allowed
  -- state so the existing consistency trigger can validate the transition.
  update public.agency_company_user_access
  set status = 'Suspended'
  where company_id = actor.company_id
    and agency_id = p_agency_id;

  update public.company_agency_access
  set status = unlink_status
  where company_id = actor.company_id
    and agency_id = p_agency_id;

  update public.agency_provisioning_requests
  set status = 'Suspended',
      updated_at = now()
  where company_id = actor.company_id
    and agency_id = p_agency_id
    and status <> 'Suspended';

  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (
    actor.company_id, 'Agency Management', p_agency_id::text,
    'Unlinked', 'Agency access unlinked from company', actor.id, actor.role,
    'The global agency and its Auth/public users were retained; tenant access was disabled.',
    'Edge Function'
  );

  return jsonb_build_object(
    'agency_id', p_agency_id,
    'company_id', actor.company_id,
    'status', unlink_status,
    'agency_deleted', false,
    'auth_user_deleted', false,
    'public_user_deleted', false
  );
end;
$function$;

revoke all on function public.agency_provisioning_public_result(
  public.agency_provisioning_requests
) from public, anon, authenticated;
revoke all on function public.agency_provisioning_create_draft(
  uuid, uuid, text, text, text, text, text, jsonb, boolean
) from public, anon, authenticated;
revoke all on function public.agency_provisioning_begin(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.agency_provisioning_complete_invitation(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.agency_provisioning_record_auth_user(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.agency_provisioning_mark_failed(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.agency_provisioning_prepare_resend(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.agency_provisioning_record_resend(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.agency_provisioning_activate(uuid)
  from public, anon, authenticated;
revoke all on function public.agency_provisioning_get_status(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.workspace_admin_update_company_settings(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.workspace_admin_update_agency(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.workspace_admin_unlink_agency(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.agency_provisioning_public_result(
  public.agency_provisioning_requests
) to service_role;
grant execute on function public.agency_provisioning_create_draft(
  uuid, uuid, text, text, text, text, text, jsonb, boolean
) to service_role;
grant execute on function public.agency_provisioning_begin(uuid, uuid)
  to service_role;
grant execute on function public.agency_provisioning_complete_invitation(uuid, uuid, uuid)
  to service_role;
grant execute on function public.agency_provisioning_record_auth_user(uuid, uuid, uuid)
  to service_role;
grant execute on function public.agency_provisioning_mark_failed(uuid, uuid, text)
  to service_role;
grant execute on function public.agency_provisioning_prepare_resend(uuid, uuid)
  to service_role;
grant execute on function public.agency_provisioning_record_resend(uuid, uuid)
  to service_role;
grant execute on function public.agency_provisioning_activate(uuid)
  to service_role;
grant execute on function public.agency_provisioning_get_status(uuid, uuid)
  to service_role;
grant execute on function public.workspace_admin_update_company_settings(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.workspace_admin_update_agency(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.workspace_admin_unlink_agency(uuid, uuid)
  to service_role;

commit;
