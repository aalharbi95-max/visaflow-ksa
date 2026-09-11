-- Close the remaining client-side-only tenant boundaries on operational data.
-- Agency users receive candidates only through their active agency/company
-- membership. Requests and visa inventory stay company-internal; agencies use
-- notification_events and visa_authorizations for assigned work.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.agency_candidate_access_allowed(
  p_company_id uuid,
  p_agency_name text,
  p_operation text default 'select'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.users app_user
    join public.agency_company_user_access access
      on access.user_id = app_user.id
     and access.agency_id = app_user.agency_id
     and access.company_id = p_company_id
     and access.status = 'Active'
    join public.agencies agency
      on agency.id = app_user.agency_id
     and agency.status = 'Active'
    where app_user.auth_user_id = auth.uid()
      and app_user.role = 'Agency'
      and app_user.status = 'Active'
      and app_user.is_active is true
      and lower(trim(agency.name)) = lower(trim(coalesce(p_agency_name, '')))
      and case lower(coalesce(p_operation, 'select'))
        when 'insert' then access.can_upload_candidates is true
        when 'update' then access.can_update_candidates is true
        else true
      end
  );
$function$;

revoke all on function public.agency_candidate_access_allowed(uuid, text, text)
  from public, anon;
grant execute on function public.agency_candidate_access_allowed(uuid, text, text)
  to authenticated, service_role;

alter table public.users enable row level security;
alter table public.requests enable row level security;
alter table public.request_lines enable row level security;
alter table public.visa_batches enable row level security;
alter table public.visa_batch_lines enable row level security;
alter table public.visa_allocations enable row level security;
alter table public.candidates enable row level security;

drop policy if exists users_operational_select on public.users;
create policy users_operational_select
on public.users for select to authenticated
using (
  auth_user_id = auth.uid()
  or public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);

revoke insert, update, delete on table public.users from anon, authenticated;
grant select on table public.users to authenticated;

drop policy if exists requests_select_tenant_policy on public.requests;
drop policy if exists requests_insert_tenant_policy on public.requests;
drop policy if exists requests_update_tenant_policy on public.requests;
drop policy if exists requests_delete_tenant_policy on public.requests;

create policy requests_select_tenant_policy
on public.requests for select to authenticated
using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);
create policy requests_insert_tenant_policy
on public.requests for insert to authenticated
with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
);
create policy requests_update_tenant_policy
on public.requests for update to authenticated
using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
)
with check (
  public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
);
create policy requests_delete_tenant_policy
on public.requests for delete to authenticated
using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin', 'Company Admin'])
  )
);

drop policy if exists request_lines_select_tenant_policy on public.request_lines;
drop policy if exists request_lines_insert_tenant_policy on public.request_lines;
drop policy if exists request_lines_update_tenant_policy on public.request_lines;
drop policy if exists request_lines_delete_tenant_policy on public.request_lines;

create policy request_lines_select_tenant_policy
on public.request_lines for select to authenticated
using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);
create policy request_lines_insert_tenant_policy
on public.request_lines for insert to authenticated
with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
);
create policy request_lines_update_tenant_policy
on public.request_lines for update to authenticated
using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
)
with check (
  public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
);
create policy request_lines_delete_tenant_policy
on public.request_lines for delete to authenticated
using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin', 'Company Admin'])
  )
);

-- Visa inventory and allocation are company-internal. The agency workflow is
-- exposed only through visa_authorizations and authorization_events.
drop policy if exists visa_batches_select_tenant_policy on public.visa_batches;
drop policy if exists visa_batch_lines_select_tenant_policy on public.visa_batch_lines;
drop policy if exists visa_allocations_select_tenant_policy on public.visa_allocations;

create policy visa_batches_select_tenant_policy
on public.visa_batches for select to authenticated
using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);
create policy visa_batch_lines_select_tenant_policy
on public.visa_batch_lines for select to authenticated
using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);
create policy visa_allocations_select_tenant_policy
on public.visa_allocations for select to authenticated
using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);

