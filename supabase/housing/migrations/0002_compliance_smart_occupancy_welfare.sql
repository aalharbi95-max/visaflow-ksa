-- Compliance, smart occupancy, operations and workforce welfare.
-- Apply only after 0001_housing_initial.sql in the dedicated Housing project.

alter table public.housing_sites
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6),
  add column if not exists google_place_id text,
  add column if not exists geofence_radius_m integer not null default 250 check (geofence_radius_m between 25 and 10000),
  add constraint housing_sites_latitude_check check (latitude is null or latitude between -90 and 90),
  add constraint housing_sites_longitude_check check (longitude is null or longitude between -180 and 180);

alter table public.housing_employees
  add column if not exists work_shift text not null default 'Flexible' check (work_shift in ('Day','Night','Rotating','Flexible')),
  add column if not exists preferred_language text,
  add column if not exists cultural_group text;

alter table public.housing_rooms
  add column if not exists area_sqm numeric(10,2),
  add column if not exists minimum_area_per_person_sqm numeric(6,2) not null default 4 check (minimum_area_per_person_sqm > 0),
  add column if not exists allowed_shift text not null default 'Any' check (allowed_shift in ('Day','Night','Rotating','Flexible','Any')),
  add column if not exists preferred_project_id uuid references public.housing_projects(id) on delete set null,
  add column if not exists preferred_language text,
  add column if not exists cultural_group text;

update public.housing_rooms
set area_sqm = capacity * minimum_area_per_person_sqm
where area_sqm is null;

alter table public.housing_rooms alter column area_sqm set not null;
alter table public.housing_rooms add constraint housing_rooms_area_sqm_check check (area_sqm > 0);
alter table public.housing_rooms
  add column if not exists legal_capacity integer generated always as (
    least(capacity, floor(area_sqm / minimum_area_per_person_sqm)::integer)
  ) stored;

alter table public.housing_assignments
  add column if not exists compliance_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists alignment_score numeric(5,2) check (alignment_score is null or alignment_score between 0 and 100);

