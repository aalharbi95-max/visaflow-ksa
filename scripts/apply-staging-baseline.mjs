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

run(["migration", "repair", ...repair, "--status", "applied"]);
run(["migration", "list"]);
run(["db", "push", "--dry-run"]);
if (process.env.STAGING_BASELINE_APPLY !== "true") {
  console.log("Baseline dry-run completed; apply flag is false.");
  process.exit(0);
}
run(["db", "push"]);
run(["migration", "list"]);
