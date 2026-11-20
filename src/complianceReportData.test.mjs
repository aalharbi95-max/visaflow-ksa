import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllRows, loadComplianceReportData, buildComplianceSnapshot } from './complianceReportData.mjs';
import { localizedAuditSheets, localizedReportHtml } from './tawteenReportLocale.mjs';
import { writeTawteenPptx, validateGeometry } from './tawteenMultilingualPptx.mjs';
import XLSX from 'xlsx';
import JSZip from 'jszip';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const input = () => ({companyId:'A',employees:Array.from({length:12},(_,i)=>({id:i,company_id:'A',nationality:i<4?'Saudi':'India',gosi_salary:4000,profession_code:'1',project_name:i<6?'One':'Two'})),employeeAttributes:[],rules:[{id:'R',rule_code:'TEST',localization_rate:.5,effective_from:'2026-01-01',engine_policy:{verified:true,floor:4000,salarySource:'gosi',rounding:'nearest'}}],professions:[{rule_code:'TEST',profession_code:'1',profession_name_ar:'محاسب'}],entityScopeComplete:true,activityCode:'410',companyActivityCode:'100'});
test('pagination retrieves all rows and fails on any page error', async()=>{
  const records=Array.from({length:1201},(_,id)=>({id}));let pages=0;
  const result=await readAllRows(()=>({range:async(a,b)=>{pages++;return {data:records.slice(a,b+1)};}}));
  assert.equal(result.length,1201);assert.equal(pages,3);
  await assert.rejects(readAllRows(()=>({range:async(a)=>a?{error:{message:'denied'}}:{data:records.slice(0,500)}})),/denied/);
});
test('loader never queries without tenant and never accepts foreign records', async()=>{
  await assert.rejects(loadComplianceReportData({},''),/workspace/);
  function client(foreign=false){return {from(table){const query={select(){return this},eq(field,value){assert.equal(field,'company_id');assert.equal(value,'A');return this},order(){return this},async range(){return {data:table==='employees'?[{id:1,company_id:foreign?'B':'A'}]:table==='compliance_rules'?[{id:'R'}]:table==='compliance_effective_rule_professions'?[{rule_code:'R'}]:[]}},async maybeSingle(){return {data:{entity_scope_confirmed:true}}}};return query;}};}
  assert.equal((await loadComplianceReportData(client(),'A')).employees.length,1);
  await assert.rejects(loadComplianceReportData(client(true),'A'),/TENANT_SCOPE/);
});
test('Nitaqat fails closed for excerpts, duplicates, missing wage/nationality and other years',()=>{
  const data=input();const options={asOf:'2026-11-19'};
  assert.notEqual(buildComplianceSnapshot(data,options).simulation.status,'review');
  assert.equal(buildComplianceSnapshot(data,{...options,project:'One'}).simulation.status,'review');
  assert.equal(buildComplianceSnapshot(data,{asOf:'2027-01-01'}).simulation.status,'review');
  for(const change of [d=>d.employees.push(d.employees[0]),d=>delete d.employees[0].gosi_salary,d=>d.employees[0].nationality='',d=>d.entityScopeComplete=false]){
    const altered=input();change(altered);assert.equal(buildComplianceSnapshot(altered,options).simulation.status,'review');
  }
});
test('90-day risk counts an employee once across events and ignores cancelled departures',()=>{
  const data=input();data.employees[0].contract_end_date='2026-12-01';
  data.demobilizations=[{employee_id:0,demob_date:'2026-12-02',status:'Pending'},{employee_id:1,demob_date:'2026-12-02',status:'Cancelled'}];
  const result=buildComplianceSnapshot(data,{asOf:'2026-11-19'});
  assert.equal(result.events.length,2);assert.equal(result.affectedCount,1);assert.equal(result.affectedSaudiCount,1);
  assert.equal(result.distributions.projects.reduce((sum,row)=>sum+row.total,0),12);
});
test('both reports use the imported GOSI wage while scope and conflicts still block approval',()=>{
  const data=input();
  data.employees=data.employees.map(({gosi_salary,...e})=>({...e,salary:12000,salary_source_fields:{contributory_wage:gosi_salary,total_wage:12000}}));
  const options={asOf:'2026-11-20'},snapshot=buildComplianceSnapshot(data,options);
  assert.equal(snapshot.people[0].gosi_salary,4000);
  assert.equal(snapshot.simulation.weightedSaudis,4);
  assert.equal(snapshot.report.current[0].eligibleSaudiCount,4);
  assert.equal(snapshot.report.current[0].eligibility[0].wage,4000);
  data.entityScopeComplete=false;
  assert.equal(buildComplianceSnapshot(data,options).simulation.status,'review');
  data.entityScopeComplete=true;
  data.employeeAttributes=[{employee_id:0,company_id:'A',gosi_salary:5000}];
  const conflict=buildComplianceSnapshot(data,options);
  assert.equal(conflict.simulation.status,'review');
  assert.equal(conflict.report.current[0].eligibility[0].wage,null);
});
test('Excel, HTML and real PPTX preserve unknown eligibility in three languages',async()=>{
  const data=input();delete data.employees[0].gosi_salary;
  const snapshot=buildComplianceSnapshot(data,{asOf:'2026-11-19'});
  assert.equal(snapshot.report.current[0].shortage,null);
  const tmp=await mkdtemp(path.join(os.tmpdir(),'compliance-restore-'));
  try {
    for(const language of ['Arabic','English','Bilingual']){
      const html=localizedReportHtml(snapshot.report,{language,mode:'detailed',asOf:snapshot.asOf});
      assert.ok(html.includes('<html'));assert.ok(!html.includes('NaN'));
      const wb=XLSX.utils.book_new();
      for(const {name,rows} of localizedAuditSheets(snapshot.report,language))XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name);
      const reopened=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));assert.equal(reopened.SheetNames.length,4);
      const file=path.join(tmp,language+'.pptx');
      const {geometry}=await writeTawteenPptx(file,{language,report_mode:'detailed',generated_date:snapshot.asOf,tawteen_localization:snapshot.report},{loadPptxgen:()=>import('pptxgenjs')});
      assert.deepEqual(validateGeometry(geometry),[]);
      const zip=await JSZip.loadAsync(await readFile(file));
      const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));assert.ok(names.length>0);
      const text=(await Promise.all(names.map(n=>zip.file(n).async('string')))).join('');assert.ok(!text.includes('NaN'));
    }
  } finally {await rm(tmp,{recursive:true,force:true});}
});
