-- Security baseline for agency provisioning.
-- This migration is intentionally fail-closed: it never repairs or deletes data.

begin;

do $preflight$
begin
  if exists (
    select 1
    from public.company_agency_access as access
    left join public.companies as company on company.id = access.company_id
    where company.id is null
  ) then
    raise exception
      'AGENCY_SECURITY_PREFLIGHT_FAILED: company_agency_access contains orphan company_id values.';
  end if;

  if exists (
    select 1
    from public.company_agency_access as access
    left join public.agencies as agency on agency.id = access.agency_id
    where agency.id is null
  ) then
    raise exception
      'AGENCY_SECURITY_PREFLIGHT_FAILED: company_agency_access contains orphan agency_id values.';
  end if;

  if exists (
    select 1
    from public.users as app_user
    left join public.agencies as agency on agency.id = app_user.agency_id
    where app_user.agency_id is not null
      and agency.id is null
  ) then
    raise exception
      'AGENCY_SECURITY_PREFLIGHT_FAILED: public.users contains orphan agency_id values.';
  end if;
end;
$preflight$;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_agency_access_company_id_fkey'
      and conrelid = 'public.company_agency_access'::regclass
  ) then
    alter table public.company_agency_access
      add constraint company_agency_access_company_id_fkey
      foreign key (company_id) references public.companies(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'company_agency_access_agency_id_fkey'
      and conrelid = 'public.company_agency_access'::regclass
  ) then
    alter table public.company_agency_access
      add constraint company_agency_access_agency_id_fkey
      foreign key (agency_id) references public.agencies(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'users_agency_id_fkey'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_agency_id_fkey
      foreign key (agency_id) references public.agencies(id)
      on delete restrict;
  end if;
end;
$constraints$;

create index if not exists agency_company_user_access_user_company_agency_idx
  on public.agency_company_user_access (user_id, company_id, agency_id);

create or replace function public.current_agency_access_actor()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', app_user.id,
    'auth_user_id', app_user.auth_user_id,
    'role', app_user.role,
    'company_id', app_user.company_id,
    'agency_id', app_user.agency_id
  )
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
    and app_user.status = 'Active'
    and app_user.is_active is true
    and (
      app_user.company_id is null
      or exists (
        select 1
        from public.companies as company
        where company.id = app_user.company_id
          and company.status = 'Active'
      )
    )
    and (
      app_user.role <> 'Agency'
      or (
        app_user.agency_id is not null
        and exists (
          select 1
          from public.agencies as agency
          where agency.id = app_user.agency_id
            and agency.status = 'Active'
        )
      )
    )
  limit 1;
$function$;

revoke all on function public.current_agency_access_actor() from public, anon, authenticated;
grant execute on function public.current_agency_access_actor() to authenticated, service_role;

-- Remove every permissive agency policy observed in the published schema.
drop policy if exists "Allow select" on public.agencies;
drop policy if exists "Enable insert for authenticated users only" on public.agencies;
drop policy if exists "Enable read access for all users" on public.agencies;
drop policy if exists "agencies company access" on public.agencies;
drop policy if exists agencies_delete_public on public.agencies;
drop policy if exists agencies_insert_public on public.agencies;
drop policy if exists agencies_select_public on public.agencies;
drop policy if exists agencies_update_public on public.agencies;

drop policy if exists "companies select own" on public.companies;
drop policy if exists agencies_tenant_select on public.agencies;
drop policy if exists companies_tenant_select on public.companies;
drop policy if exists company_agency_access_tenant_select on public.company_agency_access;
drop policy if exists agency_company_user_access_tenant_select
  on public.agency_company_user_access;

alter table public.agencies enable row level security;
alter table public.companies enable row level security;
alter table public.company_agency_access enable row level security;
alter table public.agency_company_user_access enable row level security;

revoke all on table public.agencies from public, anon, authenticated;
revoke all on table public.companies from public, anon, authenticated;
revoke all on table public.company_agency_access from public, anon, authenticated;
revoke all on table public.agency_company_user_access from public, anon, authenticated;

grant select on table public.agencies to authenticated;
grant select on table public.companies to authenticated;
grant select on table public.company_agency_access to authenticated;
grant select on table public.agency_company_user_access to authenticated;

create policy agencies_tenant_select
on public.agencies
for select to authenticated
using (
  (
    public.current_agency_access_actor()->>'role'
      in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
    and public.current_agency_access_actor()->>'company_id' is null
  )
  or id::text = public.current_agency_access_actor()->>'agency_id'
  or exists (
    select 1
    from public.company_agency_access as access
    where access.agency_id = agencies.id
      and access.company_id::text =
        public.current_agency_access_actor()->>'company_id'
      and coalesce(access.status, 'Active') <> 'Inactive'
  )
);

create policy companies_tenant_select
on public.companies
for select to authenticated
using (
  id::text = public.current_agency_access_actor()->>'company_id'
  or (
    public.current_agency_access_actor()->>'role'
      in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
    and public.current_agency_access_actor()->>'company_id' is null
  )
  or exists (
    select 1
    from public.agency_company_user_access as access
    where access.company_id = companies.id
      and access.user_id::text =
        public.current_agency_access_actor()->>'id'
      and access.agency_id::text =
        public.current_agency_access_actor()->>'agency_id'
      and access.status = 'Active'
  )
);

