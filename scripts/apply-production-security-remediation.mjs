import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const expectedRef = "zeocbftriydodzfgixjv";
const forbiddenRef = "iijhdilfzndqlguefipn";
const migrationVersion = "20260820000100";
const forbiddenVersion = "20260804000200";
const migrationPath = "supabase/migrations/20260820000100_production_security_alignment.sql";
const expectedSha256 = "c828882e126e00126c8ff9dc6900d2d2dd44464b536d38981b32c3a18665b342";

assert.equal(process.env.PRODUCTION_SECURITY_REMEDIATION, "APPLY_20260820000100_ONLY");
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, expectedRef, "Production project identity mismatch");
assert.notEqual(projectRef, forbiddenRef, "Refusing to run against Staging");

async function management(path) {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Management API ${path} failed with HTTP ${response.status}`);
  return response.json();
}

async function query(sql, { readOnly = true } = {}) {
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
    throw new Error(`Production query failed with HTTP ${response.status} (${code}): ${message}`);
  }
  return response.json();
}

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
assert.equal(affectedTables.length, 34);

function quoteIdentifier(value) {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
}

async function migrationVersions() {
  return (await query("select version::text from supabase_migrations.schema_migrations order by version"))
    .map((row) => String(row.version));
}

async function exactRowCounts() {
  const selects = affectedTables.map((table) =>
    `select '${table}'::text as table_name, count(*)::bigint::text as row_count from public.${quoteIdentifier(table)}`);
  const rows = await query(selects.join(" union all "));
  return Object.fromEntries(rows.map((row) => [row.table_name, row.row_count]));
}

const metadata = await management(`/projects/${projectRef}`);
assert.equal(metadata.id || metadata.ref, expectedRef, "Supabase returned a different Production project");

const migration = await readFile(migrationPath, "utf8");
assert.equal(createHash("sha256").update(migration).digest("hex"), expectedSha256,
  "Reviewed migration hash mismatch");
const firstExecutableStatement = migration.replace(/^(?:\s*--[^\r\n]*(?:\r?\n|$))+/, "").trimStart();
assert.ok(/^begin;/i.test(firstExecutableStatement), "Migration must start a transaction after leading comments");
assert.ok(/commit;\s*$/i.test(migration), "Migration must end with commit");
assert.doesNotMatch(migration, /^\s*(insert|update|delete|truncate)\b/gim,
  "Migration contains forbidden row DML");

const versionsBefore = await migrationVersions();
assert.ok(!versionsBefore.includes(migrationVersion), `${migrationVersion} is already recorded`);
assert.ok(!versionsBefore.includes(forbiddenVersion), `${forbiddenVersion} must remain pending`);

const precheckStart = migration.indexOf("do $precheck$");
const precheckEndMarker = "$precheck$;";
const precheckEnd = migration.indexOf(precheckEndMarker, precheckStart);
assert.ok(precheckStart >= 0 && precheckEnd > precheckStart, "Exact migration precheck block not found");
const precheckSql = migration.slice(precheckStart, precheckEnd + precheckEndMarker.length);
await query(`begin; set transaction read only; ${precheckSql} rollback;`, { readOnly: true });
console.log("Production migration prechecks PASS (read-only).");

const rowCountsBefore = await exactRowCounts();

const historyColumns = await query(`
  select column_name, is_nullable, column_default
  from information_schema.columns
  where table_schema='supabase_migrations' and table_name='schema_migrations'
  order by ordinal_position`);
const columnNames = new Set(historyColumns.map((row) => row.column_name));
assert.ok(columnNames.has("version"), "Migration history version column is missing");
const unsupportedRequired = historyColumns.filter((row) =>
  row.is_nullable === "NO" && row.column_default == null && !["version", "name", "statements"].includes(row.column_name));
assert.deepEqual(unsupportedRequired, [], "Migration history has an unsupported required column");

const insertColumns = ["version"];
const insertValues = [`'${migrationVersion}'`];
if (columnNames.has("name")) {
  insertColumns.push("name");
  insertValues.push("'production_security_alignment'");
}
if (columnNames.has("statements")) {
  insertColumns.push("statements");
  insertValues.push("array['controlled production security alignment']::text[]");
}
const historyInsert = `insert into supabase_migrations.schema_migrations(${insertColumns.join(",")}) values (${insertValues.join(",")});`;
const migrationWithoutCommit = migration.replace(/commit;\s*$/i, "");
const controlledSql = `${migrationWithoutCommit}\n${historyInsert}\ncommit;`;

try {
  await query(controlledSql, { readOnly: false });
} catch (error) {
  const versionsAfterAmbiguousResponse = await migrationVersions();
  if (!versionsAfterAmbiguousResponse.includes(migrationVersion)) throw error;
}

const versionsAfter = await migrationVersions();
assert.ok(versionsAfter.includes(migrationVersion), `${migrationVersion} was not recorded`);
assert.ok(!versionsAfter.includes(forbiddenVersion), `${forbiddenVersion} was unexpectedly applied`);
assert.deepEqual(
  versionsAfter.filter((version) => !versionsBefore.includes(version)),
  [migrationVersion],
  "Unexpected migration history change",
);

const rls = await query(`
  select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname = any(array[${affectedTables.map((t) => `'${t}'`).join(",")}])
  order by c.relname`);
assert.equal(rls.length, 34, "Not all 34 affected tables exist after migration");
assert.deepEqual(rls.filter((row) => row.rls_enabled !== true), [], "RLS is not enabled on all affected tables");

const view = await query(`
  select coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']::text[] as security_invoker
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='ai_agent_hourly_activity' and c.relkind='v'`);
assert.equal(view.length, 1, "ai_agent_hourly_activity view is missing");
assert.equal(view[0].security_invoker, true, "ai_agent_hourly_activity is not security_invoker");

await query(`
  begin;
  set transaction read only;
  set local role service_role;
  ${affectedTables.map((table) => `select count(*) from public.${quoteIdentifier(table)};`).join("\n")}
  select count(*) from public.ai_agent_hourly_activity;
  rollback;`, { readOnly: true });

const rowCountsAfter = await exactRowCounts();
assert.deepEqual(rowCountsAfter, rowCountsBefore, "Production table row counts changed during security migration");

console.log("Controlled Production security migration committed.");
console.log("Post-commit checks PASS: 34/34 RLS, security_invoker, service_role, row counts unchanged.");
console.log(`Migration history PASS: ${migrationVersion} applied; ${forbiddenVersion} pending.`);
