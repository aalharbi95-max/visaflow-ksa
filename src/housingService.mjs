const SITE_STATUSES = new Set(['Draft', 'Active', 'Full', 'Maintenance', 'Inactive'])
const SITE_TYPES = new Set(['Workers', 'Employees', 'Families', 'Management', 'Mixed'])

function clean(value) {
  return String(value ?? '').trim()
}

function required(value, fieldLabel) {
  const normalized = clean(value)
  if (!normalized) throw new Error(`${fieldLabel} is required.`)
  return normalized
}

export function buildHousingSitePayload(input = {}, companyId) {
  const capacity = Number(input.capacity || 0)
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new Error('Capacity must be a non-negative integer.')
  }

  const housingType = clean(input.housing_type) || 'Workers'
  const status = clean(input.status) || 'Active'
  if (!SITE_TYPES.has(housingType)) throw new Error('Unsupported housing type.')
  if (!SITE_STATUSES.has(status)) throw new Error('Unsupported housing status.')

  const latitude = input.latitude === '' || input.latitude == null ? null : Number(input.latitude)
  const longitude = input.longitude === '' || input.longitude == null ? null : Number(input.longitude)
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new Error('Latitude is invalid.')
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new Error('Longitude is invalid.')

  return {
    company_id: required(companyId, 'Company'),
    code: required(input.code, 'Housing code'),
    name: required(input.name, 'Housing name'),
    housing_type: housingType,
    city: required(input.city, 'City'),
    district: clean(input.district) || null,
    address: clean(input.address) || null,
    ownership_type: clean(input.ownership_type) || 'Rented',
    capacity,
    status,
    notes: clean(input.notes) || null,
    latitude,
    longitude,
  }
}

function throwIfError(result, fallbackMessage) {
  if (result?.error) {
    const error = new Error(result.error.message || fallbackMessage)
    error.code = result.error.code
    throw error
  }
  return result?.data
}

export async function getHousingSession(client) {
  return throwIfError(await client.auth.getSession(), 'Unable to read the current session.')?.session || null
}

export async function signInHousing(client, email, password) {
  return throwIfError(
    await client.auth.signInWithPassword({ email: required(email, 'Email'), password: required(password, 'Password') }),
    'Unable to sign in.'
  )
}

export async function loadHousingDashboard(client) {
  return throwIfError(await client.rpc('get_housing_dashboard'), 'Unable to load housing dashboard.')
}

export async function listHousingSites(client) {
  return throwIfError(
    await client.from('housing_sites').select('*').order('name'),
    'Unable to load housing sites.'
  ) || []
}

export async function listHousingBuildings(client) {
  return throwIfError(await client.from('housing_buildings').select('*').order('name'), 'Unable to load housing buildings.') || []
}

export async function listHousingFloors(client) {
  return throwIfError(await client.from('housing_floors').select('*').order('floor_number'), 'Unable to load housing floors.') || []
}

export async function listHousingApartments(client) {
  return throwIfError(await client.from('housing_apartments').select('*').order('apartment_number'), 'Unable to load housing apartments.') || []
}

export async function listHousingRooms(client) {
  return throwIfError(
    await client
      .from('housing_rooms')
      .select('*, site:housing_sites(id,name), building:housing_buildings(id,name,code), apartment:housing_apartments(id,apartment_number,floor:housing_floors(id,floor_number,name)), beds:housing_beds(id,bed_number,status)')
      .order('room_number'),
    'Unable to load housing rooms.'
  ) || []
}

export async function listHousingResidents(client) {
  return throwIfError(
    await client
      .from('housing_assignments')
      .select('*, employee:housing_employees(id,employee_no,full_name,nationality,profession,work_shift,preferred_language), site:housing_sites(id,name), room:housing_rooms(id,room_number,area_sqm,legal_capacity), bed:housing_beds(id,bed_number)')
      .eq('status', 'Active')
      .order('start_date', { ascending: false }),
    'Unable to load housing residents.'
  ) || []
}

export async function listHousingEmployees(client) {
  return throwIfError(await client.from('housing_employees').select('*, project:housing_projects(id,name)').order('full_name'), 'Unable to load employees.') || []
}

