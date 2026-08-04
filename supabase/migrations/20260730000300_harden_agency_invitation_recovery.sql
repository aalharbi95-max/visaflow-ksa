-- Harden the existing-agency invitation saga without replacing its workflow.
-- This migration is intentionally additive and must be applied through the
-- normal deployment process after review.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.agency_provisioning_requests
  add column if not exists failure_stage text,
  add column if not exists last_successful_operation text;

create or replace function public.agency_provisioning_public_result(
  request_row public.agency_provisioning_requests
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', request_row.id,
    'agency_id', request_row.agency_id,
    'agency_name', request_row.agency_name,
    'admin_email', request_row.admin_email,
    'status', request_row.status,
    'auth_user_id', request_row.auth_user_id,
    'public_user_id', request_row.public_user_id,
    'permissions', request_row.permissions,
    'attempt_count', request_row.attempt_count,
    'failure_stage', request_row.failure_stage,
    'failure_code', request_row.failure_code,
    'failure_metadata', request_row.failure_metadata,
    'last_successful_operation', request_row.last_successful_operation,
    'invitation_sent_at', request_row.invitation_sent_at,
    'activated_at', request_row.activated_at,
    'updated_at', request_row.updated_at
  )
$function$;

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
  existing_request public.agency_provisioning_requests%rowtype;
  request_result jsonb;
  request_id uuid;
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

  select request.*
  into existing_request
  from public.agency_provisioning_requests as request
  where request.company_id = actor.company_id
    and request.agency_id = p_agency_id
  order by request.created_at desc, request.id
  limit 1;

  -- Never call the Auth invite endpoint again for an identity already created.
  -- An expired link is recovered through the existing account recovery path.
  if existing_request.status = 'Invitation Sent'
    and existing_request.auth_user_id is not null
  then
    return public.agency_provisioning_public_result(existing_request)
      || pg_catalog.jsonb_build_object(
        'outcome', 'already_invited',
        'display_status', 'Invitation Sent'
      );
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

create or replace function public.agency_invitation_record_auth_user_v2(
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
  request_result jsonb;
  request_row public.agency_provisioning_requests%rowtype;
begin
  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;

  request_result := public.agency_invitation_record_auth_user(
    p_actor_auth_user_id,
    p_request_id,
    p_auth_user_id
  );

  update public.agency_provisioning_requests
  set failure_stage = null,
      failure_code = null,
      failure_metadata = '{}'::jsonb,
      last_successful_operation = 'AUTH_USER_RECORDED',
      updated_at = pg_catalog.now()
  where id = p_request_id
    and company_id = actor.company_id
    and auth_user_id = p_auth_user_id
  returning * into request_row;

  return public.agency_provisioning_public_result(request_row);
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
begin
  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;

  perform public.agency_invitation_complete(
    p_actor_auth_user_id,
    p_request_id,
    p_auth_user_id
  );

  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
    and request.auth_user_id = p_auth_user_id
  for update;

  update public.agency_company_user_access
  set can_view_requests =
        (request_row.permissions->>'can_view_requests')::boolean,
      can_upload_candidates =
        (request_row.permissions->>'can_upload_candidates')::boolean,
      can_update_candidates =
        (request_row.permissions->>'can_update_candidates')::boolean,
      can_view_interviews =
        (request_row.permissions->>'can_view_interviews')::boolean
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

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'sent',
      'display_status', 'Invitation Sent'
    );
end;
$function$;

