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
  assert.match(workflow, /supabase db push --linked --include-all --dry-run/);
  assert.match(workflow, /supabase db push --linked --include-all/);
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
