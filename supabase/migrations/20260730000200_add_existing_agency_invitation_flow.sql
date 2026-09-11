begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Existing agency invitations reuse the provisioning request/event tables
-- introduced by 20260726000200. Browser roles may observe tenant-scoped state,
-- but all sensitive user/access writes remain server-mediated.
revoke insert, update, delete on table public.users
  from public, anon, authenticated;
revoke insert, update, delete on table public.agency_company_user_access
  from public, anon, authenticated;
revoke insert, update, delete on table public.agency_provisioning_requests
  from public, anon, authenticated;
revoke insert, update, delete on table public.agency_provisioning_events
  from public, anon, authenticated;

create or replace function public.agency_invitation_begin(
  p_agency_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  actor_company public.companies%rowtype;
  agency_row public.agencies%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
  actor_match_count bigint;
  normalized_email text;
  previous_status text;
  next_attempt integer;
  outcome text;
begin
  select pg_catalog.count(*)
  into actor_match_count
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if actor_match_count <> 1 then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;

  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
  order by app_user.id
  limit 1;

  if actor.status <> 'Active' or actor.is_active is not true then
    raise exception 'AGENCY_INVITATION_USER_INACTIVE';
  end if;
  if actor.role not in ('Admin', 'Company Admin', 'Recruitment Manager') then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;
  if actor.company_id is null then
    raise exception 'AGENCY_INVITATION_COMPANY_INACTIVE';
  end if;

  select company.*
  into actor_company
  from public.companies as company
  where company.id = actor.company_id;

  if actor_company.id is null or actor_company.status <> 'Active' then
    raise exception 'AGENCY_INVITATION_COMPANY_INACTIVE';
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
    )
  for update;

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
      'agency_invitation:' || actor.company_id::text || ':' ||
        agency_row.id::text,
      0::bigint
    )
  );

  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.company_id = actor.company_id
    and request.agency_id = agency_row.id
  order by request.created_at desc, request.id
  limit 1
  for update;

  if request_row.id is not null then
    if request_row.status = 'Active' then
      return public.agency_provisioning_public_result(request_row)
        || pg_catalog.jsonb_build_object(
          'outcome', 'accepted',
          'display_status', 'Accepted'
        );
    end if;

    if request_row.status = 'Invitation Sent'
      and request_row.invitation_sent_at is not null
      and request_row.invitation_sent_at >
        pg_catalog.now() - interval '24 hours'
    then
      return public.agency_provisioning_public_result(request_row)
        || pg_catalog.jsonb_build_object(
          'outcome', 'already_invited',
          'display_status', 'Invitation Sent'
        );
    end if;

    if request_row.status = 'Provisioning'
      and request_row.updated_at >
        pg_catalog.now() - interval '5 minutes'
    then
      return public.agency_provisioning_public_result(request_row)
        || pg_catalog.jsonb_build_object(
          'outcome', 'in_progress',
          'display_status', 'Invitation Sending'
        );
    end if;

    if request_row.status not in (
      'Failed', 'Invitation Sent', 'Provisioning'
    ) then
      raise exception 'AGENCY_INVITATION_INVALID_STATE';
    end if;

    previous_status := case
      when request_row.status = 'Invitation Sent' then 'Expired'
      when request_row.status = 'Provisioning' then 'Failed'
      else request_row.status
    end;
    next_attempt := request_row.attempt_count + 1;

    update public.agency_provisioning_requests
    set agency_name = agency_row.name,
        country = agency_row.country,
        contact_person = agency_row.contact_person,
        admin_email = normalized_email,
        phone = agency_row.phone,
        send_invitation = true,
        status = 'Provisioning',
        attempt_count = next_attempt,
        failure_code = null,
        failure_metadata = '{}'::jsonb,
        failed_at = null,
        updated_at = pg_catalog.now()
    where id = request_row.id
    returning * into request_row;
    outcome := 'send';
  else
    if exists (
      select 1
      from public.users as app_user
      where pg_catalog.lower(
        pg_catalog.btrim(coalesce(app_user.email, ''))
      ) = normalized_email
    ) then
      raise exception 'AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED';
    end if;

    if exists (
      select 1
      from public.agency_provisioning_requests as other_request
      where other_request.company_id = actor.company_id
        and pg_catalog.lower(pg_catalog.btrim(other_request.admin_email)) =
          normalized_email
        and other_request.status in (
          'Draft', 'Provisioning', 'Invitation Sent', 'Active'
        )
    ) then
      raise exception 'AGENCY_INVITATION_ALREADY_EXISTS';
    end if;

    next_attempt := 1;
    previous_status := 'Not Invited';
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
      attempt_count
    ) values (
      pg_catalog.gen_random_uuid(),
      actor.company_id,
      agency_row.id,
      actor.id,
      actor.auth_user_id,
      agency_row.name,
      agency_row.country,
      agency_row.contact_person,
      normalized_email,
      agency_row.phone,
      pg_catalog.jsonb_build_object(
        'can_view_requests', true,
        'can_upload_candidates', true,
        'can_update_candidates', true,
        'can_view_interviews', true
      ),
      true,
      'Provisioning',
      next_attempt
    )
    returning * into request_row;
    outcome := 'send';
  end if;

  insert into public.agency_provisioning_events (
    request_id,
    event_key,
    company_id,
    agency_id,
    actor_user_id,
    actor_auth_user_id,
    event_type,
    from_status,
    to_status
  ) values (
    request_row.id,
    'existing-agency-invitation-attempt-' || next_attempt,
    request_row.company_id,
    request_row.agency_id,
    actor.id,
    actor.auth_user_id,
    case
      when previous_status in ('Failed', 'Expired')
        then 'Invitation Resend Started'
      else 'Invitation Started'
    end,
    previous_status,
    'Provisioning'
  )
  on conflict (request_id, event_key) do nothing;

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', outcome,
      'display_status', 'Invitation Sending'
    );
