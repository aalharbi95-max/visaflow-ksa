-- Agency invitations use Supabase Auth and never store a generated or temporary password.
-- Fail closed if legacy duplicates would make an invitation identity ambiguous.

do $block$
begin
  if to_regclass('public.users') is null
    or to_regclass('public.agency_members') is null
    or to_regclass('public.agency_company_user_access') is null
    or to_regclass('public.company_agency_access') is null then
    raise exception 'Cannot enable agency invitations: required application tables are missing';
  end if;

  if exists (
    select 1
    from (values
      ('users', 'id'), ('users', 'email'), ('users', 'auth_user_id'),
      ('agency_members', 'agency_id'), ('agency_members', 'user_id'),
      ('agency_members', 'status'),
      ('agency_company_user_access', 'company_id'),
      ('agency_company_user_access', 'agency_id'),
      ('agency_company_user_access', 'user_id'),
      ('agency_company_user_access', 'status')
    ) as required(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns as column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = required.table_name
        and column_info.column_name = required.column_name
    )
  ) then
    raise exception 'Cannot enable agency invitations: required application columns are missing';
  end if;

  if exists (
    select 1
    from public.users
    where nullif(btrim(email), '') is not null
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'Cannot enable agency invitations: duplicate normalized emails exist in public.users';
  end if;

  if exists (
    select 1
    from public.users
    where auth_user_id is not null
    group by auth_user_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enable agency invitations: duplicate auth_user_id values exist in public.users';
  end if;

  if exists (
    select 1 from public.agency_members
    group by agency_id, user_id having count(*) > 1
  ) then
    raise exception 'Cannot enable agency invitations: duplicate agency memberships exist';
  end if;

  if exists (
    select 1 from public.agency_company_user_access
    group by company_id, agency_id, user_id having count(*) > 1
  ) then
    raise exception 'Cannot enable agency invitations: duplicate agency company user access rows exist';
  end if;
end;
$block$;

alter table public.users alter column password drop not null;

create unique index if not exists users_normalized_email_unique
  on public.users (lower(btrim(email)))
  where nullif(btrim(email), '') is not null;

create unique index if not exists users_auth_user_id_unique
  on public.users (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists agency_members_agency_id_user_id_unique
  on public.agency_members (agency_id, user_id);

create unique index if not exists agency_company_user_access_company_agency_user_unique
  on public.agency_company_user_access (company_id, agency_id, user_id);

do $block$
begin
  if not exists (
    select 1
    from pg_index as index_info
    join pg_class as table_info on table_info.oid = index_info.indrelid
    join pg_namespace as schema_info on schema_info.oid = table_info.relnamespace
    where schema_info.nspname = 'public'
      and table_info.relname = 'agency_members'
      and index_info.indisunique
      and index_info.indpred is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_info.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = table_info.oid and attribute.attnum = key_column.attnum
      ) = array['agency_id', 'user_id']::name[]
  ) then
    raise exception 'Required unique index for agency_members is missing or incompatible';
  end if;

  if not exists (
    select 1
    from pg_index as index_info
    join pg_class as table_info on table_info.oid = index_info.indrelid
    join pg_namespace as schema_info on schema_info.oid = table_info.relnamespace
    where schema_info.nspname = 'public'
      and table_info.relname = 'agency_company_user_access'
      and index_info.indisunique
      and index_info.indpred is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_info.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = table_info.oid and attribute.attnum = key_column.attnum
      ) = array['company_id', 'agency_id', 'user_id']::name[]
  ) then
    raise exception 'Required unique index for agency_company_user_access is missing or incompatible';
  end if;
end;
$block$;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.agency_user_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  agency_id text not null,
  company_id text not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  delivery_kind text not null default 'invite'
    check (delivery_kind in ('invite', 'resend')),
  created_at timestamptz not null default now()
);

