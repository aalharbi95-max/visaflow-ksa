-- Site sub-warehouses, spare-parts balances and maintenance-linked stock movements.
-- Apply ONLY to the dedicated Housing Supabase project after 0011.

create table public.housing_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  code text not null,
  name text not null,
  status text not null default 'Active' check(status in ('Active','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code), unique(company_id,site_id,name)
);

create table public.housing_inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  sku text not null,
  name text not null,
  category text not null default 'General',
  unit text not null default 'Piece',
  unit_cost numeric(12,2) not null default 0 check(unit_cost>=0),
  reorder_level numeric(12,3) not null default 0 check(reorder_level>=0),
  status text not null default 'Active' check(status in ('Active','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,sku)
);

create table public.housing_inventory_balances (
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  location_id uuid not null references public.housing_inventory_locations(id) on delete cascade,
  item_id uuid not null references public.housing_inventory_items(id) on delete cascade,
  quantity numeric(12,3) not null default 0 check(quantity>=0),
  updated_at timestamptz not null default now(),
  primary key(location_id,item_id)
);

create table public.housing_inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  location_id uuid not null references public.housing_inventory_locations(id) on delete restrict,
  item_id uuid not null references public.housing_inventory_items(id) on delete restrict,
  movement_type text not null check(movement_type in ('Receipt','Issue','Return','Adjustment Increase','Adjustment Decrease')),
  quantity numeric(12,3) not null check(quantity>0),
  unit_cost numeric(12,2) not null default 0 check(unit_cost>=0),
  total_cost numeric(14,2) generated always as (round(quantity*unit_cost,2)) stored,
  maintenance_request_id uuid references public.housing_maintenance_requests(id) on delete set null,
  reference_no text,
  notes text,
  client_operation_id uuid,
  performed_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique(company_id,client_operation_id)
);

create index housing_inventory_locations_site_idx on public.housing_inventory_locations(company_id,site_id,status);
create index housing_inventory_items_status_idx on public.housing_inventory_items(company_id,status,category);
create index housing_inventory_transactions_created_idx on public.housing_inventory_transactions(company_id,created_at desc);

create trigger housing_inventory_locations_updated_at before update on public.housing_inventory_locations for each row execute function public.housing_set_updated_at();
create trigger housing_inventory_items_updated_at before update on public.housing_inventory_items for each row execute function public.housing_set_updated_at();

create or replace function public.housing_post_inventory_transaction(
  p_location_id uuid,p_item_id uuid,p_movement_type text,p_quantity numeric,
  p_unit_cost numeric default null,p_maintenance_request_id uuid default null,
  p_reference_no text default null,p_notes text default null,p_client_operation_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_company uuid:=public.housing_current_company_id(); v_site uuid; v_item_cost numeric; v_balance numeric; v_delta numeric; v_tx uuid;
begin
  if v_company is null or not public.housing_has_permission('inventory','manage') then raise exception 'Not authorized.'; end if;
  if p_movement_type not in ('Receipt','Issue','Return','Adjustment Increase','Adjustment Decrease') or coalesce(p_quantity,0)<=0 then raise exception 'Invalid inventory movement.'; end if;
  if p_client_operation_id is not null then select id into v_tx from public.housing_inventory_transactions where company_id=v_company and client_operation_id=p_client_operation_id; if v_tx is not null then return v_tx; end if; end if;
  select site_id into v_site from public.housing_inventory_locations where id=p_location_id and company_id=v_company and status='Active';
  if v_site is null or not public.housing_can_access_site(v_site) then raise exception 'Warehouse is unavailable.'; end if;
  select unit_cost into v_item_cost from public.housing_inventory_items where id=p_item_id and company_id=v_company and status='Active';
  if not found then raise exception 'Inventory item is unavailable.'; end if;
  if p_maintenance_request_id is not null and not exists(select 1 from public.housing_maintenance_requests where id=p_maintenance_request_id and company_id=v_company and site_id=v_site) then raise exception 'Maintenance request does not belong to this site.'; end if;
  insert into public.housing_inventory_balances(company_id,location_id,item_id,quantity) values(v_company,p_location_id,p_item_id,0) on conflict(location_id,item_id) do nothing;
  select quantity into v_balance from public.housing_inventory_balances where location_id=p_location_id and item_id=p_item_id for update;
  v_delta:=case when p_movement_type in ('Receipt','Return','Adjustment Increase') then p_quantity else -p_quantity end;
  if v_balance+v_delta<0 then raise exception 'Insufficient stock. Available: %',v_balance; end if;
  update public.housing_inventory_balances set quantity=quantity+v_delta,updated_at=now() where location_id=p_location_id and item_id=p_item_id;
  insert into public.housing_inventory_transactions(company_id,location_id,item_id,movement_type,quantity,unit_cost,maintenance_request_id,reference_no,notes,client_operation_id)
  values(v_company,p_location_id,p_item_id,p_movement_type,p_quantity,coalesce(p_unit_cost,v_item_cost),p_maintenance_request_id,nullif(trim(p_reference_no),''),nullif(trim(p_notes),''),p_client_operation_id) returning id into v_tx;
  if p_movement_type='Issue' and p_maintenance_request_id is not null then
    update public.housing_maintenance_requests set actual_cost=coalesce(actual_cost,0)+round(p_quantity*coalesce(p_unit_cost,v_item_cost),2),updated_at=now() where id=p_maintenance_request_id;
  end if;
  return v_tx;
end $$;

create or replace function public.housing_has_permission(p_module text,p_action text default 'read') returns boolean
language sql stable security definer set search_path=public as $$
  select case public.housing_current_role()
    when 'Admin' then true
    when 'Housing Manager' then p_module <> 'users'
    when 'Housing Supervisor' then p_module in ('dashboard','housing','occupancy','inspections','safety','welfare','operations','maintenance','assets','inventory','reports','notifications')
    when 'Maintenance' then p_module in ('dashboard','housing','maintenance','assets','inventory','reports') or (p_module='notifications' and p_action='read')
    when 'Finance' then p_module in ('dashboard','housing','finance','inventory','reports') or (p_module='notifications' and p_action='read')
    when 'Viewer' then p_action='read'
    else false end
$$;

alter table public.housing_inventory_locations enable row level security;
alter table public.housing_inventory_items enable row level security;
alter table public.housing_inventory_balances enable row level security;
alter table public.housing_inventory_transactions enable row level security;

create policy housing_inventory_locations_read on public.housing_inventory_locations for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','read') and public.housing_can_access_site(site_id));
create policy housing_inventory_locations_manage on public.housing_inventory_locations for all to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','manage') and public.housing_can_access_site(site_id)) with check(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','manage') and public.housing_can_access_site(site_id));
create policy housing_inventory_items_read on public.housing_inventory_items for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','read'));
create policy housing_inventory_items_manage on public.housing_inventory_items for all to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','manage')) with check(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','manage'));
create policy housing_inventory_balances_read on public.housing_inventory_balances for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','read') and exists(select 1 from public.housing_inventory_locations l where l.id=location_id and public.housing_can_access_site(l.site_id)));
create policy housing_inventory_transactions_read on public.housing_inventory_transactions for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('inventory','read') and exists(select 1 from public.housing_inventory_locations l where l.id=location_id and public.housing_can_access_site(l.site_id)));

