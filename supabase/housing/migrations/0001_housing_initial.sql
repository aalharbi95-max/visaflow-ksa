-- Standalone Housing Management database.
-- Apply this file ONLY to the dedicated Housing Supabase project.

create extension if not exists pgcrypto;

create table public.housing_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'Active' check (status in ('Active','Suspended','Inactive')),
  logo_url text,
  city text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.housing_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  full_name text not null,
  email text,
  role text not null default 'Viewer'
    check (role in ('Admin','Housing Manager','Housing Supervisor','Maintenance','Finance','Viewer')),
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.housing_projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  code text not null,
  name text not null,
  city text,
  status text not null default 'Active' check (status in ('Active','Completed','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table public.housing_employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  employee_no text not null,
  full_name text not null,
  nationality text,
  iqama_no text,
  profession text,
  department text,
  project_id uuid references public.housing_projects(id) on delete set null,
  phone text,
  gender text default 'Male' check (gender in ('Male','Female')),
  joining_date date,
  status text not null default 'Active' check (status in ('Active','Inactive','Exited')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, employee_no),
  unique(company_id, iqama_no)
);

create table public.housing_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  code text not null,
  name text not null,
  housing_type text not null default 'Workers'
    check (housing_type in ('Workers','Employees','Families','Management','Mixed')),
  city text not null,
  district text,
  address text,
  project_id uuid references public.housing_projects(id) on delete set null,
  manager_id uuid references public.housing_profiles(id) on delete set null,
  ownership_type text not null default 'Rented' check (ownership_type in ('Owned','Rented','Managed')),
  capacity integer not null default 0 check (capacity >= 0),
  status text not null default 'Active' check (status in ('Draft','Active','Full','Maintenance','Inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table public.housing_buildings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  code text not null,
  name text not null,
  floors_count integer not null default 1 check (floors_count > 0),
  status text not null default 'Active' check (status in ('Active','Maintenance','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(site_id, code)
);

create table public.housing_rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  building_id uuid not null references public.housing_buildings(id) on delete cascade,
  room_number text not null,
  floor_number integer not null default 1,
  room_type text not null default 'Shared',
  capacity integer not null default 1 check (capacity > 0),
  gender text default 'Male' check (gender in ('Male','Female','Family','Any')),
  status text not null default 'Available' check (status in ('Available','Full','Reserved','Maintenance','Inactive')),
  air_conditioned boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(building_id, room_number)
);

create table public.housing_beds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  room_id uuid not null references public.housing_rooms(id) on delete cascade,
  bed_number text not null,
  bed_type text default 'Single',
  status text not null default 'Available' check (status in ('Available','Occupied','Reserved','Maintenance','Inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, bed_number)
);

create table public.housing_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  employee_id uuid not null references public.housing_employees(id) on delete restrict,
  site_id uuid not null references public.housing_sites(id) on delete restrict,
  room_id uuid not null references public.housing_rooms(id) on delete restrict,
  bed_id uuid not null references public.housing_beds(id) on delete restrict,
  assignment_type text not null default 'CheckIn' check (assignment_type in ('CheckIn','Transfer','Temporary')),
  start_date date not null default current_date,
  expected_end_date date,
  end_date date,
  status text not null default 'Active' check (status in ('Reserved','Active','Ended','Cancelled')),
  previous_assignment_id uuid references public.housing_assignments(id) on delete set null,
  reason text,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  ended_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_date is null or end_date >= start_date)
);

create unique index housing_active_employee_uidx on public.housing_assignments(company_id,employee_id) where status='Active';
create unique index housing_active_bed_uidx on public.housing_assignments(company_id,bed_id) where status='Active';

create table public.housing_maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  request_no text not null,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  room_id uuid references public.housing_rooms(id) on delete set null,
  category text not null,
  title text not null,
  description text,
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Emergency')),
  status text not null default 'Open' check (status in ('Open','Assigned','In Progress','On Hold','Completed','Cancelled')),
  assigned_to text,
  vendor_name text,
  reported_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  estimated_cost numeric(14,2) not null default 0 check (estimated_cost >= 0),
  actual_cost numeric(14,2) not null default 0 check (actual_cost >= 0),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,request_no)
);