create policy company_agency_access_tenant_select
on public.company_agency_access
for select to authenticated
using (
  company_id::text = public.current_agency_access_actor()->>'company_id'
  or (
    agency_id::text = public.current_agency_access_actor()->>'agency_id'
    and exists (
      select 1
      from public.agency_company_user_access as user_access
      where user_access.company_id = company_agency_access.company_id
        and user_access.agency_id = company_agency_access.agency_id
        and user_access.user_id::text =
          public.current_agency_access_actor()->>'id'
        and user_access.status = 'Active'
    )
  )
  or (
    public.current_agency_access_actor()->>'role'
      in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
    and public.current_agency_access_actor()->>'company_id' is null
  )
);

create policy agency_company_user_access_tenant_select
on public.agency_company_user_access
for select to authenticated
using (
  company_id::text = public.current_agency_access_actor()->>'company_id'
  or (
    user_id::text = public.current_agency_access_actor()->>'id'
    and agency_id::text = public.current_agency_access_actor()->>'agency_id'
  )
  or (
    public.current_agency_access_actor()->>'role'
      in ('Platform Owner', 'Platform Accounts User', 'Platform Support User')
    and public.current_agency_access_actor()->>'company_id' is null
  )
);

-- Recreate the existing guards with a fixed search_path. The feature migration
-- extends the two access guards for provisioning states.
create or replace function public.guard_company_agency_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.company_id is null then
    raise exception 'SECURITY BLOCK: company_id is required for agency access.';
  end if;
  if new.agency_id is null then
    raise exception 'SECURITY BLOCK: agency_id is required for agency access.';
  end if;
  if not exists (
    select 1 from public.companies as company
    where company.id = new.company_id
  ) then
    raise exception 'SECURITY BLOCK: company does not exist.';
  end if;
  if not exists (
    select 1 from public.agencies as agency
    where agency.id = new.agency_id
  ) then
    raise exception 'SECURITY BLOCK: agency does not exist.';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_agency_company_user_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  user_role text;
  user_agency_id uuid;
begin
  if new.company_id is null or new.agency_id is null or new.user_id is null then
    raise exception
      'SECURITY BLOCK: company_id, agency_id, and user_id are required for agency user access.';
  end if;

  select app_user.role, app_user.agency_id
  into user_role, user_agency_id
  from public.users as app_user
  where app_user.id = new.user_id;

  if user_role is null or user_role <> 'Agency' then
    raise exception
      'SECURITY BLOCK: only Agency role users can be granted agency workspace access.';
  end if;
  if user_agency_id is null or user_agency_id <> new.agency_id then
    raise exception
      'SECURITY BLOCK: Agency user agency_id must match the granted agency_id.';
  end if;
  if not exists (
    select 1
    from public.company_agency_access as access
    where access.company_id = new.company_id
      and access.agency_id = new.agency_id
      and coalesce(access.status, 'Active') = 'Active'
  ) then
    raise exception
      'SECURITY BLOCK: active company_agency_access must exist before granting active agency user access.';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_platform_user_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if coalesce(new.role, '') in (
    'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  ) or coalesce(old.role, '') in (
    'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  ) then
    if auth.uid() is null or not exists (
      select 1
      from public.users as app_user
      where app_user.auth_user_id = auth.uid()
        and app_user.role = 'Platform Owner'
        and coalesce(app_user.status, 'Active') = 'Active'
    ) then
      raise exception
        'SECURITY BLOCK: only an active Platform Owner can manage platform roles.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.guard_users_security()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_role text := coalesce(new.role, 'Viewer');
begin
  new.email := lower(btrim(new.email));
  new.updated_at := now();
  if new.email is null or new.email = '' then
    raise exception 'Email is required.';
  end if;

  if normalized_role in (
    'Platform Owner', 'Platform Accounts User', 'Platform Support User'
  ) then
    new.company_id := null;
    new.agency_id := null;
    new.agency_name := null;
    if coalesce(new.status, 'Active') = 'Active'
      and new.auth_user_id is null then
      raise exception 'Active platform users must be linked to Supabase Auth.';
    end if;
  elsif normalized_role = 'Agency' then
    new.company_id := null;
    if new.agency_id is null then
      raise exception 'Agency users must have agency_id.';
    end if;
  else
    if new.company_id is null then
      raise exception 'Company users must have company_id.';
    end if;
    new.agency_id := null;
    new.agency_name := null;
  end if;

  new.role := normalized_role;
  return new;
end;
$function$;

revoke all on function public.guard_company_agency_access() from public, anon, authenticated;
revoke all on function public.guard_agency_company_user_access() from public, anon, authenticated;
revoke all on function public.guard_platform_user_roles() from public, anon, authenticated;
revoke all on function public.guard_users_security() from public, anon, authenticated;
grant execute on function public.guard_company_agency_access() to service_role;
grant execute on function public.guard_agency_company_user_access() to service_role;
grant execute on function public.guard_platform_user_roles() to service_role;
grant execute on function public.guard_users_security() to service_role;

commit;
