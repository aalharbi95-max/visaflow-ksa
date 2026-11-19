// Regulatory facts are versioned separately from calculation and employee records.
// Unmodeled requirements fail closed; free-text rule_logic is never executed.
import { salaryOf } from './compliancePlanning.mjs';
import { salaryEvidence } from './occupationSalary.mjs';
export const OFFICIAL_SOURCES = {
  accounting: 'https://www.hrsd.gov.sa/sites/default/files/2026-04/aldlyl-alajrayy-lqrar-twtyn-almhn-almhasbyt.pdf',
  engineering: 'https://prod.hrsd.gov.sa/sites/default/files/2026-01/aldlyl-alajrayy-lqrar-twtyn-almhn-alhndsyt_3.pdf',
  technical: 'https://www.hrsd.gov.sa/sites/default/files/2026-01/aldlyl-alajrayy-lqrar-twtyn-mhn-alfnyt-alhndsyt.pdf',
  projects: 'https://www.hrsd.gov.sa/sites/default/files/2026-08/aldlyl-alajrayy-lqrar-almhn-adart-almshary--alnhayy-v.1.pdf',
};
export function regulatoryPolicy(rule) {
  const code = rule.rule_code || '';
  const supplied = rule.engine_policy || rule.conditions?.find(c => c.condition_type === 'engine_policy')?.json_value;
  const common = { verified: true, min: 5, salarySource: 'gosi', sector: ['private'], calculationUnit:'entity', rounding: 'nearest', reviewedOn: '2026-11-05', ruleVersion:'2026-11-audit-2' };
  if (/^(?:ACCOUNTING_STAGE[1-4]|ACCOUNTING_STAGE5_SMALL)$/.test(code)) {
    const small = code === 'ACCOUNTING_STAGE5_SMALL';
    const stage = Number(code.match(/STAGE(\d)/)[1]);
    return { ...common, reviewedOn: '2026-11-19', family: 'accounting', calculationUnit:'entity', min: small ? 3 : 5, max: small ? 4 : null,
      rate: small ? .3 : (3+stage) / 10, start: `${2024+stage}-10-27`,
      end: stage < 4 ? `${2025+stage}-10-26` : null,
      requirements:[{field:'accountingOffice',equals:false,reason:'يلزم التحقق من استثناء مكاتب المحاسبة والمراجعة الخاضعة للقرار 658.'}], degreeFloors: { bachelor: 6000, diploma: 4500 }, accreditation: 'SOCPA', source: OFFICIAL_SOURCES.accounting };
  }
  if (code === 'ENGINEERING_2026') return { ...common, family: 'engineering', rate: .3, start: '2026-06-30', floor: 8000, accreditation: 'SCE', source: OFFICIAL_SOURCES.engineering };
  if (code === 'TECH_ENGINEERING_2025') return { ...common, family: 'technical', rate: .3, start: '2025-07-27', floor: 5000, accreditation: 'SCE', source: OFFICIAL_SOURCES.technical };
  // 2026 guide pp.4–6: three occupations, minimum 3, no profession-specific wage floor.
  if (code === 'PROJECT_MGMT_2027') return { ...common, family: 'projects', min: 3, rate: .7, start: '2027-02-14', floor:0, source: OFFICIAL_SOURCES.projects };
  if (supplied?.verified === true) return { ...supplied, source: supplied.source || rule.source_url };
  return { verified: false, min: rule.employee_threshold ?? 1, max: rule.maximum_employee_threshold, source: rule.source_url };
}
const numeric = v => v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v);
export function evaluateApplicability(rule, count, context = {}, policy = regulatoryPolicy(rule)) {
  const checks = [];
  const add = (code, expected, actual, result, reason) => checks.push({ code, expected, actual: actual ?? null, result, reason });
  const min = numeric(policy.min ?? rule.employee_threshold ?? 1);
  const max = numeric(policy.max);
  if ('localization_rate' in rule && !(Number(rule.localization_rate)>0 && Number(rule.localization_rate)<=1)) add('rate','0 < rate <= 1',rule.localization_rate,'unknown','نسبة القرار غير صالحة أو مفقودة.');
  if ('effective_from' in rule && !Number.isFinite(Date.parse(rule.effective_from))) add('effective_date','valid date',rule.effective_from,'unknown','تاريخ سريان القرار غير صالح أو مفقود.');
  add('headcount', `${min ?? 0}–${max ?? '∞'}`, count,
    (min != null && count < min) || (max != null && count > max) ? 'fail' : 'pass',
    `عدد المهن المشمولة ${count}؛ شرط التطبيق من ${min ?? 0} إلى ${max ?? 'دون حد أعلى'}.`);
  if (!policy.verified) add('official_review', 'verified structured conditions', null, 'unknown', 'لم يكتمل التحقق الرسمي من جميع شروط هذا القرار؛ لا يعتمد امتثال أو توصية تلقائية.');
  if (policy.calculationUnit && (context.entityScopeComplete!==true || !context.companyActivityCode)) add('calculation_unit',`${policy.calculationUnit} and registered activity`,context.companyActivityCode,'unknown','يجب تأكيد اكتمال الكيان ونشاطه المسجل قبل اعتماد الحساب.');
  if (context.entityScopeComplete === false) add('entity_scope', 'complete entity', false, 'unknown', 'البيانات مقتطف فرع أو مشروع وليست كامل نطاق الكيان.');
  if (context.unmatchedEmployeeCount > 0) add('occupation_mapping', 'complete', context.unmatchedEmployeeCount, 'unknown', 'توجد مسميات لم يُحسم تصنيفها؛ قد يتغير عدد المهن المشمولة.');
  if (policy.sector) {
    const actual = context.companySector;
    add('sector', policy.sector, actual, !actual ? 'unknown' : policy.sector.includes(actual) ? 'pass' : 'fail', 'يلزم تحقق قطاع المنشأة: '+policy.sector.join(' / '));
  }
  if (policy.activities) {
    const actual = context.companyActivityCode;
    add('activity', policy.activities, actual, !actual ? 'unknown' : policy.activities.includes(String(actual)) ? 'pass' : 'fail', 'النشاط المسجل يجب أن يطابق الأنشطة المشمولة بالقرار.');
  }
  const known = new Set(['employee_threshold','employee_maximum','salary_threshold','economic_activity_code','engine_policy']);
  for (const c of rule.conditions || []) {
    if (!known.has(c.condition_type)) { add(c.condition_type,c.text_value ?? c.numeric_value,null,'unknown','شرط إضافي يحتاج تفسيرًا موثقًا: '+c.condition_type); continue; }
    if (c.condition_type === 'economic_activity_code') {
      const actual = context.companyActivityCode;
      add('activity', c.text_value, actual, !actual ? 'unknown' : String(actual) === String(c.text_value) ? 'pass' : 'fail', `النشاط المطلوب ${c.text_value}؛ نشاط المنشأة ${actual || 'غير مسجل'}.`);
    }
    if (['employee_threshold','employee_maximum'].includes(c.condition_type)) {
      const n = numeric(c.numeric_value), op = c.operator || (c.condition_type === 'employee_maximum' ? '<=' : '>=');
      const compare = { '>=': () => count >= n, '<=': () => count <= n, '>': () => count > n, '<': () => count < n, '=': () => count === n, 'in': () => c.json_value?.includes(count) };
      const ok = n == null && op !== 'in' ? null : compare[op]?.();
      add('headcount_condition', `${op} ${n ?? JSON.stringify(c.json_value)}`,count,ok == null ? 'unknown' : ok ? 'pass' : 'fail',`شرط العدد ${op} ${n ?? JSON.stringify(c.json_value)}؛ العدد الحالي ${count}.`);
    }
  }
  for (const c of policy.requirements || []) {
    const actual = context.facts?.[c.field];
    add(c.field,c.equals,actual,actual == null ? 'unknown' : actual === c.equals ? 'pass' : 'fail',c.reason || `تحقق شرط ${c.field}`);
  }
  const state = checks.some(c => c.result === 'fail') ? 'not_applicable' : checks.some(c => c.result === 'unknown') ? 'unknown' : 'applicable';
  const uncertainCount=context.entityScopeComplete===false || context.unmatchedEmployeeCount>0;
  const onlyLowerBoundFailure=checks.filter(c=>c.result==='fail').every(c=>c.code==='headcount' && count<min || c.code==='headcount_condition' && /^(>=|>)/.test(c.expected));
  return { state:state==='not_applicable'&&uncertainCount&&onlyLowerBoundFailure?'unknown':state, checks, reasons: checks.filter(c => c.result !== 'pass').map(c => c.reason), min, max };
}
export function assessEligibility(employee, policy, rule, asOf, evidence=salaryEvidence(employee)) {
  const reasons = [], missing = [];
  let floor = numeric(policy.floor ?? rule.salary_threshold) ?? 0;
  if (!policy.verified) missing.push('شروط الأهلية الرسمية غير مكتملة');
  if (policy.degreeFloors) {
    const degree = String(employee.qualification_level ?? employee.education_level ?? employee.qualification ?? '').trim().toLowerCase();
    const key = /bachelor|بكالوريوس/.test(degree) ? 'bachelor' : /diploma|دبلوم/.test(degree) ? 'diploma' : null;
    floor = key ? policy.degreeFloors[key] : null;
    if (floor == null) missing.push('المؤهل العلمي أو معادلته المعتمدة');
  }
  const basis=policy.salarySource==='gosi'?'gosi':policy.salarySource==='salary'?'monthly':policy.salarySource;
  const selected=evidence.fields[basis];
  const wage=selected?.value??null;
  const wageRequired=floor>0||Boolean(policy.degreeFloors);
  if (wageRequired && wage == null) missing.push(`أساس الأجر ${basis||'غير موثق'}: ${selected?.status||'غير موثق'}؛ وجود راتب آخر لا يثبت أجر هذا الأساس`);
  if (evidence.conflicts.length) missing.push('تعارض حقول الأجر: '+evidence.conflicts.join('، '));
  if (policy.accreditation) {
    const record = employee.professional_accreditations?.[policy.accreditation];
    if (!record || !record.status || !/^\d{4}-\d{2}-\d{2}$/.test(String(record.valid_until||'').slice(0,10)) || !Number.isFinite(Date.parse(record.valid_until))) missing.push(`بيانات اعتماد ${policy.accreditation} وتاريخ صلاحيته`);
    else if (record.status !== 'valid' || String(record.valid_until).slice(0,10) < asOf) reasons.push(`اعتماد ${policy.accreditation} غير ساري`);
  }
  for (const field of policy.employeeRequirements || []) {
    if (employee[field] == null) missing.push(field);
    else if (employee[field] !== true) reasons.push(field);
  }
  const belowSalary = floor != null && wage != null && wage >= 0 && wage < floor;
  const salaryRepairable = belowSalary && !missing.length && !reasons.length;
  if (belowSalary) reasons.push('الأجر دون الحد المطلوب');
  const state=missing.length ? 'unknown' : reasons.length ? 'ineligible' : 'eligible';
  const decisionState=reasons.some(r=>r!=='الأجر دون الحد المطلوب')?'INELIGIBLE_OTHER_REASON':belowSalary?'INELIGIBLE_BELOW_SALARY':wageRequired&&wage==null?'UNKNOWN_MISSING_SALARY':missing.length?'UNKNOWN_MISSING_REQUIREMENT':'ELIGIBLE';
  return { employee, floor, wage, missing, reasons, belowSalary, salaryRepairable, salaryEvidence:evidence, salaryBasis:basis,
    salaryQualified:floor===0 || floor!=null&&wage!=null&&wage>=floor&&!evidence.conflicts.length,
    decisionState, state:decisionState.startsWith('INELIGIBLE')?'ineligible':state };
}
export function requiredEligibleCount(total,rate,rounding) {
  if (!Number.isSafeInteger(total)||total<0||!Number.isFinite(rate)||rate<=0||rate>1) return null;
  if(rounding==='nearest') return Math.round(total*rate);
  if(rounding==='ceil') return Math.ceil(total*rate-1e-10);
  if(rounding==='floor') return Math.floor(total*rate+1e-10);
  return null;
}
export function evaluateWorkforceScenario({ total, saudi, eligible, rate, hires=0, replacements=0, reductions=0, corrections=0 }) {
  const values = [total,saudi,eligible,hires,replacements,reductions,corrections];
  if (values.some(v => !Number.isSafeInteger(v) || v < 0) || eligible > saudi || saudi > total || replacements+reductions > total-saudi || corrections > saudi-eligible || !Number.isFinite(rate) || rate <= 0 || rate > 1) return { valid:false, achieved:false };
  const projectedTotal=total+hires-reductions, projectedEligible=eligible+hires+replacements+corrections;
  const projectedSaudi=saudi+hires+replacements;
  const projectedRate=projectedTotal ? projectedEligible/projectedTotal : 0;
  return { valid:true, hires,replacements,reductions,corrections, projectedTotal,projectedSaudi,projectedEligible,projectedExpatriates:projectedTotal-projectedSaudi,projectedRate:projectedRate*100,
    achieved:projectedTotal>0 && projectedRate+1e-10>=rate, remainingGap:Math.max(0,Math.ceil(projectedTotal*rate-1e-10)-projectedEligible) };
}
export function workforceOptions({ total,saudi,eligible,rate,adjustments=[],wage=null,expatriateWages=[],applicability='applicable',projectedApplicability }) {
  if (applicability !== 'applicable' || !(rate>0 && rate<=1)) return [];
  const ceil=n=>Math.max(0,Math.ceil(n-1e-10));
  const deficit=ceil(total*rate-eligible), foreigners=total-saudi;
  const repairs=Math.min(deficit,adjustments.length), baseEligible=eligible+repairs;
  const hiresFor=e => e+1e-10>=total*rate ? 0 : rate===1 ? null : ceil((rate*total-e)/(1-rate));
  const reduction=ceil(total-eligible/rate);
  const mixedReplace=Math.min(foreigners,Math.floor(deficit/2));
  const mixedHire=hiresFor(eligible+mixedReplace);
  const candidates=[['replacement', {replacements:deficit}],['additional_hiring',{hires:hiresFor(eligible)}],['expatriate_reduction',{reductions:reduction}],
    ['mixed',{replacements:mixedReplace,hires:mixedHire}],['salary_repair_first',{corrections:repairs,hires:hiresFor(baseEligible)}]];
  return candidates.map(([kind,action])=>{
    if(Object.values(action).some(v=>v==null)) return {kind,achieved:false,valid:false,reason:'لا يوجد حل توظيف إضافي محدود لهذه النسبة.'};
    const result=evaluateWorkforceScenario({total,saudi,eligible,rate,...action});
    if(!result.valid || !result.achieved) return {...result,kind,reason:'هذا الخيار لا يغلق الفجوة ضمن الأعداد المتاحة.'};
    const projected=projectedApplicability?.(result.projectedTotal);
    if(projected && projected.state!=='applicable') return {...result,kind,achieved:false,reason:'يتغير نطاق القرار بعد هذا السيناريو؛ يلزم إعادة تقييم جميع المراحل.'};
    const removed=result.replacements+result.reductions;
    const allWages=expatriateWages.length===foreigners && expatriateWages.every(v=>v!=null && v>=0);
    const savings=removed===0 ? 0 : allWages && foreigners ? expatriateWages.reduce((a,b)=>a+b,0)/foreigners*removed : null;
    const adjustmentMonthly=adjustments.slice(0,result.corrections).reduce((s,a)=>s+a.monthly,0);
    const newSalary=result.hires+result.replacements;
    const grossMonthly=newSalary===0 ? adjustmentMonthly : wage>0 ? newSalary*wage+adjustmentMonthly : null;
    const monthly=grossMonthly==null || savings==null ? null : grossMonthly-savings;
    return {...result,kind,wage,grossMonthly,monthly,annual:monthly==null?null:monthly*12,estimatedSavings:savings,
      assumptions:'التعيينات مؤهلة بالكامل؛ تكلفة الرواتب تقديرية، وتكلفة الخروج والمزايا غير مشمولة. لا يحدد السيناريو أفرادًا لإنهاء خدماتهم.'};
  });
}
