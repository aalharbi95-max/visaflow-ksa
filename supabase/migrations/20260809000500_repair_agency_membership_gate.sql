-- Repair agency candidate access for invitation-created users.
--
-- Modern agency invitations create a scoped agency_company_user_access row,
-- but older production data can be missing the legacy agency_members row.
-- The scoped user access is the authoritative company permission, so candidate
-- access must not fail solely because that redundant legacy row is absent.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into public.agency_members (agency_id, user_id, role, status)
select distinct
  app_user.agency_id,
  app_user.id,
  'Agency User',
  'Active'
from public.users as app_user
join public.agencies as agency
  on agency.id = app_user.agency_id
 and lower(coalesce(agency.status, '')) = 'active'
join public.agency_company_user_access as user_access
  on user_access.user_id = app_user.id
 and user_access.agency_id = app_user.agency_id
 and lower(coalesce(user_access.status, '')) = 'active'
join public.company_agency_access as office_access
  on office_access.company_id = user_access.company_id
 and office_access.agency_id = user_access.agency_id
 and lower(coalesce(office_access.status, '')) = 'active'
where app_user.role = 'Agency'
  and lower(coalesce(app_user.status, '')) = 'active'
  and app_user.is_active is true
on conflict (agency_id, user_id) do nothing;

create or replace function public.agency_recruitment_access_allowed(
  p_company_id uuid,
  p_agency_id uuid,
  p_operation text default 'select'
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users as app_user
    join public.agencies as agency
      on agency.id = app_user.agency_id
     and agency.id = p_agency_id
     and lower(coalesce(agency.status, '')) = 'active'
    join public.company_agency_access as office_access
      on office_access.company_id = p_company_id
     and office_access.agency_id = agency.id
     and lower(coalesce(office_access.status, '')) = 'active'
    join public.agency_company_user_access as user_access
      on user_access.company_id = p_company_id
     and user_access.agency_id = agency.id
     and user_access.user_id = app_user.id
     and lower(coalesce(user_access.status, '')) = 'active'
    where app_user.auth_user_id = auth.uid()
      and app_user.role = 'Agency'
      and lower(coalesce(app_user.status, '')) = 'active'
      and app_user.is_active is true
      and case lower(coalesce(p_operation, 'select'))
        when 'insert' then office_access.can_upload_candidates is true and user_access.can_upload_candidates is true
        when 'update' then office_access.can_update_candidates is true and user_access.can_update_candidates is true
        when 'view_interviews' then office_access.can_view_interviews is true and user_access.can_view_interviews is true
        else true
      end
  );
$$;

revoke all on function public.agency_recruitment_access_allowed(uuid, uuid, text) from public, anon;
grant execute on function public.agency_recruitment_access_allowed(uuid, uuid, text) to authenticated, service_role;

commit;