create or replace function public.agency_invitation_mark_failed_v2(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_failure_code text,
  p_failure_stage text,
  p_last_successful_operation text,
  p_auth_user_id uuid default null,
  p_failure_metadata jsonb default '{}'::jsonb
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
  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;
  if p_failure_stage not in (
    'AUTH_CREATE',
    'AUTH_USER_RECORD',
    'INVITATION_FINALIZATION'
  ) then
    raise exception 'AGENCY_INVITATION_INVALID_FAILURE_STAGE';
  end if;

  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;
  if request_row.id is null then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;

  if p_auth_user_id is not null then
    if not exists (
      select 1
      from auth.users as auth_user
      where auth_user.id = p_auth_user_id
        and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
          pg_catalog.lower(pg_catalog.btrim(request_row.admin_email))
        and auth_user.raw_user_meta_data->>'account_type' = 'agency'
        and auth_user.raw_user_meta_data->>'provisioning_request_id' =
          request_row.id::text
        and auth_user.raw_user_meta_data->>'agency_id' =
          request_row.agency_id::text
    ) then
      raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH';
    end if;
    if request_row.auth_user_id is not null
      and request_row.auth_user_id <> p_auth_user_id
    then
      raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH';
    end if;
    update public.agency_provisioning_requests
    set auth_user_id = p_auth_user_id
    where id = request_row.id;
  end if;

  perform public.agency_invitation_mark_failed(
    p_actor_auth_user_id,
    p_request_id,
    p_failure_code
  );

  update public.agency_provisioning_requests
  set failure_stage = p_failure_stage,
      failure_code = pg_catalog.left(p_failure_code, 120),
      failure_metadata = coalesce(p_failure_metadata, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('retryable', true),
      last_successful_operation = p_last_successful_operation,
      updated_at = pg_catalog.now()
  where id = request_row.id
  returning * into request_row;

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'failed',
      'display_status', 'Failed'
    );
end;
$function$;

create or replace function public.agency_invitation_activate_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_result jsonb;
  request_row public.agency_provisioning_requests%rowtype;
begin
  request_result := public.agency_invitation_activate();
  update public.agency_provisioning_requests
  set failure_stage = null,
      failure_code = null,
      failure_metadata = '{}'::jsonb,
      last_successful_operation = 'ACTIVATED',
      updated_at = pg_catalog.now()
  where auth_user_id = auth.uid()
    and status = 'Active'
  returning * into request_row;
  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'accepted',
      'display_status', 'Accepted'
    );
end;
$function$;

create or replace function public.agency_invitation_mark_activation_failed(
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_row public.agency_provisioning_requests%rowtype;
begin
  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.auth_user_id = auth.uid()
    and request.status = 'Invitation Sent'
  order by request.created_at desc, request.id
  limit 1
  for update;
  if request_row.id is null then
    raise exception 'AGENCY_INVITATION_REQUEST_NOT_FOUND';
  end if;

  update public.agency_provisioning_requests
  set failure_stage = 'ACTIVATION',
      failure_code = pg_catalog.left(
        coalesce(p_failure_code, 'AGENCY_INVITATION_ACTIVATION_FAILED'),
        120
      ),
      failure_metadata = pg_catalog.jsonb_build_object('retryable', true),
      last_successful_operation = 'INVITATION_SENT',
      updated_at = pg_catalog.now()
  where id = request_row.id
  returning * into request_row;

  insert into public.agency_provisioning_events (
    request_id,
    event_key,
    company_id,
    agency_id,
    actor_user_id,
    actor_auth_user_id,
    event_type,
    from_status,
    to_status,
    event_data
  ) values (
    request_row.id,
    'existing-agency-activation-failed',
    request_row.company_id,
    request_row.agency_id,
    request_row.public_user_id,
    auth.uid(),
    'Activation Failed',
    'Invitation Sent',
    'Invitation Sent',
    pg_catalog.jsonb_build_object(
      'failure_code',
      request_row.failure_code
    )
  )
  on conflict (request_id, event_key) do nothing;

  return public.agency_provisioning_public_result(request_row);
end;
$function$;

revoke all on function public.agency_invitation_begin(uuid)
  from public, anon, authenticated;
revoke all on function public.agency_invitation_record_auth_user(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.agency_invitation_complete(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.agency_invitation_mark_failed(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.agency_invitation_activate()
  from public, anon, authenticated;

revoke all on function public.agency_invitation_begin_v2(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.agency_invitation_record_auth_user_v2(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.agency_invitation_complete_v2(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.agency_invitation_mark_failed_v2(
  uuid, uuid, text, text, text, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.agency_invitation_activate_v2()
  from public, anon, authenticated;
revoke all on function public.agency_invitation_mark_activation_failed(text)
  from public, anon, authenticated;

grant execute on function public.agency_invitation_begin_v2(uuid, jsonb)
  to authenticated;
grant execute on function public.agency_invitation_record_auth_user_v2(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.agency_invitation_complete_v2(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.agency_invitation_mark_failed_v2(
  uuid, uuid, text, text, text, uuid, jsonb
) to service_role;
grant execute on function public.agency_invitation_activate_v2()
  to authenticated;
grant execute on function public.agency_invitation_mark_activation_failed(text)
  to authenticated;

commit;
