import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHousingSitePayload, updateHousingInspection } from './housingService.mjs'

test('buildHousingSitePayload creates a normalized tenant-owned site', () => {
  assert.deepEqual(buildHousingSitePayload({
    code: ' H-001 ',
    name: ' سكن النخيل ',
    city: ' الرياض ',
    capacity: '240',
    project_name: 'المترو',
  }, 'company-1'), {
    company_id: 'company-1',
    code: 'H-001',
    name: 'سكن النخيل',
    housing_type: 'Workers',
    city: 'الرياض',
    district: null,
    address: null,
    ownership_type: 'Rented',
    capacity: 240,
    status: 'Active',
    notes: null,
    latitude: null,
    longitude: null,
  })
})

test('buildHousingSitePayload rejects incomplete and invalid sites', () => {
  assert.throws(() => buildHousingSitePayload({ name: 'Site', city: 'Riyadh' }, 'company-1'), /code is required/i)
  assert.throws(() => buildHousingSitePayload({ code: 'H1', name: 'Site', city: 'Riyadh', capacity: -1 }, 'company-1'), /capacity/i)
  assert.throws(() => buildHousingSitePayload({ code: 'H1', name: 'Site', city: 'Riyadh', housing_type: 'Hotel' }, 'company-1'), /housing type/i)
})

test('inspection workflow persists status, checklist and calculated result', async () => {
  let captured
  const client = { from(table) { assert.equal(table, 'housing_inspections'); return { update(payload) { captured = payload; return { eq(key, value) { assert.equal(key, 'id'); assert.equal(value, 'inspection-1'); return { select() { return { single: async () => ({ data: { id: value, ...payload }, error: null }) } } } } } } } } }
  const result = await updateHousingInspection(client, 'inspection-1', { status: 'Completed', score: 90, result: 'Passed', checklist: [{ key: 'cleanliness', status: 'Pass' }], ignored: 'no' })
  assert.equal(result.status, 'Completed')
  assert.equal(captured.score, 90)
  assert.equal(captured.ignored, undefined)
  await assert.rejects(() => updateHousingInspection(client, 'inspection-1', { score: 120 }), /between 0 and 100/i)
})
