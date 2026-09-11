begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- An agency is a platform-wide identity. A company creates the identity once,
-- then other authorized companies link that same identity through
-- company_agency_access instead of creating duplicate agency/Auth records.
create or replace function public.company_agency_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.users%rowtype;
  actor_company public.companies%rowtype;
  agency_row public.agencies%rowtype;
  agency_name text;
  agency_country text;
  agency_contact_person text;
  agency_email text;
  agency_phone text;
  agency_status text;
  actor_match_count bigint;
  linked_to_actor boolean;
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'COMPANY_AGENCY_CREATE_INVALID_INPUT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as field_name
    where field_name not in (
      'name', 'country', 'contact_person', 'email', 'phone', 'status'
    )
  ) then
    raise exception 'COMPANY_AGENCY_CREATE_INVALID_FIELDS';
  end if;

  select pg_catalog.count(*)
  into actor_match_count
  from public.users as app_user
  where app_user.auth_user_id = auth.uid();

  if actor_match_count <> 1 then
    raise exception 'COMPANY_AGENCY_CREATE_UNAUTHORIZED';
  end if;

  select app_user.*
  into actor
  from public.users as app_user
  where app_user.auth_user_id = auth.uid()
  order by app_user.id
  limit 1;

  if actor.status <> 'Active' or actor.is_active is not true then
    raise exception 'COMPANY_AGENCY_CREATE_USER_INACTIVE';
  end if;
  if actor.role not in ('Admin', 'Company Admin', 'Recruitment Manager') then
    raise exception 'COMPANY_AGENCY_CREATE_UNAUTHORIZED';
  end if;
  if actor.company_id is null then
    raise exception 'COMPANY_AGENCY_CREATE_COMPANY_INACTIVE';
  end if;

  select company.*
  into actor_company
  from public.companies as company
  where company.id = actor.company_id;

  if actor_company.id is null or actor_company.status <> 'Active' then
    raise exception 'COMPANY_AGENCY_CREATE_COMPANY_INACTIVE';
  end if;

  agency_name := nullif(pg_catalog.btrim(p_payload->>'name'), '');
  agency_country := pg_catalog.btrim(coalesce(p_payload->>'country', ''));
  agency_contact_person := pg_catalog.btrim(coalesce(p_payload->>'contact_person', ''));
  agency_email := nullif(
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_payload->>'email', ''))),
    ''
  );
  agency_phone := pg_catalog.btrim(coalesce(p_payload->>'phone', ''));
  agency_status := coalesce(
    nullif(pg_catalog.btrim(p_payload->>'status'), ''),
    'Active'
  );

  if agency_name is null then
    raise exception 'COMPANY_AGENCY_CREATE_INVALID_INPUT';
  end if;
  if agency_status not in ('Active', 'Inactive', 'Suspended') then
    raise exception 'COMPANY_AGENCY_CREATE_INVALID_INPUT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      case
        when agency_email is not null then
          'company_agency_create:email:' || agency_email
        else
          'company_agency_create:name-country:' ||
            pg_catalog.lower(agency_name) || ':' ||
            pg_catalog.lower(agency_country)
      end,
      0::bigint
    )
  );

  select agency.*
  into agency_row
  from public.agencies as agency
  where (
      agency_email is not null
      and pg_catalog.lower(pg_catalog.btrim(coalesce(agency.email, ''))) = agency_email
    )
    or (
      agency_email is null
      and pg_catalog.lower(pg_catalog.btrim(coalesce(agency.name, ''))) = pg_catalog.lower(agency_name)
      and pg_catalog.lower(pg_catalog.btrim(coalesce(agency.country, ''))) = pg_catalog.lower(agency_country)
    )
  order by agency.created_at, agency.id
  limit 1
  for update;

  if agency_row.id is not null then
    if agency_row.status <> 'Active' then
      raise exception 'COMPANY_AGENCY_CREATE_AGENCY_INACTIVE';
    end if;

    select exists (
      select 1
      from public.company_agency_access as access
      where access.company_id = actor.company_id
        and access.agency_id = agency_row.id
        and coalesce(access.status, 'Active') = 'Active'
    )
    into linked_to_actor;

    if linked_to_actor then
      return pg_catalog.jsonb_build_object(
        'agency_id', agency_row.id,
        'company_id', actor.company_id,
        'status', agency_row.status,
        'link_status', 'Active',
        'idempotent', true,
        'linked_existing', true
      );
    end if;

    insert into public.company_agency_access (
      company_id,
      agency_id,
      status,
      can_view_requests,
      can_upload_candidates,
      can_update_candidates,
      can_view_interviews
    ) values (
      actor.company_id,
      agency_row.id,
      'Active',
      true,
      true,
      true,
      true
    )
    on conflict (company_id, agency_id) do update
    set status = 'Active',
        can_view_requests = true,
        can_upload_candidates = true,
        can_update_candidates = true,
        can_view_interviews = true;

    return pg_catalog.jsonb_build_object(
      'agency_id', agency_row.id,
      'company_id', actor.company_id,
      'status', agency_row.status,
      'link_status', 'Active',
      'idempotent', false,
      'linked_existing', true
    );
  end if;

  insert into public.agencies (
    name,
    country,
    status,
    contact_person,
    email,
    phone,
    company_id,
    updated_at
  ) values (
    agency_name,
    agency_country,
    agency_status,
    agency_contact_person,
    agency_email,
    agency_phone,
    actor.company_id,
    pg_catalog.now()
  )
  returning * into agency_row;

  insert into public.company_agency_access (
    company_id,
    agency_id,
    status,
    can_view_requests,
    can_upload_candidates,
    can_update_candidates,
    can_view_interviews
  ) values (
    actor.company_id,
    agency_row.id,
    'Active',
    true,
    true,
    true,
    true
  );

  return pg_catalog.jsonb_build_object(
    'agency_id', agency_row.id,
    'company_id', actor.company_id,
    'status', agency_row.status,
    'link_status', 'Active',
    'idempotent', false,
    'linked_existing', false
  );
end;
$function$;

revoke all on function public.company_agency_create(jsonb)
  from public, anon, authenticated;
grant execute on function public.company_agency_create(jsonb)
  to authenticated;

commit;
