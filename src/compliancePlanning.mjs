// Pure calculation layer, shared by browser reports and server-side consumers.
export const saudiEmployee = (e) => /^(saudi|saudi arabia|sa|sau|سعودي|سعودية|السعودية|المملكة العربية السعودية)$/i.test(String(e.nationality || '').trim());
export const activeEmployee = (e) => !['final exit', 'transferred', 'terminated', 'inactive', 'منتهي', 'غير نشط'].includes(String(e.status || 'Active').trim().toLowerCase());
export function salaryOf(e) {
  const raw = e.gosi_salary ?? e.salary ?? e.basic_salary ?? e.monthly_salary ?? e.total_salary;
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
export function riyadhDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
export function daysUntil(date, asOf = riyadhDate()) {
  const delta = Date.parse(String(date).slice(0, 10)) - Date.parse(asOf);
  return Number.isFinite(delta) ? Math.ceil(delta / 86400000) : null;
}
export function scopeEmployees(employees, { branch = '', project = '' } = {}) {
  return employees.filter(e => (!branch || e.branch_name === branch) && (!project || e.project_name === project));
}
export function wageWeight(salary, type = 'full_time') {
  if (salary == null || typeof salary === 'boolean' || String(salary).trim() === '' || !Number.isFinite(Number(salary)) || salary < 0) return null;
  if (!['full_time', 'part_time'].includes(type)) return null; // Special categories require verified Qiwa inputs.
  if (salary < 3000) return 0;
  return type === 'part_time' || salary < 4000 ? 0.5 : 1;
}
export const BAND_NAMES = ['الأخضر المنخفض', 'الأخضر المتوسط', 'الأخضر المرتفع', 'البلاتيني'];
export function simulateNitaqat({ employees = [], activity, hireSalary = 4000, hireType = 'full_time', targetBandIndex, maxHires = 100000, timeoutMs = 25, clock = () => performance.now() }) {
  const started = clock();
  const budget = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(timeoutMs, 100)) : 25;
  const limit = Number.isFinite(maxHires) ? Math.max(0, Math.min(Math.floor(maxHires), 100000)) : 100000;
  const people = employees.filter(activeEmployee);
  const saudis = people.filter(saudiEmployee);
  const weights = saudis.map(e => wageWeight(salaryOf(e), e.employment_type || 'full_time'));
  const unknown = weights.filter(w => w == null).length;
  const weightedSaudis = weights.reduce((sum, w) => sum + (w ?? 0), 0);
  const expatriates = people.length - saudis.length;
  const denominator = expatriates + weightedSaudis;
  const rate = denominator ? weightedSaudis / denominator * 100 : 0;
  const thresholds = (n) => activity?.curve?.map((s, i) => Math.min(100, Math.max(0, Number(s) * Math.log(n) + Number(activity.threshold2026?.[i])))) || [];
  const minimums = thresholds(people.length);
  const base = { headcount: people.length, weightedSaudis, unknown, rate, minimums };
  if (unknown || people.length < 6 || minimums.length !== 4 || minimums.some(v => !Number.isFinite(v))) return { ...base, status: 'review', hires: null };
  const bandIndex = minimums.reduce((found, threshold, i) => rate >= threshold ? i : found, -1);
  if (bandIndex === 3 && targetBandIndex == null) return { ...base, bandIndex, status: 'highest', hires: 0, monthly: 0, annual: 0 };
  const targetIndex = targetBandIndex ?? bandIndex + 1;
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 3) return { ...base, status: 'review', hires: null };
  const weight = wageWeight(hireSalary, hireType);
  if (!weight) return { ...base, bandIndex, targetIndex, status: 'unreachable', hires: null };
  // Re-evaluate the activity curve at every new physical headcount; never freeze its threshold.
  for (let hires = 0; hires <= limit; hires++) {
    if (hires % 128 === 0 && clock() - started >= budget) return { ...base, bandIndex, targetIndex, status: 'timeout', hires: null };
    const totalWeight = denominator + hires * weight;
    const projectedRate = totalWeight ? (weightedSaudis + hires * weight) / totalWeight * 100 : 0;
    const targetRate = Math.min(100, Math.max(0, Number(activity.curve[targetIndex]) * Math.log(people.length + hires) + Number(activity.threshold2026[targetIndex])));
    if (projectedRate + 1e-10 >= targetRate) return { ...base, bandIndex, targetIndex, status: 'ready', hires, projectedRate, targetRate, monthly: hires * hireSalary, annual: hires * hireSalary * 12 };
  }
  return { ...base, bandIndex, targetIndex, status: 'limit', hires: null };
}
export function salaryPlan({ employees, salaryFloor, shortage, rate, matchedCount, eligible, marketSalary }) {
  const alerts = employees.filter(e => salaryOf(e) != null && salaryOf(e) < salaryFloor).map((e, index) => ({
    id: e.id ?? null, name: e.name || e.employee_name || e.full_name || e.employee_code || 'موظف',
    branch: e.branch_name || '', project: e.project_name || '', salary: salaryOf(e), floor: salaryFloor, monthly: salaryFloor - salaryOf(e),
  })).sort((a, b) => a.monthly - b.monthly);
  const adjustments = shortage == null ? [] : alerts.slice(0, shortage);
  const remaining = shortage == null ? null : Math.max(0, shortage - adjustments.length);
  const hires = remaining == null ? null : remaining === 0 ? 0 : rate >= 1 ? null : Math.max(0, Math.ceil((rate * matchedCount - eligible - adjustments.length - 1e-10) / (1 - rate)));
  const wage = Number(marketSalary) > 0 ? Math.max(Number(marketSalary), salaryFloor) : null;
  const adjustmentMonthly = adjustments.reduce((sum, e) => sum + e.monthly, 0);
  const monthly = hires == null || (hires > 0 && wage == null) ? null : adjustmentMonthly + hires * (wage || 0);
  return { alerts, adjustments, remaining, hires, wage, adjustmentMonthly, monthly, annual: monthly == null ? null : monthly * 12 };
}

