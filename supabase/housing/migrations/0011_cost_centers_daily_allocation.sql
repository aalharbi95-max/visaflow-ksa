-- Cost centers and auditable daily housing cost allocation.
-- Apply ONLY to the dedicated Housing Supabase project after 0010.

create table public.housing_cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  code text not null,
  name text not null,
  project_id uuid references public.housing_projects(id) on delete set null,
  external_system text,
  external_code text,
  status text not null default 'Active' check(status in ('Active','Inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code)
);

alter table public.housing_sites
  add column if not exists default_cost_center_id uuid references public.housing_cost_centers(id) on delete set null;

alter table public.housing_assignments
  add column if not exists project_id uuid references public.housing_projects(id) on delete set null,
  add column if not exists cost_center_id uuid references public.housing_cost_centers(id) on delete set null;

create table public.housing_cost_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  cost_center_id uuid references public.housing_cost_centers(id) on delete set null,
  category text not null check(category in ('Rent','Electricity','Water','Gas','Internet','Maintenance','Catering','Laundry','Other')),
  description text not null,
  period_start date not null,
  period_end date not null,
  amount numeric(14,2) not null check(amount >= 0),
  source_reference text,
  status text not null default 'Posted' check(status in ('Draft','Posted','Cancelled')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_end >= period_start)
);

create table public.housing_cost_allocation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'Processing' check(status in ('Processing','Completed','Failed')),
  total_cost numeric(14,2) not null default 0,
  allocated_cost numeric(14,2) not null default 0,
  unallocated_cost numeric(14,2) not null default 0,
  worker_days integer not null default 0,
  generated_by uuid references auth.users(id) on delete set null default auth.uid(),
  generated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(company_id,period_start,period_end),
  check(period_end >= period_start)
);

create table public.housing_daily_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  run_id uuid not null references public.housing_cost_allocation_runs(id) on delete cascade,
  allocation_date date not null,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  employee_id uuid references public.housing_employees(id) on delete set null,
  assignment_id uuid references public.housing_assignments(id) on delete set null,
  project_id uuid references public.housing_projects(id) on delete set null,
  cost_center_id uuid references public.housing_cost_centers(id) on delete set null,
  category text not null,
  amount numeric(14,6) not null check(amount >= 0),
  source_type text not null,
  source_id uuid,
  created_at timestamptz not null default now()
);

create index housing_cost_centers_project_idx on public.housing_cost_centers(company_id,project_id,status);
create index housing_cost_entries_period_idx on public.housing_cost_entries(company_id,period_start,period_end,status);
create index housing_daily_allocations_run_idx on public.housing_daily_cost_allocations(run_id,allocation_date);
create index housing_daily_allocations_center_idx on public.housing_daily_cost_allocations(company_id,cost_center_id,allocation_date);
create index housing_daily_allocations_employee_idx on public.housing_daily_cost_allocations(company_id,employee_id,allocation_date);

create trigger housing_cost_centers_updated_at before update on public.housing_cost_centers
for each row execute function public.housing_set_updated_at();
create trigger housing_cost_entries_updated_at before update on public.housing_cost_entries
for each row execute function public.housing_set_updated_at();

create or replace function public.housing_validate_cost_center_context() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.project_id is not null and not exists(
    select 1 from public.housing_projects where id=new.project_id and company_id=new.company_id
  ) then raise exception 'Project does not belong to the housing company.'; end if;
  return new;
end $$;
create trigger housing_validate_cost_center_context before insert or update on public.housing_cost_centers
for each row execute function public.housing_validate_cost_center_context();

create or replace function public.housing_validate_cost_entry_context() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.housing_sites where id=new.site_id and company_id=new.company_id) then
    raise exception 'Housing site does not belong to the company.';
  end if;
  if new.cost_center_id is not null and not exists(
    select 1 from public.housing_cost_centers where id=new.cost_center_id and company_id=new.company_id
  ) then raise exception 'Cost center does not belong to the housing company.'; end if;
  return new;
end $$;
create trigger housing_validate_cost_entry_context before insert or update on public.housing_cost_entries
for each row execute function public.housing_validate_cost_entry_context();

