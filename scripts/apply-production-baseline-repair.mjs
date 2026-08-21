import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(await readFile("supabase/release/production-baseline-20260820.json", "utf8"));
assert.equal(process.env.SUPABASE_PROJECT_REF, manifest.project_ref, "Production project mismatch");
assert.equal(process.env.PRODUCTION_BASELINE_REPAIR, "true", "Production repair confirmation is required");

const files = (await readdir("supabase/migrations")).filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort();
const repositoryVersions = files.map((file) => file.slice(0, 14));
const repair = [...manifest.already_reflected_in_schema, ...manifest.obsolete_or_unsafe_to_replay];
const missing = manifest.genuinely_missing_and_safe_to_apply;
const classified = [...repair, ...missing].sort();
assert.equal(manifest.project_ref, "zeocbftriydodzfgixjv", "Manifest is not tied to Production");
assert.equal(manifest.repository_migration_count, 77, "Unexpected manifest migration count");
assert.equal(new Set(classified).size, classified.length, "Duplicate Production baseline version");
assert.deepEqual(classified, repositoryVersions, "Production manifest must classify every repository migration exactly once");

function execute(args, { capture = false, attempts = 1 } = {}) {
  let lastResult;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("node", ["scripts/supabase-pooler-cli.mjs", ...args], {
      encoding: capture ? "utf8" : undefined,
      stdio: capture ? "pipe" : "inherit",
      shell: false,
      env: process.env,
    });
    if (result.error) throw result.error;
    lastResult = result;
    if (result.status === 0) return capture ? `${result.stdout || ""}\n${result.stderr || ""}` : "";
    if (attempt < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 2_000);
  }
  if (capture) {
    process.stdout.write(lastResult?.stdout || "");
    process.stderr.write(lastResult?.stderr || "");
  }
  process.exit(lastResult?.status ?? 1);
}

function pendingVersions(migrationList) {
  return migrationList.split(/\r?\n/)
    .map((line) => line.split("|"))
    .filter((columns) => columns.length >= 2)
    .map(([local, remote]) => ({ local: local.match(/\d{14}/)?.[0], remote: remote.match(/\d{14}/)?.[0] }))
    .filter(({ local, remote }) => local && !remote)
    .map(({ local }) => local);
}

// This is the only remote write: history repair for versions whose replay is
// either proven redundant or fail-closed as unsafe. No migration SQL runs.
execute(["migration", "repair", ...repair, "--status", "applied"]);

const listOutput = execute(["migration", "list"], { capture: true, attempts: 3 });
const pending = pendingVersions(listOutput);
assert.deepEqual(pending, missing, "Pending migrations differ from the reviewed Production baseline");
await writeFile("production-migration-list-after-repair.txt", listOutput, "utf8");

const dryRunOutput = execute(["db", "push", "--dry-run", "--include-all"], { capture: true, attempts: 3 });
const proposed = [...dryRunOutput.matchAll(/(?:•|-)\s+(\d{14})_[a-z0-9_]+\.sql/gi)].map((match) => match[1]);
assert.deepEqual(proposed, missing, "Production dry-run proposes migrations outside the reviewed missing list");
await writeFile("production-migration-dry-run-after-repair.txt", dryRunOutput, "utf8");

console.log(`Production migration repair recorded ${repair.length} reviewed versions.`);
console.log(`Production pending migrations (${pending.length}): ${pending.join(",")}`);
