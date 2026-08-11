-- Allow assignments above the 4 m2/person area threshold while recording an alert.
-- Occupied beds remain protected from duplicate assignment.

create table if not exists public.housing_compliance_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  room_id uuid references public.housing_rooms(id) on delete cascade,
  employee_id uuid references public.housing_employees(id) on delete set null,
  assignment_id uuid references public.housing_assignments(id) on delete set null,
  alert_type text not null default 'Legal Occupancy Exceeded',
  severity text not null default 'High' check (severity in ('Info','Medium','High','Critical')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'Open' check (status in ('Open','Acknowledged','Resolved','Dismissed')),
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists housing_compliance_alerts_open_idx on public.housing_compliance_alerts(company_id,status,created_at desc);
alter table public.housing_compliance_alerts enable row level security;
create policy housing_compliance_alerts_select on public.housing_compliance_alerts for select to authenticated using (company_id=public.housing_current_company_id());
create policy housing_compliance_alerts_insert on public.housing_compliance_alerts for insert to authenticated with check (company_id=public.housing_current_company_id() and public.housing_can_manage());
create policy housing_compliance_alerts_update on public.housing_compliance_alerts for update to authenticated using (company_id=public.housing_current_company_id() and public.housing_can_manage()) with check (company_id=public.housing_current_company_id());
create policy housing_compliance_alerts_delete on public.housing_compliance_alerts for delete to authenticated using (company_id=public.housing_current_company_id() and public.housing_can_manage());
create trigger housing_compliance_alerts_updated_at before update on public.housing_compliance_alerts for each row execute function public.housing_set_updated_at();
grant select,insert,update,delete on public.housing_compliance_alerts to authenticated;

create or replace function public.housing_assign_employee(
  p_employee_id uuid,
  p_bed_id uuid,
  p_start_date date default current_date,
  p_expected_end_date date default null,
  p_reason text default null
) returns public.housing_assignments
language plpgsql security invoker set search_path=public
as $$
declare
  v_company_id uuid:=public.housing_current_company_id();
  v_site_id uuid; v_room_id uuid; v_bed_status text;
  v_room public.housing_rooms%rowtype;
  v_employee public.housing_employees%rowtype;
  v_site_project_id uuid;
  v_active_occupants integer;
  v_capacity_warning boolean:=false;
  v_existing public.housing_assignments%rowtype;
  v_assignment public.housing_assignments%rowtype;
begin
  if v_company_id is null or not public.housing_can_manage() then raise exception 'Not authorized.'; end if;
  select * into v_employee from public.housing_employees where id=p_employee_id and company_id=v_company_id and status='Active';
  if v_employee.id is null then raise exception 'Employee is unavailable.'; end if;

  select site_id,room_id,status into v_site_id,v_room_id,v_bed_status
    from public.housing_beds where id=p_bed_id and company_id=v_company_id for update;
  if v_site_id is null or v_bed_status<>'Available' then raise exception 'Bed is unavailable.'; end if;
  select * into v_room from public.housing_rooms where id=v_room_id and company_id=v_company_id for update;
  select project_id into v_site_project_id from public.housing_sites where id=v_site_id and company_id=v_company_id;

  select * into v_existing from public.housing_assignments
    where company_id=v_company_id and employee_id=p_employee_id and status='Active' for update;
  select count(*) into v_active_occupants from public.housing_assignments
    where company_id=v_company_id and room_id=v_room_id and status='Active' and employee_id<>p_employee_id;

  -- The 4 m2/person rule raises an auditable alert but does not block assignment.
  if v_room.legal_capacity <= v_active_occupants then v_capacity_warning:=true; end if;
  if v_room.allowed_shift<>'Any' and v_room.allowed_shift<>v_employee.work_shift then raise exception 'Shift alignment failed for this room.'; end if;
  if v_room.preferred_project_id is not null and v_room.preferred_project_id is distinct from v_employee.project_id then raise exception 'Project alignment failed for this room.'; end if;
  if v_room.preferred_project_id is null and v_site_project_id is not null and v_employee.project_id is not null and v_site_project_id<>v_employee.project_id then raise exception 'Employee project does not match the housing site project.'; end if;

  if v_existing.id is not null then
    update public.housing_assignments set status='Ended',end_date=greatest(coalesce(p_start_date,current_date),start_date),ended_by=auth.uid(),reason=coalesce(p_reason,'Transfer') where id=v_existing.id;
    update public.housing_beds set status='Available' where id=v_existing.bed_id and company_id=v_company_id;
    update public.housing_rooms set status='Available' where id=v_existing.room_id and company_id=v_company_id and status='Full';
  end if;

  insert into public.housing_assignments(company_id,employee_id,site_id,room_id,bed_id,assignment_type,start_date,expected_end_date,previous_assignment_id,reason,status,compliance_snapshot,alignment_score)
    values(v_company_id,p_employee_id,v_site_id,v_room_id,p_bed_id,case when v_existing.id is null then 'CheckIn' else 'Transfer' end,coalesce(p_start_date,current_date),p_expected_end_date,v_existing.id,p_reason,'Active',
      jsonb_build_object('area_sqm',v_room.area_sqm,'minimum_area_per_person_sqm',v_room.minimum_area_per_person_sqm,'legal_capacity',v_room.legal_capacity,'occupants_after_assignment',v_active_occupants+1,'occupancy_compliant',not v_capacity_warning,'warning_issued',v_capacity_warning,'work_shift',v_employee.work_shift,'room_shift',v_room.allowed_shift,'verified_at',now()),
      case when v_room.allowed_shift='Any' or v_room.allowed_shift=v_employee.work_shift then 100 else 70 end)
    returning * into v_assignment;

  if v_capacity_warning then
    insert into public.housing_compliance_alerts(company_id,site_id,room_id,employee_id,assignment_id,title,details)
    values(v_company_id,v_site_id,v_room_id,p_employee_id,v_assignment.id,'تم تجاوز معيار 4 م² لكل عامل',
      jsonb_build_object('legal_capacity',v_room.legal_capacity,'occupants_after_assignment',v_active_occupants+1,'area_sqm',v_room.area_sqm,'minimum_area_per_person_sqm',v_room.minimum_area_per_person_sqm));
  end if;

  update public.housing_beds set status='Occupied' where id=p_bed_id and company_id=v_company_id;
  update public.housing_rooms r set status=case when exists(select 1 from public.housing_beds b where b.room_id=r.id and b.status='Available') then 'Available' else 'Full' end where r.id=v_room_id and r.company_id=v_company_id;
  return v_assignment;
end $$;
