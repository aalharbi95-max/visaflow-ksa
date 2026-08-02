begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.notification_event_visible_v1(
  p_company_id uuid,
  p_agency_id uuid,
  p_recipient_role text,
  p_user_id uuid,
  p_workspace_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  with actor as (select public.current_log_actor() value)
  select case
    when actor.value is null or p_workspace_company_id is null then false
    when actor.value->>'role' = 'Agency' then
      p_company_id = p_workspace_company_id
      and p_agency_id::text = actor.value->>'agency_id'
      and p_recipient_role = 'Agency'
      and (p_user_id is null or p_user_id = auth.uid())
      and exists (
        select 1 from public.agency_company_user_access access
        where access.user_id::text = actor.value->>'id'
          and access.company_id = p_workspace_company_id
          and access.agency_id = p_agency_id
          and access.status = 'Active'
      )
    when actor.value->>'role' in ('Platform Owner', 'Platform Accounts User', 'Platform Support User') then
      p_company_id = p_workspace_company_id
      and (
        p_user_id = auth.uid()
        or (p_user_id is null and p_recipient_role = actor.value->>'role')
      )
    else
      p_company_id = p_workspace_company_id
      and p_workspace_company_id::text = actor.value->>'company_id'
      and (
        p_user_id = auth.uid()
        or (
          p_user_id is null
          and (p_recipient_role is null or p_recipient_role in ('Company', actor.value->>'role'))
        )
      )
  end
  from actor;
$function$;

revoke all on function public.notification_event_visible_v1(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.notification_event_visible_v1(uuid, uuid, text, uuid, uuid) to authenticated, service_role;

drop policy if exists secure_notification_select on public.notification_events;
drop policy if exists notification_events_recipient_select on public.notification_events;
create policy notification_events_recipient_select
on public.notification_events for select to authenticated
using (public.notification_event_visible_v1(company_id, agency_id, recipient_role, user_id, company_id));

create or replace function public.notification_center_list_v1(p_company_id uuid)
returns setof public.notification_events
language sql
stable
security definer
set search_path = ''
as $function$
  select notification.*
  from public.notification_events notification
  where public.notification_event_visible_v1(
    notification.company_id,
    notification.agency_id,
    notification.recipient_role,
    notification.user_id,
    p_company_id
  )
  order by notification.created_at desc
  limit 1000;
$function$;

revoke all on function public.notification_center_list_v1(uuid) from public, anon;
grant execute on function public.notification_center_list_v1(uuid) to authenticated;

alter function public.notification_event_mutate(text, bigint, jsonb)
  rename to notification_event_mutate_legacy_20260802;
revoke all on function public.notification_event_mutate_legacy_20260802(text, bigint, jsonb)
  from public, anon, authenticated;

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
  workspace_company_id uuid := nullif(p_payload->>'workspace_company_id', '')::uuid;
  result jsonb;
  target public.notification_events%rowtype;
  updated_count bigint;
  derived_recipient text;
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'active_application_user_required';
  end if;

  if p_operation = 'create' then
    result := public.notification_event_mutate_legacy_20260802(p_operation, p_notification_id, p_payload);
    derived_recipient := case
      when actor->>'role' = 'Agency' then 'Company'
      when nullif(result->>'agency_id', '') is not null then 'Agency'
      else 'Company'
    end;
    update public.notification_events
      set recipient_role = derived_recipient
      where id = (result->>'id')::bigint
      returning to_jsonb(notification_events.*) into result;
    return result;
  end if;

  if workspace_company_id is null then
    raise exception using errcode = '22023', message = 'active_workspace_company_required';
  end if;

  if p_operation = 'mark_all_read' then
    update public.notification_events notification
      set status = 'Read', read_at = now()
      where notification.status <> 'Read'
        and public.notification_event_visible_v1(
          notification.company_id, notification.agency_id, notification.recipient_role,
          notification.user_id, workspace_company_id
        );
    get diagnostics updated_count = row_count;
    return jsonb_build_object('updated', updated_count);
  end if;

  if p_notification_id is null then
    raise exception using errcode = '22023', message = 'notification_id_required';
  end if;

  select notification.* into target
  from public.notification_events notification
  where notification.id = p_notification_id
    and public.notification_event_visible_v1(
      notification.company_id, notification.agency_id, notification.recipient_role,
      notification.user_id, workspace_company_id
    );
  if target.id is null then
    raise exception using errcode = '42501', message = 'notification_access_denied';
  end if;

  if p_operation = 'mark_read' then
    update public.notification_events set status = 'Read', read_at = now()
      where id = target.id returning to_jsonb(notification_events.*) into result;
    return result;
  elsif p_operation = 'delete' then
    delete from public.notification_events where id = target.id
      returning to_jsonb(notification_events.*) into result;
    return result;
  elsif p_operation = 'agency_response' then
    return public.notification_event_mutate_legacy_20260802(p_operation, p_notification_id, p_payload);
  end if;

  raise exception using errcode = '22023', message = 'unsupported_notification_operation';
end;
$function$;

revoke all on function public.notification_event_mutate(text, bigint, jsonb) from public, anon;
grant execute on function public.notification_event_mutate(text, bigint, jsonb) to authenticated;

comment on function public.notification_center_list_v1(uuid) is
  'Lists only notifications addressed to the authenticated actor in the explicitly selected company workspace.';

commit;
