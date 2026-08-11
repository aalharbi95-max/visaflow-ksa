const number = (value) => Number(value || 0)

function daysInclusive(start, end) {
  const first = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  if (!start || !end || Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || last < first) return 0
  return Math.round((last - first) / 86400000) + 1
}

function annualizedUtilityCost(accountId, bills) {
  const accountBills = bills.filter((bill) => bill.utility_account_id === accountId && bill.status !== 'Cancelled')
  const amount = accountBills.reduce((sum, bill) => sum + number(bill.total_amount), 0)
  const coveredDays = accountBills.reduce((sum, bill) => sum + daysInclusive(bill.period_start, bill.period_end), 0)
  return coveredDays ? amount / coveredDays * 365 : amount
}

export function buildHousingCostReport(data = {}, now = new Date()) {
  const sites = data.sites || []
  const assignments = data.assignments || []
  const contracts = data.contracts || []
  const accounts = data.utilityAccounts || []
  const bills = data.utilityBills || []
  const maintenance = data.maintenance || []
  const yearAgo = new Date(now)
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1)

  const rows = sites.map((site) => {
    const workerCount = assignments.filter((item) => item.site_id === site.id && (!item.status || item.status === 'Active')).length
    const annualRent = contracts
      .filter((item) => item.site_id === site.id && ['Active', 'Expiring'].includes(item.status))
      .reduce((sum, item) => sum + number(item.annual_value), 0)
    const annualUtilities = accounts
      .filter((account) => account.site_id === site.id && account.status !== 'Closed')
      .reduce((sum, account) => sum + annualizedUtilityCost(account.id, bills), 0)
    const annualMaintenance = maintenance
      .filter((item) => item.site_id === site.id && (!item.reported_at || new Date(item.reported_at) >= yearAgo))
      .reduce((sum, item) => sum + (number(item.actual_cost) || number(item.estimated_cost)), 0)
    const totalAnnualCost = annualRent + annualUtilities + annualMaintenance
    return {
      site_id: site.id,
      site_code: site.code,
      site_name: site.name,
      city: site.city,
      worker_count: workerCount,
      annual_rent: Math.round(annualRent * 100) / 100,
      annual_utilities: Math.round(annualUtilities * 100) / 100,
      annual_maintenance: Math.round(annualMaintenance * 100) / 100,
      total_annual_cost: Math.round(totalAnnualCost * 100) / 100,
      annual_cost_per_worker: workerCount ? Math.round(totalAnnualCost / workerCount * 100) / 100 : null,
      monthly_cost_per_worker: workerCount ? Math.round(totalAnnualCost / workerCount / 12 * 100) / 100 : null,
    }
  })

  const workerCount = rows.reduce((sum, row) => sum + row.worker_count, 0)
  const totalAnnualCost = rows.reduce((sum, row) => sum + row.total_annual_cost, 0)
  return {
    rows,
    totals: {
      sites_count: rows.length,
      worker_count: workerCount,
      total_annual_cost: Math.round(totalAnnualCost * 100) / 100,
      annual_cost_per_worker: workerCount ? Math.round(totalAnnualCost / workerCount * 100) / 100 : null,
      monthly_cost_per_worker: workerCount ? Math.round(totalAnnualCost / workerCount / 12 * 100) / 100 : null,
    },
  }
}
