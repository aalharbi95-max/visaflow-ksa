-- Security remediation for operational tables reported with RLS disabled.
--
-- This migration deliberately depends on the canonical agency ownership
-- migrations. It fails closed when that prerequisite or unsafe legacy data is
-- present; it never guesses ownership or deletes data.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_table text;
  v_count bigint;
begin
  if to_regprocedure('public.agency_recruitment_access_allowed(uuid,uuid,text)') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'interviews'
         and column_name = 'agency_id'
     ) then
    raise exception using
      errcode = '55000',
      message = 'SECURITY_RLS_PREREQUISITE_MISSING: apply the canonical agency ownership migrations before this remediation.';
  end if;

  foreach v_table in array array['employees', 'interviews', 'mobilizations'] loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception using
        errcode = '42P01',
        message = format('SECURITY_RLS_TABLE_MISSING: public.%I', v_table);
    end if;

    execute format('select count(*) from public.%I where company_id is null', v_table)
      into v_count;
    if v_count > 0 then
      raise exception using
        errcode = '23502',
        message = format('SECURITY_RLS_NULL_TENANT_DATA: public.%I has %s row(s) with null company_id', v_table, v_count);
    end if;

    execute format(
      'select count(*) from public.%I scoped left join public.companies tenant on tenant.id = scoped.company_id where tenant.id is null',
      v_table
    ) into v_count;
    if v_count > 0 then
      raise exception using
        errcode = '23503',
        message = format('SECURITY_RLS_ORPHAN_TENANT_DATA: public.%I has %s row(s) without a company', v_table, v_count);
    end if;
  end loop;

  if to_regclass('public.agency_client_access') is null then
    raise exception using
      errcode = '42P01',
      message = 'SECURITY_RLS_TABLE_MISSING: public.agency_client_access';
  end if;

  select count(*) into v_count
  from public.agency_client_access access_row
  left join public.companies tenant on tenant.id = access_row.company_id
  where access_row.company_id is null or tenant.id is null;
  if v_count > 0 then
    raise exception using
      errcode = '23503',
      message = format('SECURITY_RLS_ORPHAN_TENANT_DATA: public.agency_client_access has %s unsafe row(s)', v_count);
  end if;
end $$;

-- Browser clients receive only the table privileges needed for policy-filtered
-- operations. Service Role remains fully functional and is not subject to RLS.
revoke all on table public.employees, public.interviews, public.mobilizations,
  public.agency_client_access from anon;

revoke all on table public.employees, public.interviews, public.mobilizations,
  public.agency_client_access from authenticated;
grant select, insert, update, delete on table
  public.employees, public.interviews, public.mobilizations to authenticated;
grant all on table public.employees, public.interviews, public.mobilizations,
  public.agency_client_access to service_role;

alter table public.employees enable row level security;
alter table public.interviews enable row level security;
alter table public.mobilizations enable row level security;
alter table public.agency_client_access enable row level security;

-- Remove legacy and unexpected policies so the effective policy set is fully
-- reviewable here. agency_client_access intentionally receives no replacement
-- policy: authenticated and anon access is deny-by-default.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array['employees', 'interviews', 'mobilizations', 'agency_client_access'])
  loop
    execute format(
      'drop policy %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end $$;

create policy employees_select_tenant_policy on public.employees
for select to authenticated using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);

create policy employees_insert_tenant_policy on public.employees
for insert to authenticated with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager'
    ])
  )
);

create policy employees_update_tenant_policy on public.employees
for update to authenticated using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager'
    ])
  )
) with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager'
    ])
  )
);

create policy employees_delete_tenant_policy on public.employees
for delete to authenticated using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager'
    ])
  )
);

create policy interviews_select_tenant_policy on public.interviews
for select to authenticated using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
  or (
    agency_id is not null
    and public.agency_recruitment_access_allowed(company_id, agency_id, 'view_interviews')
  )
);

create policy interviews_insert_tenant_policy on public.interviews
for insert to authenticated with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Recruitment Manager', 'Recruitment Officer'
    ])
  )
  or (
    agency_id is not null
    and public.agency_recruitment_access_allowed(company_id, agency_id, 'update')
  )
);

create policy interviews_update_tenant_policy on public.interviews
for update to authenticated using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Recruitment Manager', 'Recruitment Officer'
    ])
  )
  or (
    agency_id is not null
    and public.agency_recruitment_access_allowed(company_id, agency_id, 'update')
  )
) with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Recruitment Manager', 'Recruitment Officer'
    ])
  )
  or (
    agency_id is not null
    and public.agency_recruitment_access_allowed(company_id, agency_id, 'update')
  )
);

create policy interviews_delete_tenant_policy on public.interviews
for delete to authenticated using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Recruitment Manager'
    ])
  )
);

create policy mobilizations_select_tenant_policy on public.mobilizations
for select to authenticated using (
  public.is_current_platform_user()
  or (
    public.current_app_user_role() <> 'Agency'
    and company_id = public.current_app_user_company_id()
  )
);

create policy mobilizations_insert_tenant_policy on public.mobilizations
for insert to authenticated with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
);

create policy mobilizations_update_tenant_policy on public.mobilizations
for update to authenticated using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
) with check (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
);

create policy mobilizations_delete_tenant_policy on public.mobilizations
for delete to authenticated using (
  public.is_current_platform_user()
  or (
    company_id = public.current_app_user_company_id()
    and public.current_app_user_has_role(array[
      'Admin', 'Company Admin', 'Operations Manager', 'Project Manager',
      'Recruitment Manager', 'Recruitment Officer'
    ])
  )
);

comment on table public.agency_client_access is
  'Legacy access table: browser roles denied by default pending a unified authenticated workflow.';

commit;
