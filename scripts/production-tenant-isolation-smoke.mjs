import assert from "node:assert/strict";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, "zeocbftriydodzfgixjv", "Production project mismatch");
assert.equal(process.env.PRODUCTION_TENANT_DML_SMOKE, "ROLLBACK_ONLY_EXPLICITLY_APPROVED");

async function query(sql, { readOnly = false } = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!response.ok) {
    let diagnostic = {};
    try { diagnostic = await response.json(); } catch { diagnostic = {}; }
    const code = String(diagnostic.code || diagnostic.error_code || "unknown").slice(0, 80);
    const message = String(diagnostic.message || diagnostic.error || "query rejected").slice(0, 500);
    throw new Error(`Production tenant smoke failed with HTTP ${response.status} (${code}): ${message}`);
  }
  return response.json();
}

const ids = Object.freeze({
  companyA: "82000000-0000-4000-8000-000000000001",
  companyB: "82000000-0000-4000-8000-000000000002",
  companyAAuth: "82000000-0000-4000-8000-000000000011",
  companyBAuth: "82000000-0000-4000-8000-000000000012",
  agencyA: "82000000-0000-4000-8000-000000000021",
  agencyB: "82000000-0000-4000-8000-000000000022",
  agencyAAuth: "82000000-0000-4000-8000-000000000031",
  agencyBAuth: "82000000-0000-4000-8000-000000000032",
  companySettingA: "82000000-0000-4000-8000-000000000041",
  companySettingB: "82000000-0000-4000-8000-000000000042",
  companyCrossInsert: "82000000-0000-4000-8000-000000000043",
  agencyPenaltyA: "82000000-0000-4000-8000-000000000051",
  agencyPenaltyB: "82000000-0000-4000-8000-000000000052",
  agencyCrossInsert: "82000000-0000-4000-8000-000000000053",
});
const userIds = Object.freeze({ companyA: -820000001, companyB: -820000002, agencyA: -820000003, agencyB: -820000004 });
const fixturePrefix = "CODEX_PRODUCTION_RLS_SMOKE_20260820";
const touchedTables = ["companies", "agencies", "users", "company_email_settings", "agency_penalties"];

function quoted(value) {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
}

async function rowCounts() {
  const sql = touchedTables.map((table) =>
    `select '${table}'::text as table_name,count(*)::bigint::text as row_count from public.${quoted(table)}`).join(" union all ");
  return Object.fromEntries((await query(sql, { readOnly: true })).map((row) => [row.table_name, row.row_count]));
}

async function fixturePresence() {
  const rows = await query(`
    select
      (select count(*) from public.companies where id in ('${ids.companyA}'::uuid,'${ids.companyB}'::uuid))::integer as companies,
      (select count(*) from public.agencies where id in ('${ids.agencyA}'::uuid,'${ids.agencyB}'::uuid))::integer as agencies,
      (select count(*) from public.users where auth_user_id in ('${ids.companyAAuth}'::uuid,'${ids.companyBAuth}'::uuid,'${ids.agencyAAuth}'::uuid,'${ids.agencyBAuth}'::uuid))::integer as users,
      (select count(*) from public.company_email_settings where id in ('${ids.companySettingA}'::uuid,'${ids.companySettingB}'::uuid,'${ids.companyCrossInsert}'::uuid))::integer as company_settings,
      (select count(*) from public.agency_penalties where id in ('${ids.agencyPenaltyA}'::uuid,'${ids.agencyPenaltyB}'::uuid,'${ids.agencyCrossInsert}'::uuid))::integer as agency_penalties`, { readOnly: true });
  return rows[0];
}

const emptyFixture = { companies: 0, agencies: 0, users: 0, company_settings: 0, agency_penalties: 0 };
assert.deepEqual(await fixturePresence(), emptyFixture, "Predetermined fixture identifiers already exist; DML smoke refused");

// Fail closed before any DML if a trigger can invoke a non-transactional or
// external side effect. Plain SQL/PLpgSQL audit and timestamp triggers remain
// transactional and are safe because the entire fixture ends with ROLLBACK.
const triggers = await query(`
  select n.nspname as table_schema,c.relname as table_name,t.tgname as trigger_name,
    pn.nspname as function_schema,p.proname as function_name,l.lanname as language,
    pg_get_triggerdef(t.oid,true) as trigger_definition,
    pg_get_functiondef(p.oid) as function_definition
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid
  join pg_namespace pn on pn.oid=p.pronamespace
  join pg_language l on l.oid=p.prolang
  where not t.tgisinternal and n.nspname='public'
    and c.relname = any(array[${touchedTables.map((table) => `'${table}'`).join(",")}])
  order by c.relname,t.tgname`, { readOnly: true });
