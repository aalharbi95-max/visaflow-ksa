import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("./App.jsx", import.meta.url);
const workerUrl = new URL("../supabase/functions/ai-interview-invitation-worker/index.ts", import.meta.url);
const dispatcherUrl = new URL("../supabase/functions/visaflow-email-dispatcher/index.ts", import.meta.url);
const schedulerUrl = new URL("../supabase/migrations/20260805000100_schedule_ai_interview_invitations.sql", import.meta.url);

test("campaign launch triggers the invitation worker without exposing its secret", async () => {
  const [app, scheduler] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(schedulerUrl, "utf8"),
  ]);

  assert.match(app, /trigger_ai_interview_invitation_worker/);
  assert.doesNotMatch(app, /x-visaflow-worker-secret/);
  assert.match(scheduler, /security definer/);
  assert.match(scheduler, /u\.auth_user_id = auth\.uid\(\)/);
  assert.match(scheduler, /c\.company_id = v_company_id/);
  assert.match(scheduler, /vault\.decrypted_secrets/);
  assert.match(scheduler, /revoke all on function public\.trigger_ai_interview_invitation_worker\(uuid\) from public, anon/);
  assert.match(scheduler, /grant execute on function public\.trigger_ai_interview_invitation_worker\(uuid\) to authenticated/);
});

test("invitation worker is secret-gated and uses service-only queue contracts", async () => {
  const worker = await readFile(workerUrl, "utf8");

  assert.match(worker, /AI_INTERVIEW_WORKER_SECRET/);
  assert.match(worker, /x-visaflow-worker-secret/);
  assert.match(worker, /Authorization.*Bearer.*serviceKey/s);
  assert.match(worker, /claim_ai_interview_invitation_jobs/);
  assert.match(worker, /complete_ai_interview_invitation_job/);
  assert.match(worker, /fail_ai_interview_invitation_job/);
  assert.match(worker, /company_id: job\.company_id/);
  assert.doesNotMatch(worker, /console\.(?:log|warn|error)/);
});

test("email dispatcher binds internal invitations to the queued company", async () => {
  const dispatcher = await readFile(dispatcherUrl, "utf8");

  assert.match(dispatcher, /AI_INTERVIEW_INVITATION:[\s\S]*?internalEnabled: true/);
  assert.match(dispatcher, /const companyId = caller\.kind === "authenticated"[\s\S]*?safeId\(body\.company_id, "company_id"\)/);
  assert.match(dispatcher, /\.eq\("id", sessionId\)\.eq\("company_id", companyId\)/);
  assert.match(dispatcher, /\.eq\("id", session\.candidate_id\)\.eq\("company_id", companyId\)/);
});
