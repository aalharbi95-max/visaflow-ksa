import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTawteenReport} from './tawteenReport.mjs';
import {evaluateWorkforceScenario,evaluateApplicability,workforceOptions} from './occupationLocalization.mjs';
import {occupationDecisionHtml} from './occupationReportPresentation.mjs';
import {writeTawteenPptx} from './tawteenMultilingualPptx.mjs';
const create_buildTawteenExecutivePptx = ({loadPptxgen}) => (name, data) => writeTawteenPptx(name,data,{loadPptxgen});
import {buildTawteenExecutiveBrief} from './tawteenExecutiveBrief.mjs';
const roster=(s=12,f=28)=>Array.from({length:s+f},(_,i)=>({id:i,name:`Employee ${i}`,nationality:i<s?'Saudi':'Indian',profession_code:'241101',gosi_salary:9000,qualification_level:'bachelor',professional_accreditations:{SOCPA:{status:'valid',valid_until:'2032-01-01'},SCE:{status:'valid',valid_until:'2032-01-01'}}}));
const codes=['ACCOUNTING_STAGE2','ACCOUNTING_STAGE3','ACCOUNTING_STAGE4','ACCOUNTING_STAGE5_SMALL'];
const input=(employees=roster(),extra={})=>({asOf:'2026-11-05',companySector:'private',companyActivityCode:'TEST-VERIFIED',facts:{accountingOffice:false},entityScopeComplete:true,entityScopeComplete:true,marketSalary:9000,employees,
  rules:codes.map(rule_code=>({rule_code,decision_number:'103108',domain:'Accounting'})),professions:codes.map(rule_code=>({rule_code,profession_code:'241101'})),...extra});
