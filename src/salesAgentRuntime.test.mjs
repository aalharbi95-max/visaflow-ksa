import test from 'node:test';
import assert from 'node:assert/strict';
import {createSalesHandler} from '../supabase/functions/_shared/salesAgentRuntime.mjs';
const id='00000000-0000-0000-0000-000000000001';
function harness(options={}) {
  const calls=[], updates=[], completions=[];let fetches=0;
  const actor={id:1,role:'Admin',status:'Active',is_active:true,company_id:id};
  const lead={id,company_id:id,company_name:'Known company',status:'active',contact_email:'test@example.test',...options.lead};
  const client={auth:{getUser:async()=>({data:{user:{id:'auth'}},error:options.authError})},from(table){
    const filters=[];let update=null;
    const q={select(){return q;},eq(key,value){filters.push([key,value]);return q;},limit(){return q;},maybeSingle(){return q;},order(){return q;},gte(){return q;},lte(){return q;},update(value){update=value;return q;},then(resolve){
      calls.push({table,filters});if(update) updates.push(update);
      const data=table==='users'?(options.actors||[actor]):table==='companies'?{id}:table==='sales_leads'?(options.missingLead?null:lead):[];
      resolve({data,count:0,error:null});
    }};return q;
  },async rpc(name,args){calls.push({rpc:name,args});if(name==='sales_start_run')return{data:'run',error:null};completions.push(args);return{data:{...args.p_result,status:args.p_result.status},error:options.commitError?{message:'lead_do_not_contact'}:null};}};
  const handler=createSalesHandler({createClient:()=>client,env:key=>options.noAI&&key.startsWith('OPENAI')?'':({SUPABASE_URL:'local',SUPABASE_SERVICE_ROLE_KEY:'local',OPENAI_API_KEY:'test',OPENAI_SALES_AGENT_MODEL:'configured-model'}[key]),fetchImpl:async(url,init)=>{
    fetches++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(init.body).store,false);
    return new Response(JSON.stringify({output_text:JSON.stringify(options.ai||{subject:'Review',body:'A draft'})}),{status:options.aiStatus||200});
  }});
  return{calls,updates,completions,get fetches(){return fetches;},async run(body={},headers={authorization:'Bearer user'}){const response=await handler(new Request('http://localhost',{method:'POST',headers,body:JSON.stringify({action:'draft_outreach',lead_id:id,...body})}));return{status:response.status,...await response.json()};}};
}
test('authenticated draft calls AI once, commits pending, uses tenant filters, never sends mail',async()=>{
  const h=harness(), result=await h.run();assert.equal(result.status,200);assert.equal(result.delivery_enabled,false);assert.equal(h.fetches,1);
  assert.equal(h.completions[0].p_result.status,'pending');
  assert.ok(h.calls.find(c=>c.table==='sales_leads').filters.some(([k,v])=>k==='company_id'&&v===id));
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