export async function listHousingComplianceAlerts(client) {
  return throwIfError(await client.from('housing_compliance_alerts').select('*, site:housing_sites(id,name), room:housing_rooms(id,room_number), employee:housing_employees(id,employee_no,full_name)').order('created_at', { ascending: false }).limit(100), 'Unable to load compliance alerts.') || []
}

export async function listHousingLicenses(client) {
  return throwIfError(await client.from('housing_licenses').select('*, site:housing_sites(id,name)').order('expiry_date'), 'Unable to load licenses.') || []
}

export async function listHousingHseReports(client) {
  return throwIfError(await client.from('housing_hse_reports').select('*, site:housing_sites(id,name)').order('inspection_date', { ascending: false }).limit(100), 'Unable to load HSE reports.') || []
}

export async function listHousingOperations(client) {
  return throwIfError(await client.from('housing_operation_schedules').select('*, site:housing_sites(id,name), project:housing_projects(id,name), building:housing_buildings(id,name)').order('schedule_date', { ascending: false }).limit(100), 'Unable to load operation schedules.') || []
}

export async function listHousingIncidents(client) {
  return throwIfError(await client.from('housing_incidents').select('*, site:housing_sites(id,name), room:housing_rooms(id,room_number), employee:housing_employees(id,employee_no,full_name)').order('occurred_at', { ascending: false }).limit(100), 'Unable to load incidents.') || []
}

export async function listHousingSurveys(client) {
  return throwIfError(await client.from('housing_welfare_surveys').select('*, site:housing_sites(id,name), responses:housing_welfare_responses(id,overall_score)').order('opens_at', { ascending: false }).limit(100), 'Unable to load surveys.') || []
}

async function listTable(client, table, orderColumn = 'created_at') {
  return throwIfError(await client.from(table).select('*').order(orderColumn, { ascending: false }).limit(100), `Unable to load ${table}.`) || []
}

export async function loadHousingWorkspaceData(client) {
  const [dashboard, sites, buildings, floors, apartments, rooms, employees, assignments, alerts, licenses, hseReports, operations, incidents, surveys, maintenance, inspections, assets, contracts, utilityAccounts, utilityBills] = await Promise.all([
    loadHousingDashboard(client), listHousingSites(client), listHousingBuildings(client), listHousingFloors(client), listHousingApartments(client), listHousingRooms(client), listHousingEmployees(client), listHousingResidents(client), listHousingComplianceAlerts(client), listHousingLicenses(client), listHousingHseReports(client), listHousingOperations(client), listHousingIncidents(client), listHousingSurveys(client),
    listTable(client, 'housing_maintenance_requests'), listTable(client, 'housing_inspections'), listTable(client, 'housing_assets'), listTable(client, 'housing_contracts'), listTable(client, 'housing_utility_accounts'), listTable(client, 'housing_utility_bills'),
  ])
  return { dashboard, sites, buildings, floors, apartments, rooms, employees, assignments, alerts, licenses, hseReports, operations, incidents, surveys, maintenance, inspections, assets, contracts, utilityAccounts, utilityBills }
}

export async function createHousingSite(client, companyId, input) {
  const payload = buildHousingSitePayload(input, companyId)
  return throwIfError(
    await client.from('housing_sites').insert(payload).select().single(),
    'Unable to create housing site.'
  )
}

export async function seedHousingTestData(client) {
  return throwIfError(await client.rpc('housing_seed_test_data'), 'Unable to create housing test data.')
}

export async function acknowledgeHousingAlert(client, alertId) {
  return throwIfError(await client.from('housing_compliance_alerts').update({ status: 'Acknowledged', acknowledged_at: new Date().toISOString() }).eq('id', alertId).select().single(), 'Unable to acknowledge compliance alert.')
}

export async function assignHousingEmployee(client, input) {
  return throwIfError(await client.rpc('housing_assign_employee', {
    p_employee_id: input.employeeId,
    p_bed_id: input.bedId,
    p_start_date: input.startDate || null,
    p_expected_end_date: input.expectedEndDate || null,
    p_reason: clean(input.reason) || null,
  }), 'Unable to assign employee.')
}

export async function endHousingAssignment(client, input) {
  return throwIfError(await client.rpc('housing_end_assignment', {
    p_assignment_id: input.assignmentId,
    p_end_date: input.endDate || null,
    p_reason: clean(input.reason) || null,
  }), 'Unable to end assignment.')
}

