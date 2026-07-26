-- Application contracts required before VisaFlow tenant RLS can be enabled.
-- Additive only: no production data migration or backfill is performed here.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.require_workspace_actor(p_roles text[] default null)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
  v_actor_id public.users.id%type;
  v_count bigint;
begin
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select count(*), min(u.id)
    into v_count, v_actor_id
  from public.users u
  where u.auth_user_id = auth.uid();

  if v_count <> 1 then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_actor
  from public.users u
  where u.id = v_actor_id
    and u.status = 'Active'
    and u.is_active is true;

  if not found or (p_roles is not null and not (v_actor.role = any(p_roles))) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if v_actor.company_id is not null and not exists (
    select 1 from public.companies c
    where c.id = v_actor.company_id and c.status = 'Active'
  ) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

revoke all on function private.require_workspace_actor(text[]) from public, anon, authenticated;
grant execute on function private.require_workspace_actor(text[]) to service_role;

create or replace function public.get_authenticated_workspace_context()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
  v_company jsonb;
begin
  v_actor := private.require_workspace_actor(null);

  if v_actor.company_id is not null then
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'status', c.status,
      'subscription_status', c.subscription_status,
      'subscription_end', c.subscription_end
    ) into v_company
    from public.companies c
    where c.id = v_actor.company_id
      and c.status = 'Active'
      and lower(coalesce(c.subscription_status, 'active')) in ('active', 'trial', 'grace period');

    if v_company is null then
      raise exception 'workspace unavailable' using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object(
    'actor', jsonb_build_object(
      'id', v_actor.id,
      'name', v_actor.name,
      'email', v_actor.email,
      'role', v_actor.role,
      'status', v_actor.status,
      'company_id', v_actor.company_id,
      'agency_id', v_actor.agency_id,
      'agency_name', v_actor.agency_name,
      'auth_user_id', v_actor.auth_user_id,
      'created_at', v_actor.created_at
    ),
    'company', v_company
  );
end;
$$;

revoke all on function public.get_authenticated_workspace_context() from public, anon;
grant execute on function public.get_authenticated_workspace_context() to authenticated, service_role;

