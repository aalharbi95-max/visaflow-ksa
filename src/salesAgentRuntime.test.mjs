import test from 'node:test';
import assert from 'node:assert/strict';
import {createSalesHandler} from '../supabase/functions/_shared/salesAgentRuntime.mjs';
import {createSalesOutreachHandler} from '../supabase/functions/_shared/salesOutreachRuntime.mjs';
import {salesIntroduction,validateProspectSource} from '../supabase/functions/_shared/salesIntroduction.mjs';
import {publicIPv4} from '../supabase/functions/_shared/salesPublicWebsite.mjs';

test('automatic introduction is comprehensive, fixed, and never includes a price offer',()=>{
 const text=salesIntroduction('https://example.com/unsubscribe?token=abc');
 for(const part of ['التأشيرات','المرشحون','المقابلات','السكن','الصلاحيات','عرض سعر','مالك المنصة','مساعد المبيعات الآلي'])assert.ok(text.includes(part));
 assert.doesNotMatch(text,/\d+\s*(ريال|SAR)|خصم\s*\d|تجربة مجانية/);
});
test('only an email published on the same official business domain is eligible',()=>{
 const candidate={company_name:'Example',email:'info@example.com',website:'https://example.com',source_url:'https://example.com/contact'};
 assert.equal(validateProspectSource(candidate,'<a href="mailto:info@example.com">Email</a>').contact_email,'info@example.com');
 for(const value of [{...candidate,email:'guessed@example.com'},{...candidate,source_url:'https://third-party.com/list'},{...candidate,email:'a@gmail.com'}])assert.throws(()=>validateProspectSource(value,'info@example.com'));
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','0.0.0.0','::1','224.0.0.1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('8.8.8.8'),true);
});
test('outreach rejects customer roles and disabled sending before any SMTP operation',async()=>{
 for(const role of ['Admin','Platform Owner']){
  let sends=0;
  const query={select(){return query;},eq(){return query;},limit(){return query;},then(resolve){resolve({data:[{role,company_id:role==='Admin'?'customer':null,status:'Active',is_active:true}],error:null});}};
  const handler=createSalesOutreachHandler({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>query}),env:name=>name==='SUPABASE_URL'?'https://example.supabase.co':'',sendMail:async()=>{sends++;}});
  const response=await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer token'},body:'{"mode":"tick"}'}));
  assert.equal(response.status,role==='Admin'?403:503);assert.equal(sends,0);
 }
});
test('SMTP uncertainty is recorded for human review and is not retried in a cycle',async()=>{
 let claims=0,sends=0;const updates=[];
 const db={rpc:async(name,args)=>({data:name==='sales_automation_claim'?(args.p_discovery?null:{workspace_id:'w',hourly_limit:2}):name==='sales_claim_intro_delivery'?(claims++===0?{id:'d',email:'info@example.com',template_version:'visaflow-platform-introduction-ar-v1',unsubscribe_token:'a'.repeat(64)}:null):true}),from:()=>{const q={update(value){updates.push(value);return q;},eq(){return q;},then(resolve){resolve({data:null});}};return q;}};
 const handler=createSalesOutreachHandler({createClient:()=>db,env:name=>({SUPABASE_URL:'https://example.supabase.co',FAISAL_WORKER_SECRET:'worker',FAISAL_LIVE_SENDING_ENABLED:'true'}[name]||''),sendMail:async()=>{sends++;throw Error('ambiguous provider state');}});
 const response=await handler(new Request('https://test',{method:'POST',headers:{'x-faisal-worker-secret':'worker'},body:'{}'}));
 assert.equal(response.status,200);assert.equal(sends,1);assert.equal(updates[0].status,'needs_review');
 assert.equal((await response.json()).pricing_auto_send,false);
});
test('discovery preview verifies public evidence without queuing or sending, even when live sending is disabled',async()=>{
 let reads=0,fetches=0;
 const handler=createSalesOutreachHandler({createClient:()=>({}),env:name=>({SUPABASE_URL:'https://example.supabase.co',FAISAL_WORKER_SECRET:'worker',OPENAI_API_KEY:'key',OPENAI_SALES_AGENT_MODEL:'configured-model'}[name]||''),
  fetchImpl:async(_url,init)=>{fetches++;if(fetches===1)return new Response(JSON.stringify({output_text:'Public search results with citations: info@example.com, person@example.com (https://example.com/contact)'}));assert.equal(JSON.parse(init.body).text.format.strict,true);return new Response(JSON.stringify({output_text:JSON.stringify({prospects:[{company_name:'Example',website:'https://example.com',source_url:'https://example.com/contact',email:'info@example.com'},{company_name:'Example',website:'https://example.com',source_url:'https://example.com/contact',email:'person@example.com'}]})}));},
  readWebsite:async()=>{reads++;return 'info@example.com person@example.com';},sendMail:async()=>assert.fail('Preview must not send')});
 const result=await handler(new Request('https://test',{method:'POST',headers:{'x-faisal-worker-secret':'worker'},body:'{"mode":"discover_preview"}'}));
 assert.equal(result.status,200);const data=await result.json();assert.equal(data.sent,0);assert.equal(data.prospects.length,1);assert.equal(reads,2);assert.equal(fetches,2);
});
test('test recipient and content cannot be overridden, and oversized requests are rejected',async()=>{
 let mail;
 const handler=createSalesOutreachHandler({createClient:()=>({}),env:name=>({SUPABASE_URL:'https://example.supabase.co',FAISAL_WORKER_SECRET:'worker',FAISAL_TEST_RECIPIENT:'owner@example.com'}[name]||''),sendMail:async value=>{mail=value;}});
 const call=body=>handler(new Request('https://test',{method:'POST',headers:{'x-faisal-worker-secret':'worker'},body}));
 assert.equal((await call(JSON.stringify({mode:'test',to:'other@example.com',text:'Quote 100 SAR'}))).status,200);
 assert.equal(mail.to,'owner@example.com');assert.ok(!mail.text.includes('100 SAR'));
 assert.equal((await call('x'.repeat(2049))).status,413);
});
const id='00000000-0000-0000-0000-000000000001';
function harness(options={}) {
  const calls=[], updates=[], completions=[];let fetches=0;
  const actor={id:1,role:'Platform Owner',status:'Active',is_active:true,company_id:null};
  const lead={id,company_id:id,company_name:'Known company',status:'active',contact_email:'test@example.test',...options.lead};
  const client={auth:{getUser:async()=>({data:{user:{id:'auth'}},error:options.authError})},from(table){
    const filters=[];let update=null;
    const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},limit(){return q;},maybeSingle(){return q;},order(){return q;},gte(){return q;},lte(){return q;},update(value){update=value;return q;},then(resolve){
      calls.push({table,filters});if(update) updates.push(update);
      const data=table==='users'?(options.actors||[actor]):table==='sales_workspaces'?{id}:table==='sales_leads'?(options.missingLead?null:lead):[];
      resolve({data,count:0,error:null});
    }};return q;
  },async rpc(name,args){calls.push({rpc:name,args});if(name==='sales_start_run')return{data:'run',error:null};completions.push(args);return{data:{...args.p_result,status:args.p_result.status},error:options.commitError?{message:'lead_do_not_contact'}:null};}};
  const handler=createSalesHandler({createClient:()=>client,env:key=>options.noAI&&key.startsWith('OPENAI')?'':({SUPABASE_URL:'local',SUPABASE_SERVICE_ROLE_KEY:'local',OPENAI_API_KEY:'test',OPENAI_SALES_AGENT_MODEL:'configured-model'}[key]),fetchImpl:async(url,init)=>{
    fetches++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(init.body).store,false); assert.match(JSON.parse(init.body).instructions,/own platform subscription sales agent/);
    assert.match(JSON.parse(init.body).input,/Return one valid JSON object/);
    return new Response(JSON.stringify({output_text:JSON.stringify(options.ai||{subject:'Review',body:'A draft'})}),{status:options.aiStatus||200});
  }});
  return{calls,updates,completions,get fetches(){return fetches;},async run(body={},headers={authorization:'Bearer user'}){const response=await handler(new Request('http://localhost',{method:'POST',headers,body:JSON.stringify({action:'draft_outreach',lead_id:id,...body})}));return{status:response.status,...await response.json()};}};
}
test('authenticated draft calls AI once, commits pending, uses tenant filters, never sends mail',async()=>{
  const h=harness(), result=await h.run();assert.equal(result.status,200);assert.equal(result.delivery_enabled,false);assert.equal(h.fetches,1);
  assert.equal(h.completions[0].p_result.status,'pending');
  assert.ok(h.calls.find(c=>c.table==='sales_leads').filters.some(([k,v])=>k==='workspace_id'&&v===id));
});
test('missing auth and foreign tenant rejected before execution',async()=>{
  const h=harness();assert.equal((await h.run({},{})).status,401);assert.equal((await h.run({company_id:'other'})).status,403);assert.equal(h.fetches,0);assert.equal(h.completions.length,0);
});
test('UNSUBSCRIBE and pricing work without AI, forced compliance cannot fail open',async()=>{
  for(const [reply,classification] of [['UNSUBSCRIBE','UNSUBSCRIBE'],['Send your pricing','REQUEST_PRICING']]) {
    const h=harness({noAI:true});assert.equal((await h.run({action:'classify_reply',reply_text:reply})).status,200);assert.equal(h.fetches,0);assert.equal(h.completions[0].p_result.classification,classification);
  }
});
test('DNC blocks before AI and after an in-flight draft, failures are audited',async()=>{
  const h=harness({lead:{do_not_contact:true}});assert.equal((await h.run()).status,409);assert.equal(h.fetches,0);
  const race=harness({commitError:true});assert.equal((await race.run()).status,409);assert.equal(race.updates[0].status,'failed');
});
test('provider failures, missing configuration, malformed results fail closed and audit only safe codes',async()=>{
  for(const options of [{aiStatus:503},{noAI:true},{ai:{body:'missing subject'}}]) {
    const h=harness(options), result=await h.run();assert.ok(result.status>=500);assert.equal(h.completions.length,0);assert.equal(h.updates[0].status,'failed');assert.ok(!JSON.stringify(h.updates).includes('test@example'));
  }
});
test('request limit and unsupported actions fail before model or database writes',async()=>{
  const h=harness();assert.equal((await h.run({instruction:'x'.repeat(17000)})).status,413);assert.equal((await h.run({action:'send_email'})).status,400);assert.equal(h.fetches,0);
});
test('provider authentication failure exposes a safe code and never persists a draft',async()=>{
  const h=harness({aiStatus:401});const result=await h.run();
  assert.equal(result.status,502);assert.equal(result.error,'openai_auth_failed');
  assert.equal(h.completions.length,0);assert.equal(h.updates[0].error_message,'openai_auth_failed');
});

test('customer roles and workspace overrides fail before AI or audit writes',async()=>{
 for(const role of ['Admin','CEO','Recruitment Manager','Recruitment Officer','Platform Marketing User']) {
  const h=harness({actors:[{role,company_id:id,status:'Active',is_active:true}]});
  assert.equal((await h.run()).status,403);assert.equal(h.fetches,0);assert.equal(h.calls.filter(c=>c.rpc).length,0);
 }
 const h=harness(); assert.equal((await h.run({workspace_id:'customer-workspace'})).status,403);assert.equal(h.fetches,0);
});
