import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildEmailIdempotencyKey, canRetryEmailDelivery, deliverWithTransport, sanitizeProviderError } from "../supabase/functions/_shared/emailDeliveryCore.mjs";

test("transport test double receives the final provider payload", async () => {
  let received;
  const transport = { sendMail(message, callback) { received = message; callback(null, { messageId: "provider-123", accepted: message.to }); } };
  const payload = { from: "VisaFlow <noreply@example.test>", to: ["agency@example.test"], replyTo: "support@example.test", subject: "Invitation", text: "Safe body", html: "<p>Safe body</p>" };
  const result = await deliverWithTransport(transport, payload);
  assert.deepEqual(received, payload);
  assert.equal(result.providerMessageId, "provider-123");
  assert.equal(result.accepted, 1);
});

test("provider errors are safe to store and never retain secrets", () => {
  const safe = sanitizeProviderError({ code: "EAUTH", message: "password=hunter2 token=abc connection rejected" });
  assert.equal(safe.code, "EAUTH");
  assert.doesNotMatch(safe.message, /hunter2|abc/);
  assert.equal(safe.message, "Email delivery failed at the provider.");
});

test("email idempotency ignores recipient order", () => {
  assert.equal(
    buildEmailIdempotencyKey("AGENCY_AGREEMENT_SENT", "agreement-1", ["b@example.test", "a@example.test"]),
    buildEmailIdempotencyKey("AGENCY_AGREEMENT_SENT", "agreement-1", ["a@example.test", "b@example.test"])
  );
});

test("dispatcher retry claim respects failed delivery cooldown", () => {
  const now = Date.parse("2026-08-02T12:00:00Z");
  assert.equal(canRetryEmailDelivery("Failed", "2026-08-02T11:58:00Z", now), true);
  assert.equal(canRetryEmailDelivery("Failed", "2026-08-02T11:59:30Z", now), false);
  assert.equal(canRetryEmailDelivery("Sent", "2026-08-02T11:00:00Z", now), false);
});

test("dispatcher owns recipient-aware logs and agreement lookup uses agency_id", async () => {
  const [dispatcher, provisioner, app, migration, securityMigration] = await Promise.all([
    readFile(new URL("../supabase/functions/visaflow-email-dispatcher/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/visaflow-agency-provisioner/index.ts", import.meta.url), "utf8"),
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260801000200_remaining_notes_agency_security.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260802000200_email_dispatcher_early_failure_security.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /Resolved securely by Email Dispatcher/);
  assert.match(dispatcher, /agency_id, agency_name/);
  assert.match(dispatcher, /if \(!agreement\.agency_id &&/);
  assert.match(dispatcher, /from\("company_agency_access"\)/);
  assert.match(dispatcher, /email_delivery_status: "Failed"/);
  assert.match(dispatcher, /email_retry_cooldown/);
  assert.match(dispatcher, /VISAFLOW_EMAIL_DISPATCHER_SECRET/);
  assert.match(dispatcher, /provider_message_id/);
  assert.match(dispatcher, /status: "Queued"/);
  assert.match(dispatcher, /status: "Sent"/);
  assert.match(dispatcher, /status: "Failed"/);
  assert.match(dispatcher, /prior\?\.status === "Queued"[\s\S]*in_progress: true/);
  assert.match(dispatcher, /\.eq\("status", "Failed"\)\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(dispatcher, /prepareAgreementAttempt/);
  assert.match(dispatcher, /emailLogId = preparedAgreement\.id/);
  assert.match(provisioner, /DISPATCHER_SECRET_MISSING/);
  assert.match(provisioner, /DISPATCHER_AUTH_FAILED/);
  assert.match(provisioner, /status: "Failed"/);
  assert.match(provisioner, /buildEmailIdempotencyKey/);
  assert.doesNotMatch(provisioner, /error_message:\s*String\(result/);
  assert.match(migration, /revoke insert, update, delete on table public\.email_logs from anon, authenticated/);
  assert.match(securityMigration, /revoke insert, update, delete, truncate, references, trigger/);
  assert.match(migration, /create or replace function public\.email_log_list_v1/);
  for (const field of ["recipient", "error_code", "retry_count", "sent_at", "failed_at", "idempotency_key"]) assert.match(migration, new RegExp(field));
});