export async function createHousingRecord(client, table, companyId, input) {
  const allowedTables = new Set([
    'housing_maintenance_requests', 'housing_inspections', 'housing_assets',
    'housing_contracts', 'housing_utility_accounts', 'housing_utility_bills',
    'housing_incidents',
    'housing_licenses', 'housing_hse_reports', 'housing_operation_schedules',
    'housing_disciplinary_actions', 'housing_welfare_surveys', 'housing_welfare_responses',
  ])
  if (!allowedTables.has(table)) throw new Error('Unsupported housing record type.')
  return throwIfError(
    await client.from(table).insert({ ...input, company_id: required(companyId, 'Company') }).select().single(),
    'Unable to create housing record.'
  )
}

export async function updateHousingInspection(client, inspectionId, input = {}) {
  const allowed = ['status', 'completed_at', 'score', 'result', 'summary', 'checklist', 'attachments', 'inspector_name', 'scheduled_date']
  const payload = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key)))
  if (payload.score != null) {
    payload.score = Number(payload.score)
    if (!Number.isFinite(payload.score) || payload.score < 0 || payload.score > 100) throw new Error('Inspection score must be between 0 and 100.')
  }
  return throwIfError(
    await client.from('housing_inspections').update(payload).eq('id', required(inspectionId, 'Inspection')).select().single(),
    'Unable to update housing inspection.'
  )
}

export async function uploadHousingHseAttachment(client, companyId, report, file) {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  if (!file || !allowedTypes.has(file.type)) throw new Error('Only JPG, PNG, WebP and PDF files are allowed.')
  if (file.size > 10 * 1024 * 1024) throw new Error('The attachment must not exceed 10 MB.')
  const safeName = clean(file.name).replace(/[^a-zA-Z0-9._-]+/g, '-') || 'attachment'
  const objectPath = `${required(companyId, 'Company')}/${required(report?.id, 'HSE report')}/${crypto.randomUUID()}-${safeName}`
  const uploaded = await client.storage.from('housing-hse-attachments').upload(objectPath, file, { contentType: file.type, upsert: false })
  if (uploaded.error) throw new Error(uploaded.error.message || 'Unable to upload the HSE attachment.')
  const attachment = { path: objectPath, name: file.name, mime_type: file.type, size: file.size, uploaded_at: new Date().toISOString() }
  const attachments = [...(Array.isArray(report.attachments) ? report.attachments : []), attachment]
  const updated = await client.from('housing_hse_reports').update({ attachments }).eq('id', report.id).select().single()
  if (updated.error) {
    await client.storage.from('housing-hse-attachments').remove([objectPath])
    throw new Error(updated.error.message || 'Unable to link the HSE attachment.')
  }
  return updated.data
}

export async function listHousingUsers(client) {
  return throwIfError(await client.from('housing_profiles').select('*, site_scopes:housing_profile_sites(site_id)').order('full_name'), 'Unable to load housing users.') || []
}

export async function listHousingInvitations(client) {
  return throwIfError(await client.from('housing_user_invitations').select('*').order('created_at', { ascending: false }), 'Unable to load housing invitations.') || []
}

export async function createHousingUserInvitation(client, input) {
  return throwIfError(await client.rpc('housing_create_user_invitation', {
    p_email: required(input.email, 'Email'), p_full_name: required(input.fullName, 'Full name'),
    p_role: required(input.role, 'Role'), p_site_ids: input.siteIds || [],
  }), 'Unable to invite housing user.')
}

export async function updateHousingUserAccess(client, input) {
  return throwIfError(await client.rpc('housing_update_user_access', {
    p_profile_id: required(input.profileId, 'Profile'), p_role: required(input.role, 'Role'),
    p_status: required(input.status, 'Status'), p_site_ids: input.siteIds || [],
  }), 'Unable to update housing user.')
}

export async function revokeHousingUserInvitation(client, invitationId) {
  return throwIfError(await client.rpc('housing_revoke_user_invitation', { p_invitation_id: required(invitationId, 'Invitation') }), 'Unable to revoke invitation.')
}

export async function acceptHousingUserInvitation(client, token) {
  return throwIfError(await client.rpc('housing_accept_user_invitation', { p_token: required(token, 'Invitation token') }), 'Unable to accept housing invitation.')
}
