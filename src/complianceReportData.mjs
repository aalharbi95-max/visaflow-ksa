import { buildTawteenReport } from './tawteenReport.mjs';
import { simulateNitaqat, activeEmployee, saudiEmployee, riyadhDate } from './compliancePlanning.mjs';
import activities from './data/hrsdNitaqatRates2026.json' with { type: 'json' };
import { normalizeSalary } from './occupationSalary.mjs';

export const COMPLIANCE_REPORT_IDS = ['tawteen_localization', 'saudi_workforce'];
export async function readAllRows(makeQuery, pageSize = 500) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const result = await makeQuery().range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(result.error.message || 'Report data unavailable');
    rows.push(...(result.data || []));
    if ((result.data || []).length < pageSize) return rows;
  }
  throw new Error('Report exceeds the supported record limit; no partial report was generated.');
}
export async function loadComplianceReportData(client, companyId) {
  if (!companyId) throw new Error('Select a company workspace first.');
  const [employees, rules, professions, conditions, employeeAttributes, profileResult] = await Promise.all([
    readAllRows(() => client.from('employees').select('*').eq('company_id', companyId).order('id')),
    readAllRows(() => client.from('compliance_rules').select('*').order('id')),
    readAllRows(() => client.from('compliance_effective_rule_professions').select('*').order('rule_code').order('profession_code')),
    readAllRows(() => client.from('compliance_rule_conditions').select('*').order('id')),
    readAllRows(() => client.from('employee_compliance_attributes').select('*').eq('company_id', companyId).order('employee_id')),
    client.from('company_compliance_profiles').select('*').eq('company_id', companyId).maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(profileResult.error.message);
  if (!rules.length || !professions.length) throw new Error('قاعدة قرارات التوطين غير متاحة؛ لا يمكن إصدار نتيجة صحيحة.');
  if ([...employees, ...employeeAttributes].some(e => e.company_id !== companyId)) throw new Error('TENANT_SCOPE_MISMATCH');
  const profile = profileResult.data || {};
  const byRule = new Map();
  for (const condition of conditions) byRule.set(condition.rule_id, [...(byRule.get(condition.rule_id) || []), condition]);
  return { companyId, employees, employeeAttributes, professions,
    rules: rules.map(rule => ({ ...rule, conditions: byRule.get(rule.id) || [] })),
    companySector: profile.company_sector || '', entityScopeComplete: profile.entity_scope_confirmed === true,
    companyActivityCode: profile.economic_activity_code || '', companyActivityName: profile.economic_activity_name || '',
    activityCode: profile.nitaqat_activity_code || '', facts: { accountingOffice: profile.accounting_office },
  };
}
export function buildComplianceSnapshot(input, { asOf = riyadhDate(), project = '', hireSalary = 4000 } = {}) {
  const scoped = project && project !== 'All';
  const employees = input.employees.filter(e => !scoped || e.project_name === project);
  const tawteen = { ...input, employees, asOf, entityScopeComplete: !scoped && input.entityScopeComplete === true };
  const report = buildTawteenReport(tawteen);
  const attributes = new Map(input.employeeAttributes.map(a => [a.employee_id, a]));
  const seen = new Set();
  let duplicates = false;
  const people = employees.filter(activeEmployee).filter(e => {
    if (e.id == null) return true;
    if (seen.has(e.id)) { duplicates = true; return false; }
    seen.add(e.id); return true;
  }).map(e => ({ ...e, gosi_salary: normalizeSalary(attributes.get(e.id)?.gosi_salary ?? e.gosi_salary).value }));
  const activity = activities.find(a => String(a.code) === String(input.activityCode));
  // An excerpt, unknown nationality, duplicate roster, or another year cannot establish a band.
  const missingNationality = people.some(e => !String(e.nationality || '').trim());
  const missingWage = people.some(e => saudiEmployee(e) && e.gosi_salary == null);
  const allowed = tawteen.entityScopeComplete && !duplicates && !missingNationality && !missingWage && asOf.startsWith('2026-');
  const simulation = allowed ? simulateNitaqat({ employees: people, activity, hireSalary }) : { status: 'review', hires: null };
  return { tawteen, report, simulation, people, activity, asOf,
    saudiCount: people.filter(saudiEmployee).length, scope: scoped ? project : 'Company',
    reviewReason: !allowed ? 'يلزم تأكيد اكتمال الكيان والجنسية والأجر المسجل في التأمينات وعدم تكرار السجلات وصلاحية منحنيات 2026.' : '' };
}
