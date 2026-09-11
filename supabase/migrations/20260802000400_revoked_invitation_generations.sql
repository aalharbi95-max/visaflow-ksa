-- Revocation closes one invitation generation permanently. A later explicit
-- new invitation receives a fresh request/idempotency key and audit trail.
create or replace function public.agency_invitation_begin_v4(
  p_agency_id uuid,
  p_permissions jsonb,
  p_action text default 'invite_existing'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  latest_request public.agency_provisioning_requests%rowtype;
  new_request public.agency_provisioning_requests%rowtype;
  allowed_keys constant text[] := array['can_view_requests', 'can_upload_candidates', 'can_update_candidates', 'can_view_interviews'];
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid() and app_user.status = 'Active'
    and app_user.is_active is true and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_INVITATION_UNAUTHORIZED'; end if;
  if p_action not in ('invite_existing', 'resend_invitation') then raise exception 'AGENCY_INVITATION_INVALID_ACTION'; end if;
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_permissions) supplied(key) where not (supplied.key = any(allowed_keys)))
    or exists (select 1 from unnest(allowed_keys) required(key)
      where not p_permissions ? required.key or jsonb_typeof(p_permissions->required.key) <> 'boolean') then
    raise exception 'AGENCY_INVITATION_INVALID_PERMISSIONS';
  end if;
  if not exists (select 1 from public.company_agency_access access
    where access.company_id = actor.company_id and access.agency_id = p_agency_id and access.status = 'Active') then
    raise exception 'AGENCY_INVITATION_AGENCY_NOT_AVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('agency_invitation:' || actor.company_id::text || ':' || p_agency_id::text, 0)
  );
  select request.* into latest_request from public.agency_provisioning_requests request
  where request.company_id = actor.company_id and request.agency_id = p_agency_id
  order by request.created_at desc, request.id limit 1 for update;

  if latest_request.id is null or latest_request.status <> 'Revoked' then
    return public.agency_invitation_begin_v3(p_agency_id, p_permissions, p_action);
  end if;
  if p_action = 'resend_invitation' then raise exception 'AGENCY_INVITATION_REVOKED'; end if;

  if coalesce(pg_catalog.btrim(latest_request.admin_email), '') = '' then
    raise exception 'AGENCY_INVITATION_EMAIL_REQUIRED';
  end if;

  insert into public.agency_provisioning_requests (
    id, idempotency_key, company_id, agency_id, requested_by_user_id,
    requested_by_auth_user_id, agency_name, country, contact_person,
    admin_email, phone, permissions, send_invitation, status, attempt_count
  ) values (
    pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), actor.company_id, latest_request.agency_id, actor.id,
    actor.auth_user_id, latest_request.agency_name, latest_request.country, latest_request.contact_person,
    pg_catalog.lower(pg_catalog.btrim(latest_request.admin_email)), latest_request.phone,
    p_permissions, true, 'Provisioning', 1
  ) returning * into new_request;

  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status, event_data
  ) values (
    new_request.id, 'invitation-generation-started-1', new_request.company_id,
    new_request.agency_id, actor.id, actor.auth_user_id,
    'Invitation Started', 'Revoked', 'Provisioning',
    pg_catalog.jsonb_build_object('previous_request_id', latest_request.id)
  );
  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (
    actor.company_id, 'Agency Provisioning', new_request.id::text,
    'Invitation Started', 'New agency invitation generation started',
    actor.id, actor.role, 'A new invitation was created after the previous generation was revoked.', 'Protected RPC'
  );
  return public.agency_provisioning_public_result(new_request)
    || pg_catalog.jsonb_build_object('outcome', 'send', 'display_status', 'Invitation Sending',
      'previous_request_id', latest_request.id);
end;
$function$;

revoke all on function public.agency_invitation_begin_v4(uuid, jsonb, text) from public, anon;
grant execute on function public.agency_invitation_begin_v4(uuid, jsonb, text) to authenticated;