-- Existing mutation policies stay in force, but Company Admin must retain the
-- same operational capability as the UI role model.
drop policy if exists visa_batches_insert_tenant_policy on public.visa_batches;
drop policy if exists visa_batches_update_tenant_policy on public.visa_batches;
drop policy if exists visa_batches_delete_tenant_policy on public.visa_batches;
drop policy if exists visa_batch_lines_insert_tenant_policy on public.visa_batch_lines;
drop policy if exists visa_batch_lines_update_tenant_policy on public.visa_batch_lines;
drop policy if exists visa_batch_lines_delete_tenant_policy on public.visa_batch_lines;
drop policy if exists visa_allocations_insert_tenant_policy on public.visa_allocations;
drop policy if exists visa_allocations_update_tenant_policy on public.visa_allocations;
drop policy if exists visa_allocations_delete_tenant_policy on public.visa_allocations;

create policy visa_batches_insert_tenant_policy on public.visa_batches
for insert to authenticated with check (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Visa Team'])
  )
);
create policy visa_batches_update_tenant_policy on public.visa_batches
for update to authenticated using (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Visa Team'])
  )
) with check (public.is_current_platform_user() or company_id = public.current_app_user_company_id());
create policy visa_batches_delete_tenant_policy on public.visa_batches
for delete to authenticated using (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin'])
  )
);

create policy visa_batch_lines_insert_tenant_policy on public.visa_batch_lines
for insert to authenticated with check (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Visa Team'])
  )
);
create policy visa_batch_lines_update_tenant_policy on public.visa_batch_lines
for update to authenticated using (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Visa Team'])
  )
) with check (public.is_current_platform_user() or company_id = public.current_app_user_company_id());
create policy visa_batch_lines_delete_tenant_policy on public.visa_batch_lines
for delete to authenticated using (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin'])
  )
);

create policy visa_allocations_insert_tenant_policy on public.visa_allocations
for insert to authenticated with check (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Visa Team'])
  )
);
create policy visa_allocations_update_tenant_policy on public.visa_allocations
for update to authenticated using (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Operations Manager','Visa Team'])
  )
) with check (public.is_current_platform_user() or company_id = public.current_app_user_company_id());
create policy visa_allocations_delete_tenant_policy on public.visa_allocations
for delete to authenticated using (
  public.is_current_platform_user() or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin'])
  )
);

drop policy if exists candidates_select_tenant_policy on public.candidates;
drop policy if exists candidates_insert_tenant_policy on public.candidates;
drop policy if exists candidates_update_tenant_policy on public.candidates;
drop policy if exists candidates_delete_tenant_policy on public.candidates;

create policy candidates_select_tenant_policy
on public.candidates for select to authenticated
using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
  or public.agency_candidate_access_allowed(company_id, agency, 'select')
);
create policy candidates_insert_tenant_policy
on public.candidates for insert to authenticated
with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin','Company Admin','Operations Manager','Project Manager',
      'Recruitment Manager','Recruitment Officer','HR/Recruitment'
    ])
  )
  or public.agency_candidate_access_allowed(company_id, agency, 'insert')
);
create policy candidates_update_tenant_policy
on public.candidates for update to authenticated
using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin','Company Admin','Operations Manager','Project Manager',
      'Recruitment Manager','Recruitment Officer','HR/Recruitment'
    ])
  )
  or public.agency_candidate_access_allowed(company_id, agency, 'update')
)
with check (
  public.is_current_platform_user()
  or company_id = public.current_app_user_company_id()
  or public.agency_candidate_access_allowed(company_id, agency, 'update')
);
create policy candidates_delete_tenant_policy
on public.candidates for delete to authenticated
using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array['Admin','Company Admin','Recruitment Manager'])
  )
);

commit;