-- Make a repeated application converge from earlier review-only revisions.
alter table public.agency_user_invitations
  add column if not exists invalidated_at timestamptz,
  add column if not exists delivery_kind text not null default 'invite';
alter table public.agency_user_invitations drop column if exists token_hash;

do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agency_user_invitations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%delivery_kind%invite%resend%'
  ) then
    alter table public.agency_user_invitations
      add constraint agency_user_invitations_delivery_kind_check
      check (delivery_kind in ('invite', 'resend'));
  end if;
end;
$block$;

drop function if exists public.verify_agency_user_invitation(text);
drop function if exists public.consume_agency_user_invitation(text);
drop function if exists public.verify_pending_agency_user_invitation();
drop function if exists public.consume_pending_agency_user_invitation();
drop function if exists public.link_agency_invited_user(uuid, text, text, text, text, text, text);
drop function if exists public.link_agency_invited_user(uuid, text, text, text, text, text);

alter table public.agency_user_invitations enable row level security;
revoke all on table public.agency_user_invitations from public, anon, authenticated;

create unique index if not exists agency_user_invitations_one_active_per_user
  on public.agency_user_invitations (auth_user_id)
  where consumed_at is null and invalidated_at is null;

do $block$
begin
  if not exists (
    select 1
    from pg_index as index_info
    join pg_class as table_info on table_info.oid = index_info.indrelid
    join pg_namespace as schema_info on schema_info.oid = table_info.relnamespace
    where schema_info.nspname = 'public'
      and table_info.relname = 'agency_user_invitations'
      and index_info.indisunique
      and index_info.indisvalid
      and index_info.indisready
      and pg_get_expr(index_info.indpred, index_info.indrelid) ilike '%consumed_at IS NULL%'
      and pg_get_expr(index_info.indpred, index_info.indrelid) ilike '%invalidated_at IS NULL%'
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_info.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = table_info.oid and attribute.attnum = key_column.attnum
      ) = array['auth_user_id']::name[]
  ) then
    raise exception 'Required unique active-invitation index is missing or incompatible';
  end if;
end;
$block$;

-- Maintain a private, indexed projection of Auth identities. Multiple rows may
-- share an email so lookup can fail closed on ambiguous SSO identities.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.auth_identity_directory (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  normalized_email text not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.auth_identity_directory from public, anon, authenticated;

create index if not exists auth_identity_directory_normalized_email_idx
  on private.auth_identity_directory (normalized_email);

do $block$
begin
  if not exists (
    select 1
    from pg_index as index_info
    join pg_class as table_info on table_info.oid = index_info.indrelid
    join pg_namespace as schema_info on schema_info.oid = table_info.relnamespace
    where schema_info.nspname = 'private'
      and table_info.relname = 'auth_identity_directory'
      and index_info.indisvalid
      and index_info.indisready
      and index_info.indpred is null
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_info.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = table_info.oid and attribute.attnum = key_column.attnum
      ) = array['normalized_email']::name[]
  ) then
    raise exception 'Required Auth identity directory email index is missing or incompatible';
  end if;
end;
$block$;

create or replace function private.sync_auth_identity_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from private.auth_identity_directory where auth_user_id = old.id;
    return old;
  end if;

  if nullif(btrim(new.email), '') is null then
    delete from private.auth_identity_directory where auth_user_id = new.id;
  else
    insert into private.auth_identity_directory (auth_user_id, normalized_email, updated_at)
    values (new.id, lower(btrim(new.email)), now())
    on conflict (auth_user_id) do update
    set normalized_email = excluded.normalized_email,
        updated_at = excluded.updated_at;
  end if;

  return new;
end;
$function$;

revoke all on function private.sync_auth_identity_directory() from public, anon, authenticated;

drop trigger if exists sync_agency_auth_identity_directory on auth.users;
create trigger sync_agency_auth_identity_directory
after insert or update of email or delete on auth.users
for each row execute function private.sync_auth_identity_directory();

