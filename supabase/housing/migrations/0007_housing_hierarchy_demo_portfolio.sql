-- Building hierarchy and a repeatable 10-site demonstration portfolio.
-- Apply only to the dedicated Sakan Housing Supabase project.

create table if not exists public.housing_floors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  building_id uuid not null references public.housing_buildings(id) on delete cascade,
  floor_number integer not null,
  name text not null,
  status text not null default 'Active' check (status in ('Active','Maintenance','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(building_id, floor_number)
);

create table if not exists public.housing_apartments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.housing_companies(id) on delete cascade,
  site_id uuid not null references public.housing_sites(id) on delete cascade,
  building_id uuid not null references public.housing_buildings(id) on delete cascade,
  floor_id uuid not null references public.housing_floors(id) on delete cascade,
  apartment_number text not null,
  name text,
  status text not null default 'Active' check (status in ('Active','Maintenance','Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(floor_id, apartment_number)
);

alter table public.housing_rooms
  add column if not exists apartment_id uuid references public.housing_apartments(id) on delete set null;

create index if not exists housing_floors_site_idx on public.housing_floors(company_id,site_id,building_id,floor_number);
create index if not exists housing_apartments_site_idx on public.housing_apartments(company_id,site_id,building_id,floor_id);
create index if not exists housing_rooms_apartment_idx on public.housing_rooms(company_id,apartment_id);

alter table public.housing_floors enable row level security;
alter table public.housing_apartments enable row level security;

drop policy if exists housing_floors_select on public.housing_floors;
drop policy if exists housing_floors_insert on public.housing_floors;
drop policy if exists housing_floors_update on public.housing_floors;
drop policy if exists housing_floors_delete on public.housing_floors;
create policy housing_floors_select on public.housing_floors for select to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('housing','read') and public.housing_can_access_site(site_id));
create policy housing_floors_insert on public.housing_floors for insert to authenticated
  with check(company_id=public.housing_current_company_id() and public.housing_current_role() in ('Admin','Housing Manager'));
create policy housing_floors_update on public.housing_floors for update to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_current_role() in ('Admin','Housing Manager'))
  with check(company_id=public.housing_current_company_id());
create policy housing_floors_delete on public.housing_floors for delete to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

drop policy if exists housing_apartments_select on public.housing_apartments;
drop policy if exists housing_apartments_insert on public.housing_apartments;
drop policy if exists housing_apartments_update on public.housing_apartments;
drop policy if exists housing_apartments_delete on public.housing_apartments;
create policy housing_apartments_select on public.housing_apartments for select to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_has_permission('housing','read') and public.housing_can_access_site(site_id));
create policy housing_apartments_insert on public.housing_apartments for insert to authenticated
  with check(company_id=public.housing_current_company_id() and public.housing_current_role() in ('Admin','Housing Manager'));
create policy housing_apartments_update on public.housing_apartments for update to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_current_role() in ('Admin','Housing Manager'))
  with check(company_id=public.housing_current_company_id());
create policy housing_apartments_delete on public.housing_apartments for delete to authenticated
  using(company_id=public.housing_current_company_id() and public.housing_current_role()='Admin');

drop trigger if exists housing_floors_updated_at on public.housing_floors;
create trigger housing_floors_updated_at before update on public.housing_floors
  for each row execute function public.housing_set_updated_at();
drop trigger if exists housing_apartments_updated_at on public.housing_apartments;
create trigger housing_apartments_updated_at before update on public.housing_apartments
  for each row execute function public.housing_set_updated_at();

grant select,insert,update,delete on public.housing_floors,public.housing_apartments to authenticated;

create or replace function public.housing_seed_demo_portfolio() returns jsonb
language plpgsql security invoker set search_path=public
as $$
declare
  v_company_id uuid:=coalesce(
    public.housing_current_company_id(),
    case when current_user='postgres' then (select company_id from public.housing_profiles order by created_at limit 1) end
  );
  v_project_id uuid;
  v_site_id uuid;
  v_building_id uuid;
  v_floor_id uuid;
  v_apartment_id uuid;
  v_room_id uuid;
  v_bed_id uuid;
  v_employee_id uuid;
  v_site integer;
  v_floor integer;
  v_apartment integer;
  v_room integer;
  v_worker integer;
  v_is_compliant boolean;
  v_city text;
  v_district text;
  v_lat numeric(9,6);
  v_lng numeric(9,6);
