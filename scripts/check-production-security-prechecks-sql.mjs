import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const runnerTemp = process.env.RUNNER_TEMP || ".";
assert.ok(token && password, "Production credentials are required");
assert.equal(projectRef, "zeocbftriydodzfgixjv", "Production project mismatch");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function api(path) {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Supabase Management API failed with HTTP ${response.status}`);
  return response.json();
}
const [metadata, poolers] = await Promise.all([
  api(`/projects/${projectRef}`),
  api(`/projects/${projectRef}/config/database/pooler`),
]);
assert.equal(metadata.id || metadata.ref, projectRef, "Supabase returned a different Production project");
const primary = poolers.find((item) => String(item.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];
const connection = String(primary?.connection_string || primary?.connectionString || "");
const parsed = connection.match(/^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i);
const host = String(primary?.db_host || parsed?.[2] || "");
const user = String(parsed?.[1] || primary?.db_user || "");
const database = String(primary?.db_name || parsed?.[3] || "postgres");
assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i, "Authoritative Session Pooler host is invalid");
assert.equal(user, `postgres.${projectRef}`, "Authoritative Session Pooler user mismatch");

const migration = await readFile("supabase/migrations/20260820000100_production_security_alignment.sql", "utf8");
const precheck = migration.match(/do \$precheck\$[\s\S]*?\$precheck\$;/i)?.[0] || "";
assert.ok(precheck, "Reviewed Production security precheck block is missing");
assert.doesNotMatch(precheck, /\b(?:insert|update|delete|alter|drop|truncate|grant|revoke|create)\b/i,
  "Production security precheck block must remain read-only");

const sqlPath = join(runnerTemp, "production-security-prechecks-read-only.sql");
await writeFile(sqlPath, `begin;\nset transaction read only;\nset local statement_timeout='180s';\n${precheck}\nrollback;\n`, {
  encoding: "utf8",
  mode: 0o600,
});

let result;
try {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = spawnSync("psql", ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--host", host, "--port", "5432",
      "--username", user, "--dbname", database, "--quiet", "--file", sqlPath], {
      encoding: "utf8",
      shell: false,
      timeout: 240_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "60" },
    });
    if (result.error) throw result.error;
    if (result.status === 0) break;
    const diagnostic = `${String(result.stderr || "")}\n${String(result.stdout || "")}`;
    const checkoutFailure = /ECHECKOUTTIMEOUT|authentication did not complete within/i.test(diagnostic);
    if (checkoutFailure && attempt < 3) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
      continue;
    }
    throw new Error(`Production security prechecks failed with exit code ${result.status}`);
  }
} finally {
  await unlink(sqlPath).catch(() => {});
}
assert.equal(result?.status, 0, "Production security prechecks did not complete");
console.log("Production tenant/null/orphan/helper prechecks PASS using the reviewed migration block in a read-only transaction.");