test('40 accountants exclude 2029 small phase and retain 70% stage into 2029',()=>{
  const r=buildTawteenReport(input());
  const small=r.notApplicable.find(x=>x.rule_code==='ACCOUNTING_STAGE5_SMALL');
  assert.ok(small.applicability.reasons.some(s=>s.includes('40')&&s.includes('4')));
  assert.equal(small.shortage,null); assert.equal(small.options.length,0);
  assert.equal(small.applicableAlternatives[0].rate,.7);
  const future=buildTawteenReport(input(roster(),{asOf:'2030-01-01'}));
  assert.deepEqual(future.current.map(r=>r.localization_rate),[.7]);
});
test('3 and 4 accountants qualify for the small phase only when other facts are known',()=>{
  for(const n of [3,4]) {
    const r=buildTawteenReport(input(roster(1,n-1),{asOf:'2030-01-01'}));
    assert.equal(r.current[0].rule_code,'ACCOUNTING_STAGE5_SMALL');
    assert.equal(r.current[0].applicability.state,'applicable');
  }
});
test('12/28 at 50% requires replacement 8, additive 16 or reduction 16',()=>{
  const report=buildTawteenReport(input()); const row=report.current[0];
  assert.equal(row.shortage,8);
  const options=Object.fromEntries(row.options.map(o=>[o.kind,o]));
  assert.equal(options.replacement.replacements,8);
  assert.equal(options.additional_hiring.hires,16);
  assert.equal(options.expatriate_reduction.reductions,16);
  for(const o of row.options.filter(o=>o.achieved)) assert.ok(o.projectedRate>=50);
  const wrong=evaluateWorkforceScenario({total:40,saudi:12,eligible:12,rate:.5,hires:8});
  assert.equal(wrong.achieved,false); assert.equal(wrong.remainingGap,4);
  assert.equal(options.additional_hiring.monthly,144000);
});
test('unknown qualification, accreditation and GOSI do not imply eligibility',()=>{
  for(const field of ['qualification_level','professional_accreditations','gosi_salary']) {
    const people=roster(20,20); delete people[0][field]; people[0].salary=100000;
    const row=buildTawteenReport(input(people)).current[0];
    assert.equal(row.eligibleSaudiCount,19); assert.equal(row.unknownEligibilityCount,1); assert.equal(row.complianceStatus,'uncertain');
  }
});
test('salary repairs never re-credit an employee with missing or invalid accreditation',()=>{
  const people=roster(); people[0].gosi_salary=5000;people[1].gosi_salary=5000;delete people[1].professional_accreditations;
  people[2].qualification_level='diploma';people[2].gosi_salary=4500;
  const row=buildTawteenReport(input(people)).current[0];
  assert.equal(row.plan.alerts.length,1);assert.equal(row.plan.alerts[0].monthly,1000);
  assert.equal(row.eligibleSaudiCount,10);
});
test('engineering and technical rules use their own floors and accreditation',()=>{
  for(const [code,floor] of [['ENGINEERING_2026',8000],['TECH_ENGINEERING_2025',5000]]) {
    const people=roster(2,8);people[0].gosi_salary=floor-1;
    const row=buildTawteenReport(input(people,{rules:[{rule_code:code}],professions:[{rule_code:code,profession_code:'241101'}]})).current[0];
    assert.equal(row.salaryFloor,floor); assert.equal(row.eligibleSaudiCount,1);assert.equal(row.localization_rate,.3);
    assert.ok(row.options.filter(o=>o.achieved).every(o=>o.projectedRate>=30));
  }
});
test('project management uses verified 2027 scope and its own 70% rate',()=>{
  const row=buildTawteenReport(input(roster(),{rules:[{rule_code:'PROJECT_MGMT_2027'}],professions:[{rule_code:'PROJECT_MGMT_2027',profession_code:'241101'}]})).upcoming[0];
  assert.equal(row.localization_rate,.7);assert.equal(row.shortage,16);assert.equal(row.salaryFloor,0);assert.ok(row.options.some(o=>o.achieved));
  assert.ok(row.options.filter(o=>o.achieved).every(o=>o.projectedRate>=70));
});
test('generic conditions retain mismatches and unknown conditions for every profession',()=>{
  const rule={conditions:[{condition_type:'economic_activity_code',text_value:'123'},{condition_type:'employee_threshold',operator:'<=',numeric_value:4}]};
  assert.equal(evaluateApplicability(rule,40,{companyActivityCode:'999'},{verified:true,min:3}).state,'not_applicable');
  assert.equal(evaluateApplicability({conditions:[{condition_type:'special_exception'}]},10,{}, {verified:true}).state,'unknown');
});
test('duplicates are not counted twice and cause review',()=>{
  const people=roster(); const r=buildTawteenReport(input([...people,people[0]]));
  assert.equal(r.activeEmployeeCount,40);assert.equal(r.duplicateEmployeeCount,1);assert.equal(r.current[0].shortage,null);
});
test('a scenario crossing a decision headcount band is not recommended automatically',()=>{
  const options=workforceOptions({total:4,saudi:0,eligible:0,rate:.3,projectedApplicability:n=>({state:n>4?'not_applicable':'applicable'})});
  assert.equal(options.find(o=>o.kind==='additional_hiring').achieved,false);
});
test('accepted scenarios reach target over a range of workforce sizes and rates',()=>{
  for(let total=1;total<=70;total++) for(const rate of [.25,.3,.5,.7,1]) {
    const saudi=Math.floor(total*.3),eligible=Math.floor(saudi*.8);
    for(const o of workforceOptions({total,saudi,eligible,rate}).filter(o=>o.achieved)) {
      assert.ok(o.projectedEligible/o.projectedTotal+1e-10>=rate);assert.equal(o.remainingGap,0);
    }
  }
});
test('HTML includes scenarios, exclusions, source and safe employee text',()=>{
  const people=roster();people[0].name='<script>unsafe</script>'; delete people[0].gosi_salary;
  const html=occupationDecisionHtml(buildTawteenReport(input(people)));
  assert.ok(html.includes('Not Applicable'));assert.ok(html.includes('Management Action Plan'));assert.ok(html.includes('ACCOUNTING_STAGE4'));assert.ok(!html.includes('<script>unsafe'));
});
test('PPTX generation uses validated options and includes excluded decisions in appendices',async()=>{
  const text=[];
  class Pptx {addSlide(){return {addText:v=>text.push(String(v)),addShape:()=>{}};} async writeFile(){}}
  const generate=create_buildTawteenExecutivePptx({loadPptxgen:async()=>({default:Pptx}),buildTawteenExecutiveBrief,isReportArabic:()=>true,isReportBilingual:()=>false,getLocalizedReportName:()=> 'تقرير قبول',reportStudioForm:{}});
  await generate('test.pptx',{language:'English',report_mode:'detailed',generated_at:'2026-11-05',tawteen_localization:buildTawteenReport(input())});
  assert.ok(text.some(t=>t.includes('Additional hires: 16')));
  assert.ok(text.some(t=>t.includes('Replacements: 8')));
  assert.ok(text.some(t=>t.includes('Non-applicable')));
  assert.ok(text.some(t=>t.includes('40')&&t.includes('4')));
});
