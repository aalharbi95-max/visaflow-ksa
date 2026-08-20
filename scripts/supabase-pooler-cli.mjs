import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const cliArgs = process.argv.slice(2);
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.ok(password, "SUPABASE_DB_PASSWORD is required");
assert.match(projectRef, /^[a-z]{20}$/i, "SUPABASE_PROJECT_REF is invalid");
assert.ok(cliArgs.length >= 2, "A Supabase CLI command is required");

const metadataResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!metadataResponse.ok) throw new Error(`Supabase project metadata failed with HTTP ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
assert.equal(metadata.id, projectRef, "Supabase project metadata does not match SUPABASE_PROJECT_REF");

// Read the authoritative Supavisor endpoint. A project's pooler hostname is not
// safely derivable from its cloud provider and region.
const poolerResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!poolerResponse.ok) throw new Error(`Supabase pooler config failed with HTTP ${poolerResponse.status}`);
const poolers = await poolerResponse.json();
assert.ok(Array.isArray(poolers) && poolers.length > 0, "Supabase returned no pooler configuration");
const primary = poolers.find((pooler) => String(pooler.database_type || "").toUpperCase() === "PRIMARY") || poolers[0];

const connectionString = String(primary.connection_string || primary.connectionString || "");
const parsedConnection = connectionString.match(
  /^postgres(?:ql)?:\/\/([^:@/]+)(?::[^@]*)?@([^:/?#]+)(?::\d+)?\/([^?]+)/i,
);
const host = String(primary.db_host || parsedConnection?.[2] || "");
const user = String(parsedConnection?.[1] || primary.db_user || "");
const database = String(primary.db_name || parsedConnection?.[3] || "postgres");
assert.match(host, /^[a-z0-9.-]+\.pooler\.supabase\.com$/i, "Authoritative Supabase pooler host is invalid");
assert.equal(user, `postgres.${projectRef}`, "Authoritative Supabase pooler user does not match the project");

// Port 5432 selects Session Pooler mode. Credentials exist only in this process.
const dbUrl = `postgresql://${user}:${encodeURIComponent(password)}@${host}:5432/${database}?sslmode=require`;
const result = spawnSync("supabase", [...cliArgs, "--db-url", dbUrl], {
  stdio: "inherit",
  shell: false,
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
