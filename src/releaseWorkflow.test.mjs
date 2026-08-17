import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("release workflow pins Supabase CLI and uses protected staging/production environments", async () => {
  const workflow = await read("../.github/workflows/supabase-release.yml");
  assert.match(workflow, /uses: supabase\/setup-cli@v1/);
  assert.match(workflow, /version: 2\.109\.1/);
  assert.match(workflow, /- staging\s+[\s\S]*- production/);
  assert.match(workflow, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(workflow, /supabase-pooler-cli\.mjs db push --dry-run/);
  assert.match(workflow, /supabase-pooler-cli\.mjs db push/);
  assert.doesNotMatch(workflow, /--include-all/);
});

test("Staging hardening audit is read-only and captures canonical evidence", async () => {
  const workflow = await read("../.github/workflows/staging-hardening-audit.yml");
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /version: 2\.109\.1/);
  assert.match(workflow, /supabase-pooler-cli\.mjs migration list/);
  assert.match(workflow, /node scripts\/supabase-remote-audit\.mjs/);
  assert.doesNotMatch(workflow, /db push|migration repair|functions deploy/);
  assert.match(await read("../scripts/supabase-remote-audit.mjs"), /advisors\/security/);
});

test("Staging baseline bounds include-all to the exact reviewed pending manifest", async () => {
  const workflow = await read("../.github/workflows/staging-baseline-apply.yml");
  const runner = await read("../scripts/apply-staging-baseline.mjs");
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /version: 2\.109\.1/);
  assert.match(runner, /migration", "repair/);
  assert.match(runner, /pendingVersions\(listOutput\)/);
  assert.match(runner, /baselineAlreadyApplied = pending\.length === 0/);
  assert.match(runner, /postBaselinePending/);
  assert.match(runner, /manifest\.genuinely_missing_and_safe_to_apply/);
  assert.match(runner, /db", "push", "--dry-run", "--include-all/);
  assert.match(runner, /db", "push", "--include-all/);
  assert.match(workflow, /STAGING_BASELINE_APPLY: "true"/);
  for (const name of [
    "visaflow-agent-orchestrator",
    "aiagentworker",
    "visaflow-ai-commander",
    "visaflow-email-dispatcher",
  ]) {
    assert.match(workflow, new RegExp(`supabase functions deploy ${name}`));
  }
  assert.match(workflow, /test "\$status" = "401" \|\| test "\$status" = "403"/);
});

test("release workflow deploys only reviewed functions and rejects anonymous callers", async () => {
  const workflow = await read("../.github/workflows/supabase-release.yml");
  for (const name of [
    "visaflow-agent-orchestrator",
    "aiagentworker",
    "visaflow-ai-commander",
    "visaflow-email-dispatcher",
  ]) {
    assert.match(workflow, new RegExp(`supabase functions deploy ${name}`));
  }
  assert.match(workflow, /test "\$status" = "401" \|\| test "\$status" = "403"/);
  assert.doesNotMatch(workflow, /echo.*SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD|ANON_KEY)/i);
});
