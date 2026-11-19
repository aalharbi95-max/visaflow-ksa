import { consolidateSalaryPlans, activeEmployee, saudiEmployee, salaryOf, salaryPlan, riyadhDate, daysUntil } from "./compliancePlanning.mjs";
import { regulatoryPolicy, evaluateApplicability, assessEligibility, workforceOptions, requiredEligibleCount } from './occupationLocalization.mjs';
import {salaryEvidence} from './occupationSalary.mjs';
export function buildTawteenReport(tawteen = {}) {
  const todayKey = tawteen.asOf || riyadhDate();
  const companies=new Set((tawteen.employees||[]).map(e=>e.company_id).filter(Boolean));
  if (companies.size>1 || (tawteen.companyId && [...companies].some(id=>id!==tawteen.companyId))) throw new Error('TENANT_SCOPE_MISMATCH');
  const attributes=new Map((tawteen.employeeAttributes||[]).map(a=>[`${a.company_id}:${a.employee_id}`,a]));
  const people = (tawteen.employees || []).map(e=>{
    const a=attributes.get(`${e.company_id}:${e.id}`);
    if(!a) return e;
    return {...e,profession_code:a.profession_code??e.profession_code,qualification_level:a.qualification_level??e.qualification_level,
      gosi_salary:a.gosi_salary??e.gosi_salary,professional_accreditations:a.accreditation_body?{
        ...(e.professional_accreditations||{}),[a.accreditation_body]:{status:a.accreditation_status,valid_until:a.accreditation_valid_until}
      }:e.professional_accreditations};
  });
  const professionRows = tawteen.professions || [];
  const occupationCatalog = tawteen.occupationCatalog || [];
  const rules = tawteen.rules || [];
  const salaryCache=new WeakMap();
  const evidenceFor=e=>{if(!salaryCache.has(e))salaryCache.set(e,salaryEvidence(e));return salaryCache.get(e);};
  const companyActivityCode = String(tawteen.companyActivityCode || "").trim();
  const normalize = (value) => String(value || "").trim().toLocaleLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/[\sـ_-]+/g, "");
  const occupationCodeByLabel = new Map();
  occupationCatalog.forEach((item) => {
    const code = String(item.code || "").trim();
    if (!code) return;
    [item.name_ar, item.name_en, item.code].map(normalize).filter(Boolean).forEach((label) => occupationCodeByLabel.set(label, code));
  });
  const mappings = new Map();
  professionRows.forEach((row) => {
    const list = mappings.get(row.rule_code) || [];
    list.push({ code: row.profession_code, name: row.profession_name_ar });
    mappings.set(row.rule_code, list);
  });
  const professionKeyCache = new WeakMap();
  const employeeProfessionKeys = (employee) => {
    if (professionKeyCache.has(employee)) return professionKeyCache.get(employee);
    const rawTitle = employee.profession || employee.job_title || employee.occupation || "";
    // Employee forms commonly save bilingual labels as "Arabic title - English title".
    // Compare exact tokens only; fuzzy/substring matching can create false compliance matches.
    const titleParts = String(rawTitle).split(/\s+-\s+|[|/;,]+|[()]/).map(normalize).filter(Boolean);
    const codes = [employee.profession_code, employee.occupation_code, employee.job_code, employee.professionCode]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const embeddedCodes = String(rawTitle).match(/\b\d{5,8}\b/g) || [];
    const normalizedTitleParts = new Set(titleParts);
    const catalogCodes = [...normalizedTitleParts].map((label) => occupationCodeByLabel.get(label)).filter(Boolean);
    const keys = { titleParts: normalizedTitleParts, codes: new Set([...codes, ...embeddedCodes, ...catalogCodes]) };
    professionKeyCache.set(employee, keys);
    return keys;
  };
  const seenEmployees = new Set();
  let duplicateEmployeeCount = 0;
  const activeEmployees = people.filter(activeEmployee).filter(e => {
    if (e.id == null) return true;
    const key = `${e.company_id || ''}:${e.id}`;
    if (seenEmployees.has(key)) { duplicateEmployeeCount++; return false; }
    seenEmployees.add(key); return true;
  });
  const isSaudi = saudiEmployee;
  const catalogNames = new Set(professionRows.map((item) => normalize(item.profession_name_ar)).filter(Boolean));
  const catalogCodes = new Set(professionRows.map((item) => String(item.profession_code || "").trim()).filter(Boolean));
  const unmatchedProfessionGroups = new Map();
  activeEmployees.forEach((employee) => {
    const keys = employeeProfessionKeys(employee);
    const recognized = [...keys.codes].some((code) => catalogCodes.has(code))
      || [...keys.titleParts].some((title) => catalogNames.has(title));
    const label = String(employee.profession || employee.job_title || employee.occupation || "").trim();
    if (!recognized) unmatchedProfessionGroups.set(label||'مهنة غير مسجلة', (unmatchedProfessionGroups.get(label||'مهنة غير مسجلة') || 0) + 1);
  });
  const unmatchedEmployeeCount = [...unmatchedProfessionGroups.values()].reduce((sum, count) => sum + count, 0);
  const uniqueRules = new Map();
  for (const rule of rules) {
    const old=uniqueRules.get(rule.rule_code);
    if (!old || String(rule.source_version || '').localeCompare(String(old.source_version || ''),undefined,{numeric:true})>0) uniqueRules.set(rule.rule_code,rule);
  }
  const rows = [...uniqueRules.values()].flatMap((originalRule) => {
    const policy = regulatoryPolicy(originalRule);
    const rule = { ...originalRule, localization_rate:policy.rate ?? originalRule.localization_rate,
      effective_from:policy.start ?? originalRule.effective_from,
      effective_to:policy.end === undefined ? originalRule.effective_to : policy.end,
      source_url:policy.source || originalRule.source_url };
    const activityCondition = (rule.conditions || []).find((condition) => condition.condition_type === "economic_activity_code");
    const logicActivityCode = String(rule.rule_logic || "").match(/(?:economic_)?activity_code\s*=\s*(\d{4,8})/i)?.[1] || "";
    const requiredActivityCode = String(activityCondition?.text_value || logicActivityCode).trim();
    const professions = mappings.get(rule.rule_code) || [];
    const normalizedNames = professions.map((item) => normalize(item.name)).filter(Boolean);
    const professionCodes = new Set(professions.map((item) => String(item.code || "").trim()).filter(Boolean));
    const matched = activeEmployees.filter((employee) => {
      const keys = employeeProfessionKeys(employee);
      return [...keys.codes].some((code) => professionCodes.has(code))
        || [...keys.titleParts].some((title) => normalizedNames.includes(title));
    });
    const saudi = matched.filter(isSaudi);
    const salaryCondition = (rule.conditions || []).find((condition) => condition.condition_type === "salary_threshold");
    const employeeThresholdCondition = (rule.conditions || []).find((condition) => condition.condition_type === "employee_threshold");
    const salaryFloor = Number(policy.floor ?? rule.salary_threshold ?? salaryCondition?.numeric_value ?? 0);
    const eligibility = saudi.map(e => assessEligibility(e,policy,{...rule,salary_threshold:salaryFloor},rule.effective_from > todayKey ? rule.effective_from : todayKey,evidenceFor(e)));
    const eligibilityByEmployee = new Map(eligibility.map(e=>[e.employee,e]));
    const salaryQualified = eligibility.filter(e=>e.state==='eligible').map(e=>e.employee);
    const start = String(rule.effective_from || "").slice(0, 10);
    const end = String(rule.effective_to || "").slice(0, 10);
    const status = start > todayKey ? "upcoming" : (!end || end >= todayKey ? "current" : "expired");
    const threshold = Number(policy.min ?? rule.employee_threshold ?? employeeThresholdCondition?.numeric_value ?? 1);
    const context = {...tawteen,companyActivityCode,unmatchedEmployeeCount};
    const assessedPolicy = requiredActivityCode ? {...policy,activities:[requiredActivityCode]} : policy;
    const applicability = evaluateApplicability(rule,matched.length,context,assessedPolicy);
    if (!professions.length || duplicateEmployeeCount) {
      applicability.checks.push({code:'data_quality',result:'unknown',reason:'تعيين المهن مفقود أو توجد سجلات موظفين مكررة.'});
      applicability.reasons.push('تعيين المهن مفقود أو توجد سجلات موظفين مكررة.');
      if (applicability.state==='applicable') applicability.state='unknown';
    }
    const applicable = applicability.state==='applicable';
    const applicabilityUnconfirmed = applicability.state==='unknown';
    const scopeNeedsReview = applicabilityUnconfirmed;
    const rate = Number(rule.localization_rate || 0);
    const unknownEligibilityCount=eligibility.filter(e=>e.state==='unknown').length;
    const required = applicable && !scopeNeedsReview ? requiredEligibleCount(matched.length,rate,policy.rounding) : null;
    const eligible = salaryQualified.length;
    const shortage = required!=null && !unknownEligibilityCount ? Math.max(0, required - eligible) : null;
    const conditionalRequired=policy.verified&&applicability.state!=='not_applicable'?requiredEligibleCount(matched.length,rate,policy.rounding):null;
    const potentialGap=conditionalRequired==null?null:{min:Math.max(0,conditionalRequired-eligible-unknownEligibilityCount),max:Math.max(0,conditionalRequired-eligible),conditionalOnScope:!applicable};
    if (!applicable) for(const item of eligibility) item.scopeDecisionState='UNKNOWN_PENDING_SCOPE_VERIFICATION';
    const saudiWithoutSalary = eligibility.filter(e=>e.decisionState==='UNKNOWN_MISSING_SALARY');
    const saudiBelowSalary = eligibility.filter(e=>e.belowSalary);
    const professionBreakdown = professions.map((profession) => {
      const roleEmployees = matched.filter((employee) => {
        const keys = employeeProfessionKeys(employee);
        return keys.codes.has(String(profession.code || "").trim())
          || keys.titleParts.has(normalize(profession.name));
      });
      const roleSaudis = roleEmployees.filter(isSaudi);
      const roleEligible = roleSaudis.filter((employee) => eligibilityByEmployee.get(employee)?.state==='eligible');
      return {
        profession_code: profession.code,
        profession_name: profession.name,
        employee_count: roleEmployees.length,
        saudi_count: roleSaudis.length,
        eligible_saudi_count: roleEligible.length,
        salary_qualified_saudi_count:roleSaudis.filter(e=>eligibilityByEmployee.get(e)?.salaryQualified).length,
        below_salary_count: roleSaudis.filter(e=>eligibilityByEmployee.get(e)?.belowSalary).length,
        missing_salary_count: roleSaudis.filter(e=>eligibilityByEmployee.get(e)?.decisionState==='UNKNOWN_MISSING_SALARY').length,
      };
    });
    const alerts=eligibility.filter(e=>e.salaryRepairable).map(e=>({id:e.employee.id??null,name:e.employee.name||e.employee.employee_name||'موظف',salary:e.wage,floor:e.floor,monthly:e.floor-e.wage})).sort((a,b)=>a.monthly-b.monthly);
    const adjustments=shortage==null?[]:alerts.slice(0,shortage);
    const marketSalary=tawteen.marketSalaryByRule?.[rule.rule_code]??tawteen.marketSalary;
    const hireFloor=policy.degreeFloors ? Math.max(...Object.values(policy.degreeFloors)) : salaryFloor;
    const plan=salaryPlan({employees:[],salaryFloor:hireFloor,shortage:shortage==null?null:Math.max(0,shortage-adjustments.length),rate,matchedCount:matched.length,eligible:eligible+adjustments.length,marketSalary});
    plan.alerts=alerts; plan.adjustments=adjustments; plan.adjustmentMonthly=adjustments.reduce((s,a)=>s+a.monthly,0);
    if (plan.monthly!=null) { plan.monthly+=plan.adjustmentMonthly; plan.annual=plan.monthly*12; }
    const options=workforceOptions({total:matched.length,saudi:saudi.length,eligible,rate,adjustments:alerts,wage:plan.wage,
      expatriateWages:matched.filter(e=>!isSaudi(e)).map(salaryOf),applicability:shortage==null?'unknown':applicability.state,
      projectedApplicability:n=>evaluateApplicability(rule,n,context,assessedPolicy)});
    const managementActions=[];
    if(applicability.state==='unknown') managementActions.push({issue:'نطاق أو شروط القرار غير موثقة',affectedCount:matched.length,action:applicability.reasons.join('؛ '),priority:'P0',owner:'الامتثال والموارد البشرية'});
    if(unknownEligibilityCount) managementActions.push({issue:'أهلية غير محسومة',affectedCount:unknownEligibilityCount,action:'استكمال أساس الأجر والمؤهل والاعتماد من المصادر المعتمدة',priority:'P0',owner:'الرواتب والموارد البشرية'});
    if(saudiBelowSalary.length) managementActions.push({issue:'أجر أقل من الحد',affectedCount:saudiBelowSalary.length,action:'مراجعة فجوة الأجر وصلاحية بقية المتطلبات قبل أي تعديل',priority:'P1',owner:'الرواتب'});
    if(shortage>0) managementActions.push({issue:'فجوة مؤكدة',affectedCount:shortage,action:'مراجعة خيارات الإحلال والتوظيف المستقلة',priority:'P1',owner:'تخطيط القوى العاملة'});
    return { ...rule, plan, options, applicability, eligibility, unknownEligibilityCount, eligibilityUnconfirmed:unknownEligibilityCount>0,
      managementActions,
      salaryQualifiedSaudiCount:eligibility.filter(e=>e.salaryQualified).length,
      recordedSalarySaudiCount:eligibility.filter(e=>e.salaryEvidence.hasRecordedSalary).length,
      ineligibleSaudiCount:eligibility.filter(e=>e.state==='ineligible').length,
      confirmedGap:shortage,potentialGap,calculationStatus:shortage==null?'NOT_DETERMINED':'DETERMINED',
      rounding:policy.rounding??null,regulatoryVerification:policy,
      complianceStatus:!applicable?'unassessed':unknownEligibilityCount||required==null?'uncertain':shortage>0?'gap':'met',
      regulatoryRequired:required,
      daysUntilEffective: daysUntil(start, todayKey), salaryFloor, status, matchedCount: matched.length, saudiCount: saudi.length, nonSaudiCount:matched.length-saudi.length, eligibleSaudiCount: eligible, saudiBelowSalaryCount: saudiBelowSalary.length, saudiMissingSalaryCount: saudiWithoutSalary.length, requiredSaudiCount: required, shortage, scopeNeedsReview, applicabilityUnconfirmed, actualRate: matched.length ? eligible / matched.length * 100 : null, threshold, professions, professionBreakdown };
  });
  const notApplicable=rows.filter(row=>row.applicability.state==='not_applicable');
  for(const row of notApplicable) row.applicableAlternatives=rows.filter(other=>other!==row && other.decision_number===row.decision_number && other.applicability.state==='applicable' && other.effective_from<=row.effective_from && (!other.effective_to || other.effective_to>=row.effective_from)).map(other=>({rule_code:other.rule_code,rate:other.localization_rate,effective_from:other.effective_from}));
  const current = rows.filter((row) => row.status === "current" && row.applicability.state!=='not_applicable');
  const upcoming = rows.filter((row) => row.status === "upcoming" && row.applicability.state!=='not_applicable').sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)));
  const historical = rows.filter((row) => row.status === "expired");
  return {
    rows, current, upcoming, historical, notApplicable, duplicateEmployeeCount,
    consolidatedCurrent: consolidateSalaryPlans(current),
    consolidatedUpcoming: consolidateSalaryPlans(upcoming),
    unmatchedProfessionGroups: [...unmatchedProfessionGroups].sort((a, b) => b[1] - a[1]),
    decisionCount: new Set(rows.map((row) => row.decision_number).filter(Boolean)).size,
    riskCount: current.filter((row) => row.shortage > 0).length,
    reviewCount: rows.filter((row) => row.scopeNeedsReview).length,
    unassessedCurrentCount: current.filter((row) => row.applicabilityUnconfirmed || row.scopeNeedsReview || row.eligibilityUnconfirmed).length,
    unmatchedEmployeeCount,
    activeEmployeeCount: activeEmployees.length,
    saudiEmployeeCount:activeEmployees.filter(isSaudi).length,
    nonSaudiEmployeeCount:activeEmployees.filter(e=>!isSaudi(e)).length,
  };
}