const unsafeTriggerPattern = /\b(pg_notify|dblink|lo_export|supabase_functions|pg_net|net\.http|http_(?:get|post|put|delete)|aws_lambda|webhook)\b/i;
const unsafeTriggers = triggers.filter((trigger) =>
  !["sql", "plpgsql"].includes(String(trigger.language).toLowerCase())
  || unsafeTriggerPattern.test(`${trigger.trigger_definition}\n${trigger.function_definition}`));
assert.deepEqual(unsafeTriggers, [], "Unsafe or non-transactional trigger found; DML smoke refused");
console.log(`Trigger safety precheck PASS for ${touchedTables.length} fixture tables (${triggers.length} transactional trigger(s)).`);

const countsBefore = await rowCounts();

await query(`
  begin;
  set local lock_timeout = '5s';
  set local statement_timeout = '60s';

  insert into public.companies(id,name,status) values
    ('${ids.companyA}','${fixturePrefix}_COMPANY_A','Active'),
    ('${ids.companyB}','${fixturePrefix}_COMPANY_B','Active');
  insert into public.agencies(id,name,status,company_id) values
    ('${ids.agencyA}','${fixturePrefix}_AGENCY_A','Active','${ids.companyA}'),
    ('${ids.agencyB}','${fixturePrefix}_AGENCY_B','Active','${ids.companyA}');
  insert into public.users(id,name,email,role,status,is_active,company_id,agency_id,auth_user_id) values
    (${userIds.companyA},'${fixturePrefix}_COMPANY_A_USER','company-a-rls-smoke@example.invalid','Company Admin','Active',true,'${ids.companyA}',null,'${ids.companyAAuth}'),
    (${userIds.companyB},'${fixturePrefix}_COMPANY_B_USER','company-b-rls-smoke@example.invalid','Company Admin','Active',true,'${ids.companyB}',null,'${ids.companyBAuth}'),
    (${userIds.agencyA},'${fixturePrefix}_AGENCY_A_USER','agency-a-rls-smoke@example.invalid','Agency','Active',true,null,'${ids.agencyA}','${ids.agencyAAuth}'),
    (${userIds.agencyB},'${fixturePrefix}_AGENCY_B_USER','agency-b-rls-smoke@example.invalid','Agency','Active',true,null,'${ids.agencyB}','${ids.agencyBAuth}');

  insert into public.company_email_settings(id,company_id,from_name)
  values ('${ids.companySettingB}','${ids.companyB}','${fixturePrefix}_B_SEED');
  insert into public.agency_penalties(id,company_id,penalty_no,agency_id,agency_name,status,agency_evidence)
  values ('${ids.agencyPenaltyB}','${ids.companyA}','${fixturePrefix}_B_SEED','${ids.agencyB}','${fixturePrefix}_AGENCY_B','Open','[]'::jsonb);

  select set_config('request.jwt.claim.sub','${ids.companyAAuth}',true);
  set local role authenticated;
  do $company_a$
  declare affected integer;
  begin
    if public.current_app_user_company_id() <> '${ids.companyA}'::uuid then raise exception 'COMPANY_A_CONTEXT_FAILED'; end if;
    if exists(select 1 from public.company_email_settings where id='${ids.companySettingB}'::uuid) then raise exception 'COMPANY_A_CROSS_SELECT_ALLOWED'; end if;
    insert into public.company_email_settings(id,company_id,from_name) values ('${ids.companySettingA}','${ids.companyA}','${fixturePrefix}_A_OWN');
    update public.company_email_settings set from_name='${fixturePrefix}_A_UPDATED' where id='${ids.companySettingA}'::uuid;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'COMPANY_A_SAME_TENANT_UPDATE_FAILED'; end if;
    update public.company_email_settings set from_name='${fixturePrefix}_CROSS' where id='${ids.companySettingB}'::uuid;
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'COMPANY_A_CROSS_UPDATE_ALLOWED'; end if;
    begin
      insert into public.company_email_settings(id,company_id,from_name) values ('${ids.companyCrossInsert}','${ids.companyB}','${fixturePrefix}_CROSS');
      raise exception 'COMPANY_A_CROSS_INSERT_ALLOWED';
    exception when insufficient_privilege then null;
    end;
  end $company_a$;

  reset role;
  select set_config('request.jwt.claim.sub','${ids.companyBAuth}',true);
  set local role authenticated;
  do $company_b$
  declare affected integer;
  begin
    if exists(select 1 from public.company_email_settings where id='${ids.companySettingA}'::uuid) then raise exception 'COMPANY_B_CROSS_SELECT_ALLOWED'; end if;
    if not exists(select 1 from public.company_email_settings where id='${ids.companySettingB}'::uuid) then raise exception 'COMPANY_B_SAME_TENANT_SELECT_FAILED'; end if;
    update public.company_email_settings set from_name='${fixturePrefix}_B_UPDATED' where id='${ids.companySettingB}'::uuid;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'COMPANY_B_SAME_TENANT_UPDATE_FAILED'; end if;
  end $company_b$;

  reset role;
  select set_config('request.jwt.claim.sub','${ids.agencyAAuth}',true);
  set local role authenticated;
  do $agency_a$
  declare affected integer;
  begin
    if public.current_app_user_agency_id() <> '${ids.agencyA}'::uuid then raise exception 'AGENCY_A_CONTEXT_FAILED'; end if;
    if exists(select 1 from public.agency_penalties where id='${ids.agencyPenaltyB}'::uuid) then raise exception 'AGENCY_A_CROSS_SELECT_ALLOWED'; end if;
    insert into public.agency_penalties(id,company_id,penalty_no,agency_id,agency_name,status,agency_evidence)
    values ('${ids.agencyPenaltyA}','${ids.companyA}','${fixturePrefix}_A_OWN','${ids.agencyA}','${fixturePrefix}_AGENCY_A','Open','[]'::jsonb);
    update public.agency_penalties set decision_notes='${fixturePrefix}_A_UPDATED' where id='${ids.agencyPenaltyA}'::uuid;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'AGENCY_A_SAME_TENANT_UPDATE_FAILED'; end if;
    update public.agency_penalties set decision_notes='${fixturePrefix}_CROSS' where id='${ids.agencyPenaltyB}'::uuid;
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'AGENCY_A_CROSS_UPDATE_ALLOWED'; end if;
    begin
      insert into public.agency_penalties(id,company_id,penalty_no,agency_id,agency_name,status,agency_evidence)
      values ('${ids.agencyCrossInsert}','${ids.companyA}','${fixturePrefix}_CROSS','${ids.agencyB}','${fixturePrefix}_AGENCY_B','Open','[]'::jsonb);
      raise exception 'AGENCY_A_CROSS_INSERT_ALLOWED';
    exception when insufficient_privilege then null;
    end;
  end $agency_a$;

  reset role;
  select set_config('request.jwt.claim.sub','${ids.agencyBAuth}',true);
  set local role authenticated;
  do $agency_b$
  declare affected integer;
  begin
    if exists(select 1 from public.agency_penalties where id='${ids.agencyPenaltyA}'::uuid) then raise exception 'AGENCY_B_CROSS_SELECT_ALLOWED'; end if;
    if not exists(select 1 from public.agency_penalties where id='${ids.agencyPenaltyB}'::uuid) then raise exception 'AGENCY_B_SAME_TENANT_SELECT_FAILED'; end if;
    update public.agency_penalties set decision_notes='${fixturePrefix}_B_UPDATED' where id='${ids.agencyPenaltyB}'::uuid;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'AGENCY_B_SAME_TENANT_UPDATE_FAILED'; end if;
  end $agency_b$;

  reset role;
  rollback;`);

assert.deepEqual(await fixturePresence(), emptyFixture,
  "Rollback verification failed: Production fixture rows remain");
assert.deepEqual(await rowCounts(), countsBefore, "Rollback verification failed: Production row counts changed");

console.log("Production tenant-isolation smoke PASS: Company A/B and Agency A/B SELECT/INSERT/UPDATE isolation.");
console.log("Rollback verification PASS: all predetermined fixture UUIDs absent and row counts restored.");
