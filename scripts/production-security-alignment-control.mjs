import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const expectedRef = "zeocbftriydodzfgixjv";
const forbiddenStagingRef = "iijhdilfzndqlguefipn";
const securityVersion = "20260820000100";
const protectedPendingVersion = "20260804000200";
const operation = process.env.PRODUCTION_SECURITY_OPERATION || "";
const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");

assert.ok(["precheck", "apply"].includes(operation), "Operation must be precheck or apply");
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, expectedRef, "Production project identity mismatch");
assert.notEqual(projectRef, forbiddenStagingRef, "Refusing to use Staging as Production");
assert.equal(supabaseUrl, `https://${expectedRef}.supabase.co`, "Production URL mismatch");

const migrationPath = `supabase/migrations/${securityVersion}_production_security_alignment.sql`;
const migrationSql = await readFile(migrationPath, "utf8");
assert.doesNotMatch(migrationSql, /^\s*(insert\s+into|update\s+public\.|delete\s+from|truncate\s)/im,
  "Reviewed security migration contains row DML");
assert.doesNotMatch(migrationSql, /20260804000200/, "Reviewed migration references the protected pending migration");

const affectedTables = [
  "agency_client_access", "agency_members", "agency_penalties", "agency_scores",
  "ai_agent_action_locks", "ai_agent_jobs", "ai_agent_settings", "ai_agent_worker_runs",
  "ai_interview_answers", "ai_interview_generation_runs", "ai_interview_questions",
  "ai_interview_sessions", "ai_interview_templates", "candidate_technical_profiles",
  "collections", "company_agency_users", "company_email_settings", "demobilizations",
  "education_institutions", "email_templates", "employees", "interviews", "invoice_items",
  "invoices", "local_content_project_targets", "local_content_settings",
  "marketplace_deal_workers", "marketplace_deals", "marketplace_requests", "mobilizations",
  "onboarding_validations", "platform_clients", "profession_aliases", "subscription_invoices",
];

