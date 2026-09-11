import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

async function verifiedLogicalBackup() {
  const githubToken = process.env.GITHUB_TOKEN || "";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const artifactId = process.env.PRODUCTION_BACKUP_ARTIFACT_ID || "";
  const runId = process.env.PRODUCTION_BACKUP_RUN_ID || "";
  assert.ok(githubToken && repository && artifactId && runId, "Approved encrypted Production backup evidence is required");
  const headers = { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" };
  const [artifactResponse, runResponse] = await Promise.all([
    fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`, { headers, signal: AbortSignal.timeout(30_000) }),
    fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, { headers, signal: AbortSignal.timeout(30_000) }),
  ]);
  assert.ok(artifactResponse.ok, `Approved encrypted backup artifact lookup failed with HTTP ${artifactResponse.status}`);
  assert.ok(runResponse.ok, `Approved encrypted backup run lookup failed with HTTP ${runResponse.status}`);
  const [artifact, run] = await Promise.all([artifactResponse.json(), runResponse.json()]);
  const createdAt = Date.parse(artifact.created_at || "");
  const expiresAt = Date.parse(artifact.expires_at || "");
  const ageMs = Date.now() - createdAt;
  const valid = artifact.expired === false
    && artifact.workflow_run?.id === Number(runId)
    && /^visaflow-production-logical-backup-\d{8}T\d{6}Z-encrypted$/.test(String(artifact.name || ""))
    && Number(artifact.size_in_bytes) > 0
    && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 48 * 60 * 60 * 1000
    && Number.isFinite(expiresAt) && expiresAt > Date.now()
    && run.conclusion === "success";
  return {
    valid,
    artifact_id: Number(artifactId),
    run_id: Number(runId),
    created_at: artifact.created_at || null,
    expires_at: artifact.expires_at || null,
    encrypted_size_bytes: Number(artifact.size_in_bytes || 0),
  };
}

async function sessionPooler() {
  const poolers = await management(`/projects/${projectRef}/config/database/pooler`);
  assert.ok(Array.isArray(poolers) && poolers.length > 0, "Supabase returned no pooler configuration");
  const primary = poolers.find((item) => String(item.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];
  const connectionString = String(primary.connection_string || primary.connectionString || "");
  const parsed = connectionString.match(/^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i);
  const host = String(primary.db_host || parsed?.[2] || "");
  const user = String(parsed?.[1] || primary.db_user || "");
  const database = String(primary.db_name || parsed?.[3] || "postgres");
  assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i, "Authoritative Session Pooler host is invalid");
  assert.equal(user, `postgres.${projectRef}`, "Authoritative Session Pooler user mismatch");
  return { host, user, database };
}

function queryPoolerJson(connection, sql) {
  const password = process.env.SUPABASE_DB_PASSWORD || "";
  assert.ok(password, "SUPABASE_DB_PASSWORD is required");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync("psql", [
      "--no-psqlrc", "--set=ON_ERROR_STOP=1",
      "--host", connection.host, "--port", "5432",
      "--username", connection.user, "--dbname", connection.database,
      "--tuples-only", "--no-align", "--command",
      `begin; set transaction read only; set local statement_timeout = '180s'; ${sql}; rollback;`,
    ], {
      encoding: "utf8",
      shell: false,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "60" },
    });
    if (result.error) throw result.error;
    if (result.status === 0) {
      const line = String(result.stdout || "").split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith("{"));
      assert.ok(line, "Production catalog query returned no JSON result");
      return JSON.parse(line);
    }
    const diagnostic = `${String(result.stderr || "")}\n${String(result.stdout || "")}`;
    const checkoutFailure = /ECHECKOUTTIMEOUT|authentication did not complete within/i.test(diagnostic);
    if (!checkoutFailure || attempt === 3) throw new Error(`Production catalog read failed with exit code ${result.status}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 2_000);
  }
  throw new Error("Production catalog retry loop exited unexpectedly");
}

const migrationFiles = (await readdir("supabase/migrations"))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const repositoryVersions = migrationFiles.map((name) => name.match(/^(\d+)_/)?.[1]).filter(Boolean);

const metadata = await management(`/projects/${projectRef}`);
assert.equal(metadata.id || metadata.ref, projectRef, "Management API returned a different project");
const connection = await sessionPooler();
const catalog = queryPoolerJson(connection, `
  select json_build_object(
    'migration_history_exists', to_regclass('supabase_migrations.schema_migrations') is not null,
    'remote_versions', (select coalesce(json_agg(version::text order by version), '[]'::json) from supabase_migrations.schema_migrations),
    'tables', (select coalesce(json_agg(json_build_object('table_name', relname, 'rls_enabled', relrowsecurity, 'rls_forced', relforcerowsecurity) order by relname), '[]'::json)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
    'hiring_rpc_count', (select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='list_company_hiring_pipeline')
  )::text
`);
const backups = await management(`/projects/${projectRef}/database/backups`);
const logicalBackup = await verifiedLogicalBackup();
const migrationHistoryExists = catalog.migration_history_exists === true;
const remoteVersions = Array.isArray(catalog.remote_versions) ? catalog.remote_versions.map(String) : [];
const tables = Array.isArray(catalog.tables) ? catalog.tables : [];
const hiringRpcCount = Number(catalog.hiring_rpc_count || 0);

const unknownRemoteVersions = remoteVersions.filter((version) => !repositoryVersions.includes(version));
const pendingVersions = repositoryVersions.filter((version) => !remoteVersions.includes(version));
const rlsDisabled = tables.filter((row) => row.rls_enabled !== true).map((row) => row.table_name);
const backupRows = Array.isArray(backups.backups) ? backups.backups : [];
const completedBackups = backupRows.filter((backup) => String(backup.status).toUpperCase() === "COMPLETED");

const blockers = [];
if (!migrationHistoryExists) blockers.push("migration_history_table_missing");
if (unknownRemoteVersions.length) blockers.push("unknown_remote_migration_versions");
if (rlsDisabled.length) blockers.push("public_tables_without_rls");
if (hiringRpcCount !== 1) blockers.push("canonical_hiring_pipeline_rpc_missing");
if (!completedBackups.length && backups.pitr_enabled !== true && !logicalBackup.valid) blockers.push("no_valid_production_backup");

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
  hiring_pipeline_rpc_count: hiringRpcCount,
  backups: {
    pitr_enabled: backups.pitr_enabled === true,
    walg_enabled: backups.walg_enabled === true,
    completed_count: completedBackups.length,
    latest_completed_at: completedBackups.map((backup) => backup.inserted_at).filter(Boolean).sort().at(-1) || null,
    approved_encrypted_logical_backup: logicalBackup,
  },
  blockers,
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Production preflight captured: ${remoteVersions.length}/${repositoryVersions.length} migrations, ${rlsDisabled.length} tables without RLS, ${completedBackups.length} completed backups.`);
if (blockers.length) {
  console.error(`Production preflight blockers: ${blockers.join(", ")}`);
  process.exit(1);
}
