import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,url=process.env.SUPABASE_URL;
assert.ok(['iijhdilfzndqlguefipn','zeocbftriydodzfgixjv'].includes(ref));assert.equal(url,`https://${ref}.supabase.co`);
const mode=process.argv[2];assert.ok(['preflight','prepare','verify','schedule'].includes(mode));
const report={ref,mode,commit:process.env.GITHUB_SHA,checks:[],ok:false};
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
async function api(path,options={}){const response=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{...options,headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(60000)});assert.ok(response.ok,`Management ${path} HTTP ${response.status}`);const text=await response.text();return text?JSON.parse(text):null;}
const query=sql=>api('/database/query',{method:'POST',body:JSON.stringify({query:sql})});
const sql=await readFile('supabase/migrations/20260914000300_faisal_automatic_introductions.sql','utf8');
try{
 assert.equal((await api('')).status,'ACTIVE_HEALTHY');
 assert.equal((await query("select version from supabase_migrations.schema_migrations where version='20260914000200'")).length,1,'Platform workspace upgrade required');
 const names=await api('/secrets');
 for(const name of ['OPENAI_API_KEY','OPENAI_SALES_AGENT_MODEL','SMTP_USERNAME','SMTP_PASSWORD'])assert.ok(names.some(x=>x.name===name),`Missing ${name}`);
 report.checks.push('identity_existing_platform_and_provider_configuration');
 const history=await query("select statements from supabase_migrations.schema_migrations where version='20260914000300'");
 if(history.length)assert.equal(history[0].statements.join('\n').trim(),sql.trim());
 else assert.equal((await query("select tablename from pg_tables where schemaname='public' and tablename in ('sales_automation_settings','sales_intro_deliveries','sales_email_suppressions')")).length,0,'New table collision');
 if(mode==='prepare'){
  if(!history.length)await query(`begin;set local lock_timeout='5s';${sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('20260914000300','faisal_automatic_introductions',array[${literal(sql)}]);commit;`);
  await query('create extension if not exists pg_cron with schema pg_catalog; create extension if not exists pg_net with schema extensions;');
  const existing=await query("select decrypted_secret from vault.decrypted_secrets where name='faisal_worker_secret'");
  let secret=existing[0]?.decrypted_secret;
  if(!secret){secret=randomBytes(32).toString('hex');if(process.env.GITHUB_ACTIONS)console.log(`::add-mask::${secret}`);await query(`select vault.create_secret(${literal(secret)},'faisal_worker_secret','Faisal introduction scheduler only')`);}
  if(process.env.GITHUB_ACTIONS)console.log(`::add-mask::${secret}`);
  const secrets=[{name:'FAISAL_WORKER_SECRET',value:secret}];
  if(!names.some(x=>x.name==='FAISAL_LIVE_SENDING_ENABLED'))secrets.push({name:'FAISAL_LIVE_SENDING_ENABLED',value:'false'});
  if(!names.some(x=>x.name==='FAISAL_TEST_RECIPIENT'))secrets.push({name:'FAISAL_TEST_RECIPIENT',value:'adel@visaflowksa.com'});
  await api('/secrets',{method:'POST',body:JSON.stringify(secrets)});
  report.checks.push('isolated_intro_schema_and_worker_secret_prepared');
 }
 if(mode==='verify'){
  const secret=(await query("select decrypted_secret from vault.decrypted_secrets where name='faisal_worker_secret'"))[0]?.decrypted_secret;assert.ok(secret);if(process.env.GITHUB_ACTIONS)console.log(`::add-mask::${secret}`);
  const call=async(headers,body)=>fetch(`${url}/functions/v1/visaflow-sales-outreach`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(150000)});
  assert.ok([401,403].includes((await call({},{mode:'tick'})).status));
  const preview=await call({'x-faisal-worker-secret':secret},{mode:'preview'});assert.equal(preview.status,200);const text=await preview.json();assert.ok(text.text.includes('التأشيرات')&&text.text.includes('السكن'));assert.equal(text.template_version,'visaflow-platform-introduction-ar-v1');
  const invalid=await fetch(`${url}/functions/v1/visaflow-sales-unsubscribe?token=invalid`);assert.equal(invalid.status,400);
  const confirm=await fetch(`${url}/functions/v1/visaflow-sales-unsubscribe?token=${'0'.repeat(64)}`,{redirect:'manual'});assert.equal(confirm.status,302);assert.equal(confirm.headers.get('location'),`https://www.visaflowksa.com/faisal-unsubscribe.html#token=${'0'.repeat(64)}&project=${ref}`);
  report.checks.push('anonymous_sender_denied','authenticated_template_preview','unsubscribe_validation_and_confirmation');
  const discovery=await call({'x-faisal-worker-secret':secret},{mode:'discover_preview'});
  const discoveryResult=await discovery.json();assert.equal(discovery.status,200,`Discovery failed: ${discoveryResult.error}`);assert.equal(discoveryResult.sent,0);assert.ok(discoveryResult.prospects.length>0,`No verified business contact found: researched=${discoveryResult.researched}, skipped=${JSON.stringify(discoveryResult.skipped)}`);
  report.verified_business_sources=discoveryResult.prospects.length;report.checks.push('live_search_and_public_source_verification_without_sending');
  const test=await call({'x-faisal-worker-secret':secret},{mode:'test'});assert.equal(test.status,200,'Owner-only SMTP test failed');report.checks.push('fixed_owner_inbox_test_accepted_by_smtp');
 }
 if(mode==='schedule'){
  assert.equal(ref,'zeocbftriydodzfgixjv','Only Production gets the scheduled worker');
  const command=`select net.http_post(url:=${literal(`${url}/functions/v1/visaflow-sales-outreach`)},headers:=jsonb_build_object('Content-Type','application/json','x-faisal-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='faisal_worker_secret')),body:='{"mode":"tick"}'::jsonb,timeout_milliseconds:=120000);`;
  await query(`select cron.schedule('faisal-sales-hourly','15 * * * *',${literal(command)})`);
  // User/owner must explicitly enable the settings row; no recipients are enabled here.
  await api('/secrets',{method:'POST',body:JSON.stringify([{name:'FAISAL_LIVE_SENDING_ENABLED',value:'true'}])});
  report.checks.push('hourly_worker_scheduled_owner_settings_still_required');
 }
 report.ok=true;
}catch(error){report.error=error.message;process.exitCode=1;}
await writeFile('faisal-intro-release-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
