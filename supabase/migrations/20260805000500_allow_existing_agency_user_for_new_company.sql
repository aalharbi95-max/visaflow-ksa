begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A single agency login may be granted access to multiple company workspaces.
-- Seed a retryable request when the email already belongs to the same agency;
-- the existing secure invitation saga will then issue a recovery link and add
-- only the new company access. Incompatible roles/agencies remain blocked.
alter table public.agency_provisioning_requests
  add column if not exists auth_identity_preexisting boolean not null default false;

create or replace function public.agency_invitation_begin_v2(
  p_agency_id uuid,
  p_permissions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  agency_row public.agencies%rowtype;
  existing_request public.agency_provisioning_requests%rowtype;
  compatible_user public.users%rowtype;
  request_result jsonb;
  request_id uuid;
  normalized_email text;
  allowed_keys constant text[] := array[
    'can_view_requests',
    'can_upload_candidates',
    'can_update_candidates',
    'can_view_interviews'
  ];
begin
  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;

  if actor.id is null then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;
  if p_permissions is null
    or pg_catalog.jsonb_typeof(p_permissions) <> 'object'
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_permissions) as supplied(key)
      where not (supplied.key = any(allowed_keys))
    )
    or exists (
      select 1
      from pg_catalog.unnest(allowed_keys) as required(key)
      where not p_permissions ? required.key
        or pg_catalog.jsonb_typeof(p_permissions->required.key) <> 'boolean'
    )
  then
    raise exception 'AGENCY_INVITATION_INVALID_PERMISSIONS';
  end if;

  select agency.*
  into agency_row
  from public.agencies as agency
  where agency.id = p_agency_id
    and agency.status = 'Active'
    and exists (
      select 1
      from public.company_agency_access as access
      where access.company_id = actor.company_id
        and access.agency_id = agency.id
        and access.status = 'Active'
    );

  if agency_row.id is null then
    raise exception 'AGENCY_INVITATION_AGENCY_NOT_AVAILABLE';
  end if;

  normalized_email := pg_catalog.lower(
    pg_catalog.btrim(coalesce(agency_row.email, ''))
  );
  if normalized_email = ''
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'AGENCY_INVITATION_EMAIL_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'agency_invitation:' || actor.company_id::text || ':' || p_agency_id::text,
      0::bigint
    )
  );

  select request.*
  into existing_request
  from public.agency_provisioning_requests as request
  where request.company_id = actor.company_id
    and request.agency_id = p_agency_id
  order by request.created_at desc, request.id
  limit 1
  for update;

  -- Never call the Auth invite endpoint again for an identity already created.
  if existing_request.status = 'Invitation Sent'
    and existing_request.auth_user_id is not null
  then
    return public.agency_provisioning_public_result(existing_request)
      || pg_catalog.jsonb_build_object(
        'outcome', 'already_invited',
        'display_status', 'Invitation Sent'
      );
  end if;

  if existing_request.id is null then
    if exists (
      select 1
      from public.users as app_user
      where pg_catalog.lower(
        pg_catalog.btrim(coalesce(app_user.email, ''))
      ) = normalized_email
        and (
          app_user.role <> 'Agency'
          or app_user.agency_id is distinct from p_agency_id
          or app_user.auth_user_id is null
          or app_user.status <> 'Active'
          or app_user.is_active is not true
        )
    ) then
      raise exception 'AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED';
    end if;

    select app_user.*
    into compatible_user
    from public.users as app_user
    where pg_catalog.lower(
      pg_catalog.btrim(coalesce(app_user.email, ''))
    ) = normalized_email
      and app_user.role = 'Agency'
      and app_user.agency_id = p_agency_id
      and app_user.auth_user_id is not null
      and app_user.status = 'Active'
      and app_user.is_active is true
    order by app_user.id
    limit 1;

    if compatible_user.id is not null then
      insert into public.agency_provisioning_requests (
        idempotency_key,
        company_id,
        agency_id,
        requested_by_user_id,
        requested_by_auth_user_id,
        agency_name,
        country,
        contact_person,
        admin_email,
        phone,
        permissions,
        send_invitation,
        status,
        auth_user_id,
        public_user_id,
        auth_identity_preexisting,
        attempt_count,
        failure_code,
        failure_metadata,
        failed_at
      ) values (
        pg_catalog.gen_random_uuid(),
        actor.company_id,
        p_agency_id,
        actor.id,
        actor.auth_user_id,
        agency_row.name,
        agency_row.country,
        agency_row.contact_person,
        normalized_email,
        agency_row.phone,
        p_permissions,
        true,
        'Failed',
        compatible_user.auth_user_id,
        compatible_user.id,
        true,
        0,
        'EXISTING_AGENCY_IDENTITY',
        pg_catalog.jsonb_build_object('retryable', true),
        pg_catalog.now()
      );
    end if;
  end if;

  request_result := public.agency_invitation_begin(p_agency_id);
  request_id := (request_result->>'id')::uuid;

  update public.agency_provisioning_requests
  set permissions = p_permissions,
      failure_stage = null,
      last_successful_operation = coalesce(
        last_successful_operation,
        'REQUEST_STARTED'
      ),
      updated_at = pg_catalog.now()
  where id = request_id
    and company_id = actor.company_id
    and status = 'Provisioning'
  returning public.agency_provisioning_public_result(
    agency_provisioning_requests
  ) into request_result;

  return request_result || pg_catalog.jsonb_build_object(
    'outcome', 'send',
    'display_status', 'Invitation Sending'
  );