create table if not exists public.housing_compliance_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  rule_code text not null,
  category text not null check (category in ('Occupancy','Fire Safety','Municipality','Health','Operations','Other')),
  title text not null,
  minimum_area_per_person_sqm numeric(6,2) check (minimum_area_per_person_sqm is null or minimum_area_per_person_sqm > 0),
  source_authority text,
  source_url text,
  effective_from date,
  effective_to date,
  status text not null default 'Active' check (status in ('Draft','Active','Superseded','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, rule_code)
);

create table if not exists public.housing_licenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  license_type text not null check (license_type in ('Civil Defense','Municipality','Kitchen Health','Worker Health','Building','Other')),
  license_number text not null,
  issuing_authority text,
  issued_date date,
  expiry_date date not null,
  reminder_days integer[] not null default array[90,60,30,15,7],
  responsible_profile_id uuid references public.housing_profiles(id) on delete set null,
  document_url text,
  status text not null default 'Active' check (status in ('Active','Renewal Due','Expired','Suspended','Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, license_type, license_number)
);

create table if not exists public.housing_hse_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  report_no text not null,
  inspection_date date not null default current_date,
  inspector_id uuid references public.housing_profiles(id) on delete set null default auth.uid(),
  checklist jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  score numeric(5,2) check (score is null or score between 0 and 100),
  critical_findings integer not null default 0 check (critical_findings >= 0),
  corrective_action_due date,
  status text not null default 'Draft' check (status in ('Draft','Submitted','Action Required','Closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, report_no)
);

create table if not exists public.housing_operation_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  operation_type text not null check (operation_type in ('Breakfast','Lunch','Dinner','Laundry Collection','Laundry Delivery')),
  schedule_date date not null,
  slot_start time not null,
  slot_end time not null,
  project_id uuid references public.housing_projects(id) on delete set null,
  shift text check (shift is null or shift in ('Day','Night','Rotating','Flexible')),
  building_id uuid references public.housing_buildings(id) on delete set null,
  planned_people integer not null default 0 check (planned_people >= 0),
  slot_capacity integer not null check (slot_capacity > 0),
  status text not null default 'Scheduled' check (status in ('Scheduled','In Progress','Completed','Cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slot_end > slot_start),
  check (planned_people <= slot_capacity)
);

create table if not exists public.housing_disciplinary_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  employee_id uuid not null references public.housing_employees(id) on delete restrict,
  incident_id uuid references public.housing_incidents(id) on delete set null,
  action_type text not null check (action_type in ('Warning','Written Warning','Penalty','Suspension','Accommodation Transfer','Other')),
  description text not null,
  penalty_amount numeric(14,2) not null default 0 check (penalty_amount >= 0),
  action_date date not null default current_date,
  status text not null default 'Active' check (status in ('Draft','Active','Appealed','Cancelled','Closed')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.housing_welfare_surveys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid references public.housing_sites(id) on delete cascade,
  title text not null,
  languages text[] not null default array['ar','en'],
  questions jsonb not null default '[]'::jsonb,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  anonymous boolean not null default true,
  status text not null default 'Draft' check (status in ('Draft','Open','Closed','Archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table if not exists public.housing_welfare_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  survey_id uuid not null references public.housing_welfare_surveys(id) on delete cascade,
  employee_id uuid references public.housing_employees(id) on delete set null,
  language text not null default 'ar',
  answers jsonb not null,
  overall_score numeric(4,2) check (overall_score is null or overall_score between 0 and 5),
  submitted_at timestamptz not null default now()
);

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

create index if not exists housing_licenses_expiry_idx on public.housing_licenses(company_id, expiry_date, status);
create index if not exists housing_hse_reports_site_idx on public.housing_hse_reports(company_id, site_id, inspection_date desc);
create index if not exists housing_operations_slot_idx on public.housing_operation_schedules(company_id, schedule_date, operation_type);
create index if not exists housing_welfare_responses_survey_idx on public.housing_welfare_responses(company_id, survey_id);
create index if not exists housing_compliance_alerts_open_idx on public.housing_compliance_alerts(company_id, status, created_at desc);

do $$ declare t text; begin
  foreach t in array array['housing_compliance_rules','housing_licenses','housing_hse_reports','housing_operation_schedules','housing_disciplinary_actions','housing_welfare_surveys','housing_welfare_responses','housing_compliance_alerts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id=public.housing_current_company_id())',t||'_select',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.housing_current_company_id() and public.housing_can_manage())',t||'_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (company_id=public.housing_current_company_id() and public.housing_can_manage()) with check (company_id=public.housing_current_company_id())',t||'_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using (company_id=public.housing_current_company_id() and public.housing_can_manage())',t||'_delete',t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['housing_compliance_rules','housing_licenses','housing_hse_reports','housing_operation_schedules','housing_disciplinary_actions','housing_welfare_surveys','housing_compliance_alerts'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.housing_set_updated_at()',t||'_updated_at',t);
  end loop;
end $$;

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

  if v_room.legal_capacity <= v_active_occupants then
    v_capacity_warning:=true;
  end if;
  if v_room.allowed_shift<>'Any' and v_room.allowed_shift<>v_employee.work_shift then
    raise exception 'Shift alignment failed for this room.';
  end if;
  if v_room.preferred_project_id is not null and v_room.preferred_project_id is distinct from v_employee.project_id then
    raise exception 'Project alignment failed for this room.';
  end if;
  if v_room.preferred_project_id is null and v_site_project_id is not null and v_employee.project_id is not null and v_site_project_id<>v_employee.project_id then
    raise exception 'Employee project does not match the housing site project.';
  end if;

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
    values(v_company_id,v_site_id,v_room_id,p_employee_id,v_assignment.id,'تم تجاوز الطاقة الاستيعابية القانونية',
      jsonb_build_object('legal_capacity',v_room.legal_capacity,'occupants_after_assignment',v_active_occupants+1,'area_sqm',v_room.area_sqm,'minimum_area_per_person_sqm',v_room.minimum_area_per_person_sqm));
  end if;
  update public.housing_beds set status='Occupied' where id=p_bed_id and company_id=v_company_id;
  update public.housing_rooms r set status=case when exists(select 1 from public.housing_beds b where b.room_id=r.id and b.status='Available') then 'Available' else 'Full' end where r.id=v_room_id and r.company_id=v_company_id;
  return v_assignment;
end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('housing-hse-attachments','housing-hse-attachments',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "housing_hse_files_select" on storage.objects for select to authenticated
using (bucket_id='housing-hse-attachments' and (storage.foldername(name))[1]=public.housing_current_company_id()::text);
create policy "housing_hse_files_insert" on storage.objects for insert to authenticated
with check (bucket_id='housing-hse-attachments' and (storage.foldername(name))[1]=public.housing_current_company_id()::text and public.housing_can_manage());
create policy "housing_hse_files_update" on storage.objects for update to authenticated
using (bucket_id='housing-hse-attachments' and (storage.foldername(name))[1]=public.housing_current_company_id()::text and public.housing_can_manage());
create policy "housing_hse_files_delete" on storage.objects for delete to authenticated
using (bucket_id='housing-hse-attachments' and (storage.foldername(name))[1]=public.housing_current_company_id()::text and public.housing_can_manage());

grant select,insert,update,delete on public.housing_compliance_rules,public.housing_licenses,public.housing_hse_reports,public.housing_operation_schedules,public.housing_disciplinary_actions,public.housing_welfare_surveys,public.housing_welfare_responses,public.housing_compliance_alerts to authenticated;
