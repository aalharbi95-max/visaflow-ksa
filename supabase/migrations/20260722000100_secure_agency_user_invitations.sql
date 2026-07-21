-- Agency invitations use Supabase Auth and never store a generated or temporary password.
-- Fail closed if legacy duplicates would make an invitation identity ambiguous.

do $block$
begin
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
end;
$block$;

alter table public.users alter column password drop not null;

create unique index if not exists users_normalized_email_unique
  on public.users (lower(btrim(email)))
  where nullif(btrim(email), '') is not null;

create unique index if not exists users_auth_user_id_unique
  on public.users (auth_user_id)
  where auth_user_id is not null;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.agency_user_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  agency_id text not null,
  company_id text not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agency_user_invitations_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$')
);

alter table public.agency_user_invitations enable row level security;
revoke all on table public.agency_user_invitations from public, anon, authenticated;

create or replace function public.link_agency_invited_user(
  p_auth_user_id uuid,
  p_email text,
  p_name text,
  p_agency_id text,
  p_company_id text,
  p_invitation_token_hash text
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

  select app_user.id, app_user.role, app_user.agency_id
  into target_user_id, target_user_role, target_user_agency_id
  from public.users as app_user
  where lower(btrim(app_user.email)) = clean_email;

  if target_user_id is not null then
    if target_user_role <> 'Agency' then
      raise exception 'incompatible user role' using errcode = '42501';
    end if;
    if target_user_agency_id is not null and target_user_agency_id <> selected_agency_id then
      raise exception 'agency mismatch' using errcode = '42501';
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

  if nullif(btrim(p_invitation_token_hash), '') is not null then
    if p_invitation_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid invitation token hash' using errcode = '22023';
    end if;

    delete from public.agency_user_invitations
    where auth_user_id = p_auth_user_id
      and consumed_at is null;

    insert into public.agency_user_invitations (
      token_hash, auth_user_id, agency_id, company_id
    ) values (
      p_invitation_token_hash, p_auth_user_id,
      selected_agency_id::text, selected_company_id::text
    );
  end if;

  return jsonb_build_object(
    'user_id', target_user_id,
    'agency_id', selected_agency_id,
    'company_id', selected_company_id
  );
end;
$function$;

revoke all on function public.link_agency_invited_user(uuid, text, text, text, text, text) from public;
revoke all on function public.link_agency_invited_user(uuid, text, text, text, text, text) from anon;
revoke all on function public.link_agency_invited_user(uuid, text, text, text, text, text) from authenticated;
grant execute on function public.link_agency_invited_user(uuid, text, text, text, text, text) to service_role;

create or replace function public.verify_agency_user_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  invitation_id public.agency_user_invitations.id%type;
begin
  if auth.uid() is null or nullif(btrim(p_token), '') is null then
    return jsonb_build_object('valid', false);
  end if;

  select invitation.id
  into invitation_id
  from public.agency_user_invitations as invitation
  where invitation.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and invitation.auth_user_id = auth.uid()
    and invitation.consumed_at is null
    and invitation.expires_at > now()
    and exists (
      select 1
      from public.users as app_user
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

create or replace function public.consume_agency_user_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  affected_rows bigint;
begin
  if auth.uid() is null or nullif(btrim(p_token), '') is null then
    return jsonb_build_object('consumed', false);
  end if;

  update public.agency_user_invitations as invitation
  set consumed_at = now()
  where invitation.token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    and invitation.auth_user_id = auth.uid()
    and invitation.consumed_at is null
    and invitation.expires_at > now()
    and exists (
      select 1
      from public.users as app_user
      where app_user.auth_user_id = auth.uid()
        and app_user.role = 'Agency'
        and app_user.status = 'Active'
        and app_user.is_active is true
    );

  get diagnostics affected_rows = row_count;
  return jsonb_build_object('consumed', affected_rows = 1);
end;
$function$;

revoke all on function public.verify_agency_user_invitation(text) from public, anon;
grant execute on function public.verify_agency_user_invitation(text) to authenticated;
revoke all on function public.consume_agency_user_invitation(text) from public, anon;
grant execute on function public.consume_agency_user_invitation(text) to authenticated;