end;
$function$;

create or replace function public.agency_invitation_record_auth_user(
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
    and app_user.role in (
      'Admin', 'Company Admin', 'Recruitment Manager'
    );

  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
    and request.status = 'Provisioning'
  for update;

  if actor.id is null or request_row.id is null then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;
  if request_row.auth_user_id is not null
    and request_row.auth_user_id <> p_auth_user_id
  then
    raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH';
  end if;
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

  update public.agency_provisioning_requests
  set auth_user_id = p_auth_user_id,
      updated_at = pg_catalog.now()
  where id = request_row.id
  returning * into request_row;

  return public.agency_provisioning_public_result(request_row);
end;
$function$;

create or replace function public.agency_invitation_complete(
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
  select actor_user.*
  into actor
  from public.users as actor_user
  where actor_user.auth_user_id = p_actor_auth_user_id
    and actor_user.status = 'Active'
    and actor_user.is_active is true
    and actor_user.role in (
      'Admin', 'Company Admin', 'Recruitment Manager'
    );

  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;

  if actor.id is null
    or request_row.id is null
    or request_row.status <> 'Provisioning'
    or request_row.auth_user_id <> p_auth_user_id
  then
    raise exception 'AGENCY_INVITATION_INVALID_STATE';
  end if;

  select agency.*
  into agency_row
  from public.agencies as agency
  where agency.id = request_row.agency_id
    and agency.status = 'Active'
    and exists (
      select 1
      from public.company_agency_access as access
      where access.company_id = request_row.company_id
        and access.agency_id = agency.id
        and access.status = 'Active'
    );

  if agency_row.id is null then
    raise exception 'AGENCY_INVITATION_AGENCY_NOT_AVAILABLE';
  end if;

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

  select existing_user.*
  into app_user
  from public.users as existing_user
  where existing_user.auth_user_id = p_auth_user_id
     or pg_catalog.lower(
       pg_catalog.btrim(coalesce(existing_user.email, ''))
     ) = pg_catalog.lower(pg_catalog.btrim(request_row.admin_email))
  order by existing_user.id
  limit 1
  for update;

  if app_user.id is not null
    and (
      app_user.auth_user_id <> p_auth_user_id
      or app_user.role <> 'Agency'
      or app_user.agency_id <> request_row.agency_id
    )
  then
    raise exception 'AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED';
  end if;

  if app_user.id is null then
    insert into public.users (
      name,
      email,
      role,
      agency_name,
      status,
      is_active,
      company_id,
      agency_id,
      auth_user_id
    ) values (
      coalesce(
        nullif(request_row.contact_person, ''),
        agency_row.name
      ),
      request_row.admin_email,
      'Agency',
      agency_row.name,
      'Invitation Sent',
      false,
      null,
      request_row.agency_id,
      p_auth_user_id
    )
    returning * into app_user;
  end if;

  insert into public.agency_company_user_access (
    company_id,
    agency_id,
    user_id,
    role,
    status,
    can_view_requests,
    can_upload_candidates,
    can_update_candidates,
    can_view_interviews
  ) values (
    request_row.company_id,
    request_row.agency_id,
    app_user.id,
    'Agency User',
    'Invitation Sent',
    true,
    true,
    true,
    true
  )
  on conflict (company_id, agency_id, user_id) do update
  set status = case
        when public.agency_company_user_access.status = 'Active'
          then 'Active'
        else 'Invitation Sent'
      end,
      role = 'Agency User',
      can_view_requests = true,
      can_upload_candidates = true,
      can_update_candidates = true,
      can_view_interviews = true;

  update public.agency_provisioning_requests
  set public_user_id = app_user.id,
      status = 'Invitation Sent',
      invitation_sent_at = pg_catalog.now(),
      failure_code = null,
      failure_metadata = '{}'::jsonb,
      failed_at = null,
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
    to_status
  ) values (
    request_row.id,
    'existing-agency-invitation-sent-' || request_row.attempt_count,
    request_row.company_id,
    request_row.agency_id,
    actor.id,
    actor.auth_user_id,
    'Invitation Sent',
    'Provisioning',
    'Invitation Sent'
  )
  on conflict (request_id, event_key) do nothing;

  insert into public.system_activity_logs (
    company_id,
    module_name,
    record_id,
    action_type,
    action_title,
    changed_by_user_id,
    changed_by_role,
    notes,
    source
  ) values (
    request_row.company_id,
    'Agency Provisioning',
    request_row.id::text,
    'Invitation Sent',
    'Existing agency user invitation sent',
    actor.id,
    actor.role,
    'Agency and company ownership were revalidated before access was created.',
    'Edge Function'
  );

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'sent',
      'display_status', 'Invitation Sent'
    );
