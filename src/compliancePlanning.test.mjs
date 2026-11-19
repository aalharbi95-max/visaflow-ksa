import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateSalaryPlans, wageWeight, simulateNitaqat, salaryPlan, scopeEmployees, salaryOf, daysUntil, riyadhDate, saudiEmployee } from './compliancePlanning.mjs';
import { buildTawteenReport as buildReport } from './tawteenReport.mjs';
// Synthetic wage-only rules explicitly declare their complete fixture policy.
const buildTawteenReport = input => buildReport({...input,rules:input.rules.map(r=>({...r,engine_policy:{verified:true,min:1,salarySource:'salary',rounding:'ceil'}}))});

test('wage boundaries and unsupported categories', () => {
  assert.deepEqual([null, 0, 2999, 3000, 3999, 4000].map(v => wageWeight(v)), [null, 0, 0, .5, .5, 1]);
  assert.equal(wageWeight(8000, 'part_time'), .5);
  assert.equal(wageWeight(8000, 'flexible'), null);
  assert.equal(salaryOf({gosi_salary: 0, salary:8000}), 0);
  assert.equal(salaryOf({salary: ''}), null);
  assert.equal(saudiEmployee({nationality:'Non-Saudi'}), false);
});
const employees = Array.from({length:10}, (_,i) => ({id:i,nationality:i < 2 ? 'Saudi':'Indian',salary:4000}));
test('smallest hire count and full/half weighting with changing denominator', () => {
  const activity = {curve:[0,0,0,0],threshold2026:[30,50,70,90]};
  const full = simulateNitaqat({employees,activity});
  assert.equal(full.hires,2);
  const half = simulateNitaqat({employees,activity,hireSalary:3000});
  assert.equal(half.hires,3);
  assert.equal(full.annual,96000);
  assert.equal(simulateNitaqat({employees,activity,hireSalary:2000}).hires,null);
  assert.equal(simulateNitaqat({employees:[...employees,{nationality:'Saudi'}],activity}).status,'review');
});
test('activity curve moves with new headcount, and prior integer fails target', () => {
  const activity = {curve:[10,10,10,10],threshold2026:[10,20,30,40]};
  const result = simulateNitaqat({employees,activity});
  const previous = result.hires - 1;
  assert.ok((2+previous)/(10+previous)*100 < 10*Math.log(10+previous)+10);
  assert.ok(result.projectedRate >= result.targetRate);
});
test('salary repair chooses cheapest, then solves added hiring denominator', () => {
  const plan = salaryPlan({employees:[{id:'a',salary:4000},{id:'b',salary:4900},{id:'c'}],salaryFloor:5000,shortage:3,rate:.5,matchedCount:10,eligible:2,marketSalary:6000});
  assert.deepEqual(plan.adjustments.map(a=>a.id),['b','a']);
  assert.equal(plan.hires,2);
  assert.equal(plan.monthly,13100);
  assert.equal(plan.annual,157200);
  assert.equal(plan.alerts.length,2);
});
test('100% needs replacement, and absent market data is never priced at zero', () => {
  assert.equal(salaryPlan({employees:[],salaryFloor:5000,shortage:1,rate:1,matchedCount:2,eligible:1}).hires,null);
  assert.equal(salaryPlan({employees:[],salaryFloor:5000,shortage:1,rate:.5,matchedCount:2,eligible:0}).monthly,null);
});
test('scope intersection and Riyadh date boundaries', () => {
  assert.equal(scopeEmployees([{branch_name:'R',project_name:'A'},{branch_name:'J',project_name:'A'}],{branch:'R',project:'A'}).length,1);
  assert.equal(riyadhDate('2026-10-31T22:00:00Z'),'2026-11-01');
  assert.equal(daysUntil('2027-02-01','2026-10-31'),93);
});
test('report exposes salary plans, missing wages, active scope and future countdown', () => {
  const report = buildTawteenReport({asOf:'2026-10-31',marketSalary:8000,rules:[{rule_code:'ENGINEER',effective_from:'2027-02-01',localization_rate:.5,salary_threshold:8000}],professions:[{rule_code:'ENGINEER',profession_code:'123'}],employees:[{id:1,nationality:'Saudi',profession_code:'123',salary:7000},{id:2,nationality:'Saudi',profession_code:'123'},{id:3,nationality:'Indian',profession_code:'123'},{id:4,status:'Terminated',profession_code:'123'}]});
  assert.equal(report.upcoming[0].daysUntilEffective,93);
  assert.equal(report.upcoming[0].saudiMissingSalaryCount,1);
  assert.equal(report.upcoming[0].plan.alerts[0].monthly,1000);
  assert.equal(report.upcoming[0].shortage,null);
  assert.equal(report.upcoming[0].plan.monthly,null);
  assert.equal(report.activeEmployeeCount,3);
});