// Merge known employee salary actions, never sum independent decision budgets.
// Upcoming phases are separate scenarios, not concurrent recurring costs.
export function consolidateSalaryPlans(rows = []) {
  rows = rows.filter(row => row.matchedCount > 0);
  const merged = new Map();
  let unidentified = false;
  for (const row of rows) for (const action of row.plan.adjustments) {
    if (action.id == null) { unidentified = true; continue; }
    const key = String(action.id);
    const previous = merged.get(key);
    merged.set(key, { ...action, floor: Math.max(action.floor, previous?.floor ?? 0),
      salary: Math.min(action.salary, previous?.salary ?? action.salary),
      rules: [...new Set([...(previous?.rules || []), row.rule_code])] });
  }
  const adjustments = [...merged.values()].map(a => ({ ...a, monthly: a.floor - a.salary }));
  const adjustmentMonthly = adjustments.reduce((total, a) => total + a.monthly, 0);
  // Re-credit shared raises to every matching rule, including non-selected alerts.
  const residuals = rows.map(row => {
    const recovered = row.plan.alerts.filter(a => a.id != null && (merged.get(String(a.id))?.floor ?? -1) >= a.floor).length;
    const rate = Number(row.localization_rate);
    const deficit = row.matchedCount * rate - row.eligibleSaudiCount - recovered;
    const hires = row.shortage == null ? (row.matchedCount < row.threshold && !row.scopeNeedsReview && !row.applicabilityUnconfirmed ? 0 : null) : deficit <= 1e-10 ? 0 : rate >= 1 ? null : Math.ceil((deficit - 1e-10) / (1-rate));
    return { rule_code: row.rule_code, recovered, hires };
  });
  const hiringNeedsReview = residuals.some(r => r.hires == null || r.hires > 0);
  return { adjustments, residuals, unidentified, hiringNeedsReview,
    adjustmentMonthly: unidentified ? null : adjustmentMonthly,
    adjustmentAnnual: unidentified ? null : adjustmentMonthly * 12,
    monthly: unidentified || hiringNeedsReview ? null : adjustmentMonthly,
    annual: unidentified || hiringNeedsReview ? null : adjustmentMonthly * 12 };
}
