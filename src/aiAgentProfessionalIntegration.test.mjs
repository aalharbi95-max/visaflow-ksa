import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("professional worker enforces entitlement and records model usage", async () => {
  const source = await read("../supabase/functions/aiagentworker/index.ts");
  assert.match(source, /AI Agent Professional is not enabled/);
  assert.match(source, /OPENAI_AI_AGENT_MODEL/);
  assert.match(source, /ai_agent_usage_ledger/);
  assert.match(source, /json_schema/);
  assert.match(source, /Never invent dates, commitments, penalties, legal conclusions/);
});

test("public trial provisioner is origin limited, rate limited and emails a recovery setup link", async () => {
  const source = await read("../supabase/functions/visaflow-company-trial-provisioner/index.ts");
  assert.match(source, /ALLOWED_ORIGINS/);
  assert.match(source, /TRIAL_RATE_LIMITED/);
  assert.match(source, /company_fax/);
  assert.match(source, /createUser/);
  assert.match(source, /resetPasswordForEmail/);
  assert.match(source, /auth_flow/);
  assert.match(source, /recovery/);
  assert.doesNotMatch(source, /inviteUserByEmail/);
});

test("trial migration expires access and protects usage records", async () => {
  const source = await read("../supabase/migrations/20260809000300_ai_agent_professional_trials.sql");
  assert.match(source, /ai_agent_trial_end >= current_date/);
  assert.match(source, /alter table public\.ai_agent_usage_ledger enable row level security/i);
  assert.match(source, /AI_AGENT_PROFESSIONAL_NOT_ENABLED/);
});

test("AI Agent recommendations respect line assignment, nationality and rejection history", async () => {
  const source = await read("./App.jsx");
  assert.match(source, /getRequestLinesForRequest\(request\)\.map\(\(line, lineIndex\)/);
  assert.match(source, /requiredQty\s*-\s*assignedQty/);
  assert.match(source, /nationalitiesMatch\(agencyRow\?\.country/);
  assert.match(source, /AGENCY_REQUEST_RESPONSE/);
  assert.match(source, /hasMeasuredHoldRisk\s*\|\|\s*rejectedThisRequest/);
});

test("workspace logout clears candidate form state", async () => {
  const source = await read("./App.jsx");
  const clearStart = source.indexOf("function clearTenantSensitiveState()");
  const clearEnd = source.indexOf("async function loadAll()", clearStart);
  const clearSource = source.slice(clearStart, clearEnd);
  assert.match(clearSource, /setCandidateForm\(emptyCandidate\)/);
  assert.match(clearSource, /setCandidateSaveFeedback\(null\)/);
  assert.match(clearSource, /setOfficeSelectedCandidateIds\(\[\]\)/);
});
