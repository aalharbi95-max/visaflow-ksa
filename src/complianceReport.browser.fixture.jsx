import React from 'react';
import { createRoot } from 'react-dom/client';
import Reports from './RestoredComplianceReports.jsx';
const employees=Array.from({length:12},(_,i)=>({id:i,company_id:'A',nationality:i<4?'Saudi':'India',gosi_salary:4000,profession_code:'1',project_name:i<6?'One':'Two'}));
const data={employees,compliance_rules:[{id:'R',rule_code:'TEST',localization_rate:.5,effective_from:'2026-01-01',engine_policy:{verified:true,floor:4000,salarySource:'gosi',rounding:'nearest'}}],compliance_effective_rule_professions:[{rule_code:'TEST',profession_code:'1',profession_name_ar:'محاسب'}],employee_compliance_attributes:[],compliance_rule_conditions:[]};
const client={from(table){return {select(){return this},eq(){return this},order(){return this},async range(a,b){return {data:(data[table]||[]).slice(a,b+1)}},async maybeSingle(){return {data:{entity_scope_confirmed:true,nitaqat_activity_code:'410',economic_activity_code:'100'}}}}}};
const root=createRoot(document.getElementById('root'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(value,message)=>{if(!value)throw new Error(message)};
const select=(label,value)=>{const el=[...document.querySelectorAll('label')].find(e=>e.textContent.startsWith(label))?.querySelector('select');assert(el,'Missing select: '+label);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));};
const downloads=[];HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)};
async function run(){
  for(const templateId of ['tawteen_localization','saudi_workforce']){
    root.render(<Reports client={client} companyId="A" currentRole="Admin" templateId={templateId}/>);
    for(let i=0;i<100&&!document.querySelector('iframe');i++)await wait(50);
    await wait(200);
    assert(document.querySelector('iframe')?.srcdoc.includes('<html'),'Preview missing');
    assert(!document.querySelector('[role=alert]'),'Render error');
    select('الصيغة','Excel');await wait(100);document.querySelector('button').click();
    for(let i=0;i<100&&document.querySelector('button').disabled;i++)await wait(50);
    assert(!document.querySelector('[role=alert]'),document.querySelector('[role=alert]')?.textContent);
    select('المشروع','One');await wait(100);
    if(templateId==='saudi_workforce') assert(document.querySelector('iframe').srcdoc.includes('review'),'Scoped Nitaqat must be unconfirmed');
    select('المشروع','');await wait(100);
  }
  assert(downloads.length===2,'Both Excel exports must download');
  document.documentElement.dataset.testResult=btoa(JSON.stringify({downloads,preview:true}));
}
run().catch(error=>{document.documentElement.dataset.testError=btoa(unescape(encodeURIComponent(error.stack)))});
