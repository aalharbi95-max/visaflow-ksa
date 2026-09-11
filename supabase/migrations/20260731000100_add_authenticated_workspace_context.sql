-- Canonical authenticated login contract for company and agency workspaces.
-- Additive migration: the legacy RPC remains available for older deployed clients.

create or replace function public.get_authenticated_workspace_context()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  matched_actor public.users%rowtype;
  linked_rows bigint;
  company_context jsonb;
  agency_context jsonb;
begin
  if auth.uid() is null then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select count(*) into linked_rows
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if linked_rows <> 1 then
    raise exception 'account not linked' using errcode = '42501';
  end if;

  select * into matched_actor
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if matched_actor.company_id is not null then
    select jsonb_build_object(
      'id', company.id, 'name', company.name, 'status', company.status,
      'subscription_status', company.subscription_status,
      'subscription_end', company.subscription_end
    ) into company_context
    from public.companies as company
    where company.id = matched_actor.company_id;
  end if;

  if matched_actor.agency_id is not null then
    select jsonb_build_object(
      'id', agency.id, 'name', agency.name, 'status', agency.status
    ) into agency_context
    from public.agencies as agency
    where agency.id = matched_actor.agency_id;
  end if;

  return jsonb_build_object(
    'actor', jsonb_build_object(
      'id', matched_actor.id, 'name', matched_actor.name, 'email', matched_actor.email,
      'role', matched_actor.role, 'status', matched_actor.status,
      'is_active', matched_actor.is_active, 'company_id', matched_actor.company_id,
      'agency_id', matched_actor.agency_id, 'agency_name', matched_actor.agency_name,
      'auth_user_id', matched_actor.auth_user_id, 'created_at', matched_actor.created_at
    ),
    'company', company_context,
    'agency', agency_context
  );
end;
$function$;

revoke all on function public.get_authenticated_workspace_context() from public;
revoke all on function public.get_authenticated_workspace_context() from anon;
revoke all on function public.get_authenticated_workspace_context() from authenticated;
grant execute on function public.get_authenticated_workspace_context() to authenticated;
grant execute on function public.get_authenticated_workspace_context() to service_role;
