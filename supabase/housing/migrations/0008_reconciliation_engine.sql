-- Workforce reconciliation, ghost occupancy detection and approved checkout workflow.
-- Apply ONLY to the dedicated Housing Supabase project.

create table public.housing_reconciliation_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  file_name text not null,
  source_type text not null default 'HR' check (source_type in ('HR','Biometric','Payroll','Other')),
  period_month date not null,
  status text not null default 'Processing' check (status in ('Processing','Completed','Failed','Archived')),
  total_rows integer not null default 0 check (total_rows >= 0),
  matched_rows integer not null default 0 check (matched_rows >= 0),
  exception_rows integer not null default 0 check (exception_rows >= 0),
  ghost_rows integer not null default 0 check (ghost_rows >= 0),
  imported_by uuid references auth.users(id) on delete set null default auth.uid(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.housing_reconciliation_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  import_id uuid not null references public.housing_reconciliation_imports(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  employee_no text,
  iqama_no text,
  full_name text,
  employment_status text,
  leave_status text,
  project_code text,
  source_payload jsonb not null default '{}'::jsonb,
  matched_employee_id uuid references public.housing_employees(id) on delete set null,
  matched_assignment_id uuid references public.housing_assignments(id) on delete set null,
  match_status text not null check (match_status in ('Matched','Ghost Occupancy','Not Housed','Not Found','Conflict','Duplicate')),
  match_method text check (match_method in ('Employee Number','Iqama Number','Both','None')),
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  differences jsonb not null default '[]'::jsonb,
  recommended_action text check (recommended_action in ('Review','Checkout','Update Employee','Assign Housing','Ignore')),
  resolution_status text not null default 'Pending' check (resolution_status in ('Pending','Approved','Rejected','Resolved','Ignored')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(import_id,row_number)
);

create table public.housing_employee_status_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  employee_id uuid not null references public.housing_employees(id) on delete cascade,
  event_type text not null check (event_type in ('Annual Leave','Exit Reentry','Final Exit','Termination','Resignation','Transfer','Return to Work')),
  effective_date date not null,
  expected_return_date date,
  source text not null default 'Manual',
  source_reference text,
  status text not null default 'Open' check (status in ('Open','Acknowledged','Completed','Cancelled')),
  checkout_required boolean not null default false,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index housing_reconciliation_imports_company_period_idx on public.housing_reconciliation_imports(company_id,period_month desc);
create index housing_reconciliation_rows_import_status_idx on public.housing_reconciliation_rows(import_id,match_status);
create index housing_reconciliation_rows_employee_idx on public.housing_reconciliation_rows(company_id,matched_employee_id);
create index housing_employee_status_events_open_idx on public.housing_employee_status_events(company_id,status,effective_date);

alter table public.housing_reconciliation_imports enable row level security;
alter table public.housing_reconciliation_rows enable row level security;
alter table public.housing_employee_status_events enable row level security;

create policy housing_reconciliation_imports_select on public.housing_reconciliation_imports for select to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','read'));
create policy housing_reconciliation_imports_insert on public.housing_reconciliation_imports for insert to authenticated
  with check(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','manage'));
create policy housing_reconciliation_imports_update on public.housing_reconciliation_imports for update to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','manage'))
  with check(company_id=public.housing_current_company_id());
create policy housing_reconciliation_imports_delete on public.housing_reconciliation_imports for delete to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

create policy housing_reconciliation_rows_select on public.housing_reconciliation_rows for select to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','read'));
create policy housing_reconciliation_rows_insert on public.housing_reconciliation_rows for insert to authenticated
  with check(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','manage'));
create policy housing_reconciliation_rows_update on public.housing_reconciliation_rows for update to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','manage'))
  with check(company_id=public.housing_current_company_id());
create policy housing_reconciliation_rows_delete on public.housing_reconciliation_rows for delete to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

create policy housing_employee_status_events_select on public.housing_employee_status_events for select to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','read'));
create policy housing_employee_status_events_insert on public.housing_employee_status_events for insert to authenticated
  with check(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','manage'));
create policy housing_employee_status_events_update on public.housing_employee_status_events for update to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('occupancy','manage'))
  with check(company_id=public.housing_current_company_id());
create policy housing_employee_status_events_delete on public.housing_employee_status_events for delete to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

create or replace function public.housing_resolve_reconciliation_row(
  p_row_id uuid,
  p_decision text,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_row public.housing_reconciliation_rows;
  v_assignment public.housing_assignments;
begin
  if not public.housing_has_permission('occupancy','manage') then raise exception 'Permission denied'; end if;
  if p_decision not in ('Approved','Rejected','Ignored') then raise exception 'Invalid decision'; end if;

  select * into v_row from public.housing_reconciliation_rows
  where id=p_row_id and company_id=public.housing_current_company_id() for update;
  if v_row.id is null then raise exception 'Reconciliation row not found'; end if;
  if v_row.resolution_status <> 'Pending' then raise exception 'This exception has already been reviewed'; end if;

  if p_decision='Approved' and v_row.recommended_action='Checkout' and v_row.matched_assignment_id is not null then
    select * into v_assignment from public.housing_assignments
    where id=v_row.matched_assignment_id and company_id=v_row.company_id and status='Active' for update;
    if v_assignment.id is not null then
      update public.housing_assignments set status='Ended',end_date=current_date,ended_by=auth.uid(),
        reason=coalesce(p_note,'Approved workforce reconciliation checkout'),updated_at=now()
      where id=v_assignment.id;
      update public.housing_beds set status='Available',updated_at=now() where id=v_assignment.bed_id;
    end if;
  end if;

  update public.housing_reconciliation_rows set
    resolution_status=case when p_decision='Approved' then 'Resolved' else p_decision end,
    resolution_note=nullif(trim(coalesce(p_note,'')),''),resolved_by=auth.uid(),resolved_at=now()
  where id=v_row.id;

  insert into public.housing_audit_log(company_id,action,entity_type,entity_id,after_data,actor_id)
  values(v_row.company_id,'RECONCILIATION_'||upper(p_decision),'housing_reconciliation_rows',v_row.id,
    jsonb_build_object('decision',p_decision,'note',p_note,'recommended_action',v_row.recommended_action),auth.uid());

  return jsonb_build_object('success',true,'row_id',v_row.id,'decision',p_decision);
end $$;

grant select,insert,update,delete on public.housing_reconciliation_imports,public.housing_reconciliation_rows,public.housing_employee_status_events to authenticated;
grant execute on function public.housing_resolve_reconciliation_row(uuid,text,text) to authenticated;
revoke execute on function public.housing_resolve_reconciliation_row(uuid,text,text) from public,anon;
