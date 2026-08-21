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
  assert.match(workflow, /node scripts\/staging-security-smoke\.mjs/);
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

test("Production baseline classification keeps schema evidence ephemeral and version-only", async () => {
  const workflow = await read("../.github/workflows/production-baseline-classify.yml");
  const classifier = await read("../scripts/classify-production-migrations.mjs");
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /PRODUCTION_SCHEMA_DUMP: \$\{\{ runner\.temp \}\}/);
  assert.match(workflow, /db dump --schema public/);
  assert.match(workflow, /rm -f -- "\$PRODUCTION_SCHEMA_DUMP"/);
  assert.doesNotMatch(workflow, /path:\s*production-schema\.sql|path:\s*\$\{\{ runner\.temp \}\}/);
  assert.doesNotMatch(workflow, /migration repair|db push|functions deploy/);
  assert.match(classifier, /assert\.equal\(files\.length, 77/);
  assert.match(classifier, /schema_dump_persisted: false/);
  assert.doesNotMatch(classifier, /definition|pg_get_functiondef/);
});

test("Production preflight dry-run is read-only and bounded to the reviewed pending migration", async () => {
  const workflow = await read("../.github/workflows/production-preflight.yml");
  const validator = await read("../scripts/validate-production-dry-run.mjs");
  assert.match(workflow, /db push --dry-run --include-all/);
  assert.match(workflow, /validate-production-dry-run\.mjs/);
  assert.match(workflow, /check-production-security-advisor-sql\.mjs/);
  assert.match(workflow, /steps\.advisor\.outcome/);
  assert.match(await read("../scripts/production-preflight.mjs"), /AbortSignal\.timeout\(60_000\)/);
  assert.match(await read("../scripts/production-preflight.mjs"), /AbortSignal\.timeout\(180_000\)/);
  assert.match(await read("../scripts/production-preflight.mjs"), /join\("\\nunion all\\n"\)/);
  assert.match(validator, /\["20260804000200"\]/);
  assert.doesNotMatch(workflow, /db push(?! --dry-run)/);
  assert.doesNotMatch(validator, /spawn|exec|writeFile/);
});

test("Production Advisor gate is pinned, read-only, retried, and requires zero blockers", async () => {
  const workflow = await read("../.github/workflows/production-security-advisor-audit.yml");
  const checker = await read("../scripts/check-production-security-advisor-sql.mjs");
  assert.match(workflow, /check-production-security-advisor-sql\.mjs/);
  assert.match(checker, /set transaction read only/);
  assert.match(checker, /af0013defad2ae07bc111194eca7920187f5f440/);
  assert.match(checker, /attempt <= 3/);
  assert.match(checker, /assert\.equal\(blockerCount, 0/);
  assert.doesNotMatch(checker, /\b(?:insert|update|delete|alter|drop|truncate)\b/i);
});

test("Production baseline repair is manual, bounded, and never applies migration SQL", async () => {
  const workflow = await read("../.github/workflows/production-baseline-repair.yml");
  const runner = await read("../scripts/apply-production-baseline-repair.mjs");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /confirm_project_ref/);
  assert.match(runner, /migration", "repair"/);
  assert.match(runner, /db", "push", "--dry-run", "--include-all"/);
  assert.doesNotMatch(runner, /db", "push"\](?!.*--dry-run)/);
  assert.match(runner, /assert\.deepEqual\(pending, missing/);
  assert.match(runner, /assert\.deepEqual\(proposed, missing/);
  assert.match(workflow, /check-production-security-advisor\.mjs/);
  assert.doesNotMatch(workflow, /functions deploy/);
});