test('exact wage boundaries, explicit zero and invalid values do not fall through', () => {
  for (const type of ['full_time','part_time']) {
    assert.equal(wageWeight(0,type),0);
    assert.equal(wageWeight(2999.99,type),0);
    assert.equal(wageWeight(3000,type),.5);
    assert.equal(wageWeight(3999.99,type),.5);
    assert.equal(wageWeight(4000,type),type==='full_time'?1:.5);
    for (const invalid of ['', ' ', NaN, Infinity, -1, true]) assert.equal(wageWeight(invalid,type),null);
  }
  assert.equal(salaryOf({gosi_salary:0,salary:5000}),0);
  assert.equal(salaryOf({salary:0,basic_salary:5000}),0);
});

test('shared employee cost is max raise once, with separate future scenarios', () => {
  const report=buildTawteenReport({asOf:'2026-10-31',marketSalary:8000,
    rules:[{rule_code:'A',effective_from:'2026-01-01',salary_threshold:5000,localization_rate:.5},{rule_code:'B',effective_from:'2026-01-01',salary_threshold:8000,localization_rate:.5},{rule_code:'C',effective_from:'2027-02-01',salary_threshold:9000,localization_rate:.5}],
    professions:['A','B','C'].map(rule_code=>({rule_code,profession_code:'123'})),
    employees:[{id:'same',nationality:'Saudi',profession_code:'123',salary:4000},{id:'expat',nationality:'Indian',profession_code:'123'}]});
  assert.equal(report.consolidatedCurrent.adjustments.length,1);
  assert.equal(report.consolidatedCurrent.adjustmentMonthly,4000);
  assert.equal(report.consolidatedCurrent.annual,48000);
  assert.equal(report.consolidatedUpcoming.adjustmentMonthly,5000);
  assert.deepEqual(report.consolidatedCurrent.residuals.map(r=>r.hires),[0,0]);
});

test('missing identity never silently produces a complete consolidated budget', () => {
  const plan=salaryPlan({employees:[{salary:4000}],salaryFloor:5000,shortage:1,rate:.5,matchedCount:2,eligible:0});
  const result=consolidateSalaryPlans([{rule_code:'A',plan,shortage:1,localization_rate:.5,matchedCount:2,eligibleSaudiCount:0}]);
  assert.equal(result.unidentified,true);
  assert.equal(result.monthly,null);
  assert.equal(result.adjustmentMonthly,null);
});

test('timeout is explicit and does not claim a minimum integer or cost', () => {
  let time=0;
  const result=simulateNitaqat({employees,activity:{curve:[0,0,0,0],threshold2026:[99,99,99,99]},timeoutMs:1,clock:()=>time++});
  assert.equal(result.status,'timeout');
  assert.equal(result.hires,null);
  assert.equal(result.monthly,undefined);
});

test('10,000 employee stress: reporting and bounded Nitaqat search', () => {
  const people=Array.from({length:10000},(_,id)=>({id,nationality:id%4===0?'Saudi':'Indian',salary:4000,profession_code:'123'}));
  const started=performance.now();
  const simulation=simulateNitaqat({employees:people,activity:{curve:[0,0,0,0],threshold2026:[30,50,70,90]}});
  assert.ok(['ready','timeout'].includes(simulation.status));
  if(simulation.status==='ready') assert.equal(simulation.hires,715);
  const report=buildTawteenReport({asOf:'2026-10-31',employees:people,marketSalary:8000,
    rules:Array.from({length:20},(_,i)=>({rule_code:`R${i}`,effective_from:'2026-01-01',salary_threshold:5000+i*100,localization_rate:.25})),
    professions:Array.from({length:20},(_,i)=>({rule_code:`R${i}`,profession_code:'123'}))});
  assert.equal(report.activeEmployeeCount,10000);
  assert.equal(report.consolidatedCurrent.adjustments.length,2500);
  assert.equal(report.consolidatedCurrent.adjustmentMonthly,2500*2900);
  const elapsed=performance.now()-started;
  console.log(`10,000 employees / 20 decisions: ${elapsed.toFixed(1)} ms; simulation=${simulation.status}`);
  assert.ok(elapsed<5000,`Stress budget exceeded: ${elapsed}ms`);
});
