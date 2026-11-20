import test from 'node:test';
import assert from 'node:assert/strict';
import {executiveChartData,executiveReportHtml,executiveSections} from './tawteenExecutive.mjs';
const row=(shortage)=>({rule_code:'ENGINEERING_2026',shortage,matchedCount:10,saudiCount:3,eligibleSaudiCount:1,ineligibleSaudiCount:1,unknownEligibilityCount:1,actualRate:10,localization_rate:.3,regulatoryRequired:shortage==null?null:3,applicability:{state:shortage==null?'unknown':'applicable',checks:[]},eligibility:[],managementActions:[],options:[]});
test('current charts keep unknown separate from confirmed zero and do not include future stages',()=>{
 const c=executiveChartData({current:[row(null),row(0),row(2)],upcoming:[row(9)]});
 assert.deepEqual(c.status.map(s=>s.value),[1,1,1]);
 assert.equal(c.groups[0].rate,null);assert.equal(c.groups[1].rate,10);
 assert.equal(c.groups[0].eligible+c.groups[0].ineligible+c.groups[0].unknown,3);
});
test('export includes all sections, escapes employee input, and preserves unavailable costs and rates',()=>{
 const r=row(null);r.eligibility=[{employee:{name:'<img src=x onerror=alert(1)>',profession:'Engineer'},wage:null,floor:8000,decisionState:'UNKNOWN_MISSING_SALARY',missing:['GOSI'],reasons:[]}];
 const report={current:[r],rows:[r],upcoming:[],unmatchedProfessionGroups:[['<script>',2]]};
 for(const language of ['Arabic','English','Bilingual']){
  const html=executiveReportHtml(report,{language,asOf:'2026-11-20'});
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('undefined'));
  assert.deepEqual(Object.keys(executiveSections(report,{language})),['summary','people','plan','quality']);
  assert.ok(!html.includes('10% /'));assert.ok(html.includes('<details open>'));
 }
});