end;
$function$;

-- The original wrapper updated every active request for the authenticated
-- identity after activation. Once an agency identity belongs to multiple
-- companies that can affect more than one row. Scope the hardening metadata to
-- the exact request selected and activated by agency_invitation_activate().
create or replace function public.agency_invitation_activate_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_result jsonb;
  request_row public.agency_provisioning_requests%rowtype;
  activated_request_id uuid;
begin
  request_result := public.agency_invitation_activate();
  activated_request_id := nullif(request_result->>'id', '')::uuid;

  if activated_request_id is null then
    raise exception 'AGENCY_INVITATION_INVALID_STATE';
  end if;

  update public.agency_provisioning_requests
  set failure_stage = null,
      failure_code = null,
      failure_metadata = '{}'::jsonb,
      last_successful_operation = 'ACTIVATED',
      updated_at = pg_catalog.now()
  where id = activated_request_id
    and auth_user_id = auth.uid()
    and status = 'Active'
  returning * into request_row;

  if request_row.id is null then
    raise exception 'AGENCY_INVITATION_INVALID_STATE';
  end if;

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'accepted',
      'display_status', 'Accepted'
    );
end;
$function$;

-- Existing agency identities carry the provisioning metadata of their first
-- company. For an additional company, validate the immutable Auth/public-user
-- relationship instead of requiring that old request id to match the new one.
create or replace function public.agency_invitation_record_auth_user_v3(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_auth_user_id uuid,
  p_existing_identity boolean
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
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_INVITATION_UNAUTHORIZED'; end if;

  if coalesce(p_existing_identity, false) is false then
    perform public.agency_invitation_record_auth_user_v2(
      p_actor_auth_user_id, p_request_id, p_auth_user_id
    );
  else
    select request.* into request_row
    from public.agency_provisioning_requests as request
    where request.id = p_request_id
      and request.company_id = actor.company_id
      and request.agency_id is not null
      and request.status = 'Provisioning'
    for update;
    if request_row.id is null
      or (request_row.auth_user_id is not null and request_row.auth_user_id <> p_auth_user_id)
      or not exists (
        select 1 from auth.users as auth_user
        where auth_user.id = p_auth_user_id
          and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
              pg_catalog.lower(pg_catalog.btrim(request_row.admin_email))
      )
      or not exists (
        select 1 from public.users as agency_user
        where agency_user.auth_user_id = p_auth_user_id
          and agency_user.role = 'Agency'
          and agency_user.agency_id = request_row.agency_id
          and pg_catalog.lower(pg_catalog.btrim(coalesce(agency_user.email, ''))) =
              pg_catalog.lower(pg_catalog.btrim(request_row.admin_email))
      )
    then
      raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH';
    end if;
  end if;

  update public.agency_provisioning_requests
  set auth_user_id = p_auth_user_id,
      auth_identity_preexisting = coalesce(p_existing_identity, false),
      failure_stage = null,
      failure_code = null,
      failure_metadata = '{}'::jsonb,
      last_successful_operation = 'AUTH_USER_RECORDED',
      updated_at = pg_catalog.now()
  where id = p_request_id
    and company_id = actor.company_id
    and status = 'Provisioning'
  returning * into request_row;
  if request_row.id is null then raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH'; end if;

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'auth_identity_preexisting', request_row.auth_identity_preexisting
    );
end;
$function$;