insert into private.auth_identity_directory (auth_user_id, normalized_email, updated_at)
select auth_user.id, lower(btrim(auth_user.email)), now()
from auth.users as auth_user
where nullif(btrim(auth_user.email), '') is not null
on conflict (auth_user_id) do update
set normalized_email = excluded.normalized_email,
    updated_at = excluded.updated_at;

-- Service-only lookup through the private indexed directory. Email only locates
-- candidate identities; authorization still requires an exact Auth ID match.
create or replace function public.lookup_auth_identity_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  clean_email text := lower(btrim(p_email));
  identity_ids uuid[];
begin
  if nullif(clean_email, '') is null or length(clean_email) > 254 then
    return null;
  end if;

  select coalesce(array_agg(candidate.auth_user_id order by candidate.auth_user_id), '{}'::uuid[])
  into identity_ids
  from (
    select directory.auth_user_id
    from private.auth_identity_directory as directory
    where directory.normalized_email = clean_email
    order by directory.auth_user_id
    limit 2
  ) as candidate;

  if cardinality(identity_ids) = 0 then
    return null;
  end if;
  if cardinality(identity_ids) > 1 then
    return jsonb_build_object('ambiguous', true);
  end if;

  return jsonb_build_object('id', identity_ids[1], 'ambiguous', false);
end;
$function$;

