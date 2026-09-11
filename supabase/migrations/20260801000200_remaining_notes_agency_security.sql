begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Canonical bilingual nationality reference fields. Existing operational rows
-- are intentionally not rewritten; new request lines store countries.nationality.
alter table public.countries
  add column if not exists name_ar text,
  add column if not exists nationality_ar text;

update public.countries set name_ar = 'الهند', nationality_ar = 'هندي'
where upper(coalesce(iso_code, '')) = 'IN';
update public.countries set name_ar = 'المملكة العربية السعودية', nationality_ar = 'سعودي'
where upper(coalesce(iso_code, '')) in ('SA', 'SAU');

-- Agreement delivery must bind to an immutable agency id, not a mutable or
-- globally duplicated display name.
alter table public.agency_agreements
  add column if not exists agency_id uuid references public.agencies(id) on delete restrict;

with unique_match as (
  select agreement.id as agreement_id, min(agency.id::text)::uuid as agency_id
  from public.agency_agreements agreement
  join public.agencies agency
    on lower(btrim(agency.name)) = lower(btrim(agreement.agency_name))
  join public.company_agency_access access
    on access.company_id = agreement.company_id
   and access.agency_id = agency.id
   and coalesce(access.status, 'Active') <> 'Inactive'
  where agreement.agency_id is null
  group by agreement.id
  having count(distinct agency.id) = 1
)
update public.agency_agreements agreement
set agency_id = unique_match.agency_id
from unique_match
where agreement.id = unique_match.agreement_id;

create index if not exists agency_agreements_company_agency_idx
  on public.agency_agreements (company_id, agency_id, created_at desc);

alter table public.agency_agreements enable row level security;
drop policy if exists agency_agreements_tenant_select on public.agency_agreements;
drop policy if exists agency_agreements_tenant_insert on public.agency_agreements;
drop policy if exists agency_agreements_tenant_update on public.agency_agreements;
drop policy if exists agency_agreements_tenant_delete on public.agency_agreements;

create policy agency_agreements_tenant_select on public.agency_agreements
for select to authenticated using (
  public.is_current_platform_user()
  or exists (select 1 from public.users actor where actor.auth_user_id = auth.uid()
    and actor.status = 'Active' and actor.is_active is true
    and actor.role <> 'Agency' and actor.company_id = agency_agreements.company_id)
  or exists (select 1 from public.users actor
    join public.agency_company_user_access access on access.user_id = actor.id
      and access.company_id = agency_agreements.company_id and access.status = 'Active'
    join public.agencies agency on agency.id = actor.agency_id and agency.status = 'Active'
    where actor.auth_user_id = auth.uid() and actor.role = 'Agency'
      and actor.status = 'Active' and actor.is_active is true
      and (agency_agreements.agency_id = actor.agency_id
        or (agency_agreements.agency_id is null and lower(btrim(agency_agreements.agency_name)) = lower(btrim(agency.name))))
  )
);

create policy agency_agreements_tenant_insert on public.agency_agreements
for insert to authenticated with check (
  public.is_current_platform_user()
  or exists (select 1 from public.users actor
    join public.company_agency_access access on access.company_id = actor.company_id
      and access.agency_id = agency_agreements.agency_id and access.status = 'Active'
    where actor.auth_user_id = auth.uid() and actor.status = 'Active' and actor.is_active is true
      and actor.role in ('Admin', 'Company Admin', 'Recruitment Manager')
      and actor.company_id = agency_agreements.company_id)
);

create policy agency_agreements_tenant_update on public.agency_agreements
for update to authenticated using (
  public.is_current_platform_user()
  or exists (select 1 from public.users actor where actor.auth_user_id = auth.uid()
    and actor.status = 'Active' and actor.is_active is true
    and actor.role in ('Admin', 'Company Admin', 'Recruitment Manager')
    and actor.company_id = agency_agreements.company_id)
) with check (
  public.is_current_platform_user()
  or exists (select 1 from public.users actor
    join public.company_agency_access access on access.company_id = actor.company_id
      and access.agency_id = agency_agreements.agency_id and access.status = 'Active'
    where actor.auth_user_id = auth.uid() and actor.status = 'Active' and actor.is_active is true
      and actor.role in ('Admin', 'Company Admin', 'Recruitment Manager')
      and actor.company_id = agency_agreements.company_id)
);