create or replace function public.housing_assignment_financial_context() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.project_id is not null and not exists(select 1 from public.housing_projects where id=new.project_id and company_id=new.company_id) then
    raise exception 'Project does not belong to the housing company.';
  end if;
  if new.cost_center_id is not null and not exists(select 1 from public.housing_cost_centers where id=new.cost_center_id and company_id=new.company_id) then
    raise exception 'Cost center does not belong to the housing company.';
  end if;
  if new.project_id is null then
    select project_id into new.project_id from public.housing_employees
    where id=new.employee_id and company_id=new.company_id;
  end if;
  if new.cost_center_id is null then
    select id into new.cost_center_id from public.housing_cost_centers
    where company_id=new.company_id and project_id=new.project_id and status='Active'
    order by created_at limit 1;
  end if;
  if new.cost_center_id is null then
    select default_cost_center_id into new.cost_center_id from public.housing_sites
    where id=new.site_id and company_id=new.company_id;
  end if;
  return new;
end $$;

drop trigger if exists housing_assignment_financial_context on public.housing_assignments;
create trigger housing_assignment_financial_context
before insert or update of employee_id,site_id,project_id,cost_center_id on public.housing_assignments
for each row execute function public.housing_assignment_financial_context();

update public.housing_assignments a set project_id=e.project_id
from public.housing_employees e
where a.employee_id=e.id and a.company_id=e.company_id and a.project_id is null;

update public.housing_assignments a set cost_center_id=c.id
from public.housing_cost_centers c
where a.company_id=c.company_id and a.project_id=c.project_id and c.status='Active' and a.cost_center_id is null;

create or replace function public.housing_generate_daily_cost_allocation(p_period_start date,p_period_end date)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_company uuid:=public.housing_current_company_id();
  v_run uuid;
begin
  if v_company is null or not public.housing_has_permission('finance','manage') then raise exception 'Not authorized.'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Invalid allocation period.'; end if;
  if p_period_end-p_period_start>366 then raise exception 'Allocation period cannot exceed 367 days.'; end if;

  delete from public.housing_cost_allocation_runs
  where company_id=v_company and period_start=p_period_start and period_end=p_period_end;
  insert into public.housing_cost_allocation_runs(company_id,period_start,period_end)
  values(v_company,p_period_start,p_period_end) returning id into v_run;

  with source_costs as (
    select c.site_id,d.day::date allocation_date,'Rent'::text category,
      (c.annual_value/365.0)::numeric amount,'Contract'::text source_type,c.id source_id
    from public.housing_contracts c
    cross join lateral generate_series(greatest(c.start_date,p_period_start),least(c.end_date,p_period_end),interval '1 day') d(day)
    where c.company_id=v_company and c.status in ('Active','Expiring') and c.annual_value>0
      and c.start_date<=p_period_end and c.end_date>=p_period_start
    union all
    select a.site_id,d.day::date,
      case when a.utility_type in ('Electricity','Water','Gas','Internet') then a.utility_type else 'Other' end,
      (b.total_amount/greatest(1,b.period_end-b.period_start+1))::numeric,
      'Utility Bill',b.id
    from public.housing_utility_bills b join public.housing_utility_accounts a on a.id=b.utility_account_id
    cross join lateral generate_series(greatest(b.period_start,p_period_start),least(b.period_end,p_period_end),interval '1 day') d(day)
    where b.company_id=v_company and b.status<>'Cancelled' and b.total_amount>0
      and b.period_start<=p_period_end and b.period_end>=p_period_start
    union all
    select m.site_id,coalesce(m.completed_at,m.reported_at)::date,'Maintenance',
      coalesce(nullif(m.actual_cost,0),m.estimated_cost)::numeric,'Maintenance',m.id
    from public.housing_maintenance_requests m
    where m.company_id=v_company and m.status<>'Cancelled'
      and coalesce(m.completed_at,m.reported_at)::date between p_period_start and p_period_end
      and coalesce(nullif(m.actual_cost,0),m.estimated_cost)>0
    union all
    select e.site_id,d.day::date,e.category,
      (e.amount/greatest(1,e.period_end-e.period_start+1))::numeric,'Manual Cost',e.id
    from public.housing_cost_entries e
    cross join lateral generate_series(greatest(e.period_start,p_period_start),least(e.period_end,p_period_end),interval '1 day') d(day)
    where e.company_id=v_company and e.status='Posted' and e.amount>0
      and e.period_start<=p_period_end and e.period_end>=p_period_start
  ), occupancy as (
    select s.allocation_date,s.site_id,a.id assignment_id,a.employee_id,
      coalesce(a.project_id,e.project_id,hs.project_id) project_id,
      coalesce(a.cost_center_id,pc.id,hs.default_cost_center_id) cost_center_id,
      count(*) over(partition by s.allocation_date,s.site_id) occupant_count
    from (select distinct allocation_date,site_id from source_costs) s
    join public.housing_assignments a on a.company_id=v_company and a.site_id=s.site_id
      and a.start_date<=s.allocation_date and coalesce(a.end_date,p_period_end)>=s.allocation_date
    join public.housing_employees e on e.id=a.employee_id
    join public.housing_sites hs on hs.id=s.site_id
    left join lateral (
      select id from public.housing_cost_centers c
      where c.company_id=v_company and c.project_id=coalesce(a.project_id,e.project_id,hs.project_id) and c.status='Active'
      order by c.created_at limit 1
    ) pc on true
  )
  insert into public.housing_daily_cost_allocations(
    company_id,run_id,allocation_date,site_id,employee_id,assignment_id,project_id,cost_center_id,category,amount,source_type,source_id
  )
  select v_company,v_run,s.allocation_date,s.site_id,o.employee_id,o.assignment_id,o.project_id,o.cost_center_id,
    s.category,round(s.amount/o.occupant_count,6),s.source_type,s.source_id
  from source_costs s join occupancy o on o.allocation_date=s.allocation_date and o.site_id=s.site_id
  union all
  select v_company,v_run,s.allocation_date,s.site_id,null,null,hs.project_id,hs.default_cost_center_id,
    s.category,round(s.amount,6),s.source_type,s.source_id
  from source_costs s join public.housing_sites hs on hs.id=s.site_id
  where not exists(select 1 from occupancy o where o.allocation_date=s.allocation_date and o.site_id=s.site_id);

  update public.housing_cost_allocation_runs r set
    status='Completed',completed_at=now(),
    total_cost=coalesce((select round(sum(amount),2) from public.housing_daily_cost_allocations where run_id=v_run),0),
    allocated_cost=coalesce((select round(sum(amount),2) from public.housing_daily_cost_allocations where run_id=v_run and employee_id is not null),0),
    unallocated_cost=coalesce((select round(sum(amount),2) from public.housing_daily_cost_allocations where run_id=v_run and employee_id is null),0),
    worker_days=coalesce((select count(distinct (allocation_date,employee_id)) from public.housing_daily_cost_allocations where run_id=v_run and employee_id is not null),0)
  where id=v_run;
  return v_run;
