-- Phase 1: add safe RPC replacements before removing browser table privileges.
-- legacy_app_login is temporary and must be dropped after all legacy accounts
-- have been migrated to Supabase Auth.

create or replace function public.legacy_app_login(
  p_email text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  matched_user jsonb;
  matching_rows bigint;
begin
  if nullif(btrim(p_email), '') is null or nullif(p_password, '') is null then
    return jsonb_build_object('ok', false, 'user', null);
  end if;

  select count(*)
  into matching_rows
  from public.users as app_user
  where lower(btrim(app_user.email)) = lower(btrim(p_email))
    and app_user.password = p_password;

  if matching_rows <> 1 then
    return jsonb_build_object('ok', false, 'user', null);
  end if;

  select jsonb_build_object(
    'id', app_user.id,
    'name', app_user.name,
    'email', app_user.email,
    'role', app_user.role,
    'status', app_user.status,
    'company_id', app_user.company_id,
    'agency_id', app_user.agency_id,
    'agency_name', app_user.agency_name,
    'auth_user_id', app_user.auth_user_id,
    'created_at', app_user.created_at
  )
  into matched_user
  from public.users as app_user
  where lower(btrim(app_user.email)) = lower(btrim(p_email))
    and app_user.password = p_password
    and app_user.auth_user_id is null
    and app_user.role not in (
      'Platform Owner',
      'Platform Accounts User',
      'Platform Support User'
    )
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
    );

  if matched_user is null then
    return jsonb_build_object('ok', false, 'user', null);
  end if;

  return jsonb_build_object('ok', true, 'user', matched_user);
end;
$function$;

revoke all on function public.legacy_app_login(text, text) from public;
revoke all on function public.legacy_app_login(text, text) from anon;
revoke all on function public.legacy_app_login(text, text) from authenticated;
grant execute on function public.legacy_app_login(text, text) to anon;
grant execute on function public.legacy_app_login(text, text) to authenticated;

create or replace function public.get_authenticated_app_user()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  matched_user jsonb;
  linked_rows bigint;
begin
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select count(*)
  into linked_rows
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if linked_rows <> 1 then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', app_user.id,
    'name', app_user.name,
    'email', app_user.email,
    'role', app_user.role,
    'status', app_user.status,
    'company_id', app_user.company_id,
    'agency_id', app_user.agency_id,
    'agency_name', app_user.agency_name,
    'auth_user_id', app_user.auth_user_id,
    'created_at', app_user.created_at
  )
  into matched_user
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
    and (
      app_user.role not in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
      or app_user.company_id is null
    );

  if matched_user is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  return matched_user;
end;
$function$;

revoke all on function public.get_authenticated_app_user() from public;
revoke all on function public.get_authenticated_app_user() from anon;
revoke all on function public.get_authenticated_app_user() from authenticated;
grant execute on function public.get_authenticated_app_user() to authenticated;

create or replace function public.list_manageable_app_users()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id public.users.id%type;
  actor_role public.users.role%type;
  actor_company_id public.users.company_id%type;
  linked_rows bigint;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select count(*)
  into linked_rows
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if linked_rows <> 1 then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select app_user.id, app_user.role, app_user.company_id
  into actor_id, actor_role, actor_company_id
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
      app_user.role not in (
        'Platform Owner',
        'Platform Accounts User',
        'Platform Support User'
      )
      or app_user.company_id is null
    );

  if actor_id is null or actor_role not in (
    'Platform Owner',
    'Platform Accounts User',
    'Company Admin',
    'Admin'
  ) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  if actor_role in ('Platform Owner', 'Platform Accounts User') then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', managed_user.id,
          'name', managed_user.name,
          'email', managed_user.email,
          'role', managed_user.role,
          'status', managed_user.status,
          'company_id', managed_user.company_id,
          'agency_id', managed_user.agency_id,
          'agency_name', managed_user.agency_name,
          'auth_user_id', managed_user.auth_user_id,
          'created_at', managed_user.created_at
        )
        order by managed_user.created_at desc nulls last, managed_user.id
      ),
      '[]'::jsonb
    )
    into result
    from public.users as managed_user;
  else
    if actor_company_id is null then
      raise exception 'access denied' using errcode = '42501';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', managed_user.id,
          'name', managed_user.name,
          'email', managed_user.email,
          'role', managed_user.role,
          'status', managed_user.status,
          'company_id', managed_user.company_id,
          'agency_id', managed_user.agency_id,
          'agency_name', managed_user.agency_name,
          'auth_user_id', managed_user.auth_user_id,
          'created_at', managed_user.created_at
        )
        order by managed_user.created_at desc nulls last, managed_user.id
      ),
      '[]'::jsonb
    )
    into result
    from public.users as managed_user
    where managed_user.company_id = actor_company_id;
  end if;

  return coalesce(result, '[]'::jsonb);
end;
$function$;

revoke all on function public.list_manageable_app_users() from public;
revoke all on function public.list_manageable_app_users() from anon;
revoke all on function public.list_manageable_app_users() from authenticated;
grant execute on function public.list_manageable_app_users() to authenticated;
