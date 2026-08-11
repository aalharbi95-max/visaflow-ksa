import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const USER_A = '10000000-0000-4000-8000-000000000001'
const USER_B = '10000000-0000-4000-8000-000000000002'
const USER_C = '10000000-0000-4000-8000-000000000003'
const USER_D = '10000000-0000-4000-8000-000000000004'

let db

async function setActor(userId) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1::text,false)", [userId])
}

async function asUser(userId, callback) {
  await setActor(userId)
  await db.exec('set role authenticated')
  try { return await callback() } finally { await db.exec('reset role') }
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth;
    create schema storage;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table auth.users(id uuid primary key,email text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name,'/'))[1:greatest(array_length(string_to_array(name,'/'),1)-1,0)]
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant usage on schema storage to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values
      ('${USER_A}','admin-a@example.com'),
      ('${USER_B}','admin-b@example.com'),
      ('${USER_C}','supervisor@example.com'),
      ('${USER_D}','cost-admin@example.com');
  `)
  const migration = await readFile(new URL('../supabase/housing/migrations/0001_housing_initial.sql', import.meta.url), 'utf8')
  // Supabase provides pgcrypto. PGlite already provides gen_random_uuid but
  // does not package the extension control file itself.
  await db.exec(migration.replace('create extension if not exists pgcrypto;', ''))
  const advancedMigration = await readFile(new URL('../supabase/housing/migrations/0002_compliance_smart_occupancy_welfare.sql', import.meta.url), 'utf8')
  await db.exec(advancedMigration)
  const readinessMigration = await readFile(new URL('../supabase/housing/migrations/0004_test_readiness.sql', import.meta.url), 'utf8')
  await db.exec(readinessMigration)
  const permissionsMigration = await readFile(new URL('../supabase/housing/migrations/0005_users_roles_permissions.sql', import.meta.url), 'utf8')
  await db.exec(permissionsMigration)
  const ajeerMigration = await readFile(new URL('../supabase/housing/migrations/0006_contract_ajeer_details.sql', import.meta.url), 'utf8')
  await db.exec(ajeerMigration)
  const hierarchyMigration = await readFile(new URL('../supabase/housing/migrations/0007_housing_hierarchy_demo_portfolio.sql', import.meta.url), 'utf8')
  await db.exec(hierarchyMigration)
  const reconciliationMigration = await readFile(new URL('../supabase/housing/migrations/0008_reconciliation_engine.sql', import.meta.url), 'utf8')
  await db.exec(reconciliationMigration)
  const employeeStatusMigration = await readFile(new URL('../supabase/housing/migrations/0009_employee_leave_exit_workflow.sql', import.meta.url), 'utf8')
  await db.exec(employeeStatusMigration)
  const notificationMigration = await readFile(new URL('../supabase/housing/migrations/0010_multichannel_notifications.sql', import.meta.url), 'utf8')
  await db.exec(notificationMigration)
  const costAllocationMigration = await readFile(new URL('../supabase/housing/migrations/0011_cost_centers_daily_allocation.sql', import.meta.url), 'utf8')
  await db.exec(costAllocationMigration)
  const inventoryMigration = await readFile(new URL('../supabase/housing/migrations/0012_inventory_spare_parts.sql', import.meta.url), 'utf8')
  await db.exec(inventoryMigration)
})

after(async () => { await db?.close() })

test('standalone migration creates all core housing tables', async () => {
  const result = await db.query(`
    select count(*)::int as count from information_schema.tables
    where table_schema='public' and table_name like 'housing_%'
  `)
  assert.equal(result.rows[0].count, 44)
})

test('inventory receipt and maintenance issue update stock and actual cost', async () => {
  await asUser(USER_D, () => db.query("select public.housing_create_workspace('Cost Company','Cost Admin')"))
  const company = await asUser(USER_D, () => db.query('select public.housing_current_company_id() as id'))
  const companyId = company.rows[0].id
  const site = await asUser(USER_D, () => db.query("insert into public.housing_sites(company_id,code,name,city) values($1,'INV-S','Inventory Site','Riyadh') returning id", [companyId]))
  const location = await asUser(USER_D, () => db.query("insert into public.housing_inventory_locations(company_id,site_id,code,name) values($1,$2,'INV-WH','Inventory Warehouse') returning id", [companyId,site.rows[0].id]))
  const item = await asUser(USER_D, () => db.query("insert into public.housing_inventory_items(company_id,sku,name,unit_cost,reorder_level) values($1,'INV-VALVE','Valve',25,2) returning id", [companyId]))
  const request = await asUser(USER_D, () => db.query("insert into public.housing_maintenance_requests(company_id,site_id,request_no,category,title,status) values($1,$2,'MR-INV','Plumbing','Repair valve','Open') returning id", [companyId,site.rows[0].id]))
  await asUser(USER_D, () => db.query("select public.housing_post_inventory_transaction($1,$2,'Receipt',10,25,null,'PO-1',null,$3)", [location.rows[0].id,item.rows[0].id,'81000000-0000-4000-8000-000000000001']))
  await asUser(USER_D, () => db.query("select public.housing_post_inventory_transaction($1,$2,'Issue',3,25,$3,'MR-INV',null,$4)", [location.rows[0].id,item.rows[0].id,request.rows[0].id,'81000000-0000-4000-8000-000000000002']))
  const balance = await asUser(USER_D, () => db.query('select quantity from public.housing_inventory_balances where location_id=$1 and item_id=$2',[location.rows[0].id,item.rows[0].id]))
  const maintenance = await asUser(USER_D, () => db.query('select actual_cost from public.housing_maintenance_requests where id=$1',[request.rows[0].id]))
  assert.equal(Number(balance.rows[0].quantity),7)
  assert.equal(Number(maintenance.rows[0].actual_cost),75)
})

test('daily cost allocation follows assignment dates and project cost centers', async () => {
  const company = await asUser(USER_D, () => db.query('select public.housing_current_company_id() as id'))
  const companyId = company.rows[0].id
  const projectA = await asUser(USER_D, () => db.query("insert into public.housing_projects(company_id,code,name) values($1,'COST-A','Cost Project A') returning id", [companyId]))
  const projectB = await asUser(USER_D, () => db.query("insert into public.housing_projects(company_id,code,name) values($1,'COST-B','Cost Project B') returning id", [companyId]))
  const centerA = await asUser(USER_D, () => db.query("insert into public.housing_cost_centers(company_id,code,name,project_id) values($1,'CC-A','Center A',$2) returning id", [companyId, projectA.rows[0].id]))
  const centerB = await asUser(USER_D, () => db.query("insert into public.housing_cost_centers(company_id,code,name,project_id) values($1,'CC-B','Center B',$2) returning id", [companyId, projectB.rows[0].id]))
  const site = await asUser(USER_D, () => db.query("insert into public.housing_sites(company_id,code,name,city) values($1,'COST-S','Cost Site','Riyadh') returning id", [companyId]))
  const building = await asUser(USER_D, () => db.query("insert into public.housing_buildings(company_id,site_id,code,name) values($1,$2,'A','A') returning id", [companyId, site.rows[0].id]))
  const room = await asUser(USER_D, () => db.query("insert into public.housing_rooms(company_id,site_id,building_id,room_number,capacity,area_sqm) values($1,$2,$3,'101',2,8) returning id", [companyId, site.rows[0].id, building.rows[0].id]))
  const beds = await asUser(USER_D, () => db.query("insert into public.housing_beds(company_id,site_id,room_id,bed_number) values($1,$2,$3,'1'),($1,$2,$3,'2') returning id", [companyId, site.rows[0].id, room.rows[0].id]))
  const workers = await asUser(USER_D, () => db.query("insert into public.housing_employees(company_id,employee_no,full_name,project_id) values($1,'COST-E1','Worker A',$2),($1,'COST-E2','Worker B',$3) returning id", [companyId, projectA.rows[0].id, projectB.rows[0].id]))
  await asUser(USER_D, async () => {
    await db.query("insert into public.housing_assignments(company_id,employee_id,site_id,room_id,bed_id,start_date,end_date,status,project_id,cost_center_id) values($1,$2,$3,$4,$5,'2026-08-01','2026-08-02','Ended',$6,$7),($1,$8,$3,$4,$9,'2026-08-02','2026-08-02','Ended',$10,$11)", [companyId,workers.rows[0].id,site.rows[0].id,room.rows[0].id,beds.rows[0].id,projectA.rows[0].id,centerA.rows[0].id,workers.rows[1].id,beds.rows[1].id,projectB.rows[0].id,centerB.rows[0].id])
    await db.query("insert into public.housing_cost_entries(company_id,site_id,category,description,period_start,period_end,amount) values($1,$2,'Catering','Meals','2026-08-01','2026-08-02',300)", [companyId,site.rows[0].id])
  })
  const run = await asUser(USER_D, () => db.query("select public.housing_generate_daily_cost_allocation('2026-08-01','2026-08-02') as id"))
  const totals = await asUser(USER_D, () => db.query('select total_cost,allocated_cost,unallocated_cost,worker_days from public.housing_cost_allocation_runs where id=$1', [run.rows[0].id]))
  assert.deepEqual(totals.rows[0], { total_cost: '300.00', allocated_cost: '300.00', unallocated_cost: '0.00', worker_days: 3 })
  const centers = await asUser(USER_D, () => db.query('select cost_center_id,round(sum(amount),2) amount from public.housing_daily_cost_allocations where run_id=$1 group by cost_center_id order by amount desc', [run.rows[0].id]))
  assert.deepEqual(centers.rows, [{ cost_center_id: centerA.rows[0].id, amount: '225.00' }, { cost_center_id: centerB.rows[0].id, amount: '75.00' }])
  await asUser(USER_D, async () => {
    await db.query("delete from public.housing_assignments where employee_id in ($1,$2)", [workers.rows[0].id,workers.rows[1].id])
    await db.query('delete from public.housing_sites where id=$1', [site.rows[0].id])
    await db.query("delete from public.housing_employees where employee_no in ('COST-E1','COST-E2')")
    await db.query("delete from public.housing_cost_centers where code in ('CC-A','CC-B')")
    await db.query("delete from public.housing_projects where code in ('COST-A','COST-B')")
  })
})

test('reconciliation schema supports reviewed checkout without automatic eviction', async () => {
  const tables = await db.query("select table_name from information_schema.tables where table_schema='public' and table_name like 'housing_reconciliation_%' order by table_name")
  assert.deepEqual(tables.rows.map((row) => row.table_name), ['housing_reconciliation_imports','housing_reconciliation_rows'])
  const functionResult = await db.query("select count(*)::int as count from pg_proc where proname='housing_resolve_reconciliation_row'")
  assert.equal(functionResult.rows[0].count, 1)
})

test('first authenticated user can create an isolated workspace', async () => {
  const created = await asUser(USER_A, () => db.query(
    "select public.housing_create_workspace('شركة ألف','مدير ألف') as workspace"
  ))
  assert.equal(created.rows[0].workspace.role, 'Admin')

  const context = await asUser(USER_A, () => db.query('select public.get_housing_context() as context'))
  assert.equal(context.rows[0].context.company.name, 'شركة ألف')
  assert.equal(context.rows[0].context.profile.full_name, 'مدير ألف')
})

test('critical incidents create in-app events and queued external deliveries once', async () => {
  const company = await asUser(USER_A, () => db.query('select public.housing_current_company_id() as id'))
  const companyId = company.rows[0].id
  const site = await asUser(USER_A, () => db.query("insert into public.housing_sites(company_id,code,name,city) values($1,'NOTIFY-1','Notification Site','Riyadh') returning id", [companyId]))
  await asUser(USER_A, () => db.query("insert into public.housing_notification_settings(company_id,email_enabled,critical_incident_channels) values($1,true,array['In App','Email'])", [companyId]))
  await asUser(USER_A, () => db.query("insert into public.housing_notification_recipients(company_id,name,email,channels) values($1,'HSE Manager','hse@example.com',array['In App','Email'])", [companyId]))
  const incident = await asUser(USER_A, () => db.query("insert into public.housing_incidents(company_id,incident_no,site_id,incident_type,severity,occurred_at,description) values($1,'INC-N-1',$2,'Fire','Critical',now(),'Fire alarm') returning id", [companyId, site.rows[0].id]))
  const events = await asUser(USER_A, () => db.query("select id,status from public.housing_notification_events where source_id=$1", [incident.rows[0].id]))
  assert.equal(events.rows.length, 1)
  const deliveries = await asUser(USER_A, () => db.query("select channel,status,destination from public.housing_notification_deliveries where event_id=$1", [events.rows[0].id]))
  assert.deepEqual(deliveries.rows[0], { channel: 'Email', status: 'Queued', destination: 'hse@example.com' })
  await asUser(USER_A, () => db.query('select public.housing_mark_notification_read($1)', [events.rows[0].id]))
  assert.equal((await asUser(USER_A, () => db.query('select status from public.housing_notification_events where id=$1', [events.rows[0].id]))).rows[0].status, 'Read')
  await asUser(USER_A, () => db.query('delete from public.housing_sites where id=$1', [site.rows[0].id]))
  await asUser(USER_A, () => db.query('delete from public.housing_notification_recipients where company_id=$1', [companyId]))
})

test('approved final exit ends housing assignment and releases the bed', async () => {
  const company = await asUser(USER_A, () => db.query('select public.housing_current_company_id() as id'))
  const companyId = company.rows[0].id
  const site = await asUser(USER_A, () => db.query("insert into public.housing_sites(company_id,code,name,city) values($1,'LEAVE-1','Leave Site','Riyadh') returning id", [companyId]))
  const building = await asUser(USER_A, () => db.query("insert into public.housing_buildings(company_id,site_id,code,name) values($1,$2,'A','A') returning id", [companyId, site.rows[0].id]))
  const room = await asUser(USER_A, () => db.query("insert into public.housing_rooms(company_id,site_id,building_id,room_number,capacity,area_sqm) values($1,$2,$3,'101',1,4) returning id", [companyId, site.rows[0].id, building.rows[0].id]))
  const bed = await asUser(USER_A, () => db.query("insert into public.housing_beds(company_id,site_id,room_id,bed_number) values($1,$2,$3,'1') returning id", [companyId, site.rows[0].id, room.rows[0].id]))
  const employee = await asUser(USER_A, () => db.query("insert into public.housing_employees(company_id,employee_no,full_name) values($1,'LEAVE-E1','Leaving Worker') returning id", [companyId]))
  const assignment = await asUser(USER_A, () => db.query('select id from public.housing_assign_employee($1,$2)', [employee.rows[0].id, bed.rows[0].id]))
  const created = await asUser(USER_A, () => db.query("select * from public.housing_create_employee_status_event($1,'Final Exit','2026-08-11',null,'HR','VISA-1')", [employee.rows[0].id]))
  assert.equal(created.rows[0].checkout_required, true)
  assert.equal(created.rows[0].assignment_id, assignment.rows[0].id)
  await asUser(USER_A, () => db.query("select public.housing_review_employee_status_event($1,'Checkout Approved','Final exit approved')", [created.rows[0].id]))
  const released = await asUser(USER_A, () => db.query('select a.status as assignment_status,b.status as bed_status from public.housing_assignments a join public.housing_beds b on b.id=a.bed_id where a.id=$1', [assignment.rows[0].id]))
  assert.deepEqual(released.rows[0], { assignment_status: 'Ended', bed_status: 'Available' })
  const audit = await asUser(USER_A, () => db.query("select count(*)::int as count from public.housing_audit_log where entity_id=$1 and action='EMPLOYEE_STATUS_EVENT_REVIEWED'", [created.rows[0].id]))
  assert.equal(audit.rows[0].count, 1)
  await asUser(USER_A, async () => {
    await db.query('delete from public.housing_employee_status_events where id=$1', [created.rows[0].id])
    await db.query('delete from public.housing_assignments where id=$1', [assignment.rows[0].id])
    await db.query('delete from public.housing_sites where id=$1', [site.rows[0].id])
    await db.query("delete from public.housing_employees where employee_no='LEAVE-E1'")
  })
})

test('administrator can invite a scoped user and change their role', async () => {
  const company = await asUser(USER_A, () => db.query('select public.housing_current_company_id() as id'))
  const site = await asUser(USER_A, () => db.query("insert into public.housing_sites(company_id,code,name,city) values($1,'ACCESS-1','Scoped Site','Riyadh') returning id", [company.rows[0].id]))
  const invite = await asUser(USER_A, () => db.query("select public.housing_create_user_invitation('supervisor@example.com','Site Supervisor','Housing Supervisor',array[$1]::uuid[]) as value", [site.rows[0].id]))
  await asUser(USER_C, () => db.query('select public.housing_accept_user_invitation($1)', [invite.rows[0].value.token]))
  const context = await asUser(USER_C, () => db.query('select public.get_housing_context() as context'))
  assert.equal(context.rows[0].context.profile.role, 'Housing Supervisor')
  const scoped = await asUser(USER_C, () => db.query('select public.housing_can_access_site($1) as allowed', [site.rows[0].id]))
  assert.equal(scoped.rows[0].allowed, true)
  await asUser(USER_A, () => db.query("select public.housing_update_user_access($1,'Maintenance','Active',array[$2]::uuid[])", [USER_C, site.rows[0].id]))
  const permissions = await asUser(USER_C, () => db.query("select public.housing_has_permission('maintenance','manage') as maintenance,public.housing_has_permission('finance','manage') as finance"))
  assert.equal(permissions.rows[0].maintenance, true)
  assert.equal(permissions.rows[0].finance, false)
})

test('housing contracts store Ajeer registration and expiry details', async () => {
  const columns = await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='housing_contracts' and column_name like 'ajeer_%' order by column_name")
  assert.deepEqual(columns.rows.map((row)=>row.column_name), ['ajeer_contract_number','ajeer_document_url','ajeer_expiry_date','ajeer_issue_date','ajeer_provider_name','ajeer_service_type','ajeer_status'])
})

test('rooms calculate a legal capacity from area and configured beds', async () => {
  const company = await asUser(USER_A, () => db.query('select public.housing_current_company_id() as id'))
  const result = await asUser(USER_A, () => db.query(`
    with site as (
      insert into public.housing_sites(company_id,code,name,city) values($1,'LEGAL-1','Legal Site','Riyadh') returning id
    ), building as (
      insert into public.housing_buildings(company_id,site_id,code,name) select $1,id,'A','A' from site returning id,site_id
    )
    insert into public.housing_rooms(company_id,site_id,building_id,room_number,capacity,area_sqm,minimum_area_per_person_sqm)
    select $1,site_id,id,'101',6,18,4 from building returning legal_capacity
  `, [company.rows[0].id]))
  assert.equal(result.rows[0].legal_capacity, 4)
  await asUser(USER_A, () => db.query("delete from public.housing_sites where code='LEGAL-1'"))
})

test('4 m2 per worker threshold records an alert without blocking assignment', async () => {
  const company = await asUser(USER_A, () => db.query('select public.housing_current_company_id() as id'))
  const companyId = company.rows[0].id
  const site = await asUser(USER_A, () => db.query("insert into public.housing_sites(company_id,code,name,city) values($1,'WARN-1','Warning Site','Riyadh') returning id", [companyId]))
  const siteId = site.rows[0].id
  const building = await asUser(USER_A, () => db.query("insert into public.housing_buildings(company_id,site_id,code,name) values($1,$2,'A','A') returning id", [companyId, siteId]))
  const room = await asUser(USER_A, () => db.query("insert into public.housing_rooms(company_id,site_id,building_id,room_number,capacity,area_sqm) values($1,$2,$3,'101',2,4) returning id,legal_capacity", [companyId, siteId, building.rows[0].id]))
  assert.equal(room.rows[0].legal_capacity, 1)
  const beds = await asUser(USER_A, () => db.query("insert into public.housing_beds(company_id,site_id,room_id,bed_number) values($1,$2,$3,'1'),($1,$2,$3,'2') returning id,bed_number", [companyId, siteId, room.rows[0].id]))
  const employees = await asUser(USER_A, () => db.query("insert into public.housing_employees(company_id,employee_no,full_name) values($1,'WARN-E1','Worker 1'),($1,'WARN-E2','Worker 2') returning id,employee_no", [companyId]))
  await asUser(USER_A, () => db.query('select public.housing_assign_employee($1,$2)', [employees.rows[0].id, beds.rows[0].id]))
  await asUser(USER_A, () => db.query('select public.housing_assign_employee($1,$2)', [employees.rows[1].id, beds.rows[1].id]))
  const second = await asUser(USER_A, () => db.query("select compliance_snapshot from public.housing_assignments where employee_id=$1 and status='Active'", [employees.rows[1].id]))
  assert.equal(second.rows[0].compliance_snapshot.warning_issued, true)
  const alerts = await asUser(USER_A, () => db.query("select count(*)::int as count from public.housing_compliance_alerts where room_id=$1 and status='Open'", [room.rows[0].id]))
  assert.equal(alerts.rows[0].count, 1)
  await asUser(USER_A, async () => {
    await db.query('delete from public.housing_compliance_alerts where room_id=$1', [room.rows[0].id])
    await db.query('delete from public.housing_assignments where room_id=$1', [room.rows[0].id])
    await db.query('delete from public.housing_sites where id=$1', [siteId])
    await db.query("delete from public.housing_employees where employee_no in ('WARN-E1','WARN-E2')")
  })
})

test('test dataset is idempotent and creates a full workflow fixture', async () => {
  const first = await asUser(USER_A, () => db.query('select public.housing_seed_test_data() as result'))
  const second = await asUser(USER_A, () => db.query('select public.housing_seed_test_data() as result'))
  assert.equal(first.rows[0].result.rooms, 2)
  assert.equal(first.rows[0].result.beds, 10)
  assert.equal(second.rows[0].result.employees, 5)
})

test('demo portfolio creates ten hierarchical sites with mixed compliance', async () => {
  const first = await asUser(USER_A, () => db.query('select public.housing_seed_demo_portfolio() as result'))
  const second = await asUser(USER_A, () => db.query('select public.housing_seed_demo_portfolio() as result'))
  assert.equal(first.rows[0].result.sites, 10)
  assert.equal(first.rows[0].result.buildings, 10)
  assert.equal(first.rows[0].result.floors, 30)
  assert.equal(first.rows[0].result.apartments, 60)
  assert.equal(first.rows[0].result.rooms, 120)
  assert.equal(first.rows[0].result.beds, 480)
  assert.equal(first.rows[0].result.residents, 40)
  assert.equal(first.rows[0].result.non_compliant_sites, 5)
  assert.deepEqual(second.rows[0].result, first.rows[0].result)
})

test('row-level security isolates companies', async () => {
  await asUser(USER_B, () => db.query(
    "select public.housing_create_workspace('شركة باء','مدير باء')"
  ))

  const companyA = await asUser(USER_A, () => db.query('select public.housing_current_company_id() as id'))
  const companyB = await asUser(USER_B, () => db.query('select public.housing_current_company_id() as id'))

  await asUser(USER_A, () => db.query(`
    insert into public.housing_sites(company_id,code,name,city)
    values($1,'A-01','سكن ألف','الرياض')
  `, [companyA.rows[0].id]))
  await asUser(USER_B, () => db.query(`
    insert into public.housing_sites(company_id,code,name,city)
    values($1,'B-01','سكن باء','جدة')
  `, [companyB.rows[0].id]))

  const visibleA = await asUser(USER_A, () => db.query("select code from public.housing_sites where code='A-01'"))
  const visibleB = await asUser(USER_B, () => db.query('select code from public.housing_sites'))
  assert.deepEqual(visibleA.rows.map(row => row.code), ['A-01'])
  assert.deepEqual(visibleB.rows.map(row => row.code), ['B-01'])
})