create table public.housing_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  inspection_no text not null,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  room_id uuid references public.housing_rooms(id) on delete set null,
  inspection_type text not null default 'Routine',
  scheduled_date date not null,
  completed_at timestamptz,
  inspector_name text,
  score numeric(5,2) check (score between 0 and 100),
  status text not null default 'Scheduled' check (status in ('Scheduled','In Progress','Completed','Cancelled')),
  result text check (result is null or result in ('Passed','Passed with Notes','Failed')),
  summary text,
  checklist jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,inspection_no)
);

create table public.housing_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  asset_no text not null,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  room_id uuid references public.housing_rooms(id) on delete set null,
  category text not null,
  name text not null,
  brand text,
  model text,
  serial_number text,
  purchase_date date,
  purchase_cost numeric(14,2) not null default 0 check (purchase_cost >= 0),
  warranty_end_date date,
  condition text not null default 'Good' check (condition in ('New','Good','Fair','Damaged','Missing','Disposed')),
  status text not null default 'In Service' check (status in ('In Service','In Store','Under Maintenance','Disposed')),
  assigned_employee_id uuid references public.housing_employees(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,asset_no)
);

create table public.housing_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  contract_no text not null,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  contract_type text not null default 'Lease',
  landlord_name text not null,
  landlord_contact text,
  start_date date not null,
  end_date date not null,
  annual_value numeric(14,2) not null default 0 check (annual_value >= 0),
  payment_frequency text not null default 'Annual' check (payment_frequency in ('Monthly','Quarterly','Semiannual','Annual')),
  deposit_amount numeric(14,2) not null default 0,
  next_payment_date date,
  auto_renew boolean not null default false,
  status text not null default 'Active' check (status in ('Draft','Active','Expiring','Expired','Terminated')),
  document_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_date >= start_date),
  unique(company_id,contract_no)
);

create table public.housing_utility_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  utility_type text not null check (utility_type in ('Electricity','Water','Gas','Internet','Other')),
  provider_name text not null,
  account_number text not null,
  meter_number text,
  integration_mode text not null default 'Manual' check (integration_mode in ('Manual','Excel','PDF','API','Open Banking')),
  last_sync_at timestamptz,
  status text not null default 'Active' check (status in ('Active','Suspended','Closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,provider_name,account_number)
);

create table public.housing_utility_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  utility_account_id uuid not null references public.housing_utility_accounts(id) on delete cascade,
  bill_number text,
  period_start date not null,
  period_end date not null,
  issue_date date,
  due_date date not null,
  previous_reading numeric(14,3),
  current_reading numeric(14,3),
  consumption numeric(14,3) not null default 0,
  subtotal numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  paid_at timestamptz,
  status text not null default 'Due' check (status in ('Draft','Due','Partially Paid','Paid','Overdue','Cancelled')),
  source text not null default 'Manual',
  source_document_url text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end >= period_start),
  unique(utility_account_id,period_start,period_end)
);

create table public.housing_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  incident_no text not null,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  room_id uuid references public.housing_rooms(id) on delete set null,
  employee_id uuid references public.housing_employees(id) on delete set null,
  incident_type text not null,
  severity text not null default 'Low' check (severity in ('Low','Medium','High','Critical')),
  occurred_at timestamptz not null,
  description text not null,
  action_taken text,
  penalty_amount numeric(14,2) not null default 0,
  status text not null default 'Open' check (status in ('Open','Under Investigation','Action Required','Closed')),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,incident_no)
);