begin
  if v_company_id is null or (current_user<>'postgres' and not public.housing_can_manage()) then
    raise exception 'Not authorized.';
  end if;

  insert into public.housing_projects(company_id,code,name,city,status)
  values(v_company_id,'DEMO-PORTFOLIO','مشروع محفظة السكنات التجريبية / Housing Demo Portfolio','الرياض','Active')
  on conflict(company_id,code) do update set name=excluded.name,status='Active',updated_at=now()
  returning id into v_project_id;

  insert into public.housing_compliance_rules(company_id,rule_code,category,title,minimum_area_per_person_sqm,source_authority,status)
  values(v_company_id,'AREA-4M2','Occupancy','4 م² لكل عامل / 4 m² per worker',4,'سياسة النظام التجريبية','Active')
  on conflict(company_id,rule_code) do update set minimum_area_per_person_sqm=4,status='Active',updated_at=now();

  for v_site in 1..10 loop
    v_is_compliant := v_site <= 5;
    v_city := (array['الرياض','الرياض','جدة','جدة','الدمام','الخبر','الجبيل','ينبع','مكة المكرمة','المدينة المنورة'])[v_site];
    v_district := (array['الياسمين','السلي','الصفا','الخمرة','الفيصلية','الثقبة','الصناعية','ينبع الصناعية','العوالي','العزيزية'])[v_site];
    v_lat := (array[24.813600,24.589900,21.590100,21.405200,26.420700,26.217200,27.017400,24.088900,21.389100,24.470900])[v_site];
    v_lng := (array[46.636300,46.859000,39.166900,39.197900,50.088800,50.197100,49.658300,38.063700,39.857900,39.612200])[v_site];

    insert into public.housing_sites(company_id,code,name,housing_type,city,district,address,project_id,ownership_type,capacity,status,latitude,longitude,notes)
    values(v_company_id,'DEMO-H-'||lpad(v_site::text,3,'0'),
      'سكن '||v_city||' '||lpad(v_site::text,2,'0')||' / '||v_city||' Housing '||lpad(v_site::text,2,'0'),
      case when v_site in (4,8) then 'Mixed' else 'Workers' end,v_city,v_district,
      'موقع تجريبي - حي '||v_district,v_project_id,case when v_site%3=0 then 'Owned' else 'Rented' end,48,
      case when v_site=10 then 'Maintenance' else 'Active' end,v_lat,v_lng,
      case when v_is_compliant then 'سكن مطابق لمعيار المساحة والسلامة' else 'سكن تجريبي يحتوي ملاحظات امتثال مفتوحة' end)
    on conflict(company_id,code) do update set name=excluded.name,city=excluded.city,district=excluded.district,address=excluded.address,
      project_id=excluded.project_id,capacity=excluded.capacity,status=excluded.status,latitude=excluded.latitude,longitude=excluded.longitude,notes=excluded.notes,updated_at=now()
    returning id into v_site_id;

    insert into public.housing_buildings(company_id,site_id,code,name,floors_count,status)
    values(v_company_id,v_site_id,'BLD-A','المبنى A / Building A',3,case when v_site=10 then 'Maintenance' else 'Active' end)
    on conflict(site_id,code) do update set floors_count=3,status=excluded.status,updated_at=now()
    returning id into v_building_id;

    for v_floor in 1..3 loop
      insert into public.housing_floors(company_id,site_id,building_id,floor_number,name,status)
      values(v_company_id,v_site_id,v_building_id,v_floor,'الدور '||v_floor||' / Floor '||v_floor,'Active')
      on conflict(building_id,floor_number) do update set name=excluded.name,status='Active',updated_at=now()
      returning id into v_floor_id;

      for v_apartment in 1..2 loop
        insert into public.housing_apartments(company_id,site_id,building_id,floor_id,apartment_number,name,status)
        values(v_company_id,v_site_id,v_building_id,v_floor_id,(v_floor*100+v_apartment)::text,
          'شقة '||(v_floor*100+v_apartment)::text||' / Apartment '||(v_floor*100+v_apartment)::text,'Active')
        on conflict(floor_id,apartment_number) do update set name=excluded.name,status='Active',updated_at=now()
        returning id into v_apartment_id;

        for v_room in 1..2 loop
          insert into public.housing_rooms(company_id,site_id,building_id,apartment_id,room_number,floor_number,room_type,capacity,gender,status,air_conditioned,area_sqm,minimum_area_per_person_sqm,allowed_shift,preferred_project_id,notes)
          values(v_company_id,v_site_id,v_building_id,v_apartment_id,
            'F'||v_floor||'-A'||v_apartment||'-R'||v_room,v_floor,'Shared',4,'Male','Available',true,
            case when not v_is_compliant and v_floor=1 and v_apartment=1 and v_room=1 then 12 else 20 end,
            4,case when v_room=1 then 'Day' else 'Night' end,v_project_id,
            case when not v_is_compliant and v_floor=1 and v_apartment=1 and v_room=1 then 'المساحة القانونية 3 عمال مع وجود 4 أسرّة - تنبيه فقط' else 'غرفة مطابقة لمعيار 4 م² لكل عامل' end)
          on conflict(building_id,room_number) do update set apartment_id=excluded.apartment_id,area_sqm=excluded.area_sqm,
            minimum_area_per_person_sqm=4,allowed_shift=excluded.allowed_shift,preferred_project_id=excluded.preferred_project_id,notes=excluded.notes,updated_at=now()
          returning id into v_room_id;

          insert into public.housing_beds(company_id,site_id,room_id,bed_number,status)
          select v_company_id,v_site_id,v_room_id,'B-'||n,'Available' from generate_series(1,4) n
          on conflict(room_id,bed_number) do nothing;
        end loop;
      end loop;
    end loop;

    -- Four residents in the first room: compliant sites have 20 m²; non-compliant sites have 12 m².
    select r.id into v_room_id from public.housing_rooms r
    where r.site_id=v_site_id and r.room_number='F1-A1-R1';
    for v_worker in 1..4 loop
      insert into public.housing_employees(company_id,employee_no,full_name,nationality,profession,department,project_id,work_shift,preferred_language,status)
      values(v_company_id,'DEMO-E'||lpad(v_site::text,2,'0')||lpad(v_worker::text,2,'0'),
        'عامل تجريبي '||v_site||'-'||v_worker||' / Demo Worker '||v_site||'-'||v_worker,
        (array['Saudi','Indian','Egyptian','Filipino'])[v_worker],'Worker','Operations',v_project_id,
        case when v_worker%2=0 then 'Night' else 'Day' end,case when v_worker in (1,3) then 'ar' else 'en' end,'Active')
      on conflict(company_id,employee_no) do update set project_id=excluded.project_id,status='Active',updated_at=now()
      returning id into v_employee_id;

      select b.id into v_bed_id from public.housing_beds b
      where b.room_id=v_room_id and b.bed_number='B-'||v_worker;

      insert into public.housing_assignments(company_id,employee_id,site_id,room_id,bed_id,assignment_type,start_date,status,reason,compliance_snapshot,alignment_score)
      values(v_company_id,v_employee_id,v_site_id,v_room_id,v_bed_id,'CheckIn',current_date-(v_worker*3),'Active','Demo portfolio occupancy',
        jsonb_build_object('minimum_area_per_person_sqm',4,'room_area_sqm',case when v_is_compliant then 20 else 12 end,
          'occupants_after_assignment',v_worker,'legal_capacity',case when v_is_compliant then 4 else 3 end,
          'warning_issued',(not v_is_compliant and v_worker=4)),
        case when v_worker%2=0 then 90 else 100 end)
      on conflict(company_id,employee_id) where status='Active' do nothing;
      update public.housing_beds set status='Occupied' where id=v_bed_id;
    end loop;
    update public.housing_rooms set status='Full' where id=v_room_id;

    if not v_is_compliant and not exists(
      select 1 from public.housing_compliance_alerts where company_id=v_company_id and site_id=v_site_id and room_id=v_room_id and alert_type='Legal Occupancy Exceeded' and status='Open'
    ) then
      insert into public.housing_compliance_alerts(company_id,site_id,room_id,alert_type,severity,title,details,status)
      values(v_company_id,v_site_id,v_room_id,'Legal Occupancy Exceeded','High','تجاوز مساحة 4 م² لكل عامل / 4 m² occupancy exceeded',
        jsonb_build_object('room_area_sqm',12,'minimum_area_per_person_sqm',4,'occupants',4,'legal_capacity',3),'Open');
    end if;

    insert into public.housing_licenses(company_id,site_id,license_type,license_number,issuing_authority,issued_date,expiry_date,status)
    values(v_company_id,v_site_id,'Civil Defense','DEMO-CD-'||lpad(v_site::text,3,'0'),'الدفاع المدني',current_date-300,
      case when v_is_compliant then current_date+180 else current_date-(v_site-5) end,
      case when v_is_compliant then 'Active' else 'Expired' end)
    on conflict(company_id,license_type,license_number) do update set expiry_date=excluded.expiry_date,status=excluded.status,updated_at=now();

    insert into public.housing_hse_reports(company_id,site_id,report_no,inspection_date,checklist,score,critical_findings,corrective_action_due,status,notes)
    values(v_company_id,v_site_id,'DEMO-HSE-'||lpad(v_site::text,3,'0'),current_date-(v_site%7),
      case when v_is_compliant
        then '[{"item":"Fire extinguishers","result":"Passed"},{"item":"Emergency exits","result":"Passed"},{"item":"Ventilation","result":"Passed"}]'::jsonb
        else '[{"item":"Fire extinguishers","result":"Failed"},{"item":"Emergency exits","result":"Note"},{"item":"Ventilation","result":"Passed"}]'::jsonb end,
      case when v_is_compliant then 94-v_site else 62+(v_site-6)*3 end,
      case when v_is_compliant then 0 else 1 end,
      case when v_is_compliant then null else current_date+7 end,
      case when v_is_compliant then 'Closed' else 'Action Required' end,
      case when v_is_compliant then 'الفحص مطابق' else 'يتطلب إجراءً تصحيحيًا ومتابعة الترخيص والمساحة' end)
    on conflict(company_id,report_no) do update set inspection_date=excluded.inspection_date,score=excluded.score,
      critical_findings=excluded.critical_findings,corrective_action_due=excluded.corrective_action_due,status=excluded.status,notes=excluded.notes,updated_at=now();
  end loop;

  return jsonb_build_object(
    'sites',(select count(*) from public.housing_sites where company_id=v_company_id and code like 'DEMO-H-%'),
    'buildings',(select count(*) from public.housing_buildings b join public.housing_sites s on s.id=b.site_id where s.company_id=v_company_id and s.code like 'DEMO-H-%'),
    'floors',(select count(*) from public.housing_floors f join public.housing_sites s on s.id=f.site_id where s.company_id=v_company_id and s.code like 'DEMO-H-%'),
    'apartments',(select count(*) from public.housing_apartments a join public.housing_sites s on s.id=a.site_id where s.company_id=v_company_id and s.code like 'DEMO-H-%'),
    'rooms',(select count(*) from public.housing_rooms r join public.housing_sites s on s.id=r.site_id where s.company_id=v_company_id and s.code like 'DEMO-H-%'),
    'beds',(select count(*) from public.housing_beds b join public.housing_sites s on s.id=b.site_id where s.company_id=v_company_id and s.code like 'DEMO-H-%'),
    'residents',(select count(*) from public.housing_assignments a join public.housing_sites s on s.id=a.site_id where s.company_id=v_company_id and s.code like 'DEMO-H-%' and a.status='Active'),
    'non_compliant_sites',(select count(distinct site_id) from public.housing_compliance_alerts where company_id=v_company_id and status='Open' and site_id in (select id from public.housing_sites where code like 'DEMO-H-%')),
    'message','Demo housing portfolio is ready.'
  );
end $$;

grant execute on function public.housing_seed_demo_portfolio() to authenticated;
revoke execute on function public.housing_seed_demo_portfolio() from public,anon;
