import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(await readFile("supabase/release/staging-baseline-20260817.json", "utf8"));
assert.equal(process.env.SUPABASE_PROJECT_REF, manifest.project_ref, "Staging project mismatch");
const repair = [...manifest.already_reflected_in_schema, ...manifest.obsolete_or_unsafe_to_replay];
assert.equal(new Set(repair).size, repair.length, "Duplicate repair version");

function run(args) {
  const result = spawnSync("node", ["scripts/supabase-pooler-cli.mjs", ...args], { stdio: "inherit", shell: false, env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runCaptured(args) {
  const result = spawnSync("node", ["scripts/supabase-pooler-cli.mjs", ...args], {
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) process.exit(result.status ?? 1);
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function pendingVersions(migrationList) {
  return migrationList
    .split(/\r?\n/)
    .map((line) => line.split("|"))
    .filter((columns) => columns.length >= 2)
    .map(([local, remote]) => ({
      local: local.match(/\d{14}/)?.[0],
      remote: remote.match(/\d{14}/)?.[0],
    }))
    .filter(({ local, remote }) => local && !remote)
    .map(({ local }) => local);
}

run(["migration", "repair", ...repair, "--status", "applied"]);
const listOutput = runCaptured(["migration", "list"]);
assert.deepEqual(
  pendingVersions(listOutput),
  manifest.genuinely_missing_and_safe_to_apply,
  "Remote pending migrations differ from the reviewed Staging baseline manifest"
);
// Supabase requires --include-all because the reviewed missing files precede newer
// migrations already recorded remotely. The assertion above makes this bounded.
run(["db", "push", "--dry-run", "--include-all"]);
if (process.env.STAGING_BASELINE_APPLY !== "true") {
  console.log("Baseline dry-run completed; apply flag is false.");
  process.exit(0);
}
run(["db", "push", "--include-all"]);
run(["migration", "list"]);