end;
$function$;

create or replace function public.agency_invitation_mark_failed(
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
  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = p_actor_auth_user_id
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.role in (
      'Admin', 'Company Admin', 'Recruitment Manager'
    );

  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.id = p_request_id
    and request.company_id = actor.company_id
  for update;

  if actor.id is null or request_row.id is null then
    raise exception 'AGENCY_INVITATION_UNAUTHORIZED';
  end if;
  if request_row.status in ('Invitation Sent', 'Active') then
    return public.agency_provisioning_public_result(request_row);
  end if;

  update public.agency_provisioning_requests
  set status = 'Failed',
      failure_code = pg_catalog.left(
        coalesce(p_failure_code, 'INVITATION_FAILED'),
        120
      ),
      failure_metadata = pg_catalog.jsonb_build_object('retryable', true),
      failed_at = pg_catalog.now(),
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
    'existing-agency-invitation-failed-' || request_row.attempt_count,
    request_row.company_id,
    request_row.agency_id,
    actor.id,
    actor.auth_user_id,
    'Invitation Failed',
    'Provisioning',
    'Failed',
    pg_catalog.jsonb_build_object(
      'failure_code',
      request_row.failure_code
    )
  )
  on conflict (request_id, event_key) do nothing;

  insert into public.system_activity_logs (
    company_id,
    module_name,
    record_id,
    action_type,
    action_title,
    changed_by_user_id,
    changed_by_role,
    notes,
    source
  ) values (
    request_row.company_id,
    'Agency Provisioning',
    request_row.id::text,
    'Invitation Failed',
    'Existing agency invitation failed',
    actor.id,
    actor.role,
    'The invitation failed before sensitive access linking completed.',
    'Edge Function'
  );

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'failed',
      'display_status', 'Failed'
    );