create or replace function public.list_authenticated_agency_workspaces()
returns table(
  access_id uuid,
  company_id uuid,
  company_name text,
  agency_id uuid,
  agency_name text,
  is_active boolean,
  capabilities jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
begin
  v_actor := private.require_workspace_actor(array['Agency']);
  if v_actor.agency_id is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return query
  select
    aua.id,
    aua.company_id,
    c.name,
    aua.agency_id,
    coalesce(a.name, v_actor.agency_name, 'Agency'),
    true,
    jsonb_build_object(
      'view_requests', aua.can_view_requests and caa.can_view_requests,
      'upload_candidates', aua.can_upload_candidates and caa.can_upload_candidates,
      'update_candidates', aua.can_update_candidates and caa.can_update_candidates,
      'view_interviews', aua.can_view_interviews and caa.can_view_interviews
    )
  from public.agency_company_user_access aua
  join public.agency_members am
    on am.user_id = aua.user_id and am.agency_id = aua.agency_id and am.status = 'Active'
  join public.company_agency_access caa
    on caa.company_id = aua.company_id and caa.agency_id = aua.agency_id and caa.status = 'Active'
  join public.companies c
    on c.id = aua.company_id and c.status = 'Active'
  join public.agencies a
    on a.id = aua.agency_id and a.status = 'Active'
  where aua.user_id = v_actor.id
    and aua.agency_id = v_actor.agency_id
    and aua.status = 'Active';
end;
$$;

revoke all on function public.list_authenticated_agency_workspaces() from public, anon;
grant execute on function public.list_authenticated_agency_workspaces() to authenticated, service_role;

create or replace function public.get_authenticated_agency_workspace(p_access_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select * into v_row
  from public.list_authenticated_agency_workspaces() w
  where w.access_id = p_access_id;
  if not found then
    raise exception 'workspace unavailable' using errcode = '42501';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.get_authenticated_agency_workspace(uuid) from public, anon;
grant execute on function public.get_authenticated_agency_workspace(uuid) to authenticated, service_role;

create or replace function public.list_authorized_companies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_rows jsonb;
begin
  v_actor := private.require_workspace_actor(null);
  select coalesce(jsonb_agg(to_jsonb(c) - 'smtp_password' order by c.name), '[]'::jsonb) into v_rows
  from public.companies c
  where (v_actor.role = 'Platform Owner' and v_actor.company_id is null)
     or c.id = v_actor.company_id;
  return v_rows;
end;
$$;
revoke all on function public.list_authorized_companies() from public, anon;
grant execute on function public.list_authorized_companies() to authenticated;

create or replace function public.update_authorized_company(p_company_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_company public.companies%rowtype;
begin
  v_actor := private.require_workspace_actor(null);
  if not ((v_actor.role = 'Platform Owner' and v_actor.company_id is null)
    or (v_actor.role in ('Admin','Company Admin') and v_actor.company_id = p_company_id)) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  update public.companies c set
    name = case when p_patch ? 'name' then left(p_patch->>'name', 200) else c.name end,
    domain = case when p_patch ? 'domain' then nullif(left(p_patch->>'domain', 255), '') else c.domain end,
    status = case when p_patch ? 'status' then p_patch->>'status' else c.status end,
    subscription_plan = case when p_patch ? 'subscription_plan' then p_patch->>'subscription_plan' else c.subscription_plan end,
    subscription_status = case when p_patch ? 'subscription_status' then p_patch->>'subscription_status' else c.subscription_status end,
    subscription_start = case when p_patch ? 'subscription_start' then nullif(p_patch->>'subscription_start', '')::date else c.subscription_start end,
    subscription_end = case when p_patch ? 'subscription_end' then nullif(p_patch->>'subscription_end', '')::date else c.subscription_end end,
    max_users = case when p_patch ? 'max_users' then greatest(1, (p_patch->>'max_users')::integer) else c.max_users end,
    notes = case when p_patch ? 'notes' then left(p_patch->>'notes', 4000) else c.notes end,
    updated_at = now()
  where c.id = p_company_id returning * into v_company;
  if not found then raise exception 'company unavailable' using errcode = '42501'; end if;
  return to_jsonb(v_company);
end;
$$;
revoke all on function public.update_authorized_company(uuid, jsonb) from public, anon;
grant execute on function public.update_authorized_company(uuid, jsonb) to authenticated;

create table if not exists private.workspace_auth_upgrades (
  id uuid primary key default gen_random_uuid(),
  app_user_id bigint not null references public.users(id) on delete cascade,
  invited_auth_user_id uuid,
  status text not null default 'Pending' check (status in ('Pending', 'Invited', 'Completed', 'Revoked', 'Expired')),
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (app_user_id)
);
create table if not exists private.workspace_auth_upgrade_rate_limits (
  key_hash text primary key check (char_length(key_hash) = 64),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists users_normalized_email_lookup_idx
  on public.users ((lower(btrim(email))));
alter table private.workspace_auth_upgrades enable row level security;
alter table private.workspace_auth_upgrade_rate_limits enable row level security;
revoke all on table private.workspace_auth_upgrades from public, anon, authenticated;
revoke all on table private.workspace_auth_upgrade_rate_limits from public, anon, authenticated;
grant all on table private.workspace_auth_upgrades, private.workspace_auth_upgrade_rate_limits to service_role;

create or replace function public.consume_workspace_upgrade_rate_limit(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_row private.workspace_auth_upgrade_rate_limits%rowtype;
begin
  if auth.role() <> 'service_role' or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'access denied' using errcode = '42501';
  end if;
  delete from private.workspace_auth_upgrade_rate_limits where updated_at < now() - interval '7 days';
  insert into private.workspace_auth_upgrade_rate_limits(key_hash, attempt_count)
    values(p_key_hash, 0) on conflict (key_hash) do nothing;
  select * into v_row from private.workspace_auth_upgrade_rate_limits where key_hash = p_key_hash for update;
  if v_row.blocked_until is not null and v_row.blocked_until > now() then return false; end if;
  if v_row.window_started_at < now() - interval '15 minutes' then
    update private.workspace_auth_upgrade_rate_limits
      set window_started_at = now(), attempt_count = 1, blocked_until = null, updated_at = now()
      where key_hash = p_key_hash;
    return true;
  end if;
  update private.workspace_auth_upgrade_rate_limits
    set attempt_count = attempt_count + 1,
        blocked_until = case when attempt_count + 1 > 5 then now() + interval '15 minutes' else null end,
        updated_at = now()
    where key_hash = p_key_hash returning * into v_row;
  return v_row.attempt_count <= 5;
end;
$$;
revoke all on function public.consume_workspace_upgrade_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_workspace_upgrade_rate_limit(text) to service_role;

create or replace function public.complete_workspace_auth_upgrade(p_upgrade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upgrade private.workspace_auth_upgrades%rowtype;
  v_user public.users%rowtype;
begin
  if auth.uid() is null then raise exception 'access denied' using errcode = '42501'; end if;
  select * into v_upgrade from private.workspace_auth_upgrades
  where id = p_upgrade_id for update;
  if not found or v_upgrade.status <> 'Invited' or v_upgrade.expires_at <= now()
     or v_upgrade.invited_auth_user_id is distinct from auth.uid() then
    raise exception 'upgrade unavailable' using errcode = '42501';
  end if;
  select * into v_user from public.users where id = v_upgrade.app_user_id for update;
  if v_user.auth_user_id is not null and v_user.auth_user_id is distinct from auth.uid() then
    raise exception 'upgrade unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from public.users where auth_user_id = auth.uid() and id <> v_user.id) then
    raise exception 'upgrade unavailable' using errcode = '42501';
  end if;
  update public.users set auth_user_id = auth.uid(), updated_at = now() where id = v_user.id;
  update private.workspace_auth_upgrades set status = 'Completed', completed_at = now() where id = v_upgrade.id;
  return public.get_authenticated_workspace_context();
end;
$$;

revoke all on function public.complete_workspace_auth_upgrade(uuid) from public, anon;
grant execute on function public.complete_workspace_auth_upgrade(uuid) to authenticated;

create or replace function public.prepare_workspace_auth_upgrade(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user public.users%rowtype; v_upgrade_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'access denied' using errcode = '42501'; end if;
  select * into v_user from public.users u
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and u.password = p_password and u.status = 'Active' and u.is_active is true
    for update;
  if not found or v_user.auth_user_id is not null then
    raise exception 'upgrade unavailable' using errcode = '42501';
  end if;
  if (select count(*) from public.users u where lower(btrim(u.email)) = lower(btrim(p_email))) <> 1 then
    raise exception 'upgrade unavailable' using errcode = '42501';
  end if;
  insert into private.workspace_auth_upgrades(app_user_id, status, expires_at)
    values(v_user.id, 'Pending', now() + interval '24 hours')
    on conflict (app_user_id) do update set invited_auth_user_id = null, status = 'Pending',
      expires_at = now() + interval '24 hours', completed_at = null
    returning id into v_upgrade_id;
  return jsonb_build_object('upgrade_id', v_upgrade_id, 'email', v_user.email);
end;
$$;
revoke all on function public.prepare_workspace_auth_upgrade(text, text) from public, anon, authenticated;
grant execute on function public.prepare_workspace_auth_upgrade(text, text) to service_role;

create or replace function public.mark_workspace_auth_upgrade_invited(p_upgrade_id uuid, p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'access denied' using errcode = '42501'; end if;
  if exists (select 1 from public.users where auth_user_id = p_auth_user_id) then
    raise exception 'upgrade unavailable' using errcode = '42501';
  end if;
  update private.workspace_auth_upgrades
    set invited_auth_user_id = p_auth_user_id, status = 'Invited'
    where id = p_upgrade_id and status = 'Pending' and expires_at > now();
  if not found then raise exception 'upgrade unavailable' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.mark_workspace_auth_upgrade_invited(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_workspace_auth_upgrade_invited(uuid, uuid) to service_role;

create or replace function public.save_platform_email_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_row public.company_email_settings%rowtype;
begin
  v_actor := private.require_workspace_actor(array['Admin', 'Company Admin']);
  if v_actor.company_id is null or lower(coalesce(p_settings->>'mode', 'platform')) <> 'platform'
     or p_settings ? 'smtp_password' then
    raise exception 'company SMTP credentials are disabled' using errcode = '42501';
  end if;
  insert into public.company_email_settings(
    company_id, mode, provider, from_name, from_email, reply_to, agreements_email,
    notifications_email, support_email, is_active, updated_at
  ) values (
    v_actor.company_id, 'platform', 'VisaFlow Platform', left(coalesce(p_settings->>'from_name', ''), 120),
    nullif(left(coalesce(p_settings->>'from_email', ''), 320), ''),
    nullif(left(coalesce(p_settings->>'reply_to', ''), 320), ''),
    nullif(left(coalesce(p_settings->>'agreements_email', ''), 320), ''),
    nullif(left(coalesce(p_settings->>'notifications_email', ''), 320), ''),
    nullif(left(coalesce(p_settings->>'support_email', ''), 320), ''),
    coalesce((p_settings->>'is_active')::boolean, true), now()
  ) on conflict (company_id) do update set
    mode = 'platform', provider = 'VisaFlow Platform', smtp_host = null, smtp_port = null,
    smtp_secure = null, smtp_username = null, smtp_password = null,
    from_name = excluded.from_name, from_email = excluded.from_email, reply_to = excluded.reply_to,
    agreements_email = excluded.agreements_email, notifications_email = excluded.notifications_email,
    support_email = excluded.support_email, is_active = excluded.is_active, is_verified = false,
    last_test_at = null, last_test_status = null, last_error = null, updated_at = now()
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id, 'mode', v_row.mode, 'provider', v_row.provider,
    'from_name', v_row.from_name, 'from_email', v_row.from_email, 'reply_to', v_row.reply_to,
    'agreements_email', v_row.agreements_email, 'notifications_email', v_row.notifications_email,
    'support_email', v_row.support_email, 'is_active', v_row.is_active,
    'is_verified', v_row.is_verified, 'last_test_at', v_row.last_test_at,
    'last_test_status', v_row.last_test_status
  );
end;
$$;
revoke all on function public.save_platform_email_settings(jsonb) from public, anon;
grant execute on function public.save_platform_email_settings(jsonb) to authenticated;

create or replace function public.get_platform_email_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_row public.company_email_settings%rowtype;
begin
  v_actor := private.require_workspace_actor(array['Admin', 'Company Admin']);
  select * into v_row from public.company_email_settings where company_id = v_actor.company_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_row.id, 'mode', v_row.mode, 'provider', v_row.provider,
    'from_name', v_row.from_name, 'from_email', v_row.from_email, 'reply_to', v_row.reply_to,
    'agreements_email', v_row.agreements_email, 'notifications_email', v_row.notifications_email,
    'support_email', v_row.support_email, 'is_active', v_row.is_active,
    'is_verified', v_row.is_verified, 'last_test_at', v_row.last_test_at,
    'last_test_status', v_row.last_test_status, 'last_error', v_row.last_error, 'updated_at', v_row.updated_at
  );
end;
$$;
revoke all on function public.get_platform_email_settings() from public, anon;
grant execute on function public.get_platform_email_settings() to authenticated;

create table if not exists public.ai_interview_portal_invitations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_interview_sessions(id) on delete cascade,
  token_hash text not null unique,
  generation integer not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(token_hash) = 64)
);
create unique index if not exists ai_interview_one_active_invitation
  on public.ai_interview_portal_invitations(session_id)
  where consumed_at is null and revoked_at is null;
alter table public.ai_interview_portal_invitations enable row level security;
revoke all on table public.ai_interview_portal_invitations from public, anon, authenticated;
grant all on table public.ai_interview_portal_invitations to service_role;

create table if not exists public.ai_interview_portal_capabilities (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.ai_interview_portal_invitations(id) on delete cascade,
  session_id uuid not null references public.ai_interview_sessions(id) on delete cascade,
  portal_auth_user_id uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, portal_auth_user_id)
);
create index if not exists ai_interview_capability_actor_idx
  on public.ai_interview_portal_capabilities(portal_auth_user_id, expires_at);
alter table public.ai_interview_portal_capabilities enable row level security;
revoke all on table public.ai_interview_portal_capabilities from public, anon, authenticated;
grant all on table public.ai_interview_portal_capabilities to service_role;

create table if not exists public.ai_interview_media_uploads (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.ai_interview_portal_capabilities(id) on delete cascade,
  session_id uuid not null references public.ai_interview_sessions(id) on delete cascade,
  question_id uuid not null references public.ai_interview_questions(id) on delete restrict,
  object_path text not null unique,
  content_type text not null,
  content_length bigint not null,
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  check (content_length > 0 and content_length <= 104857600)
);
alter table public.ai_interview_media_uploads enable row level security;
revoke all on table public.ai_interview_media_uploads from public, anon, authenticated;
grant all on table public.ai_interview_media_uploads to service_role;

create table if not exists public.ai_interview_portal_idempotency (
  capability_id uuid not null references public.ai_interview_portal_capabilities(id) on delete cascade,
  idempotency_key text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (capability_id, idempotency_key),
  check (char_length(idempotency_key) between 8 and 128)
);
alter table public.ai_interview_portal_idempotency enable row level security;
revoke all on table public.ai_interview_portal_idempotency from public, anon, authenticated;
grant all on table public.ai_interview_portal_idempotency to service_role;

create unique index if not exists ai_interview_answers_session_question_order_uidx
  on public.ai_interview_answers(session_id, question_order);

create or replace function private.require_interview_capability(p_capability_id uuid)
returns public.ai_interview_portal_capabilities
language plpgsql
security definer
set search_path = ''
as $$
declare v_cap public.ai_interview_portal_capabilities%rowtype;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'interview unavailable' using errcode = '42501';
  end if;
  select * into v_cap from public.ai_interview_portal_capabilities c
  where c.id = p_capability_id
    and c.portal_auth_user_id = auth.uid()
    and c.revoked_at is null and c.expires_at > now()
  for update;
  if not found then raise exception 'interview unavailable' using errcode = '42501'; end if;
  update public.ai_interview_portal_capabilities set last_seen_at = now() where id = v_cap.id;
  return v_cap;
end;
$$;
revoke all on function private.require_interview_capability(uuid) from public, anon, authenticated;
grant execute on function private.require_interview_capability(uuid) to service_role;

create or replace function public.issue_secure_ai_interview_invitation(
  p_session_id uuid,
  p_app_base_url text default 'https://visaflowksa.com'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.ai_interview_sessions%rowtype;
  v_secret text;
  v_hash text;
  v_generation integer;
  v_invitation_id uuid;
  v_expiry timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'access denied' using errcode = '42501'; end if;
  select * into v_session from public.ai_interview_sessions where id = p_session_id for update;
  if not found or v_session.status in ('Completed', 'Cancelled', 'Expired') then
    raise exception 'interview unavailable' using errcode = '42501';
  end if;
  update public.ai_interview_portal_invitations
    set revoked_at = now()
    where session_id = p_session_id and revoked_at is null and consumed_at is null;
  select coalesce(max(generation), 0) + 1 into v_generation
    from public.ai_interview_portal_invitations where session_id = p_session_id;
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(extensions.digest(v_secret, 'sha256'), 'hex');
  v_expiry := least(v_session.expires_at, now() + interval '24 hours');
  insert into public.ai_interview_portal_invitations(session_id, token_hash, generation, expires_at)
    values (p_session_id, v_hash, v_generation, v_expiry) returning id into v_invitation_id;
  update public.ai_interview_sessions
    set invitation_url = regexp_replace(coalesce(nullif(btrim(p_app_base_url), ''), 'https://visaflowksa.com'), '/+$', '') || '/',
        updated_at = now()
    where id = p_session_id;
  return jsonb_build_object(
    'invitation_id', v_invitation_id,
    'expires_at', v_expiry,
    'url', regexp_replace(coalesce(nullif(btrim(p_app_base_url), ''), 'https://visaflowksa.com'), '/+$', '') ||
      '/#interview_invite=' || v_secret
  );
end;
$$;
revoke all on function public.issue_secure_ai_interview_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_secure_ai_interview_invitation(uuid, text) to service_role;

create or replace function public.exchange_ai_interview_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.ai_interview_portal_invitations%rowtype;
  v_session public.ai_interview_sessions%rowtype;
  v_capability_id uuid;
  v_cap_expiry timestamptz;
begin
  if auth.uid() is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'interview unavailable' using errcode = '42501';
  end if;
  select * into v_inv from public.ai_interview_portal_invitations i
  where i.token_hash = p_token_hash for update;
  if not found or v_inv.revoked_at is not null or v_inv.consumed_at is not null or v_inv.expires_at <= now() then
    raise exception 'interview unavailable' using errcode = '42501';
  end if;
  select * into v_session from public.ai_interview_sessions s where s.id = v_inv.session_id for update;
  if not found or v_session.expires_at <= now() or v_session.status in ('Completed', 'Cancelled', 'Expired') then
    raise exception 'interview unavailable' using errcode = '42501';
  end if;
  v_cap_expiry := least(v_inv.expires_at, now() + interval '2 hours');
  insert into public.ai_interview_portal_capabilities(invitation_id, session_id, portal_auth_user_id, expires_at)
    values (v_inv.id, v_inv.session_id, auth.uid(), v_cap_expiry)
    returning id into v_capability_id;
  update public.ai_interview_portal_invitations set consumed_at = now() where id = v_inv.id;
  return jsonb_build_object('capability_id', v_capability_id, 'expires_at', v_cap_expiry);
end;
$$;
revoke all on function public.exchange_ai_interview_invitation(text) from public, anon;
grant execute on function public.exchange_ai_interview_invitation(text) to authenticated;

create or replace function public.get_ai_interview_portal_state(p_capability_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap public.ai_interview_portal_capabilities%rowtype;
  v_session public.ai_interview_sessions%rowtype;
  v_template jsonb;
  v_questions jsonb;
  v_answers jsonb;
begin
  v_cap := private.require_interview_capability(p_capability_id);
  select * into v_session from public.ai_interview_sessions where id = v_cap.session_id;
  if v_session.expires_at <= now() and v_session.status not in ('Completed', 'Cancelled') then
    update public.ai_interview_sessions set status = 'Expired', updated_at = now() where id = v_session.id;
    v_session.status := 'Expired';
  elsif v_session.status in ('Created', 'Invitation Pending', 'Invited') then
    update public.ai_interview_sessions
      set status = case when consent_required is false or consent_accepted then 'Ready' else 'Opened' end,
          first_opened_at = coalesce(first_opened_at, now()), updated_at = now()
      where id = v_session.id returning * into v_session;
  end if;
  select jsonb_build_object(
    'id', t.id, 'template_name', t.template_name, 'template_name_en', t.template_name,
    'require_microphone_test', t.require_microphone_test, 'require_consent', t.require_consent
  ) into v_template from public.ai_interview_templates t where t.id = v_session.template_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'question_order', q.question_order, 'question_text', q.question_text,
    'question_text_ar', q.question_text_ar, 'question_text_en', q.question_text_en,
    'question_type', q.question_type, 'competency', q.competency,
    'maximum_answer_seconds', q.maximum_answer_seconds, 'is_required', q.is_required
  ) order by q.question_order), '[]'::jsonb) into v_questions
  from public.ai_interview_questions q where q.template_id = v_session.template_id and q.is_active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'question_id', a.question_id, 'question_order', a.question_order,
    'answer_status', a.answer_status, 'audio_duration_seconds', a.audio_duration_seconds,
    'has_media', nullif(a.audio_storage_path, '') is not null,
    'media_type', case when lower(a.audio_storage_path) ~ '\.(mp4)$' or lower(a.audio_storage_path) like '%video%' then 'video' else 'audio' end
  ) order by a.question_order), '[]'::jsonb) into v_answers
  from public.ai_interview_answers a where a.session_id = v_session.id;
  return jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id, 'candidate_name', v_session.candidate_name, 'profession', v_session.profession,
      'request_no', v_session.request_no, 'project_name', v_session.project_name,
      'language', v_session.language, 'status', v_session.status, 'expires_at', v_session.expires_at,
      'consent_required', v_session.consent_required, 'consent_accepted', v_session.consent_accepted,
      'participation_consent_accepted', v_session.participation_consent_accepted,
      'evaluation_email_consent', v_session.evaluation_email_consent,
      'employer_sharing_consent', v_session.employer_sharing_consent,
      'microphone_test_passed', v_session.microphone_test_passed,
      'camera_test_passed', v_session.camera_test_passed, 'camera_mode', v_session.camera_mode,
      'interview_mode', v_session.interview_mode, 'interaction_mode', v_session.interaction_mode,
      'started_at', v_session.started_at, 'completed_at', v_session.completed_at,
      'current_question_order', v_session.current_question_order, 'total_questions', v_session.total_questions,
      'answered_questions', v_session.answered_questions, 'skipped_questions', v_session.skipped_questions
    ),
    'template', v_template, 'questions', v_questions, 'answers', v_answers
  );
