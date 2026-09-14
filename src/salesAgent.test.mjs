import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPlatformSalesActor, complianceReply, normalizeSalesResult, assertSalesContactable, riyadhDayStart } from '../supabase/functions/_shared/salesAgentCore.mjs';
test('only one active unscoped Platform Owner can use subscription sales', () => {
 const owner={role:'Platform Owner',company_id:null,status:'Active',is_active:true};
 assert.equal(assertPlatformSalesActor([owner]),owner);
 for(const rows of [[],[owner,owner],[{...owner,status:'Inactive'}],[{...owner,is_active:false}],[{...owner,company_id:'customer'}],...['Admin','CEO','Company Admin','Recruitment Manager','Recruitment Officer','Platform Marketing User','Platform Support User'].map(role=>[{...owner,role}])]) assert.throws(()=>assertPlatformSalesActor(rows));
});

test('unsubscribe precedence and pricing approval cannot be weakened by model output', () => {
  for (const reply of ['UNSUBSCRIBE','Please stop emailing me','إلغاء الاشتراك','لا تتواصل معي','pricing, but unsubscribe me']) assert.equal(complianceReply(reply),'UNSUBSCRIBE');
  assert.equal(complianceReply('أرسل الأسعار'),'REQUEST_PRICING');
  const result=normalizeSalesResult('classify_reply',{classification:'REQUEST_PRICING',requires_ceo_approval:false,follow_up_days:null});
  assert.equal(result.requires_ceo_approval,true); assert.equal(result.follow_up_days,null);
  assert.equal(normalizeSalesResult('classify_reply',{classification:'INTERESTED'},'UNSUBSCRIBE').classification,'UNSUBSCRIBE');
  assert.equal(normalizeSalesResult('classify_reply',{classification:'REQUEST_DEMO',recommended_stage:'DEMO_BOOKED'}).recommended_stage,'REPLIED');
});
test('scoring grades are derived, drafts always pending, invalid results fail closed', () => {
  for (const [score,grade] of [[0,'D'],[29,'D'],[30,'C'],[54,'C'],[55,'B'],[74,'B'],[75,'A'],[100,'A']]) assert.equal(normalizeSalesResult('qualify_lead',{score,grade:'A'}).grade,grade);
  for (const score of [-1,101,NaN,'75']) assert.throws(()=>normalizeSalesResult('qualify_lead',{score}));
  assert.equal(normalizeSalesResult('draft_outreach',{subject:'Hello',body:'Draft',approval_required:false,status:'sent'}).status,'pending');
  assert.throws(()=>normalizeSalesResult('draft_outreach',{subject:'Hello'}));
  assert.throws(()=>normalizeSalesResult('classify_reply',{classification:'SEND_EMAIL'}));
});
test('DNC, paused leads, invalid email and Riyadh midnight are enforced', () => {
  const lead={status:'active',contact_email:'person@example.test',do_not_contact:false};
  assert.doesNotThrow(()=>assertSalesContactable(lead));
  for(const bad of [{...lead,do_not_contact:true},{...lead,status:'paused'},{...lead,contact_email:''}]) assert.throws(()=>assertSalesContactable(bad));
  assert.equal(riyadhDayStart(new Date('2026-09-14T00:00:00Z')),'2026-09-13T21:00:00.000Z');
});
test('Sales integration has no sender or raw HTML rendering and uses owner navigation', async () => {
  const runtime=await readFile(new URL('../supabase/functions/_shared/salesAgentRuntime.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/visaflow-email-dispatcher|outreach-email-worker|smtp|resend\.com|sendgrid|email_logs/);
  const ui=await readFile(new URL('./SalesCommandCenterLazyPage.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/dangerouslySetInnerHTML/); assert.match(ui,/sales_decide_approval/);
  const app=await readFile(new URL('./App.jsx',import.meta.url),'utf8');
  assert.match(app,/SalesCommandCenterLazyPage key="platform-sales"/);
});