end;
$function$;

create or replace function public.agency_invitation_activate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_row public.agency_provisioning_requests%rowtype;
  app_user public.users%rowtype;
begin
  select request.*
  into request_row
  from public.agency_provisioning_requests as request
  where request.auth_user_id = auth.uid()
  order by request.created_at desc, request.id
  limit 1
  for update;

  if request_row.id is null then
    raise exception 'AGENCY_INVITATION_REQUEST_NOT_FOUND';
  end if;
  if request_row.status = 'Active' then
    return public.agency_provisioning_public_result(request_row)
      || pg_catalog.jsonb_build_object(
        'outcome', 'accepted',
        'display_status', 'Accepted'
      );
  end if;
  if request_row.status <> 'Invitation Sent'
    or request_row.public_user_id is null
    or request_row.agency_id is null
  then
    raise exception 'AGENCY_INVITATION_INVALID_STATE';
  end if;

  select existing_user.*
  into app_user
  from public.users as existing_user
  where existing_user.id = request_row.public_user_id
    and existing_user.auth_user_id = auth.uid()
    and existing_user.agency_id = request_row.agency_id
    and existing_user.role = 'Agency'
  for update;

  if app_user.id is null then
    raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH';
  end if;

  update public.users
  set status = 'Active',
      is_active = true,
      updated_at = pg_catalog.now()
  where id = app_user.id
    and auth_user_id = auth.uid();

  update public.agency_company_user_access
  set status = 'Active'
  where company_id = request_row.company_id
    and agency_id = request_row.agency_id
    and user_id = app_user.id;

  update public.agency_provisioning_requests
  set status = 'Active',
      activated_at = pg_catalog.now(),
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
    to_status
  ) values (
    request_row.id,
    'existing-agency-invitation-accepted',
    request_row.company_id,
    request_row.agency_id,
    app_user.id,
    auth.uid(),
    'Invitation Accepted',
    'Invitation Sent',
    'Active'
  )
  on conflict (request_id, event_key) do nothing;

  insert into public.system_activity_logs (
    company_id,
    module_name,
    record_id,
    action_type,
    action_title,
    changed_by_user_id,
    changed_by_role,
    notes,
    source
  ) values (
    request_row.company_id,
    'Agency Provisioning',
    request_row.id::text,
    'Accepted',
    'Agency invitation accepted',
    app_user.id,
    'Agency',
    'The invited Auth identity activated only its verified agency-company access.',
    'Authenticated RPC'
  );

  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object(
      'outcome', 'accepted',
      'display_status', 'Accepted'
    );
end;
$function$;

revoke all on function public.agency_invitation_begin(uuid)
  from public, anon, authenticated;
revoke all on function public.agency_invitation_activate()
  from public, anon, authenticated;
revoke all on function public.agency_invitation_record_auth_user(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.agency_invitation_complete(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.agency_invitation_mark_failed(
  uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.agency_invitation_begin(uuid)
  to authenticated;
grant execute on function public.agency_invitation_activate()
  to authenticated;
grant execute on function public.agency_invitation_record_auth_user(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.agency_invitation_complete(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.agency_invitation_mark_failed(
  uuid, uuid, text
) to service_role;

commit;
