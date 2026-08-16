begin;

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
    'Platform Owner', 'Platform Accounts User', 'Platform Support User',
    'Platform Marketing User'
  ) or coalesce(old.role, '') in (
    'Platform Owner', 'Platform Accounts User', 'Platform Support User',
    'Platform Marketing User'
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
    'Platform Owner', 'Platform Accounts User', 'Platform Support User',
    'Platform Marketing User'
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

revoke all on function public.guard_platform_user_roles() from public, anon, authenticated;
revoke all on function public.guard_users_security() from public, anon, authenticated;
grant execute on function public.guard_platform_user_roles() to service_role;
grant execute on function public.guard_users_security() to service_role;

commit;