create policy agency_agreements_tenant_delete on public.agency_agreements
for delete to authenticated using (
  public.is_current_platform_user()
  or exists (select 1 from public.users actor where actor.auth_user_id = auth.uid()
    and actor.status = 'Active' and actor.is_active is true
    and actor.role in ('Admin', 'Company Admin', 'Recruitment Manager')
    and actor.company_id = agency_agreements.company_id)
);
revoke all on table public.agency_agreements from anon, authenticated;
grant select, insert, update, delete on table public.agency_agreements to authenticated;

create or replace function public.agency_agreement_accept_v1(p_agreement_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare actor public.users%rowtype; agreement_row public.agency_agreements%rowtype; signer text;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid() and app_user.role = 'Agency'
    and app_user.status = 'Active' and app_user.is_active is true and app_user.agency_id is not null;
  if actor.id is null then raise exception 'AGENCY_AGREEMENT_UNAUTHORIZED'; end if;
  select agreement.* into agreement_row from public.agency_agreements agreement
  where agreement.id = p_agreement_id and agreement.status = 'Pending Signature'
    and (agreement.agency_id = actor.agency_id or (agreement.agency_id is null and lower(btrim(agreement.agency_name)) = lower(btrim(actor.agency_name))))
    and exists (select 1 from public.agency_company_user_access access
      where access.user_id = actor.id and access.company_id = agreement.company_id
        and access.agency_id = actor.agency_id and access.status = 'Active')
  for update;
  if agreement_row.id is null then raise exception 'AGENCY_AGREEMENT_NOT_FOUND'; end if;
  signer := coalesce(nullif(actor.name, ''), actor.email, 'Agency User');
  update public.agency_agreements set status = 'Active',
    signed_by_agency = coalesce(nullif(signed_by_agency, ''), signer),
    agency_signature = 'Accepted electronically by ' || signer || ' (' || coalesce(actor.email, '') || ')',
    agency_accepted_by = signer, agency_accepted_email = actor.email,
    agency_accepted_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = agreement_row.id returning * into agreement_row;
  return pg_catalog.jsonb_build_object('id', agreement_row.id, 'company_id', agreement_row.company_id,
    'agency_id', agreement_row.agency_id, 'status', agreement_row.status,
    'agency_accepted_at', agreement_row.agency_accepted_at);
end;
$function$;

-- Provider-aware, retryable email audit fields. Recipient is tenant-protected
-- by the existing email_logs RLS and is masked in the UI for non-admin roles.
alter table public.email_logs
  add column if not exists agency_id uuid references public.agencies(id) on delete set null,
  add column if not exists user_id bigint references public.users(id) on delete set null,
  add column if not exists recipient text,
  add column if not exists provider_message_id text,
  add column if not exists error_code text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists sent_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists idempotency_key text;

create unique index if not exists email_logs_company_idempotency_unique
  on public.email_logs (company_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists email_logs_agency_created_idx
  on public.email_logs (company_id, agency_id, created_at desc);
create index if not exists email_logs_recipient_search_idx
  on public.email_logs (company_id, lower(recipient));

update public.email_logs
set error_message = 'Email delivery failed at the provider.'
where error_message is not null and btrim(error_message) <> '';

alter table public.agency_provisioning_requests
  add column if not exists auth_identity_preexisting boolean not null default false;

alter table public.agency_provisioning_requests
  drop constraint if exists agency_provisioning_requests_status_check;
alter table public.agency_provisioning_requests
  add constraint agency_provisioning_requests_status_check check (
    status in ('Draft', 'Provisioning', 'Invitation Sent', 'Active', 'Failed', 'Suspended', 'Revoked')
  );

-- Email audit rows are owned by the dispatcher. Company users read them
-- through a tenant-derived RPC so non-admin roles never receive a full
-- recipient address from PostgREST, even if they bypass the UI masking.
drop policy if exists secure_email_log_insert on public.email_logs;
drop policy if exists secure_email_log_select on public.email_logs;
create policy secure_email_log_select
on public.email_logs for select to authenticated
using (
  company_id::text = public.current_log_actor()->>'company_id'
  and public.current_log_actor()->>'role' in ('Admin', 'Company Admin')
);
revoke insert, update, delete on table public.email_logs from anon, authenticated;
grant select on table public.email_logs to authenticated;

create or replace function public.email_log_list_v1()
returns table (
  id uuid, company_id uuid, agency_id uuid, user_id bigint,
  event_type text, type text, status text, recipient text, to_email text,
  subject text, provider text, provider_message_id text, message_id text,
  error_code text, error_message text, retry_count integer,
  created_at timestamptz, sent_at timestamptz, failed_at timestamptz
)
language plpgsql security definer stable set search_path = '' as $function$
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
      when position('@' in coalesce(log.recipient, log.to_email, '')) > 1 then
        left(split_part(coalesce(log.recipient, log.to_email), '@', 1), 2)
          || '***@' || split_part(coalesce(log.recipient, log.to_email), '@', 2)
      else null end,
    case when actor.role in ('Admin', 'Company Admin') then log.to_email
      when position('@' in coalesce(log.to_email, log.recipient, '')) > 1 then
        left(split_part(coalesce(log.to_email, log.recipient), '@', 1), 2)
          || '***@' || split_part(coalesce(log.to_email, log.recipient), '@', 2)
      else null end,
    log.subject, log.provider, log.provider_message_id, log.message_id,
    log.error_code,
    case when log.error_message is null then null else 'Email delivery failed at the provider.' end,
    log.retry_count, log.created_at, log.sent_at, log.failed_at
  from public.email_logs log
  where log.company_id = actor.company_id
  order by log.created_at desc
  limit 100;
end;
$function$;

create or replace function public.platform_email_log_summary_v1()
returns table (company_id uuid, created_at timestamptz, type text, status text)
language plpgsql security definer stable set search_path = '' as $function$
declare actor public.users%rowtype;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active' and app_user.is_active is true
    and app_user.company_id is null
    and app_user.role in ('Platform Owner', 'Platform Accounts User');
  if actor.id is null then raise exception 'EMAIL_LOG_UNAUTHORIZED'; end if;
  return query select log.company_id, log.created_at, log.type, log.status
  from public.email_logs log order by log.created_at desc limit 10000;
end;
$function$;

-- Record whether the Auth identity existed before this invitation. This flag
-- is server-owned and lets the callback preserve an existing password.
create or replace function public.agency_invitation_record_auth_user_v3(
  p_actor_auth_user_id uuid,
  p_request_id uuid,
  p_auth_user_id uuid,
  p_existing_identity boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare request_row public.agency_provisioning_requests%rowtype;
begin
  perform public.agency_invitation_record_auth_user_v2(
    p_actor_auth_user_id, p_request_id, p_auth_user_id
  );
  update public.agency_provisioning_requests
  set auth_identity_preexisting = coalesce(p_existing_identity, false),
      updated_at = pg_catalog.now()
  where id = p_request_id and auth_user_id = p_auth_user_id
  returning * into request_row;
  if request_row.id is null then raise exception 'AGENCY_INVITATION_AUTH_USER_MISMATCH'; end if;
  return public.agency_provisioning_public_result(request_row)
    || pg_catalog.jsonb_build_object('auth_identity_preexisting', request_row.auth_identity_preexisting);
end;
$function$;

create or replace function public.agency_invitation_begin_v3(
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
  request_row public.agency_provisioning_requests%rowtype;
  previous_status text;
  allowed_keys constant text[] := array['can_view_requests', 'can_upload_candidates', 'can_update_candidates', 'can_view_interviews'];
begin
  select app_user.* into actor
  from public.users app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active' and app_user.is_active is true
    and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_INVITATION_UNAUTHORIZED'; end if;
  if p_action not in ('invite_existing', 'resend_invitation') then
    raise exception 'AGENCY_INVITATION_INVALID_ACTION';
  end if;
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_permissions) supplied(key) where not (supplied.key = any(allowed_keys)))
    or exists (select 1 from unnest(allowed_keys) required(key)
      where not p_permissions ? required.key or jsonb_typeof(p_permissions->required.key) <> 'boolean') then
    raise exception 'AGENCY_INVITATION_INVALID_PERMISSIONS';
  end if;
  if p_action = 'invite_existing' then
    return public.agency_invitation_begin_v2(p_agency_id, p_permissions);
  end if;
  if not exists (select 1 from public.company_agency_access access
    where access.company_id = actor.company_id and access.agency_id = p_agency_id and access.status = 'Active') then
    raise exception 'AGENCY_INVITATION_AGENCY_NOT_AVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('agency_invitation:' || actor.company_id::text || ':' || p_agency_id::text, 0)
  );
  select request.* into request_row
  from public.agency_provisioning_requests request
  where request.company_id = actor.company_id and request.agency_id = p_agency_id
  order by request.created_at desc, request.id limit 1 for update;
  if request_row.id is null then raise exception 'AGENCY_INVITATION_NOT_FOUND'; end if;
  if request_row.status = 'Active' then raise exception 'AGENCY_INVITATION_ALREADY_ACCEPTED'; end if;
  if request_row.status = 'Provisioning' then raise exception 'AGENCY_INVITATION_IN_PROGRESS'; end if;
  if request_row.updated_at > pg_catalog.now() - interval '60 seconds' then
    raise exception 'AGENCY_INVITATION_RESEND_COOLDOWN';
  end if;
  if request_row.status = 'Invitation Sent'
    and request_row.invitation_sent_at > pg_catalog.now() - interval '24 hours' then
    raise exception 'AGENCY_INVITATION_ALREADY_SENT';
  end if;
  if request_row.status not in ('Failed', 'Invitation Sent', 'Revoked') then
    raise exception 'AGENCY_INVITATION_INVALID_STATE';
  end if;
  previous_status := case when request_row.status = 'Invitation Sent' then 'Expired' else request_row.status end;
  update public.agency_provisioning_requests
  set status = 'Provisioning', permissions = p_permissions,
      attempt_count = attempt_count + 1, failure_code = null,
      failure_stage = null, failure_metadata = '{}'::jsonb, failed_at = null,
      updated_at = pg_catalog.now()
  where id = request_row.id returning * into request_row;
  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status
  ) values (
    request_row.id, 'invitation-resend-started-' || request_row.attempt_count,
    request_row.company_id, request_row.agency_id, actor.id, actor.auth_user_id,
    'Invitation Resend Started', previous_status, 'Provisioning'
  ) on conflict (request_id, event_key) do nothing;
  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (actor.company_id, 'Agency Provisioning', request_row.id::text,
    'Invitation Resend Started', 'Agency user invitation resend started', actor.id, actor.role,
    'A new invitation delivery attempt was started after tenant, state, and cooldown checks.', 'Protected RPC');
  return public.agency_provisioning_public_result(request_row)
    || jsonb_build_object('outcome', 'resend', 'display_status', 'Pending');
