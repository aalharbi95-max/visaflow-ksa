// Display-only layer. No regulatory matching, eligibility or financial calculations.
export function reportLanguage(value) {
  const key=String(value||'en').trim().toLowerCase();
  const aliases={ar:'ar',arabic:'ar',en:'en',english:'en',mixed:'mixed',bilingual:'mixed'};
  if(!aliases[key]) throw new Error('Unsupported report language');
  return aliases[key];
}
export const OCCUPATION_TERMS={
  '241101':{ar:'محاسب',en:'Accountant'},
  '311511':{ar:'فني صيانة ميكانيكية',en:'Mechanical maintenance technician'},
  '311301':{ar:'فني هندسة كهربائية',en:'Electrical engineering technician'},
  '311207':{ar:'فني صيانة مباني',en:'Building maintenance technician'},
  '214201':{ar:'مهندس مدني',en:'Civil engineer'},
  '242108':{ar:'أخصائي إدارة مشاريع',en:'Project management specialist'},
  '121314':{ar:'مدير إدارة مشاريع',en:'Project management director'},
  '214909':{ar:'مهندس إدارة مشاريع',en:'Project management engineer'},
};
export const TERMINOLOGY_VERSION='SSCO-2026-report-1';
// Stable occupation codes from official decision schedules; reviewed display equivalents.
const D={
 title:['توطين المهن','Occupation localization'],executive:['تقرير الإدارة التنفيذية','Executive report'],detailed:['تقرير الامتثال التفصيلي','Detailed compliance report'],
 summary:['الموقف التنفيذي','Executive position'],workforce:['القوى العاملة','Workforce overview'],current:['التعرض الحالي للامتثال','Current compliance exposure'],upcoming:['المراحل التنظيمية القادمة','Upcoming regulatory changes'],salary:['الأجور والأهلية','Salary and eligibility risks'],scenarios:['خيارات معالجة القوى العاملة','Workforce action scenarios'],decisions:['قرارات الإدارة المطلوبة','Management decisions required'],roadmap:['خطة الثلاثين والستين والتسعين يومًا','30 / 60 / 90-day action plan'],
 total:['الموظفون النشطون','Active employees'],saudi:['السعوديون','Saudi employees'],nonSaudi:['غير السعوديين','Non-Saudi employees'],matched:['الموظفون المشمولون','Matched employees'],eligible:['مستوفو شروط الأهلية المثبتة','Verified eligible Saudis'],salaryQualified:['المستوفون لشرط الأجر','Salary-qualified Saudis'],unresolved:['أهلية غير محسومة','Unresolved eligibility'],ineligible:['غير مستوفين للأهلية','Ineligible Saudis'],required:['المطلوب نظاميًا','Required eligible Saudis'],gap:['الفجوة المؤكدة','Confirmed shortfall'],potential:['الفجوة العددية المحتملة','Potential numerical shortfall'],payroll:['لديهم أجر مسجل','Recorded payroll available'],wage:['الأجر المعتمد للاحتساب','Legally qualifying wage'],floor:['حد الأجر','Salary threshold'],monthly:['التغير الشهري في الرواتب','Monthly salary change'],annual:['التغير السنوي في الرواتب','Annual salary change'],date:['تاريخ السريان','Effective date'],scope:['نطاق القرار','Regulatory scope'],status:['حالة الامتثال','Compliance status'],sources:['المراجع والتحقق','Sources and verification'],employee:['الموظف','Employee'],audit:['تدقيق أهلية الموظفين','Employee eligibility audit'],reconciliation:['مطابقة أساس الأجر','Salary reconciliation'],excluded:['القرارات غير المنطبقة','Non-applicable decisions'],history:['المراحل السابقة','Historical phases'],
 unknown:['غير محسوم','Not determined'],notVerified:['غير متحقق','Not verified'],notRequired:['لا يشترطه القرار المتحقق','Not required by the verified decision'],met:['مستوفى بناءً على البيانات المتحققة','Met on verified evidence'],shortfall:['فجوة مؤكدة','Confirmed shortfall'],pending:['يلزم التحقق','Verification pending'],notApplicable:['لا ينطبق','Not applicable'],applicable:['منطبق','Applicable'],
 unknownHeadline:['لا يمكن تأكيد فجوات الامتثال الحالية حتى استكمال الأهلية ونطاق الاحتساب.','Current compliance gaps cannot be confirmed until eligibility and calculation scope are verified.'],completeHeadline:['تظهر أدناه النتائج المؤكدة وفق البيانات المتاحة؛ راجع الفجوات لكل قرار.','Verified results are shown below; review shortfalls separately for each decision.'],noRows:['لا توجد مراحل مطابقة ضمن هذه الفترة.','No matched stages in this period.'],
 rangeAssumption:['النطاق المحتمل مشروط بانطباق القرار؛ حدّه الأدنى يفترض تأهل جميع مجهولي الأهلية، والأعلى يفترض عدم تأهلهم. لا يُجمع بين القرارات أو المراحل.','The range is conditional on rule applicability. Its lower bound assumes all unresolved Saudis qualify; its upper bound assumes none qualify. Do not add ranges across decisions or phases.'],
 noHiring:['لا تعتمد توصية توظيف من أهلية غير محسومة؛ استكمل البيانات أولًا.','Do not approve hiring from unresolved eligibility alone. Verify the missing evidence first.'],
 payrollNote:['الأجر المسجل في الملف لا يثبت أجر الاشتراك أو استيفاء الاعتماد المهني.','Recorded payroll does not establish the contributory wage or professional accreditation.'],
 costsNote:['التكلفة تقديرية فقط عند توفر أساسها؛ لا تشمل التوظيف أو المزايا أو إنهاء الخدمة، ولا تجمع الخيارات البديلة.','Costs are planning estimates only where supported. They exclude recruitment, benefits and exit costs. Do not add alternative scenarios.'],
 disclaimer:['تقديرات تخطيطية داخلية، وليست نتيجة رسمية معتمدة من قوى.','Internal planning estimates, not an official Qiwa compliance result.'],
 verifyScope:['تأكيد النشاط ووحدة الاحتساب والاستثناءات','Confirm activity, calculation unit and exceptions'],verifyEligibility:['توثيق أجر الاشتراك والمؤهل والاعتماد','Verify contributory wage, qualification and accreditation'],approveScenario:['اعتماد خيار معالجة بعد استكمال التحقق','Approve a corrective scenario after verification'],monitor:['متابعة المراحل وإعادة حساب المؤشرات','Monitor upcoming stages and recalculate'],
 priorityUrgent:['عاجل','Urgent'],priorityPlanned:['مخطط','Planned'],ownerCompliance:['الامتثال والموارد البشرية','Compliance and HR'],ownerPayroll:['الرواتب والموارد البشرية','Payroll and HR'],ownerManagement:['الإدارة التنفيذية','Executive management'],
 day30:['خلال 30 يومًا','Within 30 days'],day60:['خلال 60 يومًا','Within 60 days'],day90:['خلال 90 يومًا','Within 90 days'],
 replacement:['الإحلال','Replacement'],additional_hiring:['التوظيف الإضافي','Additional hiring'],expatriate_reduction:['تخفيض غير السعوديين','Non-Saudi headcount reduction'],mixed:['معالجة مختلطة','Combined scenario'],salary_repair_first:['تصحيح الأجور ثم التوظيف','Wage correction before hiring'],hires:['تعيينات إضافية','Additional hires'],replacements:['إحلال','Replacements'],reductions:['تخفيض','Reductions'],corrections:['تصحيح أهلية','Eligibility corrections'],projected:['المؤهلون بعد التنفيذ','Projected eligible workforce'],
 ELIGIBLE:['مستوفٍ للأهلية','Eligible'],INELIGIBLE_BELOW_SALARY:['دون حد الأجر المعتمد','Below the qualifying wage threshold'],INELIGIBLE_OTHER_REASON:['غير مستوفٍ لمتطلب آخر','Another eligibility requirement is not met'],UNKNOWN_MISSING_SALARY:['أساس الأجر مفقود أو غير صالح','Qualifying wage missing or invalid'],UNKNOWN_MISSING_REQUIREMENT:['متطلبات أهلية غير موثقة','Eligibility requirements unverified'],UNKNOWN_PENDING_SCOPE_VERIFICATION:['نطاق الاحتساب غير متحقق','Calculation scope unverified'],
 headcount:['العدد خارج حدود تطبيق القرار','Headcount outside the rule boundaries'],headcount_condition:['شرط عدد الموظفين غير مستوفى','Employee-count condition not met'],sector:['قطاع المنشأة غير مؤكد أو غير مشمول','Company sector unverified or outside scope'],activity:['النشاط الاقتصادي غير مؤكد أو غير مشمول','Economic activity unverified or outside scope'],calculation_unit:['اكتمال وحدة الاحتساب والنشاط غير متحقق','Calculation-unit completeness and activity unverified'],entity_scope:['المقتطف لا يمثل كامل وحدة الاحتساب','The selection does not represent the full calculation unit'],accountingOffice:['يلزم تحقق استثناء مكاتب المحاسبة','Accounting-office exception requires verification'],official_review:['الشروط التنظيمية لم تراجع بالكامل','Regulatory conditions have not been fully verified'],occupation_mapping:['تصنيف بعض المهن غير محسوم','Some occupation mappings are unresolved'],data_quality:['توجد مشكلة في اكتمال أو تكرار البيانات','Data completeness or duplication requires review'],rate:['نسبة القرار غير صالحة','Rule percentage is invalid'],effective_date:['تاريخ السريان غير صالح','Effective date is invalid'],otherCheck:['شرط إضافي يحتاج مراجعة','An additional requirement needs review'],
 basis_gosi:['أجر الاشتراك في التأمينات','Contributory wage'],basis_monthly:['الأجر الشهري المسجل','Recorded monthly salary'],basis_basic:['الأجر الأساسي','Basic salary'],basis_total:['إجمالي الأجر','Total salary'],basis_allowances:['البدلات','Allowances'],
 MISSING:['غير مسجل','Missing'],INVALID:['صيغة غير صالحة','Invalid format'],CONFLICT:['قيم متعارضة','Conflicting values'],VALID:['قيمة صالحة','Valid value'],source:['المصدر الرسمي','Official source'],ruleVersion:['إصدار القاعدة','Rule version'],reviewed:['تاريخ المراجعة','Review date'],untranslated:['مسمى يحتاج اعتماد الترجمة','Title translation requires verification'],noFinancial:['الأثر المالي غير متحقق؛ لا توجد ميزانية مقترحة قابلة للاعتماد.','Financial exposure is unverified; no supportable budget is proposed.'],
};
export const t=(key,language)=>{const value=D[key];if(!value)throw Error(`Missing translation: ${key}`);return value[language==='ar'?0:1];};
export const number=(value,language)=>value==null?t('unknown',language):new Intl.NumberFormat(language==='ar'?'ar-SA':'en-GB',{maximumFractionDigits:2}).format(value);
export function date(value,language) {
  const key=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return t('notVerified',language);
  const d=new Date(key+'T00:00:00Z');if(!Number.isFinite(+d))return t('notVerified',language);
  return new Intl.DateTimeFormat(language==='ar'?'ar-SA-u-ca-gregory':'en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(d);
}
export function employeesText(count,language) {
  const n=number(count,language);if(language==='en')return `${n} ${new Intl.PluralRules('en').select(count)==='one'?'employee':'employees'}`;
  const category=new Intl.PluralRules('ar').select(count);return `${n} ${category==='two'?'موظفان':category==='few'?'موظفين':'موظفًا'}`;
}
export function occupationName(code,language,record={}) {
  const term=OCCUPATION_TERMS[String(code)]?.[language];if(term)return term;
  const candidate=record[`occupation_name_${language}`]||record[`profession_name_${language}`];
  if(candidate && (language==='en'?!/\p{Script=Arabic}/u.test(candidate):/\p{Script=Arabic}/u.test(candidate)))return candidate;
  return `${t('untranslated',language)} (${String(code||'').replace(/[^\d]/g,'')||'—'})`;
}
export function ruleName(row,language) {
  const id=String(row.rule_code||'');
  const pair=id.startsWith('ACCOUNTING_')?['المهن المحاسبية','Accounting professions']:id==='ENGINEERING_2026'?['المهن الهندسية','Engineering professions']:id==='TECH_ENGINEERING_2025'?['المهن الفنية الهندسية','Technical engineering professions']:id.startsWith('PROJECT_MGMT')?['إدارة المشاريع','Project management']:null;
  const named=row[`rule_name_${language}`];
  const name=pair?.[language==='ar'?0:1]||(named && (language==='en'?!/\p{Script=Arabic}/u.test(named):/\p{Script=Arabic}/u.test(named))?named:null);
  return name||(language==='ar'?`قرار توطين رقم ${String(row.decision_number||'').replace(/[^\d]/g,'')||'غير موثق'}`:`Localization decision ${String(row.decision_number||'').replace(/[^\d]/g,'')||'awaiting verification'}`);
}
export const gapLabel=(row,lang)=>row.shortage==null?t('unknown',lang):number(row.shortage,lang);
export const potentialLabel=(row,lang)=>row.potentialGap?`${number(row.potentialGap.min,lang)}–${number(row.potentialGap.max,lang)}`:t('notVerified',lang);
export function floorLabel(row,lang) {
  const floors=row.regulatoryVerification?.degreeFloors;
  if(floors)return lang==='ar'?`بكالوريوس ${number(floors.bachelor,lang)}؛ دبلوم ${number(floors.diploma,lang)} ريال`:`Bachelor ${number(floors.bachelor,lang)}; diploma ${number(floors.diploma,lang)} SAR`;
  if(row.regulatoryVerification?.verified&&row.regulatoryVerification?.floor===0)return t('notRequired',lang);
  if(!(row.salaryFloor>0))return t('notVerified',lang);
  return `${number(row.salaryFloor,lang)} ${lang==='ar'?'ريال':'SAR'}`;
}
export function rowStatus(row,lang) {return t(row.applicability?.state==='not_applicable'?'notApplicable':row.shortage==null?'pending':row.shortage>0?'shortfall':'met',lang);}
export function scopeReasons(row,lang) {return [...new Set((row.applicability?.checks||[]).filter(c=>c.result!=='pass').map(c=>t(D[c.code]?c.code:'otherCheck',lang)))];}
const cleanId=value=>String(value??'').replace(/[^A-Za-z0-9-]/g,'').slice(0,30);
export function buildTawteenDisplay(report,{language='en',mode='executive',asOf}={}) {
  const lang=reportLanguage(language);if(!['executive','detailed'].includes(mode))throw Error('Unsupported report mode');
  const langs=lang==='mixed'?['ar','en']:[lang];
  const current=(report.current||[]).filter(r=>r.matchedCount),future=(report.upcoming||[]).filter(r=>r.matchedCount),active=[...current,...future];
  const pages=[];
  // Every block holds one independent paragraph per language. Never concatenate mixed sentences.
  const page=(key,blocks,extra={})=>pages.push({key,title:Object.fromEntries(langs.map(l=>[l,t(key,l)])),blocks:blocks.map(fn=>Object.fromEntries(langs.map(l=>[l,fn(l)]))),...extra});
  const ruleLine=r=>l=>`${ruleName(r,l)} (${number(r.localization_rate*100,l)}%)\n${t('matched',l)}: ${number(r.matchedCount,l)}; ${t('saudi',l)}: ${number(r.saudiCount,l)}\n${t('gap',l)}: ${gapLabel(r,l)}; ${t('potential',l)}: ${potentialLabel(r,l)}\n${t('date',l)}: ${date(r.effective_from,l)}. ${rowStatus(r,l)}`;
  const unknown=current.some(r=>r.shortage==null);
  const summary=[l=>t(unknown?'unknownHeadline':'completeHeadline',l),l=>`${t('total',l)}: ${number(report.activeEmployeeCount,l)}\n${t('saudi',l)}: ${number(report.saudiEmployeeCount,l)}; ${t('nonSaudi',l)}: ${number(report.nonSaudiEmployeeCount,l)}`,l=>`${t('current',l)}: ${number(current.length,l)}; ${t('upcoming',l)}: ${number(future.length,l)}\n${t('pending',l)}: ${number(active.filter(r=>r.shortage==null).length,l)}`,l=>t('disclaimer',l)];
  page('summary',summary);
  const allMatched=(report.rows||[]).filter(r=>r.matchedCount);
  const groups=new Map();for(const r of allMatched)for(const p of r.professionBreakdown||[])if(p.employee_count)groups.set(String(p.profession_code),p);
  const grouped=[...groups.values()];
  page('workforce',grouped.slice(0,6).map(p=>l=>`${occupationName(p.profession_code,l,p)}\n${employeesText(p.employee_count,l)}; ${t('saudi',l)}: ${number(p.saudi_count,l)}`),{chart:{labels:['saudi','nonSaudi'],values:[report.saudiEmployeeCount??0,report.nonSaudiEmployeeCount??0]}});
  if(mode==='executive') {
    const compact=r=>l=>`${ruleName(r,l)} ${number(r.localization_rate*100,l)}% · ${date(r.effective_from,l)}\n${t('gap',l)}: ${gapLabel(r,l)}; ${t('potential',l)}: ${potentialLabel(r,l)}`;
    page('current',[...current.slice(0,3).map(compact),l=>t('rangeAssumption',l)]);
    page('upcoming',[...future.slice(0,3).map(compact),l=>l==='ar'?`عرض ${number(Math.min(future.length,3),l)} من ${number(future.length,l)} مراحل؛ بقية الأدلة في التقرير التفصيلي.`:`Showing ${Math.min(future.length,3)} of ${future.length} stages. Remaining evidence is in the detailed report.`]);
    page('salary',[l=>t('payrollNote',l),...current.slice(0,3).map(r=>l=>`${ruleName(r,l)}\n${t('payroll',l)}: ${number(r.recordedSalarySaudiCount,l)}; ${t('unresolved',l)}: ${number(r.unknownEligibilityCount,l)}\n${t('floor',l)}: ${floorLabel(r,l)}`)]);
    const options=current.flatMap(r=>(r.options||[]).filter(o=>o.achieved).slice(0,1).map(o=>({r,o})));
    page('scenarios',options.length?[...options.slice(0,3).map(({r,o})=>l=>scenarioText(r,o,l)),l=>t('costsNote',l)]:[l=>t('noHiring',l),l=>t('noFinancial',l),l=>t('rangeAssumption',l)]);
    page('decisions',[l=>`${t('priorityUrgent',l)}: ${t('verifyScope',l)}\n${t('ownerCompliance',l)}. ${employeesText(report.activeEmployeeCount,l)}`,l=>`${t('priorityUrgent',l)}: ${t('verifyEligibility',l)}\n${t('ownerPayroll',l)}. ${t('noHiring',l)}`,l=>`${t('priorityPlanned',l)}: ${t('approveScenario',l)}\n${t('ownerManagement',l)}. ${t('costsNote',l)}`]);
    page('roadmap',[l=>`${t('day30',l)}\n${t('verifyScope',l)}; ${t('verifyEligibility',l)}.\n${t('ownerCompliance',l)}`,l=>`${t('day60',l)}\n${t('approveScenario',l)}.\n${t('ownerManagement',l)}`,l=>`${t('day90',l)}\n${t('monitor',l)}.\n${t('ownerPayroll',l)}`]);
  } else {
    for(const r of allMatched) {
      page(r.status==='expired'?'history':r.status==='upcoming'?'upcoming':'current',[ruleLine(r),l=>`${t('eligible',l)}: ${number(r.eligibleSaudiCount,l)}; ${t('salaryQualified',l)}: ${number(r.salaryQualifiedSaudiCount,l)}\n${t('unresolved',l)}: ${number(r.unknownEligibilityCount,l)}; ${t('ineligible',l)}: ${number(r.ineligibleSaudiCount,l)}\n${t('required',l)}: ${number(r.requiredSaudiCount,l)}; ${t('floor',l)}: ${floorLabel(r,l)}`,l=>scopeReasons(r,l).join('\n')||t('applicable',l),l=>t('rangeAssumption',l)],{ruleId:r.rule_code});
      for(let i=0;i<r.eligibility.length;i+=3)page('audit',r.eligibility.slice(i,i+3).map(e=>l=>`${t('employee',l)} ${cleanId(e.employee.employee_no||e.employee.id)} · ${ruleName(r,l)}\n${t(e.decisionState||'UNKNOWN_MISSING_REQUIREMENT',l)}\n${t('payroll',l)}: ${number(e.salaryEvidence?.fields.monthly.value,l)}; ${t('wage',l)}: ${number(e.wage,l)}; ${t('floor',l)}: ${e.floor===0?t('notRequired',l):number(e.floor,l)}\n${t(D['basis_'+e.salaryBasis]?'basis_'+e.salaryBasis:'notVerified',l)}; ${t(e.salaryEvidence?.fields[e.salaryBasis]?.status||'MISSING',l)}`),{ruleId:r.rule_code});
      const options=(r.options||[]).filter(o=>o.achieved);for(let i=0;i<options.length;i+=3)page('scenarios',options.slice(i,i+3).map(o=>l=>scenarioText(r,o,l)),{ruleId:r.rule_code});
    }
    const excluded=report.notApplicable||[];
    for(let i=0;i<excluded.length;i+=4)page('excluded',excluded.slice(i,i+4).map(r=>l=>`${ruleName(r,l)} (${number(r.localization_rate*100,l)}%)\n${employeesText(r.matchedCount,l)}; ${scopeReasons(r,l).join('; ')}`));
    for(let i=0;i<allMatched.length;i+=3)page('sources',allMatched.slice(i,i+3).map(r=>l=>`${ruleName(r,l)}\n${t('reviewed',l)}: ${date(r.regulatoryVerification?.reviewedOn,l)}\n${t('status',l)}: ${t(r.regulatoryVerification?.verified?'applicable':'notVerified',l)}`),{links:allMatched.slice(i,i+3).map(r=>r.source_url)});
  }
  return {language:lang,mode,languages:langs,asOf,pages};
}
export function scenarioText(row,o,l) {return `${ruleName(row,l)}: ${t(o.kind,l)}\n${t('hires',l)}: ${number(o.hires,l)}; ${t('replacements',l)}: ${number(o.replacements,l)}; ${t('reductions',l)}: ${number(o.reductions,l)}; ${t('corrections',l)}: ${number(o.corrections,l)}\n${t('projected',l)}: ${number(o.projectedEligible,l)}/${number(o.projectedTotal,l)} (${number(o.projectedRate,l)}%)\n${t('monthly',l)}: ${number(o.monthly,l)}; ${t('annual',l)}: ${number(o.annual,l)} ${l==='ar'?'ريال':'SAR'}`;}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function localizedReportHtml(report,options={}) {
  const model=buildTawteenDisplay(report,options);
  return `<!doctype html><html lang="${model.language==='mixed'?'ar':model.language}"><head><meta charset="utf-8"><title>VisaFlow — Tawteen</title><style>body{font:16px Arial,sans-serif;margin:32px;color:#0f172a;line-height:1.7}section{border-bottom:1px solid #cbd5e1;padding:16px 0}h2{color:#075985}@media print{section{break-before:page}section:first-child{break-before:auto}}</style></head><body>${model.pages.map(p=>`<section>${model.languages.map(l=>`<div dir="${l==='ar'?'rtl':'ltr'}" lang="${l}"><h2>${escape(p.title[l])}</h2>${p.blocks.map(b=>`<p>${escape(b[l]).replaceAll('\n','<br>')}</p>`).join('')}</div>`).join('')}</section>`).join('')}</body></html>`;
}
export function localizedAuditSheets(report,language) {
  const mode=reportLanguage(language),langs=mode==='mixed'?['ar','en']:[mode];
  const label=k=>langs.map(l=>t(k,l)).join('\n');const phrase=fn=>langs.map(fn).join('\n');
  const rows=(report.rows||[]).filter(r=>r.matchedCount);
  return [
    {name:label('summary').slice(0,31),rows:[{[label('total')]:report.activeEmployeeCount,[label('saudi')]:report.saudiEmployeeCount,[label('nonSaudi')]:report.nonSaudiEmployeeCount,[label('status')]:phrase(l=>t(rows.some(r=>r.shortage==null)?'pending':'completeHeadline',l))}]},
    {name:label('current').slice(0,31),rows:rows.map(r=>({[label('title')]:phrase(l=>ruleName(r,l)),[label('date')]:phrase(l=>date(r.effective_from,l)),[label('matched')]:r.matchedCount,[label('saudi')]:r.saudiCount,[label('nonSaudi')]:r.nonSaudiCount,[label('salaryQualified')]:r.salaryQualifiedSaudiCount,[label('eligible')]:r.eligibleSaudiCount,[label('unresolved')]:r.unknownEligibilityCount,[label('required')]:r.requiredSaudiCount??phrase(l=>t('unknown',l)),[label('gap')]:r.shortage??phrase(l=>t('unknown',l)),[label('potential')]:phrase(l=>potentialLabel(r,l)),[label('scope')]:phrase(l=>scopeReasons(r,l).join('; ')||t('applicable',l)),[label('status')]:phrase(l=>rowStatus(r,l))}))},
    {name:label('audit').slice(0,31),rows:rows.flatMap(r=>(r.eligibility||[]).map(e=>({[label('title')]:phrase(l=>ruleName(r,l)),[label('employee')]:cleanId(e.employee.employee_no||e.employee.id),[label('payroll')]:e.salaryEvidence?.fields.monthly.value??phrase(l=>t('notVerified',l)),[label('wage')]:e.wage??phrase(l=>t('notVerified',l)),[label('status')]:phrase(l=>t(e.decisionState||'UNKNOWN_MISSING_REQUIREMENT',l)),[label('scope')]:phrase(l=>rowStatus(r,l))})))},
    {name:label('sources').slice(0,31),rows:rows.map(r=>({[label('title')]:phrase(l=>ruleName(r,l)),[label('source')]:encodeURI(r.source_url||''),[label('reviewed')]:phrase(l=>date(r.regulatoryVerification?.reviewedOn,l)),[label('status')]:phrase(l=>t(r.regulatoryVerification?.verified?'applicable':'notVerified',l))}))},
  ];
}