create or replace function public.agency_invitation_complete_v2(
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
  agency_user public.users%rowtype;
begin
  select app_user.* into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_INVITATION_UNAUTHORIZED'; end if;

  select request.* into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;
  if request_row.id is null
    or request_row.status <> 'Provisioning'
    or request_row.auth_user_id is distinct from p_auth_user_id
  then raise exception 'AGENCY_INVITATION_INVALID_STATE'; end if;

  if request_row.auth_identity_preexisting is true then
    if not exists (
      select 1 from public.agencies as agency
      where agency.id = request_row.agency_id
        and agency.status = 'Active'
    ) or not exists (
      select 1 from public.company_agency_access as access
      where access.company_id = request_row.company_id
        and access.agency_id = request_row.agency_id
        and access.status = 'Active'
    ) or not exists (
      select 1 from auth.users as auth_user
      where auth_user.id = p_auth_user_id
        and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
            pg_catalog.lower(pg_catalog.btrim(request_row.admin_email))
    ) then raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH'; end if;

    select app_user.* into agency_user
    from public.users as app_user
    where app_user.auth_user_id = p_auth_user_id
      and app_user.role = 'Agency'
      and app_user.agency_id = request_row.agency_id
      and pg_catalog.lower(pg_catalog.btrim(coalesce(app_user.email, ''))) =
          pg_catalog.lower(pg_catalog.btrim(request_row.admin_email))
    order by app_user.id
    limit 1
    for update;
    if agency_user.id is null then raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH'; end if;

    insert into public.agency_company_user_access (
      company_id, agency_id, user_id, role, status,
      can_view_requests, can_upload_candidates,
      can_update_candidates, can_view_interviews
    ) values (
      request_row.company_id, request_row.agency_id, agency_user.id,
      'Agency User', 'Invitation Sent',
      (request_row.permissions->>'can_view_requests')::boolean,
      (request_row.permissions->>'can_upload_candidates')::boolean,
      (request_row.permissions->>'can_update_candidates')::boolean,
      (request_row.permissions->>'can_view_interviews')::boolean
    )
    on conflict (company_id, agency_id, user_id) do update
    set role = 'Agency User',
        status = case
          when public.agency_company_user_access.status = 'Active' then 'Active'
          else 'Invitation Sent'
        end,
        can_view_requests = excluded.can_view_requests,
        can_upload_candidates = excluded.can_upload_candidates,
        can_update_candidates = excluded.can_update_candidates,
        can_view_interviews = excluded.can_view_interviews;

    update public.agency_provisioning_requests
    set public_user_id = agency_user.id,
        status = 'Invitation Sent',
        invitation_sent_at = pg_catalog.now(),
        failure_stage = null,
        failure_code = null,
        failure_metadata = '{}'::jsonb,
        failed_at = null,
        last_successful_operation = 'INVITATION_SENT',
        updated_at = pg_catalog.now()
    where id = request_row.id
    returning * into request_row;

    insert into public.agency_provisioning_events (
      request_id, event_key, company_id, agency_id,
      actor_user_id, actor_auth_user_id, event_type,
      from_status, to_status
    ) values (
      request_row.id,
      'existing-agency-invitation-sent-' || request_row.attempt_count,
      request_row.company_id, request_row.agency_id,
      actor.id, actor.auth_user_id, 'Invitation Sent',
      'Provisioning', 'Invitation Sent'
    ) on conflict (request_id, event_key) do nothing;
  else
    perform public.agency_invitation_complete(
      p_actor_auth_user_id, p_request_id, p_auth_user_id
    );
    select request.* into request_row
    from public.agency_provisioning_requests as request
    where request.id = p_request_id
      and request.company_id = actor.company_id
      and request.auth_user_id = p_auth_user_id
    for update;
    update public.agency_company_user_access
    set can_view_requests = (request_row.permissions->>'can_view_requests')::boolean,
        can_upload_candidates = (request_row.permissions->>'can_upload_candidates')::boolean,
        can_update_candidates = (request_row.permissions->>'can_update_candidates')::boolean,
        can_view_interviews = (request_row.permissions->>'can_view_interviews')::boolean
    where company_id = request_row.company_id
      and agency_id = request_row.agency_id
      and user_id = request_row.public_user_id;
    update public.agency_provisioning_requests
    set failure_stage = null,
        failure_code = null,
        failure_metadata = '{}'::jsonb,
        last_successful_operation = 'INVITATION_SENT',
        updated_at = pg_catalog.now()
    where id = request_row.id
    returning * into request_row;
  end if;

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'sent',
      'display_status', 'Invitation Sent'
    );
end;
$function$;

revoke all on function public.agency_invitation_begin_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.agency_invitation_begin_v2(uuid, jsonb)
  to authenticated;

revoke all on function public.agency_invitation_record_auth_user_v3(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.agency_invitation_record_auth_user_v3(uuid, uuid, uuid, boolean)
  to service_role;

revoke all on function public.agency_invitation_complete_v2(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.agency_invitation_complete_v2(uuid, uuid, uuid)
  to service_role;

revoke all on function public.agency_invitation_activate_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.agency_invitation_activate_v2()
  to authenticated;

commit;