end;
$function$;

create or replace function public.agency_invitation_revoke_v1(p_agency_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor public.users%rowtype;
  request_row public.agency_provisioning_requests%rowtype;
  previous_status text;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid() and app_user.status = 'Active'
    and app_user.is_active is true and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_INVITATION_UNAUTHORIZED'; end if;
  select request.* into request_row from public.agency_provisioning_requests request
  where request.company_id = actor.company_id and request.agency_id = p_agency_id
  order by request.created_at desc, request.id limit 1 for update;
  if request_row.id is null then raise exception 'AGENCY_INVITATION_NOT_FOUND'; end if;
  if request_row.status = 'Active' then raise exception 'AGENCY_INVITATION_ALREADY_ACCEPTED'; end if;
  if request_row.status = 'Revoked' then return public.agency_provisioning_public_result(request_row); end if;
  previous_status := request_row.status;
  update public.agency_provisioning_requests
  set status = 'Revoked', failure_code = null, failure_stage = null,
      failure_metadata = '{}'::jsonb, updated_at = pg_catalog.now()
  where id = request_row.id returning * into request_row;
  update public.agency_company_user_access set status = 'Suspended'
  where company_id = actor.company_id and agency_id = p_agency_id and status <> 'Active';
  insert into public.agency_provisioning_events (
    request_id, event_key, company_id, agency_id, actor_user_id,
    actor_auth_user_id, event_type, from_status, to_status
  ) values (request_row.id, 'invitation-revoked', actor.company_id, p_agency_id,
    actor.id, actor.auth_user_id, 'Invitation Revoked', previous_status, 'Revoked')
  on conflict (request_id, event_key) do nothing;
  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (actor.company_id, 'Agency Provisioning', request_row.id::text,
    'Invitation Revoked', 'Agency user invitation revoked', actor.id, actor.role,
    'The invitation was revoked without deleting the Auth identity or operational records.', 'Edge Function');
  return public.agency_provisioning_public_result(request_row)
    || jsonb_build_object('outcome', 'revoked', 'display_status', 'Revoked');
end;
$function$;

create or replace function public.agency_user_lifecycle_mutate(
  p_agency_id uuid,
  p_user_id bigint,
  p_action text,
  p_role text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor public.users%rowtype;
  access_row public.agency_company_user_access%rowtype;
  next_status text;
  next_role text;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid() and app_user.status = 'Active'
    and app_user.is_active is true and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_USER_LIFECYCLE_UNAUTHORIZED'; end if;
  select access.* into access_row from public.agency_company_user_access access
  where access.company_id = actor.company_id and access.agency_id = p_agency_id
    and access.user_id = p_user_id for update;
  if access_row.user_id is null then raise exception 'AGENCY_USER_ACCESS_NOT_FOUND'; end if;
  if p_action not in ('disable', 'reactivate', 'unlink', 'change_role') then
    raise exception 'AGENCY_USER_LIFECYCLE_INVALID_ACTION';
  end if;
  if p_action = 'reactivate' and not exists (
    select 1 from public.company_agency_access company_access
    where company_access.company_id = actor.company_id and company_access.agency_id = p_agency_id
      and company_access.status = 'Active'
  ) then raise exception 'AGENCY_NOT_LINKED'; end if;
  next_status := case p_action when 'disable' then 'Suspended' when 'unlink' then 'Inactive'
    when 'reactivate' then 'Active' else access_row.status end;
  next_role := case when p_action = 'change_role' then nullif(btrim(p_role), '') else access_row.role end;
  if next_role not in ('Agency User', 'Agency Manager') then
    raise exception 'AGENCY_USER_ROLE_NOT_ALLOWED';
  end if;
  update public.agency_company_user_access
  set status = next_status, role = next_role
  where company_id = actor.company_id and agency_id = p_agency_id and user_id = p_user_id
  returning * into access_row;
  if p_action = 'reactivate' then
    update public.users set status = 'Active', is_active = true,
      updated_at = pg_catalog.now()
    where id = p_user_id and role = 'Agency' and agency_id = p_agency_id;
  elsif p_action in ('disable', 'unlink') and not exists (
    select 1 from public.agency_company_user_access other_access
    where other_access.user_id = p_user_id and other_access.status = 'Active'
  ) then
    update public.users set status = 'Inactive', is_active = false,
      updated_at = pg_catalog.now()
    where id = p_user_id and role = 'Agency' and agency_id = p_agency_id;
  end if;
  insert into public.system_activity_logs (
    company_id, module_name, record_id, action_type, action_title,
    changed_by_user_id, changed_by_role, notes, source
  ) values (actor.company_id, 'Agency User Lifecycle', p_user_id::text,
    p_action, 'Agency user access ' || replace(p_action, '_', ' '), actor.id, actor.role,
    'Tenant-scoped access changed; Auth identity and operational records were retained.', 'Protected RPC');
  return jsonb_build_object('company_id', actor.company_id, 'agency_id', p_agency_id,
    'user_id', p_user_id, 'status', access_row.status, 'role', access_row.role,
    'auth_user_deleted', false, 'public_user_deleted', false);
end;
$function$;

create or replace function public.agency_user_lifecycle_list()
returns table (
  company_id uuid, agency_id uuid, user_id bigint, user_name text,
  user_email text, access_role text, access_status text
)
language plpgsql security definer stable set search_path = '' as $function$
declare actor public.users%rowtype;
begin
  select app_user.* into actor from public.users app_user
  where app_user.auth_user_id = auth.uid() and app_user.status = 'Active'
    and app_user.is_active is true and app_user.role in ('Admin', 'Company Admin')
    and app_user.company_id is not null;
  if actor.id is null then raise exception 'AGENCY_USER_LIFECYCLE_UNAUTHORIZED'; end if;
  return query
  select access.company_id, access.agency_id, access.user_id, app_user.name,
    app_user.email, access.role, access.status
  from public.agency_company_user_access access
  join public.users app_user on app_user.id = access.user_id
  where access.company_id = actor.company_id
  order by access.created_at desc, access.user_id;
end;
$function$;

revoke all on function public.agency_invitation_begin_v3(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.agency_invitation_revoke_v1(uuid) from public, anon, authenticated;
revoke all on function public.agency_user_lifecycle_mutate(uuid, bigint, text, text) from public, anon;
revoke all on function public.agency_user_lifecycle_list() from public, anon;
revoke all on function public.email_log_list_v1() from public, anon, authenticated;
revoke all on function public.platform_email_log_summary_v1() from public, anon, authenticated;
revoke all on function public.agency_invitation_record_auth_user_v3(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.agency_agreement_accept_v1(uuid) from public, anon, authenticated;
grant execute on function public.agency_invitation_begin_v3(uuid, jsonb, text) to authenticated;
grant execute on function public.agency_invitation_revoke_v1(uuid) to authenticated;
grant execute on function public.agency_user_lifecycle_mutate(uuid, bigint, text, text) to authenticated;
grant execute on function public.agency_user_lifecycle_list() to authenticated;
grant execute on function public.email_log_list_v1() to authenticated;
grant execute on function public.platform_email_log_summary_v1() to authenticated;
grant execute on function public.agency_invitation_record_auth_user_v3(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.agency_agreement_accept_v1(uuid) to authenticated;

commit;
