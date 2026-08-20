import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const mode = process.argv[2] || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
const runnerTemp = process.env.RUNNER_TEMP || ".";
const expectedProjectRef = "zeocbftriydodzfgixjv";
const forbiddenProjectRef = "iijhdilfzndqlguefipn";
const migrationVersion = "20260820000100";
const forbiddenVersion = "20260804000200";
const migrationPath = "supabase/migrations/20260820000100_production_security_alignment.sql";
const expectedMigrationSha256 = "b279e95cecc3ae9819feab5aac8b56b5bf592252955afa0a41dbc79b00b10b69";
const statePath = join(runnerTemp, "production-security-precheck-state.json");
const commitMarkerPath = join(runnerTemp, "production-security-schema-committed");

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
assert.ok(["backup", "precheck", "apply", "verify"].includes(mode), "Unknown remediation mode");
assert.equal(projectRef, expectedProjectRef, "Production project identity mismatch");
assert.notEqual(projectRef, forbiddenProjectRef, "Refusing to run against Staging");
assert.ok(accessToken, "SUPABASE_ACCESS_TOKEN is required");
if (mode !== "backup") assert.ok(password, "SUPABASE_DB_PASSWORD is required");

async function api(path, options = {}) {
  const response = await fetch(path.startsWith("https://") ? path : `https://api.supabase.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${path.startsWith("https://api.github.com/") ? process.env.GITHUB_TOKEN : accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`API request failed with HTTP ${response.status}`);
  return response;
}

async function confirmProject() {
  const response = await api(`/projects/${projectRef}`);
  const metadata = await response.json();
  assert.equal(metadata.id || metadata.ref, expectedProjectRef, "Supabase returned a different Production project");
}

async function pooler() {
  await confirmProject();
  const response = await api(`/projects/${projectRef}/config/database/pooler`);
  const poolers = await response.json();
  assert.ok(Array.isArray(poolers) && poolers.length > 0, "Supabase returned no pooler configuration");
  const primary = poolers.find((item) => String(item.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];
  const connection = String(primary.connection_string || primary.connectionString || "");
  const parsed = connection.match(/^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i);
  const host = String(primary.db_host || parsed?.[2] || "");
  const user = String(parsed?.[1] || primary.db_user || "");
  const database = String(primary.db_name || parsed?.[3] || "postgres");
  assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i, "Authoritative Session Pooler host is invalid");
  assert.equal(user, `postgres.${projectRef}`, "Authoritative Session Pooler user mismatch");
  return { host, user, database };
}

function runPsql(connection, extraArgs, { capture = false } = {}) {
  const args = [
    "--no-psqlrc", "--set=ON_ERROR_STOP=1",
    "--host", connection.host, "--port", "5432",
    "--username", connection.user, "--dbname", connection.database,
    ...extraArgs,
  ];
  const result = spawnSync("psql", args, {
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
    env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "15" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`psql failed with exit code ${result.status}`);
  }
  return capture ? String(result.stdout || "").trim() : "";
}

async function runSql(connection, sql, label) {
  const path = join(runnerTemp, `${label}.sql`);
  await writeFile(path, sql, { encoding: "utf8", mode: 0o600 });
  try {
    runPsql(connection, ["--quiet", "--file", path]);
  } finally {
    await unlink(path).catch(() => {});
  }
}

function query(connection, sql) {
  return runPsql(connection, ["--tuples-only", "--no-align", "--field-separator", "|", "--command", sql], { capture: true });
}

function migrationVersions(connection) {
  const text = query(connection, "select version::text from supabase_migrations.schema_migrations order by version");
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

function rowCounts(connection) {
  const statements = affectedTables.map((table) =>
    `select '${table}'::text,count(*)::bigint::text from public."${table}"`);
  const text = query(connection, statements.join(" union all "));
  return Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map((line) => line.split("|")));
}

async function verifyBackup() {
  assert.ok(process.env.GITHUB_TOKEN, "GITHUB_TOKEN is required");
  const artifactId = process.env.PRODUCTION_BACKUP_ARTIFACT_ID || "";
  assert.equal(artifactId, "9421790381", "Unexpected backup artifact id");
  const metadataResponse = await api(`https://api.github.com/repos/aalharbi95-max/visaflow-ksa/actions/artifacts/${artifactId}`);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.name, "visaflow-production-logical-backup-20260820T194240Z-encrypted");
  assert.equal(metadata.expired, false, "Encrypted Production backup artifact has expired");
  assert.ok(Number(metadata.size_in_bytes) > 0, "Encrypted Production backup artifact is empty");
  assert.ok(Date.parse(metadata.expires_at) > Date.now(), "Encrypted Production backup artifact is no longer valid");
  const runResponse = await api(`https://api.github.com/repos/aalharbi95-max/visaflow-ksa/actions/runs/${metadata.workflow_run.id}`);
  const run = await runResponse.json();
  assert.equal(run.conclusion, "success", "Production backup workflow did not complete successfully");
  const archiveResponse = await api(`https://api.github.com/repos/aalharbi95-max/visaflow-ksa/actions/artifacts/${artifactId}/zip`);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  assert.ok(archive.length > 0, "Downloaded encrypted backup archive is empty");
  assert.equal(archive.subarray(0, 2).toString("ascii"), "PK", "Backup artifact is not a valid ZIP container");
  const zipPath = join(runnerTemp, "production-backup-encrypted.zip");
  await writeFile(zipPath, archive, { mode: 0o600 });
  const test = spawnSync("unzip", ["-tq", zipPath], { encoding: "utf8", shell: false });
  assert.equal(test.status, 0, "Encrypted backup ZIP integrity check failed");
  const listing = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8", shell: false });
  assert.equal(listing.status, 0, "Could not inspect encrypted backup ZIP");
  const entries = String(listing.stdout || "").split(/\r?\n/).filter(Boolean);
  assert.equal(entries.length, 1, "Backup artifact must contain exactly one encrypted file");
  assert.equal(entries[0], "visaflow-production-logical-backup-20260820T194240Z.tar.gz.cms",
    "Backup artifact does not contain the expected encrypted CMS payload");
  const extracted = spawnSync("unzip", ["-p", zipPath, entries[0]], {
    encoding: null,
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(extracted.status, 0, "Could not extract encrypted CMS payload for integrity validation");
  assert.ok(extracted.stdout?.length > 0, "Encrypted CMS payload is empty");
  const encryptedPath = join(runnerTemp, "production-backup-encrypted.cms");
  await writeFile(encryptedPath, extracted.stdout, { mode: 0o600 });
  const cms = spawnSync("openssl", ["cms", "-cmsout", "-inform", "DER", "-in", encryptedPath, "-noout"], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(cms.status, 0, "Encrypted CMS payload structure is invalid");
  console.log(`Backup gate PASS: encrypted artifact ${artifactId}, ${metadata.size_in_bytes} bytes, expires ${metadata.expires_at}.`);
}

async function validateMigration() {
  const migration = await readFile(migrationPath, "utf8");
  assert.equal(createHash("sha256").update(migration).digest("hex"), expectedMigrationSha256, "Reviewed migration hash mismatch");
  assert.ok(/^begin;/im.test(migration), "Migration transaction BEGIN is missing");
  assert.ok(/commit;\s*$/i.test(migration), "Migration transaction COMMIT is missing");
  assert.doesNotMatch(migration, /^\s*(insert|update|delete|truncate)\b/gim, "Migration contains forbidden row DML");
  return migration;
}

async function precheck() {
  const migration = await validateMigration();
  const connection = await pooler();
  const versions = migrationVersions(connection);
  assert.ok(!versions.includes(migrationVersion), `${migrationVersion} is already recorded`);
  assert.ok(!versions.includes(forbiddenVersion), `${forbiddenVersion} must remain pending`);
  const start = migration.indexOf("do $precheck$");
  const marker = "$precheck$;";
  const end = migration.indexOf(marker, start);
  assert.ok(start >= 0 && end > start, "Exact migration precheck block not found");
  const precheckSql = migration.slice(start, end + marker.length);
  await runSql(connection, `begin; set transaction read only; ${precheckSql} rollback;`, "production-read-only-prechecks");
  const counts = rowCounts(connection);
  await writeFile(statePath, JSON.stringify({ projectRef, versions, counts }), { encoding: "utf8", mode: 0o600 });
  console.log("Production identity and tenant/null/orphan/helper prechecks PASS via authoritative Session Pooler (read-only).");
}

async function apply() {
  const migration = await validateMigration();
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.projectRef, expectedProjectRef, "Precheck state project mismatch");
  const connection = await pooler();
  const versions = migrationVersions(connection);
  assert.ok(!versions.includes(migrationVersion), "Migration became applied after precheck; refusing SQL replay");
  assert.ok(!versions.includes(forbiddenVersion), `${forbiddenVersion} must remain pending`);
  await runSql(connection, migration, "production-security-migration");
  await writeFile(commitMarkerPath, new Date().toISOString(), { encoding: "utf8", mode: 0o600 });
  console.log("Production security SQL transaction COMMITTED. Do not rerun SQL if the next history-repair step fails.");
}

async function verify() {
  await readFile(commitMarkerPath, "utf8");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const connection = await pooler();
  const versions = migrationVersions(connection);
  assert.ok(versions.includes(migrationVersion), `${migrationVersion} is not recorded as applied`);
  assert.ok(!versions.includes(forbiddenVersion), `${forbiddenVersion} was unexpectedly applied`);
  const quotedTables = affectedTables.map((table) => `'${table}'`).join(",");
  const rls = query(connection, `select count(*)::text,count(*) filter(where c.relrowsecurity)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${quotedTables}])`).split("|");
  assert.deepEqual(rls, ["34", "34"], "RLS is not enabled on all 34 targeted tables");
  const invoker = query(connection, "select (coalesce(c.reloptions,array[]::text[]) @> array['security_invoker=true']::text[])::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='ai_agent_hourly_activity' and c.relkind='v'");
  assert.equal(invoker, "true", "ai_agent_hourly_activity is not security_invoker");
  await runSql(connection, `begin; set transaction read only; set local role service_role; ${affectedTables.map((table) => `select count(*) from public."${table}";`).join("\n")} select count(*) from public.ai_agent_hourly_activity; rollback;`, "production-service-role-check");
  assert.deepEqual(rowCounts(connection), state.counts, "Production targeted table row counts changed");
  console.log("Post-commit verification PASS: 34/34 RLS, security_invoker, service_role, row counts unchanged.");
  console.log(`Migration history PASS: ${migrationVersion} applied; ${forbiddenVersion} pending.`);
}

if (mode === "backup") await verifyBackup();
if (mode === "precheck") await precheck();
if (mode === "apply") await apply();
if (mode === "verify") await verify();