revoke all on function public.lookup_auth_identity_by_email(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_identity_by_email(text) to service_role;

create or replace function public.link_agency_invited_user(
  p_auth_user_id uuid,
  p_email text,
  p_name text,
  p_agency_id text,
  p_company_id text,
  p_invitation_id uuid,
  p_delivery_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_user_id public.users.id%type;
  target_user_role public.users.role%type;
  target_user_agency_id public.users.agency_id%type;
  target_user_auth_user_id public.users.auth_user_id%type;
  selected_agency_id public.agencies.id%type;
  selected_agency_name public.agencies.name%type;
  selected_company_id public.companies.id%type;
  clean_email text := lower(btrim(p_email));
begin
  if p_auth_user_id is null
    or nullif(clean_email, '') is null
    or nullif(btrim(p_name), '') is null
    or nullif(btrim(p_agency_id), '') is null
    or nullif(btrim(p_company_id), '') is null then
    raise exception 'invalid invitation link request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text, 0));

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_auth_user_id
      and auth_user.email = clean_email
  ) then
    raise exception 'authentication identity mismatch' using errcode = '42501';
  end if;

  select agency.id, agency.name
  into selected_agency_id, selected_agency_name
  from public.agencies as agency
  where agency.id::text = p_agency_id
    and agency.status = 'Active';

  if selected_agency_id is null then
    raise exception 'agency not found' using errcode = 'P0002';
  end if;

  select company.id
  into selected_company_id
  from public.companies as company
  where company.id::text = p_company_id
    and company.status = 'Active';

  if selected_company_id is null or not exists (
    select 1
    from public.company_agency_access as access
    where access.company_id = selected_company_id
      and access.agency_id = selected_agency_id
      and access.status = 'Active'
  ) then
    raise exception 'agency is not linked to company' using errcode = '42501';
  end if;

  select app_user.id, app_user.role, app_user.agency_id, app_user.auth_user_id
  into target_user_id, target_user_role, target_user_agency_id, target_user_auth_user_id
  from public.users as app_user
  where lower(btrim(app_user.email)) = clean_email;

  if target_user_id is not null then
    if target_user_role <> 'Agency' then
      raise exception 'incompatible user role' using errcode = '42501';
    end if;
    if target_user_agency_id is not null and target_user_agency_id <> selected_agency_id then
      raise exception 'agency mismatch' using errcode = '42501';
    end if;
    if target_user_auth_user_id is not null and target_user_auth_user_id <> p_auth_user_id then
      raise exception 'authentication identity mismatch' using errcode = '42501';
    end if;
    if target_user_auth_user_id is null and p_delivery_kind is distinct from 'invite' then
      raise exception 'trusted authentication migration required' using errcode = '42501';
    end if;

    update public.users
    set name = btrim(p_name),
        email = clean_email,
        role = 'Agency',
        status = 'Active',
        is_active = true,
        company_id = null,
        agency_id = selected_agency_id,
        agency_name = selected_agency_name,
        auth_user_id = p_auth_user_id,
        password = null
    where id = target_user_id;
  else
    insert into public.users (
      name, email, role, status, is_active, company_id, agency_id,
      agency_name, auth_user_id, password
    ) values (
      btrim(p_name), clean_email, 'Agency', 'Active', true, null,
      selected_agency_id, selected_agency_name, p_auth_user_id, null
    )
    returning id into target_user_id;
  end if;

  insert into public.agency_members (agency_id, user_id, role, status)
  values (selected_agency_id, target_user_id, 'Agency User', 'Active')
  on conflict (agency_id, user_id) do update
  set role = excluded.role,
      status = excluded.status;

  insert into public.agency_company_user_access (
    company_id, agency_id, user_id, role, status,
    can_view_requests, can_upload_candidates, can_update_candidates, can_view_interviews
  ) values (
    selected_company_id, selected_agency_id, target_user_id, 'Agency User', 'Active',
    true, true, true, true
  )
  on conflict (company_id, agency_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      can_view_requests = excluded.can_view_requests,
      can_upload_candidates = excluded.can_upload_candidates,
      can_update_candidates = excluded.can_update_candidates,
      can_view_interviews = excluded.can_view_interviews;

  if p_delivery_kind is not null then
    if p_invitation_id is null then
      raise exception 'invitation delivery requires an identifier' using errcode = '22023';
    end if;
    if p_delivery_kind not in ('invite', 'resend') then
      raise exception 'invalid invitation delivery kind' using errcode = '22023';
    end if;

    update public.agency_user_invitations
    set invalidated_at = now()
    where auth_user_id = p_auth_user_id
      and consumed_at is null
      and invalidated_at is null;

    insert into public.agency_user_invitations (
      id, auth_user_id, agency_id, company_id, delivery_kind
    ) values (
      p_invitation_id, p_auth_user_id, selected_agency_id::text,
      selected_company_id::text, p_delivery_kind
    );
  elsif p_invitation_id is not null then
    raise exception 'invitation identifier requires a delivery kind' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'user_id', target_user_id,
    'agency_id', selected_agency_id,
    'company_id', selected_company_id
  );
end;
$function$;

revoke all on function public.link_agency_invited_user(uuid, text, text, text, text, uuid, text) from public;
revoke all on function public.link_agency_invited_user(uuid, text, text, text, text, uuid, text) from anon;
revoke all on function public.link_agency_invited_user(uuid, text, text, text, text, uuid, text) from authenticated;
grant execute on function public.link_agency_invited_user(uuid, text, text, text, text, uuid, text) to service_role;

create or replace function public.verify_pending_agency_user_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invitation_id public.agency_user_invitations.id%type;
begin
  if auth.uid() is null or p_invitation_id is null then
    return jsonb_build_object('valid', false);
  end if;

  select invitation.id
  into invitation_id
  from public.agency_user_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.auth_user_id = auth.uid()
    and invitation.consumed_at is null
    and invitation.invalidated_at is null
    and invitation.expires_at > now()
    and exists (
      select 1
      from public.users as app_user
      join public.agency_members as membership
        on membership.user_id = app_user.id
       and membership.agency_id::text = invitation.agency_id
       and membership.status = 'Active'
      where app_user.auth_user_id = auth.uid()
        and app_user.role = 'Agency'
        and app_user.status = 'Active'
        and app_user.is_active is true
        and app_user.agency_id::text = invitation.agency_id
    )
    and exists (
      select 1
      from public.agency_company_user_access as access
      join public.users as app_user on app_user.id = access.user_id
      where app_user.auth_user_id = auth.uid()
        and access.agency_id::text = invitation.agency_id
        and access.company_id::text = invitation.company_id
        and access.status = 'Active'
    );

  return jsonb_build_object('valid', invitation_id is not null);
end;
$function$;

create or replace function public.consume_pending_agency_user_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_invitation public.agency_user_invitations%rowtype;
  target_user_id public.users.id%type;
  affected_rows bigint;
begin
  if auth.uid() is null or p_invitation_id is null then
    return jsonb_build_object('consumed', false);
  end if;

  -- Serialize consumption with invite/resend rotation for this Auth identity.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select invitation.*
  into locked_invitation
  from public.agency_user_invitations as invitation
  where invitation.id = p_invitation_id
    and invitation.auth_user_id = auth.uid()
  for update;

  if locked_invitation.id is null then
    return jsonb_build_object('consumed', false);
  end if;

  if locked_invitation.consumed_at is not null
    or locked_invitation.invalidated_at is not null
    or locked_invitation.expires_at <= now() then
    return jsonb_build_object('consumed', false);
  end if;

  select app_user.id
  into target_user_id
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.role = 'Agency'
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.agency_id::text = locked_invitation.agency_id
  for update;

  if target_user_id is null then
    return jsonb_build_object('consumed', false);
  end if;

  perform 1
  from public.agency_members as membership
  where membership.user_id = target_user_id
    and membership.agency_id::text = locked_invitation.agency_id
    and membership.status = 'Active'
  for update;
  if not found then
    return jsonb_build_object('consumed', false);
  end if;

  perform 1
  from public.agency_company_user_access as access
  where access.user_id = target_user_id
    and access.agency_id::text = locked_invitation.agency_id
    and access.company_id::text = locked_invitation.company_id
    and access.status = 'Active'
  for update;
  if not found then
    return jsonb_build_object('consumed', false);
  end if;

  update public.agency_user_invitations as invitation
  set consumed_at = now()
  where invitation.id = locked_invitation.id
    and invitation.auth_user_id = auth.uid()
    and invitation.consumed_at is null
    and invitation.invalidated_at is null
    and invitation.expires_at > now();

  get diagnostics affected_rows = row_count;
  return jsonb_build_object('consumed', affected_rows = 1);
end;
$function$;

revoke all on function public.verify_pending_agency_user_invitation(uuid) from public, anon;
grant execute on function public.verify_pending_agency_user_invitation(uuid) to authenticated;
revoke all on function public.consume_pending_agency_user_invitation(uuid) from public, anon;
grant execute on function public.consume_pending_agency_user_invitation(uuid) to authenticated;

-- Retain consumed, superseded, and expired invitations for 90 days by default.
-- Run this service-role-only function from a trusted scheduled job; it refuses
-- retention periods shorter than 30 days so recent audit evidence is preserved.
create or replace function public.cleanup_agency_user_invitations(p_retention_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  deleted_rows bigint;
  cutoff timestamptz;
begin
  if p_retention_days < 30 or p_retention_days > 3650 then
    raise exception 'retention must be between 30 and 3650 days' using errcode = '22023';
  end if;

  cutoff := now() - make_interval(days => p_retention_days);

  delete from public.agency_user_invitations as invitation
  where (invitation.consumed_at is not null and invitation.consumed_at < cutoff)
     or (invitation.invalidated_at is not null and invitation.invalidated_at < cutoff)
     or (
       invitation.consumed_at is null
       and invitation.invalidated_at is null
       and invitation.expires_at < cutoff
     );

  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$function$;

comment on function public.cleanup_agency_user_invitations(integer) is
  'Deletes consumed, invalidated, or long-expired agency invitation audit rows after a minimum 30-day retention period. Schedule with a trusted service-role job.';

revoke all on function public.cleanup_agency_user_invitations(integer) from public, anon, authenticated;
grant execute on function public.cleanup_agency_user_invitations(integer) to service_role;
