-- Idempotent test dataset for an authenticated Housing administrator.

create or replace function public.housing_seed_test_data() returns jsonb
language plpgsql security invoker set search_path=public
as $$
declare
  v_company_id uuid:=public.housing_current_company_id();
  v_project_id uuid;
  v_site_id uuid;
  v_building_id uuid;
  v_room_small_id uuid;
  v_room_large_id uuid;
  v_employee_id uuid;
  v_utility_account_id uuid;
begin
  if v_company_id is null or not public.housing_can_manage() then raise exception 'Not authorized.'; end if;

  insert into public.housing_projects(company_id,code,name,city,status)
  values(v_company_id,'TST-PRJ','مشروع الاختبار / Test Project','الرياض','Active')
  on conflict(company_id,code) do update set name=excluded.name,updated_at=now()
  returning id into v_project_id;

  insert into public.housing_sites(company_id,code,name,housing_type,city,district,address,project_id,ownership_type,capacity,status,latitude,longitude,notes)
  values(v_company_id,'TST-H-001','سكن الاختبار / Test Housing','Workers','الرياض','الياسمين','موقع تجريبي للاختبار الشامل',v_project_id,'Managed',10,'Active',24.813600,46.636300,'Safe test dataset')
  on conflict(company_id,code) do update set project_id=excluded.project_id,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now()
  returning id into v_site_id;

  insert into public.housing_buildings(company_id,site_id,code,name,floors_count,status)
  values(v_company_id,v_site_id,'TST-A','مبنى الاختبار A / Test Building A',2,'Active')
  on conflict(site_id,code) do update set name=excluded.name,updated_at=now()
  returning id into v_building_id;

  insert into public.housing_rooms(company_id,site_id,building_id,room_number,floor_number,room_type,capacity,area_sqm,minimum_area_per_person_sqm,allowed_shift,status,notes)
  values(v_company_id,v_site_id,v_building_id,'TST-101',1,'Shared',4,12,4,'Day','Available','Legal capacity 3; physical beds 4 to test warning-only policy')
  on conflict(building_id,room_number) do update set capacity=excluded.capacity,area_sqm=excluded.area_sqm,minimum_area_per_person_sqm=excluded.minimum_area_per_person_sqm,allowed_shift=excluded.allowed_shift,updated_at=now()
  returning id into v_room_small_id;

  insert into public.housing_rooms(company_id,site_id,building_id,room_number,floor_number,room_type,capacity,area_sqm,minimum_area_per_person_sqm,allowed_shift,status,notes)
  values(v_company_id,v_site_id,v_building_id,'TST-102',1,'Shared',6,24,4,'Night','Available','Fully compliant room')
  on conflict(building_id,room_number) do update set capacity=excluded.capacity,area_sqm=excluded.area_sqm,minimum_area_per_person_sqm=excluded.minimum_area_per_person_sqm,allowed_shift=excluded.allowed_shift,updated_at=now()
  returning id into v_room_large_id;

  insert into public.housing_beds(company_id,site_id,room_id,bed_number)
  select v_company_id,v_site_id,v_room_small_id,'S-'||n from generate_series(1,4) n
  on conflict(room_id,bed_number) do nothing;
  insert into public.housing_beds(company_id,site_id,room_id,bed_number)
  select v_company_id,v_site_id,v_room_large_id,'L-'||n from generate_series(1,6) n
  on conflict(room_id,bed_number) do nothing;

  insert into public.housing_employees(company_id,employee_no,full_name,nationality,profession,department,project_id,work_shift,preferred_language,status)
  values
    (v_company_id,'TST-E001','أحمد علي / Ahmed Ali','Saudi','Supervisor','Operations',v_project_id,'Day','ar','Active'),
    (v_company_id,'TST-E002','Ravi Kumar','Indian','Electrician','Maintenance',v_project_id,'Day','hi','Active'),
    (v_company_id,'TST-E003','Mohammed Ismail','Egyptian','Technician','Operations',v_project_id,'Day','ar','Active'),
    (v_company_id,'TST-E004','Arjun Singh','Indian','Worker','Operations',v_project_id,'Day','hi','Active'),
    (v_company_id,'TST-E005','John Peter','Filipino','Cook','Catering',v_project_id,'Night','en','Active')
  on conflict(company_id,employee_no) do update set project_id=excluded.project_id,work_shift=excluded.work_shift,preferred_language=excluded.preferred_language,updated_at=now();
  select id into v_employee_id from public.housing_employees where company_id=v_company_id and employee_no='TST-E001';

  insert into public.housing_maintenance_requests(company_id,request_no,site_id,room_id,category,title,description,priority,status,due_at,estimated_cost)
  values(v_company_id,'TST-MNT-001',v_site_id,v_room_small_id,'Air Conditioning','اختبار صيانة المكيف / AC maintenance test','Test maintenance workflow','High','Open',now()+interval '2 days',500)
  on conflict(company_id,request_no) do update set status='Open',updated_at=now();

  insert into public.housing_inspections(company_id,inspection_no,site_id,room_id,inspection_type,scheduled_date,inspector_name,score,status,result,summary)
  values(v_company_id,'TST-INS-001',v_site_id,v_room_small_id,'Safety & Hygiene',current_date,'Test Inspector',92,'Completed','Passed with Notes','Test inspection workflow')
  on conflict(company_id,inspection_no) do update set scheduled_date=current_date,score=92,updated_at=now();

  insert into public.housing_assets(company_id,asset_no,site_id,room_id,category,name,brand,serial_number,purchase_cost,condition,status)
  values(v_company_id,'TST-AST-001',v_site_id,v_room_small_id,'Air Conditioning','مكيف اختبار / Test AC','Test Brand','TST-SN-001',2500,'Good','In Service')
  on conflict(company_id,asset_no) do update set condition='Good',status='In Service',updated_at=now();

  insert into public.housing_contracts(company_id,contract_no,site_id,contract_type,landlord_name,start_date,end_date,annual_value,payment_frequency,next_payment_date,status)
  values(v_company_id,'TST-CTR-001',v_site_id,'Lease','Test Landlord',current_date,current_date+365,120000,'Quarterly',current_date+90,'Active')
  on conflict(company_id,contract_no) do update set end_date=current_date+365,status='Active',updated_at=now();

  insert into public.housing_utility_accounts(company_id,site_id,utility_type,provider_name,account_number,meter_number,integration_mode,status)
  values(v_company_id,v_site_id,'Electricity','Test Electricity Provider','TST-UTIL-001','TST-METER-001','Manual','Active')
  on conflict(company_id,provider_name,account_number) do update set status='Active',updated_at=now()
  returning id into v_utility_account_id;

  insert into public.housing_utility_bills(company_id,utility_account_id,bill_number,period_start,period_end,issue_date,due_date,consumption,subtotal,vat_amount,total_amount,status,source)
  values(v_company_id,v_utility_account_id,'TST-BILL-001',date_trunc('month',current_date)::date,current_date,current_date,current_date+15,1250,1000,150,1150,'Due','Manual')
  on conflict(utility_account_id,period_start,period_end) do update set due_date=current_date+15,total_amount=1150,status='Due',updated_at=now();

  insert into public.housing_incidents(company_id,incident_no,site_id,room_id,employee_id,incident_type,severity,occurred_at,description,status)
  values(v_company_id,'TST-INC-001',v_site_id,v_room_small_id,v_employee_id,'Safety Violation','Medium',now(),'Test worker-linked incident','Open')
  on conflict(company_id,incident_no) do update set status='Open',updated_at=now();

  insert into public.housing_compliance_rules(company_id,rule_code,category,title,minimum_area_per_person_sqm,source_authority,status)
  values(v_company_id,'AREA-4M2','Occupancy','4 م² لكل عامل / 4 m² per worker',4,'Configured for system testing','Active')
  on conflict(company_id,rule_code) do update set minimum_area_per_person_sqm=4,updated_at=now();

  insert into public.housing_licenses(company_id,site_id,license_type,license_number,issuing_authority,issued_date,expiry_date,status)
  values(v_company_id,v_site_id,'Civil Defense','TST-CD-001','Test Authority',current_date-300,current_date+30,'Renewal Due')
  on conflict(company_id,license_type,license_number) do update set expiry_date=current_date+30,status='Renewal Due',updated_at=now();

  insert into public.housing_hse_reports(company_id,site_id,report_no,inspection_date,checklist,attachments,score,critical_findings,status,notes)
  values(v_company_id,v_site_id,'TST-HSE-001',current_date,
    '[{"item":"Fire extinguishers","result":"Passed"},{"item":"Emergency exits","result":"Passed"},{"item":"Ventilation","result":"Note"}]'::jsonb,
    '[]'::jsonb,92,0,'Submitted','Test HSE report')
  on conflict(company_id,report_no) do update set inspection_date=current_date,score=92,updated_at=now();

  if not exists(select 1 from public.housing_operation_schedules where company_id=v_company_id and site_id=v_site_id and schedule_date=current_date and operation_type='Dinner') then
    insert into public.housing_operation_schedules(company_id,site_id,operation_type,schedule_date,slot_start,slot_end,project_id,shift,building_id,planned_people,slot_capacity,status)
    values(v_company_id,v_site_id,'Dinner',current_date,'18:00','19:00',v_project_id,'Day',v_building_id,5,50,'Scheduled');
  end if;

  if not exists(select 1 from public.housing_welfare_surveys where company_id=v_company_id and title='اختبار الرفاهية / Welfare Test') then
    insert into public.housing_welfare_surveys(company_id,site_id,title,languages,questions,opens_at,closes_at,anonymous,status)
    values(v_company_id,v_site_id,'اختبار الرفاهية / Welfare Test',array['ar','en'],
      '[{"key":"food","ar":"كيف تقيم جودة الطعام؟","en":"How do you rate food quality?"},{"key":"cleanliness","ar":"كيف تقيم النظافة؟","en":"How do you rate cleanliness?"}]'::jsonb,
      now(),now()+interval '30 days',true,'Open');
  end if;

  return jsonb_build_object(
    'site_id',v_site_id,
    'rooms',(select count(*) from public.housing_rooms where site_id=v_site_id),
    'beds',(select count(*) from public.housing_beds where site_id=v_site_id),
    'employees',(select count(*) from public.housing_employees where company_id=v_company_id and employee_no like 'TST-%'),
    'maintenance',(select count(*) from public.housing_maintenance_requests where company_id=v_company_id and request_no like 'TST-%'),
    'assets',(select count(*) from public.housing_assets where company_id=v_company_id and asset_no like 'TST-%'),
    'contracts',(select count(*) from public.housing_contracts where company_id=v_company_id and contract_no like 'TST-%'),
    'message','Test data is ready.'
  );
end $$;

grant execute on function public.housing_seed_test_data() to authenticated;
revoke execute on function public.housing_seed_test_data() from public,anon;
