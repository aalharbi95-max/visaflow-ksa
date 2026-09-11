import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const runnerTemp = process.env.RUNNER_TEMP || ".";
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.ok(password, "SUPABASE_DB_PASSWORD is required");
assert.equal(projectRef, "zeocbftriydodzfgixjv", "Production project mismatch");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const api = async (path) => {
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Supabase Management API failed with HTTP ${response.status}`);
  return response.json();
};

const [metadata, poolers] = await Promise.all([
  api(`/projects/${projectRef}`),
  api(`/projects/${projectRef}/config/database/pooler`),
]);
assert.equal(metadata.id || metadata.ref, projectRef, "Supabase returned a different Production project");
assert.ok(Array.isArray(poolers) && poolers.length > 0, "Supabase returned no pooler configuration");
const primary = poolers.find((item) => String(item.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];
const connectionString = String(primary.connection_string || primary.connectionString || "");
const parsed = connectionString.match(/^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i);
const host = String(primary.db_host || parsed?.[2] || "");
const user = String(parsed?.[1] || primary.db_user || "");
const database = String(primary.db_name || parsed?.[3] || "postgres");
assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i, "Authoritative Session Pooler host is invalid");
assert.equal(user, `postgres.${projectRef}`, "Authoritative Session Pooler user mismatch");

const splinterCommit = "af0013defad2ae07bc111194eca7920187f5f440";
const splinterResponse = await fetch(
  `https://raw.githubusercontent.com/supabase/splinter/${splinterCommit}/splinter.sql`,
  { signal: AbortSignal.timeout(30_000) },
);
assert.ok(splinterResponse.ok, `Pinned Supabase Splinter source failed with HTTP ${splinterResponse.status}`);
const splinterSql = await splinterResponse.text();
const errorBlocks = splinterSql
  .split(/\r?\nunion all\r?\n(?=\()/)
  .filter((block) => /'ERROR'\s+as\s+level/i.test(block));
assert.equal(errorBlocks.length, 8, "Pinned Supabase Splinter ERROR rule inventory changed unexpectedly");

const sqlPath = join(runnerTemp, "production-security-advisor-read-only.sql");
const sql = `
begin;
set transaction read only;
set local statement_timeout = '480s';
select advisor.name::text, count(*)::bigint::text
from (
${errorBlocks.join("\nunion all\n")}
) advisor
group by advisor.name
order by advisor.name;
rollback;
`;
await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 });

let result;
try {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = spawnSync("psql", [
      "--no-psqlrc", "--set=ON_ERROR_STOP=1",
      "--host", host, "--port", "5432",
      "--username", user, "--dbname", database,
      "--tuples-only", "--no-align", "--field-separator", "|",
      "--file", sqlPath,
    ], {
      encoding: "utf8",
      shell: false,
      timeout: 600_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: password, PGSSLMODE: "require", PGCONNECT_TIMEOUT: "60" },
    });
    if (result.error) throw result.error;
    if (result.status === 0) break;
    const diagnostic = `${String(result.stderr || "")}\n${String(result.stdout || "")}`;
    const checkoutFailure = /ECHECKOUTTIMEOUT|authentication did not complete within/i.test(diagnostic);
    if (checkoutFailure && attempt < 3) {
      console.error(`Session Pooler checkout unavailable; retrying read-only Advisor acquisition (${attempt}/3).`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
      continue;
    }
    throw new Error(`Read-only Supabase Security Advisor query failed with exit code ${result.status}`);
  }
} finally {
  await unlink(sqlPath).catch(() => {});
}

assert.equal(result?.status, 0, "Read-only Supabase Security Advisor query did not complete");
const rows = String(result.stdout || "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.includes("|"));
const ruleCounts = Object.fromEntries(rows.map((line) => {
  const [rule, count] = line.split("|");
  assert.match(count, /^\d+$/, "Unexpected Advisor count output");
  return [rule, Number(count)];
}));
const blockerCount = Object.values(ruleCounts).reduce((sum, count) => sum + count, 0);
console.log(`Pinned Supabase Security Advisor Critical/High/ERROR findings: ${blockerCount}`);
if (blockerCount > 0) console.log(`Blocking Advisor rules: ${JSON.stringify(ruleCounts)}`);
assert.equal(blockerCount, 0, "Pinned Supabase Security Advisor has blocking findings");