const retryable = new Set([408, 429, 500, 502, 503, 504, 522, 524, 544]);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function management(path, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`https://api.supabase.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (response.ok) return response.json();
    if (!retryable.has(response.status) || attempt === attempts) {
      throw new Error(`Management API ${path} failed with HTTP ${response.status}`);
    }
    await response.text();
    await wait(attempt * 3_000);
  }
  throw new Error(`Management API ${path} exhausted retries`);
}

async function readQuery(sql, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: true }),
    });
    if (response.ok) return response.json();
    if (!retryable.has(response.status) || attempt === attempts) {
      throw new Error(`Production read-only query failed with HTTP ${response.status}`);
    }
    await response.text();
    await wait(attempt * 3_000);
  }
  throw new Error("Production read-only query exhausted retries");
}

async function writeQueryOnce(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: false }),
  });
  if (!response.ok) {
    throw new Error(`Controlled Production migration request failed with HTTP ${response.status}; write was not retried`);
  }
  return response.json();
}

function uuidLiteral(value) {
  assert.match(value, /^[0-9a-f-]{36}$/i, "Expected UUID");
  return `'${value}'`;
}

async function confirmIdentityAndBackup() {
  const [metadata, backups] = await Promise.all([
    management(`/projects/${projectRef}`),
    management(`/projects/${projectRef}/database/backups`),
  ]);
  assert.equal(metadata.id || metadata.ref, expectedRef, "Management API returned another project");
  assert.ok(!metadata.status || String(metadata.status).toUpperCase().includes("ACTIVE"),
    "Production project is not active");
  const completed = (Array.isArray(backups.backups) ? backups.backups : [])
    .filter((backup) => String(backup.status).toUpperCase() === "COMPLETED");
  const completedTimes = completed
    .map((backup) => backup.inserted_at || backup.completed_at || backup.created_at)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const pitr = backups.pitr_enabled === true;
  const recentCompleted = completedTimes.length > 0
    && Date.now() - completedTimes[0] <= 48 * 60 * 60 * 1_000;
  assert.ok(pitr || recentCompleted, "No PITR or completed backup from the last 48 hours");
  return { pitr, recentCompleted };
}

async function migrationHistory() {
  return readQuery(`
    select version::text
    from supabase_migrations.schema_migrations
    where version in ('${securityVersion}','${protectedPendingVersion}')
    order by version`);
}

async function assertHistoryBefore() {
  const columns = await readQuery(`
    select column_name, data_type
    from information_schema.columns
    where table_schema='supabase_migrations' and table_name='schema_migrations'
    order by ordinal_position`);
  for (const required of ["version", "statements", "name"]) {
    assert.ok(columns.some((column) => column.column_name === required),
      `Migration history column missing: ${required}`);
  }
  const history = await migrationHistory();
  assert.ok(!history.some((row) => row.version === securityVersion), "Security migration is already recorded");
  assert.ok(!history.some((row) => row.version === protectedPendingVersion),
    "Protected migration must remain pending before remediation");
}

function precheckBlock() {
  const match = migrationSql.match(/do \$precheck\$[\s\S]*?\$precheck\$;/i);
  assert.ok(match, "Migration precheck block was not found");
  return match[0];
}

async function runMigrationPrechecks() {
  await readQuery(`
    begin read only;
    set local lock_timeout = '5s';
    set local statement_timeout = '60s';
    ${precheckBlock()}
    rollback;
    select true as prechecks_passed;
  `);
}

async function rowDigest() {
  const sql = affectedTables
    .map((table) => `select '${table}'::text as table_name, count(*)::bigint::text as row_count from public.${table}`)
    .join(" union all ");
  const rows = await readQuery(sql);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function controlledMigrationSql() {
  assert.match(migrationSql, /^\s*begin;/i, "Migration must begin transactionally");
  assert.match(migrationSql, /commit;\s*$/i, "Migration must commit transactionally");
  const body = migrationSql.replace(/^\s*begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
  return `
    begin;
    ${body}
    insert into supabase_migrations.schema_migrations(version, statements, name)
    values ('${securityVersion}', array['controlled production security alignment']::text[], 'production_security_alignment');
    commit;
  `;
}

async function postMigrationCatalogChecks() {
  const quoted = affectedTables.map((table) => `'${table}'`).join(",");
  const [rls, view, serviceRole, history] = await Promise.all([
    readQuery(`
      select count(*)::integer as enabled_count
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (${quoted})
        and c.relkind in ('r','p') and c.relrowsecurity`),
    readQuery(`
      select coalesce('security_invoker=true' = any(c.reloptions),false) as security_invoker
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='ai_agent_hourly_activity' and c.relkind='v'`),
    readQuery(`
      select
        (select rolbypassrls from pg_roles where rolname='service_role') as bypass_rls,
        count(*) filter(where
          has_table_privilege('service_role',format('public.%I',c.relname),'SELECT')
          and has_table_privilege('service_role',format('public.%I',c.relname),'INSERT')
          and has_table_privilege('service_role',format('public.%I',c.relname),'UPDATE')
          and has_table_privilege('service_role',format('public.%I',c.relname),'DELETE')
        )::integer as full_table_count
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (${quoted}) and c.relkind in ('r','p')`),
    migrationHistory(),
  ]);
  assert.equal(rls[0]?.enabled_count, 34, "RLS is not enabled on all 34 tables");
  assert.equal(view[0]?.security_invoker, true, "ai_agent_hourly_activity is not security_invoker");
  assert.equal(serviceRole[0]?.bypass_rls, true, "service_role no longer bypasses RLS");
  assert.equal(serviceRole[0]?.full_table_count, 34, "service_role lacks full privileges");
  assert.deepEqual(history.map((row) => row.version), [securityVersion],
    "Migration history is not exactly the reviewed security version");
}

async function advisorChecks() {
  let blockerCount = -1;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const advisor = await management(`/projects/${projectRef}/advisors/security`);
    blockerCount = (advisor.lints || []).filter((lint) =>
      ["ERROR", "CRITICAL", "HIGH", "BLOCKER"].includes(
        String(lint.level || lint.severity || "").toUpperCase(),
      )).length;
    if (blockerCount === 0) return;
    if (attempt < 6) await wait(attempt * 10_000);
  }
  throw new Error(`Production Security Advisor still has ${blockerCount} blocking finding(s)`);
}

async function actorPairs() {
  const companies = await readQuery(`
    select distinct on (u.company_id)
      u.auth_user_id::text as auth_user_id, u.company_id::text as scope_id
    from public.users u
    where u.auth_user_id is not null and u.company_id is not null
      and u.status='Active' and u.is_active is true
      and u.role in ('Admin','Company Admin','Operations Manager','Project Manager')
    order by u.company_id,u.id limit 2`);
  const agencies = await readQuery(`
    select distinct on (u.agency_id)
      u.auth_user_id::text as auth_user_id, u.agency_id::text as scope_id
    from public.users u
    join public.agency_members m on m.user_id=u.id and m.agency_id=u.agency_id
    where u.auth_user_id is not null and u.agency_id is not null
      and u.status='Active' and u.is_active is true and u.role='Agency'
      and m.status='Active'
    order by u.agency_id,u.id limit 2`);
  assert.equal(companies.length, 2, "Two distinct active company actors are required");
  assert.equal(agencies.length, 2, "Two distinct active agency actors are required");
  return { companies, agencies };
}

async function tenantAuthorizationSmoke() {
  const { companies, agencies } = await actorPairs();
  for (const [own, other] of [[companies[0], companies[1]], [companies[1], companies[0]]]) {
    await readQuery(`
      begin read only;
      select set_config('request.jwt.claim.sub',${uuidLiteral(own.auth_user_id)},true);
      set local role authenticated;
      do \$smoke\$
      begin
        if public.current_app_user_company_id() is distinct from ${uuidLiteral(own.scope_id)}::uuid then
          raise exception 'COMPANY_CONTEXT_FAILED';
        end if;
        if exists(select 1 from public.local_content_settings
                  where company_id=${uuidLiteral(other.scope_id)}::uuid) then
          raise exception 'COMPANY_CROSS_TENANT_READ';
        end if;
        perform count(*) from public.local_content_settings
          where company_id=${uuidLiteral(own.scope_id)}::uuid;
        if not has_table_privilege(current_user,'public.local_content_settings','SELECT')
           or not has_table_privilege(current_user,'public.local_content_settings','UPDATE') then
          raise exception 'COMPANY_ALLOWED_PRIVILEGE_FAILED';
        end if;
        if not (${uuidLiteral(own.scope_id)}::uuid = public.current_app_user_company_id())
           or (${uuidLiteral(other.scope_id)}::uuid = public.current_app_user_company_id()) then
          raise exception 'COMPANY_WRITE_POLICY_PREDICATE_FAILED';
        end if;
      end
      \$smoke\$;
      rollback;
      select true as company_isolation_passed;
    `);
  }
  for (const [own, other] of [[agencies[0], agencies[1]], [agencies[1], agencies[0]]]) {
    await readQuery(`
      begin read only;
      select set_config('request.jwt.claim.sub',${uuidLiteral(own.auth_user_id)},true);
      set local role authenticated;
      do \$smoke\$
      begin
        if public.current_app_user_agency_id() is distinct from ${uuidLiteral(own.scope_id)}::uuid then
          raise exception 'AGENCY_CONTEXT_FAILED';
        end if;
        if exists(select 1 from public.agency_members
                  where agency_id=${uuidLiteral(other.scope_id)}::uuid) then
          raise exception 'AGENCY_CROSS_TENANT_READ';
        end if;
        if not exists(select 1 from public.agency_members
                      where agency_id=${uuidLiteral(own.scope_id)}::uuid) then
          raise exception 'AGENCY_OWN_TENANT_READ_FAILED';
        end if;
        perform count(*) from public.agency_penalties
          where agency_id=${uuidLiteral(own.scope_id)}::uuid;
        if not has_table_privilege(current_user,'public.agency_penalties','SELECT')
           or not has_table_privilege(current_user,'public.agency_penalties','UPDATE') then
          raise exception 'AGENCY_ALLOWED_PRIVILEGE_FAILED';
        end if;
        if not (${uuidLiteral(own.scope_id)}::uuid = public.current_app_user_agency_id())
           or (${uuidLiteral(other.scope_id)}::uuid = public.current_app_user_agency_id()) then
          raise exception 'AGENCY_WRITE_POLICY_PREDICATE_FAILED';
        end if;
      end
      \$smoke\$;
      rollback;
      select true as agency_isolation_passed;
    `);
  }
}

const backup = await confirmIdentityAndBackup();
await assertHistoryBefore();
await runMigrationPrechecks();

if (operation === "precheck") {
  console.log(`PRODUCTION_SECURITY_PRECHECK_PASS identity=${projectRef} backup=${backup.pitr ? "PITR" : "RECENT_COMPLETED"}`);
  process.exit(0);
}

const rowsBefore = await rowDigest();
await writeQueryOnce(controlledMigrationSql());
await postMigrationCatalogChecks();
await advisorChecks();
await tenantAuthorizationSmoke();
const rowsAfter = await rowDigest();
assert.equal(rowsAfter, rowsBefore, "Production business-table row counts changed");

console.log("PRODUCTION_SECURITY_ALIGNMENT_PASS rls=34/34 advisor_blockers=0 tenant_isolation=PASS service_role=PASS protected_pending=YES data_rows_unchanged=YES");
