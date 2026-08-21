import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260817001300_full_sensitive_table_rls.sql", import.meta.url), "utf8");
const advisorMigration = await readFile(new URL("../supabase/migrations/20260817001400_security_advisor_high_risk_remediation.sql", import.meta.url), "utf8");
const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const client = await readFile(new URL("./supabase.js", import.meta.url), "utf8");

test("Security Advisor target tables are RLS enabled and anon grants are reset", () => {
  for (const table of ["agency_members","agency_penalties","agency_scores","ai_agent_worker_runs","ai_interview_answers","ai_interview_sessions","candidate_technical_profiles","company_email_settings","invoices","marketplace_deal_workers","platform_clients","subscription_invoices"]) assert.match(migration, new RegExp(`['"]${table}['"]`));
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.%I from anon, authenticated/i);
  assert.match(migration, /grant all on table public\.%I to service_role/i);
});

test("anonymous interview access is bound to the exact URL token header", () => {
  assert.match(migration, /x-ai-interview-token/);
  assert.match(migration, /access_token=public\.current_ai_interview_access_token\(\)/);
  assert.match(client, /'x-ai-interview-token': token/);
  assert.match(app, /createAIInterviewPortalClient\(accessToken\)/);
});

test("high-impact Advisor findings cannot run with anonymous or view-owner authority", () => {
  assert.match(advisorMigration, /alter view public\.ai_agent_hourly_activity set \(security_invoker = true\)/i);
  assert.match(advisorMigration, /revoke all on public\.ai_agent_hourly_activity from public, anon, authenticated/i);
  for (const name of [
    "ai_agent_emergency_stop",
    "claim_ai_interview_invitation_jobs",
    "complete_ai_interview_invitation_job",
    "fail_ai_interview_invitation_job",
    "launch_ai_interview_campaign",
    "add_candidates_to_ai_interview_campaign",
    "remove_candidates_from_ai_interview_campaign",
  ]) {
    assert.match(advisorMigration, new RegExp(`revoke all on function public\\.${name}\\(`, "i"));
  }
  assert.match(advisorMigration, /ai_agent_emergency_stop\(uuid\) to service_role/i);
  assert.doesNotMatch(advisorMigration, /ai_agent_emergency_stop\(uuid\) to authenticated/i);
});
