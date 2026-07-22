-- Database contract test for a disposable local Supabase database or staging clone.
-- Run only after applying migrations in that disposable environment. The
-- transaction is always rolled back and must never be pointed at production.

begin;

do $test$
declare
  selected_auth_user_id uuid;
  selected_agency_id text;
  selected_company_id text;
  invitation_id uuid;
  superseded_invitation_id uuid;
  result jsonb;
  active_count bigint;
begin
  if has_function_privilege('anon', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE') then
    raise exception 'Auth directory lookup is exposed to a browser role';
  end if;

  if has_function_privilege('anon', 'public.cleanup_agency_user_invitations(integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.cleanup_agency_user_invitations(integer)', 'EXECUTE') then
    raise exception 'Invitation cleanup is exposed to a browser role';
  end if;

  if not has_function_privilege('service_role', 'public.lookup_auth_identity_by_email(text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.cleanup_agency_user_invitations(integer)', 'EXECUTE') then
    raise exception 'Required service-role grants are missing';
  end if;

  if to_regclass('private.auth_identity_directory_normalized_email_idx') is null then
    raise exception 'Indexed private Auth identity directory is missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_user_invitations'
      and column_name in ('token', 'token_hash')
  ) then
    raise exception 'Application invitation secrets must not be stored';
  end if;

  select app_user.auth_user_id, access.agency_id::text, access.company_id::text
  into selected_auth_user_id, selected_agency_id, selected_company_id
  from public.users as app_user
  join public.agency_company_user_access as access on access.user_id = app_user.id
  where app_user.role = 'Agency'
    and app_user.status = 'Active'
    and app_user.is_active is true
    and app_user.auth_user_id is not null
    and access.status = 'Active'
  order by app_user.id
  limit 1;
  if selected_auth_user_id is null then
    raise exception 'Database contract test requires one linked Agency Auth fixture user';
  end if;

  perform set_config('request.jwt.claim.sub', selected_auth_user_id::text, true);

  update public.agency_user_invitations
  set invalidated_at = now()
  where auth_user_id = selected_auth_user_id
    and consumed_at is null
    and invalidated_at is null;

  insert into public.agency_user_invitations (
    auth_user_id, agency_id, company_id, delivery_kind, expires_at
  ) values (
    selected_auth_user_id, selected_agency_id, selected_company_id,
    'invite', now() - interval '1 minute'
  ) returning id into invitation_id;

  select public.verify_pending_agency_user_invitation(invitation_id) into result;
  if coalesce((result ->> 'valid')::boolean, false) then
    raise exception 'Expired invitation was accepted';
  end if;

  update public.agency_user_invitations
  set invalidated_at = now()
  where auth_user_id = selected_auth_user_id
    and consumed_at is null
    and invalidated_at is null;

  insert into public.agency_user_invitations (
    auth_user_id, agency_id, company_id, delivery_kind
  ) values (
    selected_auth_user_id, selected_agency_id, selected_company_id, 'resend'
  ) returning id into invitation_id;

  select public.verify_pending_agency_user_invitation(invitation_id) into result;
  if not coalesce((result ->> 'valid')::boolean, false) then
    raise exception 'Active invitation was not accepted for its matching Auth session';
  end if;

  superseded_invitation_id := invitation_id;
  update public.agency_user_invitations
  set invalidated_at = now()
  where auth_user_id = selected_auth_user_id
    and consumed_at is null
    and invalidated_at is null;

  insert into public.agency_user_invitations (
    auth_user_id, agency_id, company_id, delivery_kind
  ) values (
    selected_auth_user_id, selected_agency_id, selected_company_id, 'resend'
  ) returning id into invitation_id;

  select public.verify_pending_agency_user_invitation(superseded_invitation_id) into result;
  if coalesce((result ->> 'valid')::boolean, false) then
    raise exception 'Superseded invitation identifier remained valid';
  end if;

  select public.verify_pending_agency_user_invitation(invitation_id) into result;
  if not coalesce((result ->> 'valid')::boolean, false) then
    raise exception 'Replacement invitation was not valid';
  end if;

  begin
    insert into public.agency_user_invitations (
      auth_user_id, agency_id, company_id, delivery_kind
    ) values (
      selected_auth_user_id, selected_agency_id, selected_company_id, 'resend'
    );
    raise exception 'Expected the second active invitation to violate the unique index';
  exception
    when unique_violation then null;
  end;

  select count(*) into active_count
  from public.agency_user_invitations
  where auth_user_id = selected_auth_user_id
    and consumed_at is null
    and invalidated_at is null;
  if active_count <> 1 then
    raise exception 'Expected exactly one active invitation, found %', active_count;
  end if;

  select public.consume_pending_agency_user_invitation(invitation_id) into result;
  if not coalesce((result ->> 'consumed')::boolean, false) then
    raise exception 'Matching active invitation was not consumed';
  end if;

  select public.verify_pending_agency_user_invitation(invitation_id) into result;
  if coalesce((result ->> 'valid')::boolean, false) then
    raise exception 'Consumed invitation remained valid';
  end if;
end;
$test$;

-- These statements exercise the exact conflict targets against real tables.
-- At least one fixture row in each table is required in local/staging.
do $test$
begin
  if not exists (select 1 from public.agency_members) then
    raise exception 'Database contract test requires one agency_members fixture row';
  end if;
  if not exists (select 1 from public.agency_company_user_access) then
    raise exception 'Database contract test requires one agency_company_user_access fixture row';
  end if;

  insert into public.agency_members
  select source.* from public.agency_members as source limit 1
  on conflict (agency_id, user_id) do update
  set status = excluded.status;

  insert into public.agency_company_user_access
  select source.* from public.agency_company_user_access as source limit 1
  on conflict (company_id, agency_id, user_id) do update
  set status = excluded.status;
end;
$test$;

rollback;
