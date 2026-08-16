import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20260816000100_communication_reliability_hiring_pipeline.sql", import.meta.url);
const pipelineDecisionSyncUrl = new URL("../supabase/migrations/20260816000300_pipeline_contact_decision_sync.sql", import.meta.url);
const contactWorkerUrl = new URL("../supabase/functions/talent-prospect-email-worker/index.ts", import.meta.url);
const retryWorkerUrl = new URL("../supabase/functions/visaflow-email-retry-worker/index.ts", import.meta.url);

test("communication migration records lifecycle events, automatic retries and provider webhooks", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /create table if not exists public\.email_delivery_events/i);
  assert.match(migration, /'Queued'.*'Sending'.*'Sent'.*'Delivered'.*'Opened'.*'Failed'/is);
  assert.match(migration, /claim_email_retry_jobs/i);
  assert.match(migration, /retry_count < coalesce\(log\.max_retries, 3\)/i);
  assert.match(migration, /record_email_provider_event/i);
  assert.match(migration, /email_logs_company_idempotency|idempotency_key/is);
});

test("contact approval worker has open tracking, fallback SMTP and automatic retry handoff", async () => {
  const worker = await readFile(contactWorkerUrl, "utf8");
  assert.match(worker, /record_talent_contact_email_open/);
  assert.match(worker, /SMTP_FALLBACK_USERNAME/);
  assert.match(worker, /complete_talent_company_contact_email_v2/);
  assert.match(worker, /موافق \/ Approve/);
  assert.match(worker, /غير موافق \/ Decline/);
  const retryWorker = await readFile(retryWorkerUrl, "utf8");
  assert.match(retryWorker, /claim_email_retry_jobs/);
  assert.match(retryWorker, /visaflow-email-dispatcher-v2/);
  assert.doesNotMatch(retryWorker, /SMTP_PASSWORD/);
});

test("hiring pipeline is tenant scoped, duplicate safe and transition controlled", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /unique\(company_id, job_id, candidate_source, candidate_id\)/i);
  assert.match(migration, /current_app_user_company_id\(\)/i);
  assert.match(migration, /Invalid hiring stage transition/i);
  assert.match(migration, /when 'Offer' then p_to_stage in \('Hired','Rejected'\)/i);
  assert.match(migration, /revoke all on public\.company_hiring_jobs.*authenticated/is);
});

test("pipeline keeps private candidates and synchronizes contact decisions", async () => {
  const migration = await readFile(pipelineDecisionSyncUrl, "utf8");
  assert.match(migration, /sync_imported_talent_contact_decision_to_pipeline/i);
  assert.match(migration, /new\.status = 'Declined'/i);
  assert.match(migration, /set stage = 'Rejected'/i);
  assert.match(migration, /case when contact\.status = 'Approved' then imported\.email end/i);
  assert.match(migration, /case when contact\.status = 'Approved' then imported\.phone end/i);
});
