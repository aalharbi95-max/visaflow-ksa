-- Gate security: visitors, deliveries and asset gate passes.
-- Apply ONLY to the dedicated Housing Supabase project after 0012.

create table public.housing_gate_visitors (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade, visit_no text not null,
  visitor_name text not null, id_type text, id_last4 text check(id_last4 is null or length(id_last4)=4), organization text,
  purpose text not null, host_name text, vehicle_plate text, entry_at timestamptz not null default now(), exit_at timestamptz,
  status text not null default 'Checked In' check(status in ('Checked In','Checked Out','Denied')),
  notes text, created_by uuid references auth.users(id) on delete set null default auth.uid(), created_at timestamptz not null default now(),
  unique(company_id,visit_no)
);

create table public.housing_gate_deliveries (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade, delivery_no text not null,
  delivery_type text not null check(delivery_type in ('Catering','Water Tanker','Sewage Tanker','Laundry','Materials','Other')),
  supplier_name text not null, driver_name text, vehicle_plate text, quantity numeric(12,3), unit text,
  arrived_at timestamptz not null default now(), departed_at timestamptz,
  status text not null default 'On Site' check(status in ('Expected','On Site','Departed','Rejected')),
  notes text, created_by uuid references auth.users(id) on delete set null default auth.uid(), created_at timestamptz not null default now(),
  unique(company_id,delivery_no)
);

create table public.housing_gate_passes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade, pass_no text not null,
  asset_id uuid references public.housing_assets(id) on delete set null, item_description text not null, quantity numeric(12,3) not null default 1 check(quantity>0),
  reason text not null, destination text, approved_by_name text, expected_return_at timestamptz,
  checked_out_at timestamptz, returned_at timestamptz,
  status text not null default 'Draft' check(status in ('Draft','Approved','Checked Out','Returned','Cancelled')),
  notes text, created_by uuid references auth.users(id) on delete set null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,pass_no)
);

create index housing_gate_visitors_active_idx on public.housing_gate_visitors(company_id,site_id,status,entry_at desc);
create index housing_gate_deliveries_active_idx on public.housing_gate_deliveries(company_id,site_id,status,arrived_at desc);
create index housing_gate_passes_active_idx on public.housing_gate_passes(company_id,site_id,status,expected_return_at);
create trigger housing_gate_passes_updated_at before update on public.housing_gate_passes for each row execute function public.housing_set_updated_at();

create or replace function public.housing_gate_transition(p_entity text,p_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_company uuid:=public.housing_current_company_id(); v_row jsonb;
begin
  if v_company is null or not public.housing_has_permission('security','manage') then raise exception 'Not authorized.'; end if;
  if p_entity='Visitor' and p_action='Checkout' then
    update public.housing_gate_visitors set status='Checked Out',exit_at=now() where id=p_id and company_id=v_company and status='Checked In' returning to_jsonb(housing_gate_visitors.*) into v_row;
  elsif p_entity='Delivery' and p_action='Depart' then
    update public.housing_gate_deliveries set status='Departed',departed_at=now() where id=p_id and company_id=v_company and status='On Site' returning to_jsonb(housing_gate_deliveries.*) into v_row;
  elsif p_entity='Pass' and p_action='Approve' then
    update public.housing_gate_passes set status='Approved' where id=p_id and company_id=v_company and status='Draft' returning to_jsonb(housing_gate_passes.*) into v_row;
  elsif p_entity='Pass' and p_action='Checkout' then
    update public.housing_gate_passes set status='Checked Out',checked_out_at=now() where id=p_id and company_id=v_company and status='Approved' returning to_jsonb(housing_gate_passes.*) into v_row;
  elsif p_entity='Pass' and p_action='Return' then
    update public.housing_gate_passes set status='Returned',returned_at=now() where id=p_id and company_id=v_company and status='Checked Out' returning to_jsonb(housing_gate_passes.*) into v_row;
  else raise exception 'Unsupported gate transition.'; end if;
  if v_row is null then raise exception 'Record is unavailable or transition is not allowed.'; end if;
  return v_row;
end $$;

create or replace function public.housing_has_permission(p_module text,p_action text default 'read') returns boolean
language sql stable security definer set search_path=public as $$
  select case public.housing_current_role()
    when 'Admin' then true
    when 'Housing Manager' then p_module <> 'users'
    when 'Housing Supervisor' then p_module in ('dashboard','housing','occupancy','inspections','safety','welfare','operations','maintenance','assets','inventory','security','reports','notifications')
    when 'Maintenance' then p_module in ('dashboard','housing','maintenance','assets','inventory','reports') or (p_module in ('notifications','security') and p_action='read')
    when 'Finance' then p_module in ('dashboard','housing','finance','inventory','reports') or (p_module in ('notifications','security') and p_action='read')
    when 'Viewer' then p_action='read'
    else false end
$$;

alter table public.housing_gate_visitors enable row level security; alter table public.housing_gate_deliveries enable row level security; alter table public.housing_gate_passes enable row level security;
create policy housing_gate_visitors_read on public.housing_gate_visitors for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('security','read') and public.housing_can_access_site(site_id));
create policy housing_gate_visitors_manage on public.housing_gate_visitors for insert to authenticated with check(company_id=public.housing_current_company_id() and public.housing_has_permission('security','manage') and public.housing_can_access_site(site_id));
create policy housing_gate_deliveries_read on public.housing_gate_deliveries for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('security','read') and public.housing_can_access_site(site_id));
create policy housing_gate_deliveries_manage on public.housing_gate_deliveries for insert to authenticated with check(company_id=public.housing_current_company_id() and public.housing_has_permission('security','manage') and public.housing_can_access_site(site_id));
create policy housing_gate_passes_read on public.housing_gate_passes for select to authenticated using(company_id=public.housing_current_company_id() and public.housing_has_permission('security','read') and public.housing_can_access_site(site_id));
create policy housing_gate_passes_manage on public.housing_gate_passes for insert to authenticated with check(company_id=public.housing_current_company_id() and public.housing_has_permission('security','manage') and public.housing_can_access_site(site_id));
grant select,insert on public.housing_gate_visitors,public.housing_gate_deliveries,public.housing_gate_passes to authenticated;
grant execute on function public.housing_gate_transition(text,uuid,text) to authenticated;