exception when others then
  update public.housing_cost_allocation_runs set status='Failed',completed_at=now() where id=v_run;
  raise;
end $$;

alter table public.housing_cost_centers enable row level security;
alter table public.housing_cost_entries enable row level security;
alter table public.housing_cost_allocation_runs enable row level security;
alter table public.housing_daily_cost_allocations enable row level security;

create policy housing_cost_centers_select on public.housing_cost_centers for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','read'));
create policy housing_cost_centers_manage on public.housing_cost_centers for all to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','manage'))
with check(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','manage'));
create policy housing_cost_entries_select on public.housing_cost_entries for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','read') and public.housing_can_access_site(site_id));
create policy housing_cost_entries_manage on public.housing_cost_entries for all to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','manage') and public.housing_can_access_site(site_id))
with check(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','manage') and public.housing_can_access_site(site_id));
create policy housing_cost_runs_select on public.housing_cost_allocation_runs for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','read'));
create policy housing_daily_allocations_select on public.housing_daily_cost_allocations for select to authenticated
using(company_id=public.housing_current_company_id() and public.housing_has_permission('finance','read') and public.housing_can_access_site(site_id));

grant select,insert,update,delete on public.housing_cost_centers,public.housing_cost_entries to authenticated;
grant select on public.housing_cost_allocation_runs,public.housing_daily_cost_allocations to authenticated;
grant execute on function public.housing_generate_daily_cost_allocation(date,date) to authenticated;
revoke execute on function public.housing_assignment_financial_context() from public,anon,authenticated;
revoke execute on function public.housing_validate_cost_center_context() from public,anon,authenticated;
revoke execute on function public.housing_validate_cost_entry_context() from public,anon,authenticated;

-- Give existing projects a safe initial mapping; finance can rename or replace it later.
insert into public.housing_cost_centers(company_id,code,name,project_id,notes)
select p.company_id,'HC-'||p.code,p.name,p.id,'Automatically created from the existing housing project'
from public.housing_projects p
where not exists(select 1 from public.housing_cost_centers c where c.company_id=p.company_id and c.project_id=p.id)
on conflict(company_id,code) do nothing;

update public.housing_sites s set default_cost_center_id=c.id
from public.housing_cost_centers c
where s.company_id=c.company_id and s.project_id=c.project_id and s.default_cost_center_id is null and c.status='Active';

update public.housing_assignments a set cost_center_id=c.id
from public.housing_cost_centers c
where a.company_id=c.company_id and a.project_id=c.project_id and a.cost_center_id is null and c.status='Active';
