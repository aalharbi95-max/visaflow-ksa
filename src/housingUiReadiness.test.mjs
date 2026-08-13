import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('housing UI provides persisted Arabic and English modes', async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL('./housingI18n.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housing.css', import.meta.url), 'utf8'),
  ])
  assert.match(source, /ar:\s*\{/)
  assert.match(source, /en:\s*\{/)
  assert.match(source, /housing-language/)
  assert.match(source, /document\.documentElement\.dir/)
  assert.match(source, /toggleLanguage/)
  assert.match(styles, /--housing-sidebar-width:\s*264px/)
  assert.match(styles, /inset-inline-start:\s*0/)
  assert.match(styles, /margin-inline-start:\s*var\(--housing-sidebar-width\)/)
  assert.match(styles, /width:\s*calc\(100%\s*-\s*var\(--housing-sidebar-width\)\)/)
  assert.match(styles, /max-width:\s*1384px/)
  assert.doesNotMatch(styles, /var\(--housing-sidebar\)/)
})

test('housing email confirmation returns to the housing application', async () => {
  const source = await readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8')
  assert.match(source, /new URL\('\/housing', window\.location\.origin\)/)
  assert.match(source, /emailRedirectUrl\.searchParams\.set\('invite', inviteToken\)/)
  assert.match(source, /emailRedirectTo/)
})

test('housing subscriptions require owner approval and expose an isolated owner portal', async () => {
  const [app, access, owner, main, migration] = await Promise.all([
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingAccess.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingOwnerApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0014_housing_owner_platform.sql', import.meta.url), 'utf8'),
  ])
  assert.match(app, /housing_submit_subscription_request/)
  assert.match(app, /allowRegistration=\{Boolean\(inviteToken\)\}/)
  assert.match(access, /طلب اشتراك جديد/)
  assert.match(owner, /housing_owner_review_request/)
  assert.match(owner, /housing_owner_set_company_status/)
  assert.match(main, /\/housing-owner/)
  assert.match(migration, /housing_subscription_requests/)
  assert.match(migration, /housing_is_platform_owner/)
  assert.match(migration, /Owner approval and a valid housing invitation are required/)
})

test('live housing views are wired to database data and Google Maps', async () => {
  const [source, service, migration] = await Promise.all([
    readFile(new URL('./HousingLiveViews.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housingService.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0007_housing_hierarchy_demo_portfolio.sql', import.meta.url), 'utf8'),
  ])
  assert.match(source, /data\.sites/)
  assert.match(source, /data\.rooms/)
  assert.match(source, /data\.assignments/)
  assert.match(source, /googleMapsUrl/)
  assert.match(source, /compliance_snapshot/)
  assert.doesNotMatch(source, /data\.alerts\.slice\(0,5\)/)
  assert.match(source, /siteHierarchy/)
  assert.match(source, /apartments/)
  assert.match(service, /listHousingFloors/)
  assert.match(service, /housing_apartments/)
  assert.match(migration, /housing_seed_demo_portfolio/)
})

test('workspace exposes the full test center and live modules', async () => {
  const [source, advanced, styles] = await Promise.all([
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingAdvancedModules.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housing.css', import.meta.url), 'utf8'),
  ])
  assert.match(source, /HousingTestCenter/)
  assert.match(source, /LiveDashboard/)
  assert.match(source, /LiveUtilities/)
  assert.match(source, /toggleLanguage/)
  assert.doesNotMatch(advanced, /reports\.slice\(0,5\)/)
  assert.doesNotMatch(advanced, /housing-scroll-list/)
  assert.match(styles, /max-height:\s*1000px/)
})

