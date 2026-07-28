-- Atomic protected-write layer for Sprint 1.
-- Rollback: revoke/drop the three RPCs below, then remove the added
-- idempotency column/index. Never roll back authorization_events rows alone.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.visa_authorizations
  add column if not exists creation_idempotency_key text;

create unique index if not exists uq_visa_authorizations_creation_idempotency
  on public.visa_authorizations(company_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

alter table public.authorization_events
  drop constraint if exists authorization_events_event_type_check;
alter table public.authorization_events
  add constraint authorization_events_event_type_check
  check (event_type in (
    'Created', 'Sent', 'Resent', 'Viewed', 'Acknowledged',
    'Accepted', 'Rejected', 'Cancelled'
  ));

create or replace function public.authorization_workflow_notify(
  p_authorization public.visa_authorizations,
  p_type text,
  p_reason text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  manager record;
  title_text text := initcap(lower(replace(p_type, '_', ' ')));
  message_text text;
begin
  if p_type not in ('AUTHORIZATION_SENT', 'AUTHORIZATION_ACCEPTED', 'AUTHORIZATION_REJECTED') then
    raise exception using errcode = '22023', message = 'unsupported_notification_type';
  end if;

  message_text := coalesce(nullif(p_authorization.authorization_no, ''), nullif(p_authorization.visa_no, ''), 'Authorization')
    || case p_type
      when 'AUTHORIZATION_SENT' then ' was sent to the agency.'
      when 'AUTHORIZATION_ACCEPTED' then ' was accepted by the agency.'
      else ' was rejected by the agency. Reason: ' || coalesce(p_reason, '')
    end;

  insert into public.notification_events (
    company_id, agency_id, agency_name, recipient_role, type, title, message,
    priority, status, related_table, related_id, request_no, response_status,
    response_at, rejection_reason, dedupe_key, data
  ) values (
    p_authorization.company_id, p_authorization.agency_id, p_authorization.agency,
    'Agency', p_type, title_text, message_text,
    case when p_type = 'AUTHORIZATION_REJECTED' then 'High' else 'Medium' end,
    'Unread', 'visa_authorizations', p_authorization.id::text,
    p_authorization.request_no, p_authorization.agency_status,
    case when p_type = 'AUTHORIZATION_SENT' then null else now() end,
    case when p_type = 'AUTHORIZATION_REJECTED' then p_reason else null end,
    'authorization:' || p_authorization.id::text || ':agency:' || p_idempotency_key,
    jsonb_build_object('authorization_id', p_authorization.id, 'recipient_role', 'Agency')
  ) on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing;

  for manager in
    select auth_user_id, role
    from public.users
    where company_id = p_authorization.company_id
      and status = 'Active' and is_active is true
      and role in ('Recruitment Manager', 'Recruitment Director')
  loop
    insert into public.notification_events (
      company_id, user_id, recipient_role, agency_name, type, title, message,
      priority, status, related_table, related_id, request_no, response_status,
      response_at, rejection_reason, dedupe_key, data
    ) values (
      p_authorization.company_id, manager.auth_user_id, manager.role,
      p_authorization.agency, p_type, title_text, message_text,
      case when p_type = 'AUTHORIZATION_REJECTED' then 'High' else 'Medium' end,
      'Unread', 'visa_authorizations', p_authorization.id::text,
      p_authorization.request_no, p_authorization.agency_status,
      case when p_type = 'AUTHORIZATION_SENT' then null else now() end,
      case when p_type = 'AUTHORIZATION_REJECTED' then p_reason else null end,
      'authorization:' || p_authorization.id::text || ':' || manager.auth_user_id::text || ':' || p_idempotency_key,
      jsonb_build_object('authorization_id', p_authorization.id, 'recipient_role', manager.role)
    ) on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing;
  end loop;
end;
$function$;

revoke all on function public.authorization_workflow_notify(public.visa_authorizations, text, text, text)
  from public, anon, authenticated;

create or replace function public.authorization_workflow_mutate(
  p_action text,
  p_authorization_id uuid default null,
  p_input jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  authorization public.visa_authorizations%rowtype;
  allocation public.visa_allocations%rowtype;
  agency public.agencies%rowtype;
  normalized_action text := lower(trim(coalesce(p_action, '')));
  reason_text text := nullif(trim(coalesce(p_input->>'reason', '')), '');
  event_name text;
  next_status text;
  now_at timestamptz := now();
  requested_qty integer;
  already_authorized bigint;
  is_resend boolean;
  timeline jsonb;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[0-9a-fA-F-]{36}$' then
    raise exception using errcode = '22023', message = 'valid_idempotency_key_required';
  end if;
  if p_input ? 'company_id' or p_input ? 'actor_user_id' or p_input ? 'recipient_role' then
    raise exception using errcode = '22023', message = 'server_controlled_field';
  end if;

  begin
    select app_user.* into strict actor
    from public.users app_user
    where app_user.auth_user_id = auth.uid()
      and app_user.status = 'Active' and app_user.is_active is true
      and (
        (app_user.role in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
          and app_user.company_id is null)
        or (app_user.role = 'Agency' and app_user.agency_id is not null
          and exists (select 1 from public.agencies a where a.id = app_user.agency_id and a.status = 'Active'))
        or (app_user.role not in ('Agency', 'Platform Owner', 'Platform Accounts User', 'Platform Support User')
          and app_user.company_id is not null
          and exists (select 1 from public.companies c where c.id = app_user.company_id and c.status = 'Active'))
      );
  exception
    when no_data_found then
      raise exception using errcode = '42501', message = 'active_application_user_required';
    when too_many_rows then
      raise exception using errcode = '42501', message = 'ambiguous_actor_identity';
  end;

  if normalized_action = 'create' then
    if actor.role not in ('Admin', 'Company Admin', 'Visa Team') or actor.company_id is null then
      raise exception using errcode = '42501', message = 'company_role_denied';
    end if;
    select * into authorization from public.visa_authorizations
    where company_id = actor.company_id and creation_idempotency_key = p_idempotency_key;
    if found then
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
      into timeline from public.authorization_events e where e.authorization_id = authorization.id;
      return jsonb_build_object('authorization', to_jsonb(authorization), 'events', timeline, 'idempotent', true);
    end if;

    requested_qty := (p_input->>'allocated_qty')::integer;
    if requested_qty <= 0 then raise exception using errcode = '22023', message = 'allocated_qty_must_be_positive'; end if;
    select * into strict allocation from public.visa_allocations
      where id = (p_input->>'visa_allocation_id')::bigint and company_id = actor.company_id
      for update;
    -- A concurrent duplicate may have committed while this request waited for
    -- the allocation lock. Recheck so both callers receive the same result.
    select * into authorization from public.visa_authorizations
    where company_id = actor.company_id and creation_idempotency_key = p_idempotency_key;
    if found then
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
      into timeline from public.authorization_events e where e.authorization_id = authorization.id;
      return jsonb_build_object('authorization', to_jsonb(authorization), 'events', timeline, 'idempotent', true);
    end if;
    select coalesce(sum(allocated_qty), 0) into already_authorized
      from public.visa_authorizations
      where company_id = actor.company_id and visa_allocation_id = allocation.id and status <> 'Cancelled';
    if already_authorized + requested_qty > allocation.allocated_qty then
      raise exception using errcode = '23514', message = 'authorization_quantity_exceeds_allocation';
    end if;

    select * into strict agency from public.agencies
      where id = (p_input->>'agency_id')::uuid and status = 'Active';
    if not exists (
      select 1 from public.company_agency_access access
      where access.company_id = actor.company_id and access.agency_id = agency.id and access.status = 'Active'
    ) then raise exception using errcode = '42501', message = 'agency_not_active_for_company'; end if;
    if nullif(trim(p_input->>'authorization_no'), '') is null then
      raise exception using errcode = '22023', message = 'authorization_no_required';
    end if;

    insert into public.visa_authorizations (
      company_id, visa_id, visa_no, request_no, visa_allocation_id, visa_batch_line_id,
      profession, nationality, gender, authorization_no, agency_id, agency,
      office_country, allocated_qty, received_candidates, interview_passed, mobilized,
      status, agency_status, created_at, updated_at, updated_by,
      created_by_name, created_by_email, created_by_role,
      updated_by_name, updated_by_email, updated_by_role, creation_idempotency_key
    ) values (
      actor.company_id, nullif(p_input->>'visa_id', '')::uuid, allocation.visa_no,
      allocation.request_no, allocation.id, allocation.visa_batch_line_id,
      nullif(trim(p_input->>'profession'), ''), nullif(trim(p_input->>'nationality'), ''),
      nullif(trim(p_input->>'gender'), ''), trim(p_input->>'authorization_no'),
      agency.id, agency.name, nullif(trim(p_input->>'office_country'), ''), requested_qty,
      0, 0, 0, 'New', 'New', now_at, now_at, actor.auth_user_id,
      coalesce(nullif(actor.name, ''), actor.email), actor.email, actor.role,
      coalesce(nullif(actor.name, ''), actor.email), actor.email, actor.role, p_idempotency_key
    ) returning * into authorization;
    event_name := 'Created';
  else
    if p_authorization_id is null then raise exception using errcode = '22023', message = 'authorization_id_required'; end if;
    select * into strict authorization from public.visa_authorizations
      where id = p_authorization_id for update;

    if exists (
      select 1 from public.authorization_events
      where authorization_id = authorization.id and idempotency_key = p_idempotency_key
    ) then
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
      into timeline from public.authorization_events e where e.authorization_id = authorization.id;
      return jsonb_build_object('authorization', to_jsonb(authorization), 'events', timeline, 'idempotent', true);
    end if;

    if normalized_action in ('send', 'resend', 'cancel') then
      if actor.role not in ('Admin', 'Company Admin', 'Visa Team')
        or actor.company_id is distinct from authorization.company_id then
        raise exception using errcode = '42501', message = 'company_authorization_access_denied';
      end if;
    else
      if normalized_action not in ('view', 'acknowledge', 'accept', 'reject')
        or actor.role <> 'Agency' or actor.agency_id is distinct from authorization.agency_id
        or not exists (
          select 1 from public.agency_company_user_access access
          where access.user_id = actor.id and access.company_id = authorization.company_id
            and access.agency_id = actor.agency_id and access.status = 'Active'
        ) then raise exception using errcode = '42501', message = 'agency_authorization_access_denied'; end if;
      if authorization.sent_at is null then raise exception using errcode = '23514', message = 'authorization_not_sent'; end if;
    end if;

    if normalized_action in ('send', 'resend') then
      if authorization.status = 'Cancelled' or authorization.agency_id is null then
        raise exception using errcode = '23514', message = 'authorization_cannot_be_sent';
      end if;
      if not exists (
        select 1 from public.company_agency_access access join public.agencies a on a.id = access.agency_id
        where access.company_id = actor.company_id and access.agency_id = authorization.agency_id
          and access.status = 'Active' and a.status = 'Active'
      ) then raise exception using errcode = '42501', message = 'agency_not_active_for_company'; end if;
      is_resend := authorization.sent_at is not null;
      if is_resend and normalized_action <> 'resend' then
        raise exception using errcode = '23505', message = 'already_sent_use_resend';
      end if;
      if is_resend and coalesce((p_input->>'confirm_resend')::boolean, false) is not true then
        raise exception using errcode = '22023', message = 'resend_confirmation_required';
      end if;
      update public.visa_authorizations set status = 'Sent to Agency',
        agency_status = case when is_resend then agency_status else 'New' end,
        sent_at = now_at, sent_by = actor.auth_user_id, send_count = send_count + 1,
        updated_at = now_at, updated_by = actor.auth_user_id,
        updated_by_name = coalesce(nullif(actor.name, ''), actor.email),
        updated_by_email = actor.email, updated_by_role = actor.role
      where id = authorization.id returning * into authorization;
      event_name := case when is_resend then 'Resent' else 'Sent' end;
    elsif normalized_action = 'cancel' then
      if authorization.status = 'Cancelled' then raise exception using errcode = '23505', message = 'already_cancelled'; end if;
      if nullif(trim(p_input->>'cancellation_no'), '') is null
        or coalesce(p_input->>'cancelled_at', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception using errcode = '22023', message = 'valid_cancellation_details_required';
      end if;
      update public.visa_authorizations set status = 'Cancelled',
        cancellation_no = trim(p_input->>'cancellation_no'),
        cancelled_at = (p_input->>'cancelled_at')::date,
        updated_at = now_at, updated_by = actor.auth_user_id,
        updated_by_name = coalesce(nullif(actor.name, ''), actor.email),
        updated_by_email = actor.email, updated_by_role = actor.role
      where id = authorization.id returning * into authorization;
      event_name := 'Cancelled';
    else
      if normalized_action = 'view'
        and authorization.agency_status in ('Viewed', 'Acknowledged', 'Accepted', 'Rejected') then
        select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
        into timeline from public.authorization_events e where e.authorization_id = authorization.id;
        return jsonb_build_object('authorization', to_jsonb(authorization), 'events', timeline, 'idempotent', true);
      end if;
      if normalized_action = 'view' then
        if authorization.agency_status <> 'New' then raise exception using errcode = '23514', message = 'invalid_view_transition'; end if;
        next_status := 'Viewed'; event_name := 'Viewed';
      elsif normalized_action = 'acknowledge' then
        if authorization.agency_status not in ('New', 'Viewed') then raise exception using errcode = '23514', message = 'invalid_acknowledge_transition'; end if;
        next_status := 'Acknowledged'; event_name := 'Acknowledged';
      elsif normalized_action = 'accept' then
        if authorization.agency_status <> 'Acknowledged' then raise exception using errcode = '23514', message = 'invalid_accept_transition'; end if;
        next_status := 'Accepted'; event_name := 'Accepted';
      elsif normalized_action = 'reject' then
        if authorization.agency_status <> 'Acknowledged' then raise exception using errcode = '23514', message = 'invalid_reject_transition'; end if;
        if reason_text is null or length(reason_text) > 1000 then raise exception using errcode = '22023', message = 'valid_rejection_reason_required'; end if;
        next_status := 'Rejected'; event_name := 'Rejected';
      end if;
      update public.visa_authorizations set agency_status = next_status, status = next_status,
        viewed_at = case when normalized_action in ('view', 'acknowledge') and viewed_at is null then now_at else viewed_at end,
        viewed_by = case when normalized_action in ('view', 'acknowledge') and viewed_by is null then actor.auth_user_id else viewed_by end,
        acknowledged_at = case when normalized_action = 'acknowledge' then now_at else acknowledged_at end,
        acknowledged_by = case when normalized_action = 'acknowledge' then actor.auth_user_id else acknowledged_by end,
        decision_at = case when normalized_action in ('accept', 'reject') then now_at else decision_at end,
        decision_by = case when normalized_action in ('accept', 'reject') then actor.auth_user_id else decision_by end,
        response_reason = case when normalized_action in ('accept', 'reject') then reason_text else response_reason end,
        updated_at = now_at, updated_by = actor.auth_user_id,
        updated_by_name = coalesce(nullif(actor.name, ''), actor.email),
        updated_by_email = actor.email, updated_by_role = actor.role
      where id = authorization.id returning * into authorization;
    end if;
  end if;

  if normalized_action = 'acknowledge' and authorization.viewed_at = now_at then
    insert into public.authorization_events (
      authorization_id, company_id, agency_id, event_type, actor_user_id,
      actor_auth_user_id, actor_name, actor_email, actor_role, reason,
      idempotency_key, metadata, created_at
    ) values (
      authorization.id, authorization.company_id, authorization.agency_id, 'Viewed',
      actor.id, actor.auth_user_id, coalesce(nullif(actor.name, ''), actor.email),
      actor.email, actor.role, null, p_idempotency_key || ':implicit-view',
      jsonb_build_object('implicit', true), now_at
    );
  end if;

  insert into public.authorization_events (
    authorization_id, company_id, agency_id, event_type, actor_user_id,
    actor_auth_user_id, actor_name, actor_email, actor_role, reason,
    idempotency_key, metadata
  ) values (
    authorization.id, authorization.company_id, authorization.agency_id, event_name,
    actor.id, actor.auth_user_id, coalesce(nullif(actor.name, ''), actor.email),
    actor.email, actor.role, reason_text, p_idempotency_key,
    jsonb_build_object('action', normalized_action, 'send_count', authorization.send_count)
  );

  if event_name in ('Sent', 'Resent') then
    perform public.authorization_workflow_notify(authorization, 'AUTHORIZATION_SENT', null, p_idempotency_key);
  elsif event_name = 'Accepted' then
    perform public.authorization_workflow_notify(authorization, 'AUTHORIZATION_ACCEPTED', reason_text, p_idempotency_key);
  elsif event_name = 'Rejected' then
    perform public.authorization_workflow_notify(authorization, 'AUTHORIZATION_REJECTED', reason_text, p_idempotency_key);
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
  into timeline from public.authorization_events e where e.authorization_id = authorization.id;
  return jsonb_build_object('authorization', to_jsonb(authorization), 'events', timeline, 'idempotent', false);
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'protected_resource_not_found';
  when too_many_rows then
    raise exception using errcode = '21000', message = 'ambiguous_actor_identity';
end;
$function$;

revoke all on function public.authorization_workflow_mutate(text, uuid, jsonb, text)
  from public, anon;
grant execute on function public.authorization_workflow_mutate(text, uuid, jsonb, text)
  to authenticated;

create or replace function public.notification_event_mutate(
  p_operation text,
  p_notification_id bigint default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor jsonb := public.current_log_actor();
  result_row public.notification_events%rowtype;
  allowed_types constant text[] := array[
    'AGENCY_REQUEST_RESPONSE','NEW_REQUEST_AGENCY_ALERT','AGENCY_AGREEMENT_SENT',
    'AGENCY_AGREEMENT_ACCEPTED','INTERVIEW_SCHEDULE_APPROVED','INTERVIEW_SCHEDULE_REJECTED',
    'AGENCY_INTERVIEW_SCHEDULED','WORKFORCE_REDEPLOYMENT_REVIEW','AGENCY_PENALTY_SENT',
    'AI_AGENT_DAILY_BRIEF','AI_AGENT_ASSIGNMENT_APPROVAL','AI_AGENT_AGENCY_ASSIGNMENT',
    'AI_AGENT_AUTO_AGENCY_FOLLOWUP','AI_AGENT_AGENCY_FOLLOWUP','JOB_OFFER_EMAIL',
    'OFFICE_BULK_CANDIDATE_UPDATE','CANDIDATE_UPDATED','CANDIDATE_CREATED',
    'AGENCY_TALENT_POOL_UPLOAD','UPDATE_COMPLIANCE_ALERT'
  ];
  requested_agency uuid;
  target_company uuid;
begin
  if actor is null then raise exception using errcode = '42501', message = 'active_application_user_required'; end if;
  if p_payload ? 'company_id' or p_payload ? 'user_id' or p_payload ? 'recipient_role'
    or p_payload ? 'actor_user_id' then
    raise exception using errcode = '22023', message = 'server_controlled_field';
  end if;

  if p_operation = 'create' then
    if not ((p_payload->>'type') = any(allowed_types)) then
      raise exception using errcode = '22023', message = 'unsupported_notification_type';
    end if;
    target_company := nullif(actor->>'company_id', '')::uuid;
    requested_agency := nullif(p_payload->>'agency_id', '')::uuid;
    if actor->>'role' = 'Agency' then
      target_company := nullif(p_payload->>'workspace_company_id', '')::uuid;
      requested_agency := (actor->>'agency_id')::uuid;
      if target_company is null or not exists (
        select 1 from public.agency_company_user_access access
        where access.user_id::text = actor->>'id' and access.company_id = target_company
          and access.agency_id = requested_agency and access.status = 'Active'
      ) then raise exception using errcode = '42501', message = 'agency_company_access_denied'; end if;
    elsif requested_agency is not null and not exists (
      select 1 from public.company_agency_access access join public.agencies a on a.id = access.agency_id
      where access.company_id = (actor->>'company_id')::uuid
        and access.agency_id = requested_agency and access.status = 'Active' and a.status = 'Active'
    ) then raise exception using errcode = '42501', message = 'agency_not_active_for_company'; end if;

    insert into public.notification_events (
      company_id, agency_id, agency_name, type, title, message, priority, status,
      related_table, related_id, request_no, response_status, response_at,
      rejection_reason, sla_started_at, sla_days, sla_due_at, data
    ) values (
      target_company, requested_agency, left(coalesce(p_payload->>'agency_name', ''), 300),
      p_payload->>'type', left(coalesce(p_payload->>'title', p_payload->>'type'), 300),
      left(coalesce(p_payload->>'message', p_payload->>'type'), 2000),
      case when p_payload->>'priority' in ('Low','Medium','High','Critical') then p_payload->>'priority' else 'Medium' end,
      'Unread', left(coalesce(p_payload->>'related_table', ''), 120),
      left(coalesce(p_payload->>'related_id', ''), 500), left(coalesce(p_payload->>'request_no', ''), 200),
      left(coalesce(p_payload->>'response_status', ''), 120), nullif(p_payload->>'response_at', '')::timestamptz,
      left(coalesce(p_payload->>'rejection_reason', ''), 1000), nullif(p_payload->>'sla_started_at', '')::timestamptz,
      nullif(p_payload->>'sla_days', '')::integer, nullif(p_payload->>'sla_due_at', '')::timestamptz,
      coalesce(p_payload->'data', '{}'::jsonb)
    ) returning * into result_row;
  elsif p_operation = 'agency_response' then
    if actor->>'role' <> 'Agency' or p_notification_id is null
      or p_payload->>'response_status' not in ('Accepted', 'Rejected')
      or (p_payload->>'response_status' = 'Rejected'
        and nullif(trim(p_payload->>'rejection_reason'), '') is null) then
      raise exception using errcode = '22023', message = 'valid_agency_response_required';
    end if;
    update public.notification_events set
      status = 'Read', read_at = now(), response_status = p_payload->>'response_status',
      response_at = now(), rejection_reason = left(coalesce(p_payload->>'rejection_reason', ''), 1000),
      sla_started_at = nullif(p_payload->>'sla_started_at', '')::timestamptz,
      sla_days = nullif(p_payload->>'sla_days', '')::integer,
      sla_due_at = nullif(p_payload->>'sla_due_at', '')::timestamptz,
      data = coalesce(p_payload->'data', '{}'::jsonb)
    where id = p_notification_id
      and agency_id::text = actor->>'agency_id'
      and exists (
        select 1 from public.agency_company_user_access access
        where access.user_id::text = actor->>'id'
          and access.company_id = notification_events.company_id
          and access.agency_id = notification_events.agency_id
          and access.status = 'Active'
      )
    returning * into result_row;
  elsif p_operation in ('mark_read', 'delete') then
    if p_notification_id is null then raise exception using errcode = '22023', message = 'notification_id_required'; end if;
    if p_operation = 'mark_read' then
      update public.notification_events set status = 'Read', read_at = now()
      where id = p_notification_id and (
        (company_id::text = actor->>'company_id' and (
          (user_id is not null and user_id = auth.uid())
          or (user_id is null and recipient_role = actor->>'role')
          or (user_id is null and recipient_role is null)
        ))
        or (actor->>'role' = 'Agency' and agency_id::text = actor->>'agency_id')
      ) returning * into result_row;
    else
      delete from public.notification_events where id = p_notification_id and (
        (company_id::text = actor->>'company_id' and (
          (user_id is not null and user_id = auth.uid())
          or (user_id is null and recipient_role = actor->>'role')
          or (user_id is null and recipient_role is null)
        ))
        or (actor->>'role' = 'Agency' and agency_id::text = actor->>'agency_id')
      ) returning * into result_row;
    end if;
  elsif p_operation = 'mark_all_read' then
    update public.notification_events set status = 'Read', read_at = now()
    where status <> 'Read' and (
      (company_id::text = actor->>'company_id' and (
        (user_id is not null and user_id = auth.uid())
        or (user_id is null and recipient_role = actor->>'role')
        or (user_id is null and recipient_role is null)
      ))
      or (actor->>'role' = 'Agency' and agency_id::text = actor->>'agency_id')
    );
    return jsonb_build_object('updated', found);
  else
    raise exception using errcode = '22023', message = 'unsupported_notification_operation';
  end if;

  if result_row.id is null then raise exception using errcode = '42501', message = 'notification_access_denied'; end if;
  return to_jsonb(result_row);
end;
$function$;

revoke all on function public.notification_event_mutate(text, bigint, jsonb)
  from public, anon;
grant execute on function public.notification_event_mutate(text, bigint, jsonb)
  to authenticated;

comment on function public.authorization_workflow_mutate(text, uuid, jsonb, text) is
  'Atomic tenant-checked Authorization mutation, event append, and notification creation.';
comment on function public.notification_event_mutate(text, bigint, jsonb) is
  'Guarded notification mutation. Tenant, recipient, type, and actor are server validated.';
