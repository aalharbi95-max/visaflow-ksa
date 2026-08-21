import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const output = process.env.SUPABASE_PREFLIGHT_OUTPUT || "production-preflight.json";
const expectedProductionRef = "zeocbftriydodzfgixjv";
const stagingRef = "iijhdilfzndqlguefipn";

assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.equal(projectRef, expectedProductionRef, "Production project identity mismatch");
assert.notEqual(projectRef, stagingRef, "Refusing to audit Staging as Production");
assert.equal(new URL(supabaseUrl).hostname, `${projectRef}.supabase.co`, "Production URL/ref mismatch");

async function management(path) {
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504, 522, 524, 544]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.supabase.com/v1${path}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (attempt === 3) throw new Error(`Management API ${path} timed out after ${attempt} attempts`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      continue;
    }
    if (response.ok) return response.json();
    if (!retryableStatuses.has(response.status) || attempt === 3) {
      throw new Error(`Management API ${path} failed with HTTP ${response.status} after ${attempt} attempt(s)`);
    }
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw new Error(`Management API ${path} retry loop exited unexpectedly`);
}

async function query(sql) {
  const retryableStatuses = new Set([502, 503, 504, 522, 524, 544]);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, read_only: true }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      if (attempt === 3) throw new Error(`Production read-only query timed out after ${attempt} attempts`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      continue;
    }
    if (response.ok) return response.json();
    if (!retryableStatuses.has(response.status) || attempt === 3) {
      throw new Error(`Production read-only query failed with HTTP ${response.status} after ${attempt} attempt(s)`);
    }
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  throw new Error("Production read-only query retry loop exited unexpectedly");
}

const migrationFiles = (await readdir("supabase/migrations"))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const repositoryVersions = migrationFiles.map((name) => name.match(/^(\d+)_/)?.[1]).filter(Boolean);

const metadata = await management(`/projects/${projectRef}`);
assert.equal(metadata.id || metadata.ref, projectRef, "Management API returned a different project");

const migrationHistoryTable = await query(`
  select to_regclass('supabase_migrations.schema_migrations') is not null as exists`);
const remoteMigrations = migrationHistoryTable[0]?.exists === true
  ? await query(`select version::text from supabase_migrations.schema_migrations order by version`)
  : [];

const [tables, hiringRpc, backups] = await Promise.all([
  query(`
    select c.relname as table_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') order by c.relname`),
  query(`
    select count(*)::integer as count
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_company_hiring_pipeline'`),
  management(`/projects/${projectRef}/database/backups`),
]);

const remoteVersions = remoteMigrations.map((row) => String(row.version));
const unknownRemoteVersions = remoteVersions.filter((version) => !repositoryVersions.includes(version));
const pendingVersions = repositoryVersions.filter((version) => !remoteVersions.includes(version));
const rlsDisabled = tables.filter((row) => row.rls_enabled !== true).map((row) => row.table_name);
const backupRows = Array.isArray(backups.backups) ? backups.backups : [];
const completedBackups = backupRows.filter((backup) => String(backup.status).toUpperCase() === "COMPLETED");

const blockers = [];
if (migrationHistoryTable[0]?.exists !== true) blockers.push("migration_history_table_missing");
if (unknownRemoteVersions.length) blockers.push("unknown_remote_migration_versions");
if (rlsDisabled.length) blockers.push("public_tables_without_rls");
if (hiringRpc[0]?.count !== 1) blockers.push("canonical_hiring_pipeline_rpc_missing");
if (!completedBackups.length && backups.pitr_enabled !== true) blockers.push("no_completed_backup_or_pitr");

const report = {
  captured_at: new Date().toISOString(),
  project: {
    ref: projectRef,
    name: metadata.name || null,
    region: metadata.region || null,
    status: metadata.status || null,
    url: supabaseUrl,
    staging_ref_rejected: projectRef !== stagingRef,
  },
  migrations: {
    repository_count: repositoryVersions.length,
    remote_count: remoteVersions.length,
    pending_count: pendingVersions.length,
    pending_versions: pendingVersions,
    unknown_remote_versions: unknownRemoteVersions,
  },
  security: {
    public_table_count: tables.length,
    rls_disabled: rlsDisabled,
    advisor_gate: "pinned_splinter_sql_zero_blockers",
  },
  tenant_integrity_gate: "reviewed_security_migration_precheck_block",
  hiring_pipeline_rpc_count: hiringRpc[0]?.count || 0,
  backups: {
    pitr_enabled: backups.pitr_enabled === true,
    walg_enabled: backups.walg_enabled === true,
    completed_count: completedBackups.length,
    latest_completed_at: completedBackups.map((backup) => backup.inserted_at).filter(Boolean).sort().at(-1) || null,
  },
  blockers,
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Production preflight captured: ${remoteVersions.length}/${repositoryVersions.length} migrations, ${rlsDisabled.length} tables without RLS, ${completedBackups.length} completed backups.`);
if (blockers.length) {
  console.error(`Production preflight blockers: ${blockers.join(", ")}`);
  process.exit(1);
}
