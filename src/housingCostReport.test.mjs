import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHousingCostReport } from './housingCostReport.mjs'

test('housing cost report calculates site and portfolio worker costs', () => {
  const report = buildHousingCostReport({
    sites: [{ id: 's1', code: 'H-1', name: 'Site One', city: 'Riyadh' }, { id: 's2', code: 'H-2', name: 'Site Two', city: 'Jeddah' }],
    assignments: [{ site_id: 's1', status: 'Active' }, { site_id: 's1', status: 'Active' }, { site_id: 's2', status: 'Active' }],
    contracts: [{ site_id: 's1', status: 'Active', annual_value: 12000 }, { site_id: 's1', status: 'Expired', annual_value: 99999 }],
    utilityAccounts: [{ id: 'u1', site_id: 's1', status: 'Active' }],
    utilityBills: [{ utility_account_id: 'u1', status: 'Due', period_start: '2026-01-01', period_end: '2026-01-31', total_amount: 1000 }],
    maintenance: [{ site_id: 's1', reported_at: '2026-07-01T00:00:00Z', actual_cost: 500, estimated_cost: 700 }],
  }, new Date('2026-08-10T00:00:00Z'))

  assert.equal(report.rows.length, 2)
  assert.equal(report.rows[0].worker_count, 2)
  assert.equal(report.rows[0].annual_rent, 12000)
  assert.equal(report.rows[0].annual_maintenance, 500)
  assert.ok(report.rows[0].annual_utilities > 11700 && report.rows[0].annual_utilities < 11800)
  assert.equal(report.rows[1].monthly_cost_per_worker, 0)
  assert.equal(report.totals.worker_count, 3)
  assert.equal(report.totals.annual_cost_per_worker, Math.round(report.totals.total_annual_cost / 3 * 100) / 100)
})

test('per-worker cost is unavailable when a housing site has no residents', () => {
  const report = buildHousingCostReport({ sites: [{ id: 's1', code: 'H-1', name: 'Empty', city: 'Riyadh' }], contracts: [{ site_id: 's1', status: 'Active', annual_value: 10000 }] })
  assert.equal(report.rows[0].annual_cost_per_worker, null)
  assert.equal(report.totals.monthly_cost_per_worker, null)
})
