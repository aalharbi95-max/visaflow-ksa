import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const USER_A = '10000000-0000-4000-8000-000000000001'
const USER_B = '10000000-0000-4000-8000-000000000002'
const USER_C = '10000000-0000-4000-8000-000000000003'

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
      ('${USER_C}','supervisor@example.com');
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
})

after(async () => { await db?.close() })

test('standalone migration creates all core housing tables', async () => {
  const result = await db.query(`
    select count(*)::int as count from information_schema.tables
    where table_schema='public' and table_name like 'housing_%'
  `)
  assert.equal(result.rows[0].count, 29)
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