test('inventory and spare parts are connected to maintenance costs', async () => {
  const [app,page,service,migration]=await Promise.all([
    readFile(new URL('./HousingApp.jsx',import.meta.url),'utf8'), readFile(new URL('./HousingInventoryPage.jsx',import.meta.url),'utf8'),
    readFile(new URL('./housingService.mjs',import.meta.url),'utf8'), readFile(new URL('../supabase/housing/migrations/0012_inventory_spare_parts.sql',import.meta.url),'utf8'),
  ])
  assert.match(app,/HousingInventoryPage/); assert.match(page,/maintenanceRequestId/); assert.match(service,/housing_post_inventory_transaction/)
  assert.match(migration,/housing_inventory_balances/); assert.match(migration,/actual_cost=coalesce\(actual_cost,0\)/)
})

test('security and gate control covers visitors deliveries and asset passes', async()=>{
  const [app,page,service,migration]=await Promise.all([
    readFile(new URL('./HousingApp.jsx',import.meta.url),'utf8'),readFile(new URL('./HousingSecurityPage.jsx',import.meta.url),'utf8'),
    readFile(new URL('./housingService.mjs',import.meta.url),'utf8'),readFile(new URL('../supabase/housing/migrations/0013_security_gate_control.sql',import.meta.url),'utf8'),
  ])
  assert.match(app,/HousingSecurityPage/);assert.match(page,/Visitor/);assert.match(page,/Delivery/);assert.match(page,/Pass/)
  assert.match(service,/housing_gate_transition/);assert.match(migration,/housing_gate_visitors/);assert.match(migration,/housing_gate_deliveries/);assert.match(migration,/housing_gate_passes/)
})