create table public.housing_audit_log (
  id bigint generated by default as identity primary key,
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create or replace function public.housing_current_company_id() returns uuid
language sql stable security definer set search_path=public
as $$ select company_id from public.housing_profiles where id=auth.uid() and status='Active' limit 1 $$;

create or replace function public.housing_current_role() returns text
language sql stable security definer set search_path=public
as $$ select role from public.housing_profiles where id=auth.uid() and status='Active' limit 1 $$;

create or replace function public.housing_can_manage() returns boolean
language sql stable security definer set search_path=public
as $$ select public.housing_current_role() in ('Admin','Housing Manager','Housing Supervisor') $$;

create or replace function public.housing_set_updated_at() returns trigger
language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;

create or replace function public.housing_create_workspace(p_company_name text,p_full_name text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_company_id uuid; v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if exists(select 1 from public.housing_profiles where id=v_user_id) then raise exception 'Workspace already exists.'; end if;
  if nullif(trim(p_company_name),'') is null or nullif(trim(p_full_name),'') is null then raise exception 'Company and name are required.'; end if;
  insert into public.housing_companies(name) values(trim(p_company_name)) returning id into v_company_id;
  insert into public.housing_profiles(id,company_id,full_name,email,role)
  values(v_user_id,v_company_id,trim(p_full_name),(select email from auth.users where id=v_user_id),'Admin');
  return jsonb_build_object('company_id',v_company_id,'role','Admin');
end $$;

create or replace function public.get_housing_context() returns jsonb
language sql stable security invoker set search_path=public
as $$
  select jsonb_build_object(
    'profile',to_jsonb(p),
    'company',to_jsonb(c)
  ) from public.housing_profiles p join public.housing_companies c on c.id=p.company_id
  where p.id=auth.uid() and p.status='Active' and c.status='Active'
$$;

create or replace function public.get_housing_dashboard() returns jsonb
language sql stable security invoker set search_path=public
as $$
  with t as (select public.housing_current_company_id() company_id), m as (
    select
      (select count(*) from public.housing_sites s,t where s.company_id=t.company_id and s.status<>'Inactive') sites,
      (select count(*) from public.housing_beds b,t where b.company_id=t.company_id and b.status<>'Inactive') beds,
      (select count(*) from public.housing_assignments a,t where a.company_id=t.company_id and a.status='Active') residents,
      (select count(*) from public.housing_maintenance_requests r,t where r.company_id=t.company_id and r.status in ('Open','Assigned','In Progress')) open_maintenance,
      (select count(*) from public.housing_contracts c,t where c.company_id=t.company_id and c.end_date between current_date and current_date+30 and c.status='Active') expiring_contracts,
      (select coalesce(sum(b.total_amount-b.paid_amount),0) from public.housing_utility_bills b,t where b.company_id=t.company_id and b.status in ('Due','Partially Paid','Overdue')) utility_balance
  ) select jsonb_build_object('sites',sites,'beds',beds,'residents',residents,'occupancy_rate',case when beds=0 then 0 else round(residents::numeric/beds*100,1) end,'open_maintenance',open_maintenance,'expiring_contracts',expiring_contracts,'utility_balance',utility_balance) from m
$$;

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
  v_existing public.housing_assignments%rowtype;
  v_assignment public.housing_assignments%rowtype;
begin
  if v_company_id is null or not public.housing_can_manage() then raise exception 'Not authorized.'; end if;
  if not exists(select 1 from public.housing_employees where id=p_employee_id and company_id=v_company_id and status='Active') then raise exception 'Employee is unavailable.'; end if;
  select site_id,room_id,status into v_site_id,v_room_id,v_bed_status
    from public.housing_beds where id=p_bed_id and company_id=v_company_id for update;
  if v_site_id is null or v_bed_status<>'Available' then raise exception 'Bed is unavailable.'; end if;
  select * into v_existing from public.housing_assignments
    where company_id=v_company_id and employee_id=p_employee_id and status='Active' for update;
  if v_existing.id is not null then
    update public.housing_assignments set status='Ended',end_date=greatest(coalesce(p_start_date,current_date),start_date),ended_by=auth.uid(),reason=coalesce(p_reason,'Transfer') where id=v_existing.id;
    update public.housing_beds set status='Available' where id=v_existing.bed_id and company_id=v_company_id;
    update public.housing_rooms set status='Available' where id=v_existing.room_id and company_id=v_company_id and status='Full';
  end if;
  insert into public.housing_assignments(company_id,employee_id,site_id,room_id,bed_id,assignment_type,start_date,expected_end_date,previous_assignment_id,reason,status)
    values(v_company_id,p_employee_id,v_site_id,v_room_id,p_bed_id,case when v_existing.id is null then 'CheckIn' else 'Transfer' end,coalesce(p_start_date,current_date),p_expected_end_date,v_existing.id,p_reason,'Active')
    returning * into v_assignment;
  update public.housing_beds set status='Occupied' where id=p_bed_id and company_id=v_company_id;
  update public.housing_rooms r set status=case when exists(select 1 from public.housing_beds b where b.room_id=r.id and b.status='Available') then 'Available' else 'Full' end where r.id=v_room_id and r.company_id=v_company_id;
  return v_assignment;
end $$;

create or replace function public.housing_end_assignment(
  p_assignment_id uuid,
  p_end_date date default current_date,
  p_reason text default null
) returns public.housing_assignments
language plpgsql security invoker set search_path=public
as $$
declare v_company_id uuid:=public.housing_current_company_id(); v_assignment public.housing_assignments%rowtype;
begin
  if v_company_id is null or not public.housing_can_manage() then raise exception 'Not authorized.'; end if;
  select * into v_assignment from public.housing_assignments where id=p_assignment_id and company_id=v_company_id and status='Active' for update;
  if v_assignment.id is null then raise exception 'Active assignment was not found.'; end if;
  update public.housing_assignments set status='Ended',end_date=greatest(coalesce(p_end_date,current_date),start_date),ended_by=auth.uid(),reason=p_reason where id=v_assignment.id returning * into v_assignment;
  update public.housing_beds set status='Available' where id=v_assignment.bed_id and company_id=v_company_id;
  update public.housing_rooms set status='Available' where id=v_assignment.room_id and company_id=v_company_id and status='Full';
  return v_assignment;
end $$;

create index housing_sites_company_idx on public.housing_sites(company_id,status);
create index housing_rooms_site_idx on public.housing_rooms(company_id,site_id,status);
create index housing_beds_room_idx on public.housing_beds(company_id,room_id,status);
create index housing_assignments_company_idx on public.housing_assignments(company_id,status,start_date desc);
create index housing_maintenance_status_idx on public.housing_maintenance_requests(company_id,status,priority);
create index housing_contracts_end_idx on public.housing_contracts(company_id,end_date,status);
create index housing_bills_due_idx on public.housing_utility_bills(company_id,due_date,status);

do $$ declare t text; begin
  foreach t in array array['housing_companies','housing_profiles','housing_projects','housing_employees','housing_sites','housing_buildings','housing_rooms','housing_beds','housing_assignments','housing_maintenance_requests','housing_inspections','housing_assets','housing_contracts','housing_utility_accounts','housing_utility_bills','housing_incidents','housing_audit_log'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
  foreach t in array array['housing_projects','housing_employees','housing_sites','housing_buildings','housing_rooms','housing_beds','housing_assignments','housing_maintenance_requests','housing_inspections','housing_assets','housing_contracts','housing_utility_accounts','housing_utility_bills','housing_incidents','housing_audit_log'] loop
    execute format('create policy %I_select on public.%I for select to authenticated using(company_id=public.housing_current_company_id())',t,t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check(company_id=public.housing_current_company_id() and public.housing_can_manage())',t,t);
    execute format('create policy %I_update on public.%I for update to authenticated using(company_id=public.housing_current_company_id() and public.housing_can_manage()) with check(company_id=public.housing_current_company_id())',t,t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using(company_id=public.housing_current_company_id() and public.housing_can_manage())',t,t);
  end loop;
end $$;

create policy housing_companies_select on public.housing_companies for select to authenticated using(id=public.housing_current_company_id());
create policy housing_companies_update on public.housing_companies for update to authenticated using(id=public.housing_current_company_id() and public.housing_current_role()='Admin');
create policy housing_profiles_select on public.housing_profiles for select to authenticated using(company_id=public.housing_current_company_id());
create policy housing_profiles_manage on public.housing_profiles for all to authenticated using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin') with check(company_id=public.housing_current_company_id());

do $$ declare t text; begin
  foreach t in array array['housing_companies','housing_profiles','housing_projects','housing_employees','housing_sites','housing_buildings','housing_rooms','housing_beds','housing_assignments','housing_maintenance_requests','housing_inspections','housing_assets','housing_contracts','housing_utility_accounts','housing_utility_bills','housing_incidents'] loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.housing_set_updated_at()',t,t);
  end loop;
end $$;

grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant execute on function public.housing_create_workspace(text,text) to authenticated;
grant execute on function public.get_housing_context() to authenticated;
grant execute on function public.get_housing_dashboard() to authenticated;
grant execute on function public.housing_assign_employee(uuid,uuid,date,date,text) to authenticated;
grant execute on function public.housing_end_assignment(uuid,date,text) to authenticated;

revoke execute on function public.housing_create_workspace(text,text) from public,anon;
revoke execute on function public.get_housing_context() from public,anon;
revoke execute on function public.get_housing_dashboard() from public,anon;
revoke execute on function public.housing_assign_employee(uuid,uuid,date,date,text) from public,anon;
revoke execute on function public.housing_end_assignment(uuid,date,text) from public,anon;
