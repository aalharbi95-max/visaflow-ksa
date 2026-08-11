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
