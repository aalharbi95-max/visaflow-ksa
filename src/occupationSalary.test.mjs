import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSalary,salaryEvidence,importedMonthlySalary} from './occupationSalary.mjs';
import {assessEligibility,requiredEligibleCount} from './occupationLocalization.mjs';
import {buildTawteenReport} from './tawteenReport.mjs';
test('salary normalization preserves zero, currency formats, missing and invalid independently',()=>{
  for(const v of [8000,'8,000.00 SAR','SAR 8,000','٨٬٠٠٠٫٠٠ ر.س']) assert.equal(normalizeSalary(v).value,8000);
  for(const v of [null,undefined,'','  ']) assert.equal(normalizeSalary(v).status,'MISSING');
  for(const v of [false,-1,'8,00','1e4','8 000 USD','oops']) assert.equal(normalizeSalary(v).status,'INVALID');
  assert.equal(importedMonthlySalary({'Monthly Salary':0}),0);
  assert.equal(importedMonthlySalary({}),null);
  assert.throws(()=>importedMonthlySalary({'Monthly Salary':'bad'}));
  assert.throws(()=>importedMonthlySalary({salary:8000,'Monthly Salary':7000}));
  assert.equal(salaryEvidence({basic_salary:4000,allowances:1000,total_salary:8000}).conflicts.length,1);
});
test('eligibility states distinguish recorded payroll from legal wage and requirements',()=>{
  const p={verified:true,salarySource:'gosi',floor:8000};
  const assess=e=>assessEligibility(e,p,{},'2026-11-06');
  const missing=assess({salary:8500});
  assert.equal(missing.decisionState,'UNKNOWN_MISSING_SALARY');
  assert.equal(missing.salaryEvidence.fields.monthly.value,8500);
  assert.equal(assess({gosi_salary:7999}).decisionState,'INELIGIBLE_BELOW_SALARY');
  assert.equal(assess({gosi_salary:8000}).decisionState,'ELIGIBLE');
  assert.equal(assessEligibility({gosi_salary:8000},{...p,employeeRequirements:['credential']},{},'2026-11-06').decisionState,'UNKNOWN_MISSING_REQUIREMENT');
  assert.equal(assessEligibility({gosi_salary:8000,credential:false},{...p,employeeRequirements:['credential']},{},'2026-11-06').decisionState,'INELIGIBLE_OTHER_REASON');
});
test('rounding is specific to decision and missing metadata never defaults to ceil',()=>{
  assert.equal(requiredEligibleCount(41,.3,'nearest'),12);
  assert.equal(requiredEligibleCount(41,.3,'ceil'),13);
  assert.equal(requiredEligibleCount(41,.3,undefined),null);
});
test('unknown gap has a bounded range, no confirmed zero and no hiring plan',()=>{
 const employees=Array.from({length:10},(_,id)=>({id,profession_code:'1',nationality:id<5?'Saudi':'India',salary:8000}));
 const input={employees,asOf:'2026-11-06',rules:[{rule_code:'TEST',effective_from:'2026-01-01',localization_rate:.5,engine_policy:{verified:true,salarySource:'gosi',floor:8000,rounding:'nearest'}}],professions:[{rule_code:'TEST',profession_code:'1'}]};
 const r=buildTawteenReport(input).current[0];
 assert.equal(r.shortage,null);assert.equal(r.calculationStatus,'NOT_DETERMINED');assert.deepEqual(r.potentialGap,{min:0,max:5,conditionalOnScope:false});assert.equal(r.options.length,0);
 assert.deepEqual(buildTawteenReport(input),buildTawteenReport(input));
 assert.throws(()=>buildTawteenReport({...input,employees:[{company_id:'A'},{company_id:'B'}]}),/TENANT_SCOPE/);
});