end;
$$;
revoke all on function public.get_ai_interview_portal_state(uuid) from public, anon;
grant execute on function public.get_ai_interview_portal_state(uuid) to authenticated;

create or replace function public.transition_ai_interview_portal(
  p_capability_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap public.ai_interview_portal_capabilities%rowtype;
  v_session public.ai_interview_sessions%rowtype;
  v_question public.ai_interview_questions%rowtype;
  v_media public.ai_interview_media_uploads%rowtype;
  v_now timestamptz := now();
  v_answered integer;
  v_skipped integer;
  v_result jsonb;
begin
  v_cap := private.require_interview_capability(p_capability_id);
  if nullif(p_idempotency_key, '') is not null then
    if char_length(p_idempotency_key) not between 8 and 128 then raise exception 'invalid idempotency key' using errcode = '22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_cap.id::text || ':' || p_idempotency_key, 0));
    select i.response into v_result from public.ai_interview_portal_idempotency i
      where i.capability_id = v_cap.id and i.idempotency_key = p_idempotency_key;
    if found then return v_result; end if;
  end if;
  select * into v_session from public.ai_interview_sessions where id = v_cap.session_id for update;
  if v_session.expires_at <= v_now or v_session.status in ('Expired', 'Cancelled', 'Completed', 'Failed') then
    raise exception 'interview unavailable' using errcode = '42501';
  end if;

  if p_action = 'accept_consent' then
    if coalesce((p_payload->>'participation_consent')::boolean, false) is not true
       or coalesce((p_payload->>'recording_consent')::boolean, false) is not true then
      raise exception 'required consent missing' using errcode = '22023';
    end if;
    update public.ai_interview_sessions set
      participation_consent_accepted = true, participation_consent_accepted_at = v_now,
      consent_accepted = true, consent_accepted_at = v_now,
      evaluation_email_consent = coalesce((p_payload->>'evaluation_email_consent')::boolean, false),
      evaluation_email_consent_at = case when coalesce((p_payload->>'evaluation_email_consent')::boolean, false) then v_now end,
      employer_sharing_consent = coalesce((p_payload->>'employer_sharing_consent')::boolean, false),
      employer_sharing_consent_at = case when coalesce((p_payload->>'employer_sharing_consent')::boolean, false) then v_now end,
      consent_version = 'visaflow-secure-interview-v1', status = case when microphone_test_passed then 'Ready' else 'Consent Pending' end,
      updated_at = v_now where id = v_session.id;
  elsif p_action = 'decline' then
    update public.ai_interview_sessions set status = 'Cancelled', participation_declined_at = v_now,
      participation_consent_accepted = false, consent_accepted = false,
      evaluation_email_consent = false, employer_sharing_consent = false, updated_at = v_now where id = v_session.id;
  elsif p_action = 'microphone_test' then
    update public.ai_interview_sessions set microphone_test_passed = true,
      status = case when consent_required is false or consent_accepted then 'Ready' else status end,
      updated_at = v_now where id = v_session.id;
  elsif p_action = 'camera_test' then
    update public.ai_interview_sessions set camera_test_passed = true, camera_permission_status = 'Granted',
      camera_tested_at = v_now, updated_at = v_now where id = v_session.id;
  elsif p_action = 'start' then
    if v_session.consent_required and not v_session.consent_accepted then raise exception 'consent required'; end if;
    if exists (select 1 from public.ai_interview_templates t where t.id = v_session.template_id and t.require_microphone_test and not v_session.microphone_test_passed) then
      raise exception 'microphone test required' using errcode = '42501';
    end if;
    if v_session.camera_mode = 'Required' and not v_session.camera_test_passed then
      raise exception 'camera test required' using errcode = '42501';
    end if;
    update public.ai_interview_sessions set status = 'In Progress', started_at = coalesce(started_at, v_now),
      current_question_order = greatest(coalesce((p_payload->>'question_order')::integer, 1), 1),
      total_questions = (select count(*) from public.ai_interview_questions q where q.template_id = v_session.template_id and q.is_active),
      updated_at = v_now where id = v_session.id;
  elsif p_action in ('save_answer', 'skip_answer') then
    select * into v_question from public.ai_interview_questions q
      where q.id = (p_payload->>'question_id')::uuid and q.template_id = v_session.template_id and q.is_active;
    if not found then raise exception 'question unavailable' using errcode = '42501'; end if;
    if p_action = 'save_answer' and nullif(p_payload->>'upload_id', '') is not null then
      select * into v_media from public.ai_interview_media_uploads m
       where m.id = (p_payload->>'upload_id')::uuid and m.capability_id = v_cap.id
         and m.session_id = v_session.id and m.question_id = v_question.id and m.finalized_at is not null;
      if not found then raise exception 'media unavailable' using errcode = '42501'; end if;
    end if;
    insert into public.ai_interview_answers(
      company_id, session_id, question_id, question_order, question_text_snapshot, question_type, competency,
      asked_at, answer_started_at, answer_completed_at, answer_text, answer_language, audio_storage_path,
      audio_duration_seconds, transcription_status, answer_status, updated_at
    ) values (
      v_session.company_id, v_session.id, v_question.id, v_question.question_order,
      coalesce(nullif(v_question.question_text, ''), nullif(v_question.question_text_en, ''), v_question.question_text_ar),
      v_question.question_type, v_question.competency, v_now, v_now, v_now,
      left(coalesce(p_payload->>'answer_text', ''), 10000), left(coalesce(p_payload->>'answer_language', ''), 32),
      coalesce(v_media.object_path, ''), greatest(coalesce((p_payload->>'audio_duration_seconds')::integer, 0), 0),
      case when p_action = 'skip_answer' then 'Not Required' else 'Pending' end,
      case when p_action = 'skip_answer' then 'Skipped' else 'Answered' end, v_now
    ) on conflict (session_id, question_order) do update set
      answer_text = excluded.answer_text, answer_language = excluded.answer_language,
      audio_storage_path = excluded.audio_storage_path, audio_duration_seconds = excluded.audio_duration_seconds,
      transcription_status = excluded.transcription_status, answer_status = excluded.answer_status,
      answer_completed_at = excluded.answer_completed_at, updated_at = excluded.updated_at;
    select count(*) filter (where answer_status in ('Answered','Analyzed')),
           count(*) filter (where answer_status = 'Skipped')
      into v_answered, v_skipped from public.ai_interview_answers where session_id = v_session.id;
    update public.ai_interview_sessions set status = 'In Progress', answered_questions = v_answered,
      skipped_questions = v_skipped, current_question_order = v_question.question_order, updated_at = v_now
      where id = v_session.id;
  elsif p_action = 'set_question' then
    update public.ai_interview_sessions set current_question_order = greatest((p_payload->>'question_order')::integer, 1), updated_at = v_now where id = v_session.id;
  elsif p_action = 'complete' then
    select count(*) filter (where answer_status in ('Answered','Analyzed')),
           count(*) filter (where answer_status = 'Skipped')
      into v_answered, v_skipped from public.ai_interview_answers where session_id = v_session.id;
    update public.ai_interview_sessions set status = 'Completed', completed_at = v_now,
      answered_questions = v_answered, skipped_questions = v_skipped,
      interview_duration_seconds = greatest(extract(epoch from (v_now - coalesce(started_at, v_now)))::integer, 0),
      review_status = 'Pending Human Review', ai_recommendation = 'Pending Analysis', updated_at = v_now where id = v_session.id;
  else
    raise exception 'unsupported interview transition' using errcode = '22023';
  end if;
  v_result := public.get_ai_interview_portal_state(p_capability_id);
  if nullif(p_idempotency_key, '') is not null then
    insert into public.ai_interview_portal_idempotency(capability_id, idempotency_key, response)
      values(v_cap.id, p_idempotency_key, v_result);
  end if;
  return v_result;
end;
$$;
revoke all on function public.transition_ai_interview_portal(uuid, text, jsonb, text) from public, anon;
grant execute on function public.transition_ai_interview_portal(uuid, text, jsonb, text) to authenticated;

create or replace function public.prepare_ai_interview_media_upload(
  p_capability_id uuid, p_question_id uuid, p_content_type text, p_content_length bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap public.ai_interview_portal_capabilities%rowtype;
  v_session public.ai_interview_sessions%rowtype;
  v_upload_id uuid := gen_random_uuid();
  v_ext text;
  v_path text;
begin
  v_cap := private.require_interview_capability(p_capability_id);
  select * into v_session from public.ai_interview_sessions where id = v_cap.session_id;
  if v_session.status <> 'In Progress' then raise exception 'upload unavailable' using errcode = '42501'; end if;
  if not exists (select 1 from public.ai_interview_questions q where q.id = p_question_id and q.template_id = v_session.template_id and q.is_active) then
    raise exception 'upload unavailable' using errcode = '42501';
  end if;
  if p_content_type not in ('audio/webm','audio/webm;codecs=opus','audio/mp4','audio/ogg','audio/ogg;codecs=opus','audio/wav','video/webm','video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/mp4') then
    raise exception 'unsupported media type' using errcode = '22023';
  end if;
  if p_content_length <= 0 or p_content_length > case when p_content_type like 'video/%' then 104857600 else 26214400 end then
    raise exception 'media size rejected' using errcode = '22023';
  end if;
  v_ext := case when p_content_type like '%mp4%' then 'mp4' when p_content_type like '%ogg%' then 'ogg' when p_content_type like '%wav%' then 'wav' else 'webm' end;
  v_path := 'company/' || v_session.company_id || '/session/' || v_session.id || '/question/' || p_question_id || '/' || v_upload_id || '.' || v_ext;
  insert into public.ai_interview_media_uploads(id, capability_id, session_id, question_id, object_path, content_type, content_length, expires_at)
    values(v_upload_id, v_cap.id, v_session.id, p_question_id, v_path, p_content_type, p_content_length, now() + interval '2 minutes');
  return jsonb_build_object('upload_id', v_upload_id, 'object_path', v_path, 'expires_at', now() + interval '2 minutes');
end;
$$;
revoke all on function public.prepare_ai_interview_media_upload(uuid, uuid, text, bigint) from public, anon;
grant execute on function public.prepare_ai_interview_media_upload(uuid, uuid, text, bigint) to authenticated;

create or replace function public.finalize_ai_interview_media_upload(p_capability_id uuid, p_upload_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_cap public.ai_interview_portal_capabilities%rowtype; v_upload public.ai_interview_media_uploads%rowtype;
begin
  v_cap := private.require_interview_capability(p_capability_id);
  select * into v_upload from public.ai_interview_media_uploads u
   where u.id = p_upload_id and u.capability_id = v_cap.id and u.session_id = v_cap.session_id for update;
  if not found or v_upload.finalized_at is not null or v_upload.expires_at <= now() then
    raise exception 'upload unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object('upload_id', v_upload.id, 'question_id', v_upload.question_id,
    'object_path', v_upload.object_path, 'content_type', v_upload.content_type, 'content_length', v_upload.content_length);
end;
$$;
revoke all on function public.finalize_ai_interview_media_upload(uuid, uuid) from public, anon;
grant execute on function public.finalize_ai_interview_media_upload(uuid, uuid) to authenticated;

create or replace function public.confirm_ai_interview_media_upload(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'access denied' using errcode = '42501'; end if;
  update public.ai_interview_media_uploads set finalized_at = now()
    where id = p_upload_id and finalized_at is null and expires_at > now();
  if not found then raise exception 'upload unavailable' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.confirm_ai_interview_media_upload(uuid) from public, anon, authenticated;
grant execute on function public.confirm_ai_interview_media_upload(uuid) to service_role;

create or replace function public.get_ai_interview_answer_media_path(p_capability_id uuid, p_answer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_cap public.ai_interview_portal_capabilities%rowtype; v_path text;
begin
  v_cap := private.require_interview_capability(p_capability_id);
  select a.audio_storage_path into v_path from public.ai_interview_answers a
    where a.id = p_answer_id and a.session_id = v_cap.session_id and nullif(a.audio_storage_path, '') is not null;
  if v_path is null then raise exception 'media unavailable' using errcode = '42501'; end if;
  return v_path;
end;
$$;
revoke all on function public.get_ai_interview_answer_media_path(uuid, uuid) from public, anon;
grant execute on function public.get_ai_interview_answer_media_path(uuid, uuid) to authenticated;

create or replace function public.cleanup_ai_interview_portal_security_records(p_retention_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_days integer := greatest(coalesce(p_retention_days, 90), 30); v_idempotency bigint; v_uploads bigint; v_caps bigint; v_invites bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'access denied' using errcode = '42501'; end if;
  delete from public.ai_interview_portal_idempotency where created_at < now() - make_interval(days => v_days); get diagnostics v_idempotency = row_count;
  delete from public.ai_interview_media_uploads where created_at < now() - make_interval(days => v_days); get diagnostics v_uploads = row_count;
  delete from public.ai_interview_portal_capabilities where expires_at < now() - make_interval(days => v_days); get diagnostics v_caps = row_count;
  delete from public.ai_interview_portal_invitations
    where (consumed_at is not null or revoked_at is not null or expires_at < now())
      and created_at < now() - make_interval(days => v_days);
  get diagnostics v_invites = row_count;
  return jsonb_build_object('idempotency',v_idempotency,'uploads',v_uploads,'capabilities',v_caps,'invitations',v_invites);
end;
$$;
revoke all on function public.cleanup_ai_interview_portal_security_records(integer) from public, anon, authenticated;
grant execute on function public.cleanup_ai_interview_portal_security_records(integer) to service_role;

-- Candidate/interview agency ownership is additive. No data is backfilled here.
alter table public.candidates add column if not exists agency_id uuid;
alter table public.interviews add column if not exists agency_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'candidates_agency_id_fkey' and conrelid = 'public.candidates'::regclass) then
    alter table public.candidates add constraint candidates_agency_id_fkey foreign key (agency_id) references public.agencies(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'interviews_agency_id_fkey' and conrelid = 'public.interviews'::regclass) then
    alter table public.interviews add constraint interviews_agency_id_fkey foreign key (agency_id) references public.agencies(id) on delete restrict;
  end if;
end $$;
create index if not exists candidates_company_agency_idx on public.candidates(company_id, agency_id);
create index if not exists candidates_company_agency_status_idx on public.candidates(company_id, agency_id, status);
create index if not exists interviews_company_agency_candidate_idx on public.interviews(company_id, agency_id, candidate_id);
create index if not exists interviews_company_agency_status_idx on public.interviews(company_id, agency_id, status);

create or replace function public.enforce_candidate_interview_agency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor public.users%rowtype; v_candidate public.candidates%rowtype; v_name text;
begin
  if auth.uid() is not null then
    v_actor := private.require_workspace_actor(null);
    if v_actor.role = 'Agency' then
      if v_actor.agency_id is null or new.company_id is null or not exists (
        select 1 from public.agency_members am
        join public.company_agency_access caa on caa.agency_id = am.agency_id and caa.company_id = new.company_id and caa.status = 'Active'
        join public.agency_company_user_access aua on aua.agency_id = am.agency_id and aua.company_id = new.company_id and aua.user_id = am.user_id and aua.status = 'Active'
        where am.user_id = v_actor.id and am.agency_id = v_actor.agency_id and am.status = 'Active'
      ) then raise exception 'agency access denied' using errcode = '42501'; end if;
      new.agency_id := v_actor.agency_id;
    elsif new.agency_id is not null and new.company_id is not null and not exists (
      select 1 from public.company_agency_access caa where caa.company_id = new.company_id and caa.agency_id = new.agency_id and caa.status = 'Active'
    ) then raise exception 'agency access denied' using errcode = '42501'; end if;
  end if;
  if tg_table_name = 'interviews' and new.candidate_id is not null then
    select * into v_candidate from public.candidates c where c.id = new.candidate_id;
    if not found or v_candidate.company_id is distinct from new.company_id or v_candidate.agency_id is distinct from new.agency_id then
      raise exception 'candidate ownership mismatch' using errcode = '42501';
    end if;
  end if;
  if new.agency_id is not null then
    select a.name into v_name from public.agencies a where a.id = new.agency_id and a.status = 'Active';
    if v_name is null then raise exception 'agency unavailable' using errcode = '42501'; end if;
    new.agency := v_name;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_candidate_interview_agency() from public, anon, authenticated, service_role;

drop trigger if exists candidates_enforce_agency on public.candidates;
create trigger candidates_enforce_agency before insert or update of company_id, agency_id, agency on public.candidates
for each row execute function public.enforce_candidate_interview_agency();
drop trigger if exists interviews_enforce_agency on public.interviews;
create trigger interviews_enforce_agency before insert or update of company_id, agency_id, agency, candidate_id on public.interviews
for each row execute function public.enforce_candidate_interview_agency();

-- The browser must never execute legacy passwords or worker lock contracts.
revoke all on function public.legacy_app_login(text, text) from public, anon, authenticated;
revoke all on function public.ai_agent_try_acquire_lock(uuid, text, text, text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.ai_agent_release_lock(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ai_agent_try_acquire_lock(uuid, text, text, text, text, uuid, integer) to service_role;
grant execute on function public.ai_agent_release_lock(uuid, text, text, text) to service_role;

-- Raw company and secret-bearing settings tables are not browser APIs.
revoke all on table public.companies from anon, authenticated;
revoke all on table public.company_email_settings from anon, authenticated;
grant all on table public.companies, public.company_email_settings to service_role;
