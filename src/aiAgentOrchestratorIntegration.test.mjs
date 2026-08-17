import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Phase 1 migration defines memory, plans, approvals, RLS, and tenant-derived queueing", async () => {
  const source = await read("../supabase/migrations/20260817000500_autonomous_ai_agent_foundation.sql");
  for (const table of ["ai_agent_cases", "ai_agent_runs", "ai_agent_execution_steps", "ai_agent_case_events", "ai_agent_case_memory", "ai_agent_followup_tasks", "ai_agent_approval_requests"]) assert.match(source, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(source, /enable row level security/gi);
  assert.match(source, /revoke all on public\.ai_agent_jobs from public, anon, authenticated/i);
  assert.match(source, /create table if not exists public\.ai_agent_usage_ledger/i);
  assert.match(source, /add column if not exists ai_agent_enabled/i);
  assert.match(source, /current_app_user_company_id\(\) is distinct from p_company_id/i);
  assert.match(source, /enqueue_ai_agent_request_review/);
  assert.match(source, /decide_ai_agent_approval/);
  assert.match(source, /Never store hidden chain-of-thought/i);
});

test("Orchestrator derives tenants and rejects company_id payloads", async () => {
  const source = await read("../supabase/functions/visaflow-agent-orchestrator/index.ts");
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(body, "company_id"\)/);
  assert.match(source, /\.eq\("company_id", ctx\.companyId\)/);
  assert.match(source, /internal_job_or_case_required/);
  assert.doesNotMatch(source, /from\("[^\"]+"\)\.delete/);
  assert.doesNotMatch(source, /\b(sql|query)_tool\b/i);
});

test("every mutating Phase 1 path records and verifies evidence", async () => {
  const source = await read("../supabase/functions/visaflow-agent-orchestrator/index.ts");
  for (const tool of ["send_agency_followup", "create_followup_task", "escalate_to_manager", "create_manager_approval_request"]) {
    assert.match(source, new RegExp(`name === "${tool}"`));
  }
  assert.match(source, /email_logs/);
  assert.match(source, /verification: \{ verified:/);
  assert.match(source, /ai_agent_audit_logs/);
  assert.match(source, /ai_agent_case_events/);
});

test("Worker and Commander connect to the Orchestrator without exposing service credentials", async () => {
  const [worker, commander] = await Promise.all([
    read("../supabase/functions/aiagentworker/index.ts"),
    read("../supabase/functions/visaflow-ai-commander/index.ts"),
  ]);
  assert.match(worker, /orchestrator_request_review/);
  assert.match(worker, /x-visaflow-worker-secret/);
  assert.match(commander, /action\?: "chat" \| "commander" \| "offer" \| "agent_goal"/);
  assert.match(commander, /Authorization: authorization/);
  assert.doesNotMatch(commander, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("Dispatcher resolves Agent recipients from tenant-owned records", async () => {
  const source = await read("../supabase/functions/visaflow-email-dispatcher/index.ts");
  assert.match(source, /AI_AGENT_REQUEST_FOLLOWUP/);
  assert.match(source, /notification_events\.agency_id -> active agencies\.email/);
  assert.match(source, /\.eq\("company_id", companyId\)\.eq\("type", "AI_AGENT_REQUEST_FOLLOWUP"\)/);
  assert.match(source, /assertAgencyAccess\(admin, companyId/);
  assert.match(source, /caller\.kind !== "internal"/);
});
