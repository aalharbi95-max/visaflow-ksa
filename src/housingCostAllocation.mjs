const amount = (value) => Number(value || 0)

export function monthPeriod(value = new Date()) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  }
}

export function summarizeCostAllocations(lines = []) {
  const centers = new Map()
  const workerDays = new Set()
  let total = 0
  let allocated = 0
  let unallocated = 0

  for (const line of lines) {
    const value = amount(line.amount)
    total += value
    if (line.employee_id) {
      allocated += value
      workerDays.add(`${line.employee_id}:${line.allocation_date}`)
    } else unallocated += value
    const key = line.cost_center_id || 'unassigned'
    const current = centers.get(key) || {
      cost_center_id: line.cost_center_id || null,
      cost_center_code: line.cost_center?.code || 'UNASSIGNED',
      cost_center_name: line.cost_center?.name || 'Unassigned',
      project_name: line.project?.name || 'Unassigned',
      amount: 0,
      worker_days: new Set(),
    }
    current.amount += value
    if (line.employee_id) current.worker_days.add(`${line.employee_id}:${line.allocation_date}`)
    centers.set(key, current)
  }

  const round = (value) => Math.round(value * 100) / 100
  return {
    totals: {
      total: round(total), allocated: round(allocated), unallocated: round(unallocated),
      worker_days: workerDays.size,
      cost_per_worker_day: workerDays.size ? round(allocated / workerDays.size) : null,
    },
    centers: [...centers.values()].map((row) => ({
      ...row, amount: round(row.amount), worker_days: row.worker_days.size,
      cost_per_worker_day: row.worker_days.size ? round(row.amount / row.worker_days.size) : null,
    })).sort((a, b) => b.amount - a.amount),
  }
}

export function validateCostCenter(input = {}) {
  if (!String(input.code || '').trim()) throw new Error('cost_center_code_required')
  if (!String(input.name || '').trim()) throw new Error('cost_center_name_required')
  return {
    code: String(input.code).trim().toUpperCase(), name: String(input.name).trim(),
    project_id: input.project_id || null, external_system: String(input.external_system || '').trim() || null,
    external_code: String(input.external_code || '').trim() || null, status: input.status || 'Active',
  }
}

export function validateCostEntry(input = {}) {
  if (!input.site_id || !input.category || !input.period_start || !input.period_end) throw new Error('cost_entry_fields_required')
  if (input.period_end < input.period_start) throw new Error('cost_entry_period_invalid')
  if (!(Number(input.amount) >= 0)) throw new Error('cost_entry_amount_invalid')
  return { ...input, amount: Number(input.amount), cost_center_id: input.cost_center_id || null, status: input.status || 'Posted' }
}

