import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const edgeSource = await readFile(
  new URL("../supabase/functions/generate-ai-interview-template/index.ts", import.meta.url),
  "utf8",
);
const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

test("AI interview generator authenticates the actor and derives tenant authority", () => {
  assert.match(edgeSource, /auth\.getUser\(token\)/);
  assert.match(edgeSource, /get_authenticated_workspace_context/);
  assert.match(edgeSource, /ALLOWED_ROLES/);
  assert.match(edgeSource, /cross_tenant_company_denied/);
  assert.match(edgeSource, /targetCompanyId = role === "platform owner" \? requestedCompanyId : actorCompanyId/);
  assert.match(edgeSource, /rateLimit\(authData\.user\.id\)/);
});

test("AI interview generator uses Responses structured output and privacy safeguards", () => {
  assert.match(edgeSource, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(edgeSource, /type: "json_schema"/);
  assert.match(edgeSource, /strict: true/);
  assert.match(edgeSource, /safety_identifier/);
  assert.match(edgeSource, /gpt-5\.6-terra/);
  assert.match(edgeSource, /Never make hiring decisions/);
  assert.match(edgeSource, /protected or sensitive personal traits/);
  assert.doesNotMatch(edgeSource, /v1\/chat\/completions/);
});

test("generated templates remain inactive until mandatory human approval", () => {
  assert.match(edgeSource, /approval_status: "Pending Review"/);
  assert.match(edgeSource, /status: "Draft"/);
  assert.match(edgeSource, /is_active: false/);
  assert.match(edgeSource, /mandatory human review/i);
  assert.match(edgeSource, /ai_interview_generation_runs/);
});

test("browser generation path no longer silently substitutes fixed fallback questions", () => {
  const start = appSource.indexOf("async function generateAIInterviewTemplateFromJobDescription");
  const end = appSource.indexOf("async function generateAllRemainingReadyMadeTemplates", start);
  assert.ok(start >= 0 && end > start);
  const generationPath = appSource.slice(start, end);
  assert.doesNotMatch(generationPath, /saveGuardedAIInterviewTemplateFallback/);
  assert.match(generationPath, /Human approval is required before publishing/);
  assert.match(generationPath, /ai_service_not_configured/);
});