grant select,insert,update,delete on public.housing_inventory_locations,public.housing_inventory_items to authenticated;
grant select on public.housing_inventory_balances,public.housing_inventory_transactions to authenticated;
grant execute on function public.housing_post_inventory_transaction(uuid,uuid,text,numeric,numeric,uuid,text,text,uuid) to authenticated;

insert into public.housing_inventory_locations(company_id,site_id,code,name)
select s.company_id,s.id,'WH-'||s.code,'Main Spare Parts Store' from public.housing_sites s
on conflict(company_id,site_id,name) do nothing;

insert into public.housing_inventory_items(company_id,sku,name,category,unit,unit_cost,reorder_level)
select c.id,v.sku,v.name,v.category,v.unit,v.cost,v.reorder from public.housing_companies c cross join (values
  ('AC-FILTER','Air-conditioner filter','HVAC','Piece',18::numeric,10::numeric),
  ('REFRIGERANT','Refrigerant cylinder','HVAC','Cylinder',320::numeric,2::numeric),
  ('WATER-VALVE','Water shut-off valve','Plumbing','Piece',45::numeric,5::numeric),
  ('LED-LAMP','LED lamp','Electrical','Piece',12::numeric,20::numeric)
) v(sku,name,category,unit,cost,reorder)
on conflict(company_id,sku) do nothing;