test('visible housing action buttons are wired to forms, details, filters and exports', async () => {
  const [app, modules, liveViews, advanced, hook, modal, service] = await Promise.all([
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingModules.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingLiveViews.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingAdvancedModules.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./useHousingWorkspaceData.js', import.meta.url), 'utf8'),
    readFile(new URL('./HousingRecordModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housingService.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(app, /saveRecord/)
  assert.match(app, /onCreate=\{saveRecord\}/)
  assert.match(hook, /createRecord:/)
  assert.match(modules, /onClick=\{\(\)=>setModalOpen\(true\)\}/)
  assert.match(modules, /housing_inspections/)
  assert.match(modules, /exportHousingExcel/)
  assert.doesNotMatch(modules, /text\/csv/)
  assert.match(liveViews, /setActiveOnly/)
  assert.match(liveViews, /housing_utility_accounts/)
  assert.match(liveViews, /setSelectedSite/)
  assert.match(advanced, /setSelectedLicense/)
  assert.match(advanced, /onUploadAttachment/)
  assert.match(advanced, /housing-hse-upload/)
  assert.match(service, /housing-hse-attachments/)
  assert.match(service, /uploadHousingHseAttachment/)
  assert.match(advanced, /setSelected\(slot\)/)
  assert.match(modal, /onSave\(normalizeForm/)
})

test('scheduled inspections can be started, checked, scored and completed', async () => {
  const [workflow, modules, app, hook] = await Promise.all([
    readFile(new URL('./HousingInspectionWorkflow.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingModules.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./useHousingWorkspaceData.js', import.meta.url), 'utf8'),
  ])
  assert.match(workflow, /status: 'In Progress'/)
  assert.match(workflow, /status: 'Completed'/)
  assert.match(workflow, /STATUS_SCORE/)
  assert.match(workflow, /checklist/)
  assert.match(workflow, /completed_at/)
  assert.match(modules, /onRowClick=\{setSelected\}/)
  assert.match(app, /onUpdate=\{live\.updateInspection\}/)
  assert.match(hook, /updateInspection:/)
})

test('housing settings manage roles, invitations and assigned-site scopes', async () => {
  const [settings, service, app, migration] = await Promise.all([
    readFile(new URL('./HousingSettingsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housingService.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0005_users_roles_permissions.sql', import.meta.url), 'utf8'),
  ])
  assert.match(settings, /Invite User/)
  assert.match(settings, /Save Access/)
  assert.match(settings, /SiteChecks/)
  assert.match(service, /housing_create_user_invitation/)
  assert.match(service, /housing_update_user_access/)
  assert.match(app, /ROLE_PAGE_ACCESS/)
  assert.match(app, /housing_accept_user_invitation/)
  assert.match(migration, /housing_has_permission/)
  assert.match(migration, /housing_can_access_site/)
  assert.match(migration, /housing_profile_sites/)
})

test('housing contracts support preview and Ajeer details', async () => {
  const [modules, migration] = await Promise.all([
    readFile(new URL('./HousingModules.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0006_contract_ajeer_details.sql', import.meta.url), 'utf8'),
  ])
  assert.match(modules, /معاينة العقد/)
  assert.match(modules, /Preview Contract/)
  assert.match(modules, /ajeer_contract_number/)
  assert.match(modules, /ajeer_document_url/)
  assert.match(migration, /ajeer_expiry_date/)
  assert.match(migration, /housing_contracts_ajeer_status_check/)
})

test('workforce reconciliation is connected to imports, review and approved checkout', async () => {
  const [app, page, engine, service, migration] = await Promise.all([
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingReconciliationPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housingReconciliation.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./housingService.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0008_reconciliation_engine.sql', import.meta.url), 'utf8'),
  ])
  assert.match(app, /HousingReconciliationPage/)
  assert.match(page, /accept="\.xlsx,\.xls,\.csv"/)
  assert.match(page, /approveCheckout/)
  assert.match(engine, /Ghost Occupancy/)
  assert.match(engine, /Duplicate identifier/)
  assert.match(service, /saveHousingReconciliation/)
  assert.match(service, /housing_resolve_reconciliation_row/)
  assert.match(migration, /housing_audit_log/)
  assert.match(migration, /status='Ended'/)
})

test('employee leave and exit workflow requires supervisor-approved checkout', async () => {
  const [app, page, logic, service, migration] = await Promise.all([
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingEmployeeStatusPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housingEmployeeStatus.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./housingService.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0009_employee_leave_exit_workflow.sql', import.meta.url), 'utf8'),
  ])
  assert.match(app, /HousingEmployeeStatusPage/)
  assert.match(app, /employee-status/)
  assert.match(page, /Checkout Approved/)
  assert.match(page, /Return to Work/)
  assert.match(logic, /eventRequiresCheckout/)
  assert.match(service, /housing_create_employee_status_event/)
  assert.match(service, /housing_review_employee_status_event/)
  assert.match(migration, /status='Ended'/)
  assert.match(migration, /housing_audit_log/)
})

test('multi-channel housing notifications include secure queue, settings and delivery audit', async () => {
  const [app, page, service, migration, worker] = await Promise.all([
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingNotificationsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housingService.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0010_multichannel_notifications.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/housing-notification-dispatcher/index.ts', import.meta.url), 'utf8'),
  ])
  assert.match(app, /HousingNotificationsPage/)
  assert.match(app, /goTo\("notifications"\)/)
  assert.match(page, /WhatsApp/)
  assert.match(page, /Delivery Log/)
  assert.match(service, /housing_prepare_weekly_digest/)
  assert.match(migration, /housing_notification_deliveries/)
  assert.match(migration, /housing_notify_critical_incident/)
  assert.match(worker, /HOUSING_NOTIFICATION_WORKER_SECRET/)
  assert.match(worker, /RESEND_API_KEY/)
  assert.match(worker, /TWILIO_ACCOUNT_SID/)
})

test('cost centers and daily prorated allocation are connected to finance navigation and Supabase', async () => {
  const [app, page, service, migration] = await Promise.all([
    readFile(new URL('./HousingApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./HousingCostCentersPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./housingService.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/housing/migrations/0011_cost_centers_daily_allocation.sql', import.meta.url), 'utf8'),
  ])
  assert.match(app, /cost-centers/)
  assert.match(page, /generateHousingDailyCostAllocation/)
  assert.match(page, /exportHousingExcel/)
  assert.match(service, /housing_daily_cost_allocations/)
  assert.match(migration, /housing_generate_daily_cost_allocation/)
  assert.match(migration, /worker_days/)
  assert.match(migration, /cost_center_id/)
})
