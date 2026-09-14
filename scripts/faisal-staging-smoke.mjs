import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const STAGING = 'iijhdilfzndqlguefipn';
const PRODUCTION = 'zeocbftriydodzfgixjv';
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
assert.equal(ref, STAGING, 'Staging identity mismatch');
assert.notEqual(ref, PRODUCTION);
assert.equal(url, `https://${STAGING}.supabase.co`);
assert.ok(token && anon, 'Staging credentials missing');
const report = { project_ref: ref, started_at: new Date().toISOString(), checks: [], cleanup: 'not_needed' };
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
function mask(value) { if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`); }
async function management(path, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Staging management ${path.split('?')[0]} HTTP ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}
async function query(sql) {
  return management('/database/query', { method: 'POST', body: JSON.stringify({ query: sql }) });
}
async function api(path, jwt, body, method = 'POST', key = anon) {
  const response = await fetch(`${url}${path}`, { method, headers: { apikey: key, ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
function expect(response, status, label) {
  assert.equal(response.status, status, `${label}: HTTP ${response.status}, code ${response.data?.error || response.data?.code || 'unknown'}`);
  report.checks.push(label);
  return response.data;
}
async function verifyIdentity() {
  const metadata = await management('');
  assert.equal(metadata.id, STAGING);
  assert.equal(metadata.status, 'ACTIVE_HEALTHY', 'Staging is not healthy');
  report.project_name = metadata.name;
}
async function prepare() {
  const sql = await readFile('supabase/migrations/20260914000100_faisal_sales_agent_mvp.sql', 'utf8');
  const history = await query("select version from supabase_migrations.schema_migrations where version='20260914000100'");
  if (!history.length) {
    const collisions = await query("select tablename from pg_tables where schemaname='public' and tablename in ('sales_leads','sales_tasks','sales_interactions','sales_agent_runs','sales_agent_approvals')");
    assert.equal(collisions.length, 0, 'Sales tables exist without migration history; refusing to overwrite');
    await query(`begin; select pg_advisory_xact_lock(hashtext('faisal-staging-migration')); ${sql}\n insert into supabase_migrations.schema_migrations(version,name,statements) values('20260914000100','faisal_sales_agent_mvp',array[${lit(sql)}]); commit;`);
    report.checks.push('only_faisal_migration_applied');
  } else {
    const stored = await query("select statements from supabase_migrations.schema_migrations where version='20260914000100'");
    assert.equal(stored[0].statements.join('\n').trim(), sql.trim(), 'Recorded migration differs; refusing replay');
    report.checks.push('exact_migration_already_applied');
  }
  await query("notify pgrst, 'reload schema'");
  const names = await management('/secrets');
  report.openai_key_configured = names.some(x => x.name === 'OPENAI_API_KEY');
  if (!names.some(x => x.name === 'OPENAI_SALES_AGENT_MODEL')) {
    await management('/secrets', { method: 'POST', body: JSON.stringify([{ name: 'OPENAI_SALES_AGENT_MODEL', value: 'gpt-4.1-mini-2025-04-14' }]) });
    report.checks.push('staging_model_configured');
  }
}
async function smoke() {
  const keys = await management('/api-keys');
  const service = keys.find(x => x.name === 'service_role')?.api_key;
  assert.ok(service, 'Staging service key unavailable'); mask(service);
  const fixtures = { companies: [randomUUID(), randomUUID()], users: [] };
  const [a, b] = fixtures.companies;
  const tag = randomUUID();
  report.fixture_tag = tag;
  const edge = (jwt, body) => api('/functions/v1/visaflow-sales-agent', jwt, body);
  const rest = (table, jwt, body, method = 'POST') => api(`/rest/v1/${table}`, jwt, body, method);
  const addUser = async (company, role) => {
    const email = `faisal-${randomUUID()}@example.invalid`, password = `${randomUUID()}aA1!`;
    const response = await api('/auth/v1/admin/users', service, { email, password, email_confirm: true }, 'POST', service);
    assert.equal(response.status, 200, `Create test Auth user: HTTP ${response.status}`);
    const id = response.data.id; fixtures.users.push(id);
    await query(`insert into public.users(name,email,role,status,is_active,company_id,auth_user_id) values('Faisal Staging QA',${lit(email)},${lit(role)},'Active',true,${lit(company)},${lit(id)})`);
    const login = await api('/auth/v1/token?grant_type=password', null, { email, password });
    assert.equal(login.status, 200, 'Test user sign-in failed');
    mask(login.data.access_token); mask(login.data.refresh_token);
    return { id, jwt: login.data.access_token };
  };
  try {
    await query(`insert into public.companies(id,name,status) values(${lit(a)},${lit(`Faisal QA A ${tag}`)},'Active'),(${lit(b)},${lit(`Faisal QA B ${tag}`)},'Active')`);
    report.cleanup = 'pending';
    const admin = await addUser(a, 'Admin'), other = await addUser(b, 'Admin'), officer = await addUser(a, 'Recruitment Officer'), manager = await addUser(a, 'Recruitment Manager');
    report.checks.push('real_auth_password_login');
    const unauthorized = await edge(null, { action: 'daily_brief' });
    assert.ok([401,403].includes(unauthorized.status)); report.checks.push('anonymous_denied');
    expect(await edge(admin.jwt, { action: 'daily_brief', company_id: b }), 403, 'tenant_override_denied');
    const lead = expect(await rest('sales_leads', admin.jwt, { company_id:a, company_name:'Fictional QA Facilities', contact_name:'QA Contact', industry:'Facility management', contact_email:`prospect-${tag}@example.invalid`, notes:'Synthetic test facts: facilities operations company; recruitment coordination across two locations. No actual customer or project claims.' }), 201, 'own_tenant_lead_insert')[0];
    expect(await rest('sales_leads', admin.jwt, { company_id:b, company_name:'Forbidden' }), 403, 'cross_tenant_insert_denied');
    expect(await edge(other.jwt, { action:'qualify_lead', lead_id:lead.id }), 404, 'foreign_lead_hidden');
    const brief = expect(await edge(admin.jwt,{ action:'daily_brief' }),200,'daily_brief_real_edge');
    assert.equal(brief.result.total_active_leads,1); assert.equal(brief.delivery_enabled,false);
    const qualify = await edge(admin.jwt,{ action:'qualify_lead',lead_id:lead.id });
    let aiFailure = null;
    if (qualify.status === 200) {
      expect(qualify,200,'live_openai_scoring'); assert.ok(qualify.data.result.score >= 0 && qualify.data.result.score <= 100);
      const draft = await edge(admin.jwt,{ action:'draft_outreach',lead_id:lead.id });
      if (draft.status === 200) {
        expect(draft,200,'live_openai_draft'); assert.equal(draft.data.result.status,'pending'); assert.equal(draft.data.delivery_enabled,false);
        expect(await rest(`sales_agent_approvals?id=eq.${draft.data.result.approval_id}`,admin.jwt,{status:'approved'},'PATCH'),403,'direct_approval_mutation_denied');
        const rows = await query(`select count(*)::int n from public.sales_agent_approvals where run_id=${lit(draft.data.run_id)} and status='pending'`); assert.equal(rows[0].n,1);
      } else aiFailure = `draft ${draft.status} ${draft.data?.error || 'unknown'}`;
    } else aiFailure = `scoring ${qualify.status} ${qualify.data?.error || 'unknown'}`;
    const pricing = expect(await edge(admin.jwt,{action:'classify_reply',lead_id:lead.id,reply_text:'Please send your pricing.'}),200,'pricing_classification');
    assert.equal(pricing.result.requires_ceo_approval,true); assert.ok(pricing.result.approval_id);
    const decision = {p_approval_id:pricing.result.approval_id,p_decision:'approved',p_reason:'Synthetic staging QA'};
    assert.ok((await rest('rpc/sales_decide_approval',officer.jwt,decision)).status>=400); report.checks.push('officer_approval_denied');
    assert.ok((await rest('rpc/sales_decide_approval',manager.jwt,decision)).status>=400); report.checks.push('manager_pricing_approval_denied');
    const approved=expect(await rest('rpc/sales_decide_approval',admin.jwt,decision),200,'admin_pricing_approval'); assert.equal(approved.delivery_enabled,false);
    for(const table of ['sales_leads','sales_interactions','sales_agent_runs','sales_agent_approvals','sales_tasks']) {
      const rows=expect(await rest(`${table}?company_id=eq.${a}`,other.jwt,undefined,'GET'),200,`${table}_tenant_isolation`);assert.deepEqual(rows,[]);
    }
    expect(await edge(admin.jwt,{action:'classify_reply',lead_id:lead.id,reply_text:'UNSUBSCRIBE — إلغاء الاشتراك'}),200,'unsubscribe_real_edge');
    const suppressed=expect(await rest(`sales_leads?id=eq.${lead.id}`,admin.jwt,undefined,'GET'),200,'dnc_readback')[0];assert.equal(suppressed.do_not_contact,true);assert.equal(suppressed.next_follow_up_at,null);
    expect(await edge(admin.jwt,{action:'draft_outreach',lead_id:lead.id}),409,'dnc_draft_rejected');
    assert.ok((await rest(`sales_leads?id=eq.${lead.id}`,admin.jwt,{do_not_contact:false},'PATCH')).status>=400);report.checks.push('dnc_cannot_clear');
    const pending=await query(`select count(*)::int n from public.sales_agent_approvals where company_id=${lit(a)} and status in ('pending','approved')`);assert.equal(pending[0].n,0);
    report.checks.push('unsubscribe_cancels_approvals');
    const outbound=await query(`select count(*)::int n from public.sales_interactions where company_id=${lit(a)} and direction='outbound'`);assert.equal(outbound[0].n,0);
    const emails=await query(`select count(*)::int n from public.email_logs where company_id in (${lit(a)},${lit(b)})`);assert.equal(emails[0].n,0);
    report.checks.push('zero_outbound_interactions_and_email_logs');
    if (aiFailure) throw new Error(`Live AI acceptance blocked: ${aiFailure}`);
  } finally {
    const companies=fixtures.companies.map(lit).join(',');
    await query(`begin; delete from public.sales_agent_approvals where company_id in (${companies}); delete from public.sales_interactions where company_id in (${companies}); delete from public.sales_tasks where company_id in (${companies}); delete from public.sales_agent_runs where company_id in (${companies}); delete from public.sales_leads where company_id in (${companies}); delete from public.users where company_id in (${companies}); commit;`);
    for(const id of fixtures.users) {const removed=await api(`/auth/v1/admin/users/${id}`,service,undefined,'DELETE',service);assert.ok([200,204].includes(removed.status),'Auth fixture cleanup failed');}
    await query(`delete from public.companies where id in (${companies})`);
    report.cleanup='completed';
  }
}
try {
  await verifyIdentity();
  if(process.argv[2]==='prepare') await prepare();
  else if(process.argv[2]==='smoke') await smoke();
  else throw new Error('Expected prepare or smoke');
  report.status='passed';
} catch(error) {
  report.status='failed';report.error=error.message;process.exitCode=1;
} finally {
  report.finished_at=new Date().toISOString();
  await writeFile('faisal-staging-result.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
