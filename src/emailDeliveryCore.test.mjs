import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildEmailIdempotencyKey, canRetryEmailDelivery, deliverWithTransport, sanitizeProviderError } from "../supabase/functions/_shared/emailDeliveryCore.mjs";
import { ensureQueuedEmailAttempt, markEmailAttemptFailed } from "../supabase/functions/_shared/emailAttemptCore.mjs";
import { cleanContractInputVariables, validateSupabaseInvitationUrl } from "../supabase/functions/_shared/emailVariableValidation.mjs";
import { acquireEmailDispatch, isValidInternalHandoff } from "../supabase/functions/_shared/emailDispatchState.mjs";
import { renderAgencyInvitationEmail } from "../supabase/functions/_shared/agencyInvitationEmail.mjs";
import { renderPlatformCompanyInvitationEmail } from "../supabase/functions/_shared/platformCompanyInvitationEmail.mjs";

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
  assert.equal(safe.code, "SMTP_AUTH_FAILED");
  assert.doesNotMatch(safe.message, /hunter2|abc/);
  assert.equal(safe.message, "SMTP authentication failed.");
});

test("invitation contract accepts only the staging Supabase Auth verification URL", () => {
  const supabaseUrl = "https://staging-ref.supabase.co";
  const valid = validateSupabaseInvitationUrl(
    "https://staging-ref.supabase.co/auth/v1/verify?token=secret-token&type=invite",
    supabaseUrl,
  );
  assert.equal(valid.ok, true);
  for (const value of [
    "https://attacker.example/auth/v1/verify?token=x",
    "http://staging-ref.supabase.co/auth/v1/verify?token=x",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///auth/v1/verify",
    "https://user:password@staging-ref.supabase.co/auth/v1/verify",
    "https://staging-ref.supabase.co/not-auth/verify",
  ]) assert.deepEqual(validateSupabaseInvitationUrl(value, supabaseUrl), { ok: false, error: "INVALID_ACTION_URL" });
});

test("all non-invitation template variables continue to reject URLs", () => {
  const result = cleanContractInputVariables({
    messageType: "OTHER_MESSAGE",
    value: { action_url: "https://staging-ref.supabase.co/auth/v1/verify?token=x" },
    allowedKeys: ["action_url"],
    supabaseUrl: "https://staging-ref.supabase.co",
  });
  assert.deepEqual(result, { ok: false, error: "EXTERNAL_URL_NOT_ALLOWED" });
});

test("validated invitation reaches the mocked transport without exposing its token", async () => {
  const validation = cleanContractInputVariables({
    messageType: "AGENCY_USER_INVITATION",
    value: { action_url: "https://staging-ref.supabase.co/auth/v1/verify?token=private-token&type=invite" },
    allowedKeys: ["action_url"],
    supabaseUrl: "https://staging-ref.supabase.co",
  });
  assert.equal(validation.ok, true);
  let transportReached = false;
  const transport = { sendMail(_message, callback) { transportReached = true; callback(null, { messageId: "mock-provider-id" }); } };
  await deliverWithTransport(transport, { subject: "Invitation" });
  assert.equal(transportReached, true);
  const safe = sanitizeProviderError({ code: "EAUTH", message: validation.variables.action_url });
  assert.doesNotMatch(JSON.stringify(safe), /private-token|auth\/v1\/verify/);
});

test("agency invitation email uses a bilingual CTA and never displays the raw token", () => {
  const actionUrl = "https://staging-ref.supabase.co/auth/v1/verify?token=raw-secret-token&type=invite";
  const rendered = renderAgencyInvitationEmail({ agencyName: "Agency One", actionUrl, expiresHours: 24 });
  assert.match(rendered.html, /<a href="[^"]+"[^>]*>Accept Invitation \/ قبول الدعوة<\/a>/);
  assert.match(rendered.html, /24 hours/);
  assert.match(rendered.html, /24 ساعة/);
  assert.doesNotMatch(rendered.text, /raw-secret-token|auth\/v1\/verify/);
  const visibleHtml = rendered.html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(visibleHtml, /raw-secret-token|auth\/v1\/verify/);
});

test("company onboarding is one bilingual email with details and a secure activation CTA", () => {
  const actionUrl = "https://production-ref.supabase.co/auth/v1/verify?token=company-secret&type=recovery";
  const rendered = renderPlatformCompanyInvitationEmail({
    companyName: "Example Company",
    adminEmail: "admin@example.com",
    actionUrl,
    loginUrl: "https://visaflowksa.com/",
  });
  assert.match(rendered.subject, /Activate Your VisaFlow Company Account/);
  assert.match(rendered.html, /Example Company/);
  assert.match(rendered.html, /admin@example\.com/);
  assert.match(rendered.html, /Activate Account &amp; Create Password/);
  assert.match(rendered.html, /تفعيل الحساب وإنشاء كلمة المرور/);
  assert.doesNotMatch(rendered.text, /company-secret|auth\/v1\/verify/);
  const visibleHtml = rendered.html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(visibleHtml, /company-secret|auth\/v1\/verify/);
});

test("company invitation dispatcher generates the recovery link on the server", async () => {
  const dispatcher = await readFile(new URL("../supabase/functions/visaflow-email-dispatcher/index.ts", import.meta.url), "utf8");
  assert.match(dispatcher, /PLATFORM_CLIENT_LOGIN_DETAILS_EMAIL[\s\S]*renderPlatformCompanyInvitationEmail/);
  assert.match(dispatcher, /type:\s*"recovery"/);
  assert.match(dispatcher, /login:\s*"1",\s*auth_flow:\s*"workspace",\s*recovery:\s*"1"/);
  assert.match(dispatcher, /actionUrl\.pathname !== "\/auth\/v1\/verify"/);
  assert.doesNotMatch(dispatcher, /password[^\n]*variables/i);
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

test("failed invitation attempt persists a Failed email log before dispatcher handoff", async () => {
  const rows = [];
  const attempt = await ensureQueuedEmailAttempt({
    queued: { company_id: "company-a", status: "Queued" },
    lookup: async () => null,
    insert: async (values) => { const row = { id: "log-a", ...values }; rows.push(row); return row; },
    requeue: async () => { throw new Error("unexpected requeue"); },
  });
  await markEmailAttemptFailed({
    emailLogId: attempt.id,
    code: "DISPATCHER_AUTH_FAILED",
    update: async (id, values) => Object.assign(rows.find((row) => row.id === id), values),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Failed");
  assert.equal(rows[0].error_code, "DISPATCHER_AUTH_FAILED");
  assert.ok(rows[0].failed_at);
});

test("email log insert errors are propagated and cannot be replaced by a successful handoff", async () => {
  await assert.rejects(() => ensureQueuedEmailAttempt({
    queued: { company_id: "company-a", status: "Queued" },
    lookup: async () => null,
    insert: async () => { throw new Error("email_logs insert rejected"); },
    requeue: async () => null,
  }), /email_logs insert rejected/);
});

test("retry reuses the idempotent email log and increments retry_count", async () => {
  const existing = { id: "log-a", status: "Failed", retry_count: 1 };
  let inserted = false;
  const attempt = await ensureQueuedEmailAttempt({
    queued: { company_id: "company-a", idempotency_key: "stable-key" },
    lookup: async () => existing,
    insert: async () => { inserted = true; return null; },
    requeue: async (id, values) => ({ id, ...values }),
  });
  assert.equal(inserted, false);
  assert.equal(attempt.id, "log-a");
  assert.equal(attempt.retryCount, 2);
});

const handoff = { emailLogId: "log-a", idempotencyKey: "key-a", companyId: "company-a", agencyId: "agency-a", recipient: "agency@example.test" };
const dispatchExpected = { ...handoff };
const never = async () => { throw new Error("unexpected operation"); };

test("existing Queued with a valid internal handoff claims once and reaches mocked SMTP", async () => {
  let claimed = false;
  let inserts = 0;
  const result = await acquireEmailDispatch({
    prior: { id: "log-a", status: "Queued" }, callerKind: "internal", handoff, expected: dispatchExpected,
    canRetry: () => false,
    claimQueued: async () => claimed ? null : (claimed = true, { id: "log-a" }),
    claimFailed: never, insertQueued: async () => { inserts += 1; }, reloadAfterConflict: never,
  });
  assert.deepEqual(result, { action: "send", id: "log-a" });
  assert.equal(inserts, 0);
  let smtpReached = false;
  if (result.action === "send") await deliverWithTransport({ sendMail(_mail, callback) { smtpReached = true; callback(null, { messageId: "mock" }); } }, {});
  assert.equal(smtpReached, true);
  const duplicate = await acquireEmailDispatch({
    prior: { id: "log-a", status: "Queued" }, callerKind: "internal", handoff, expected: dispatchExpected,
    canRetry: () => false, claimQueued: async () => null, claimFailed: never, insertQueued: never, reloadAfterConflict: never,
  });
  assert.equal(duplicate.action, "in_progress");
});

test("Queued duplicate or mismatched handoff never sends or inserts", async () => {
  for (const candidate of [null, { ...handoff, companyId: "company-b" }, { ...handoff, recipient: "other@example.test" }]) {
    const result = await acquireEmailDispatch({
      prior: { id: "log-a", status: "Queued" }, callerKind: candidate ? "internal" : "authenticated",
      handoff: candidate, expected: dispatchExpected, canRetry: () => false,
      claimQueued: never, claimFailed: never, insertQueued: never, reloadAfterConflict: never,
    });
    assert.equal(result.action, "in_progress");
  }
  assert.equal(isValidInternalHandoff({ callerKind: "internal", handoff, expected: dispatchExpected }), true);
});

test("Sent is idempotent and Failed uses one atomic retry claim", async () => {
  const sent = await acquireEmailDispatch({ prior: { id: "log-a", status: "Sent" }, callerKind: "authenticated", handoff: null,
    expected: dispatchExpected, canRetry: () => false, claimQueued: never, claimFailed: never, insertQueued: never, reloadAfterConflict: never });
  assert.equal(sent.action, "sent");
  let claims = 0;
  const failed = await acquireEmailDispatch({ prior: { id: "log-a", status: "Failed", retry_count: 2 }, callerKind: "authenticated", handoff: null,
    expected: dispatchExpected, canRetry: () => true, claimQueued: never,
    claimFailed: async () => (++claims === 1 ? { id: "log-a" } : null), insertQueued: never, reloadAfterConflict: never });
  assert.equal(failed.action, "send");
  const raced = await acquireEmailDispatch({ prior: { id: "log-a", status: "Failed", retry_count: 2 }, callerKind: "authenticated", handoff: null,
    expected: dispatchExpected, canRetry: () => true, claimQueued: never,
    claimFailed: async () => (++claims === 1 ? { id: "log-a" } : null), insertQueued: never, reloadAfterConflict: never });
  assert.equal(raced.action, "in_progress");
  assert.equal(claims, 2);
});

test("no prior inserts once and a 23505 race reloads as in_progress", async () => {
  let inserts = 0;
  const created = await acquireEmailDispatch({ prior: null, callerKind: "authenticated", handoff: null, expected: dispatchExpected,
    canRetry: () => false, claimQueued: never, claimFailed: never,
    insertQueued: async () => (++inserts, { id: "log-new" }), reloadAfterConflict: never });
  assert.deepEqual(created, { action: "send", id: "log-new" });
  assert.equal(inserts, 1);
  const race = await acquireEmailDispatch({ prior: null, callerKind: "authenticated", handoff: null, expected: dispatchExpected,
    canRetry: () => false, claimQueued: never, claimFailed: never,
    insertQueued: async () => { const error = new Error("duplicate"); error.code = "23505"; throw error; },
    reloadAfterConflict: async () => ({ id: "log-winner", status: "Queued" }) });
  assert.deepEqual(race, { action: "in_progress", id: "log-winner", raced: true });
});

test("SMTP secrets are read only after a dispatch claim succeeds", async () => {
  let secretsRead = 0;
  const result = await acquireEmailDispatch({ prior: { id: "log-a", status: "Queued" }, callerKind: "authenticated", handoff: null,
    expected: dispatchExpected, canRetry: () => false, claimQueued: never, claimFailed: never, insertQueued: never, reloadAfterConflict: never });
  if (result.action === "send") secretsRead += 1;
  assert.equal(result.action, "in_progress");
  assert.equal(secretsRead, 0);
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
  assert.match(provisioner, /markEmailAttemptFailed/);
  assert.match(provisioner, /buildEmailIdempotencyKey/);
  assert.doesNotMatch(provisioner, /error_message:\s*String\(result/);
  assert.match(provisioner, /SAFE_DISPATCHER_ERROR_CODES/);
  assert.match(provisioner, /agency_invitation_begin_v4/);
  assert.doesNotMatch(dispatcher, /console\.(?:log|error)\([^\n]*action_url/);
  assert.match(migration, /revoke insert, update, delete on table public\.email_logs from anon, authenticated/);
  assert.match(securityMigration, /revoke insert, update, delete, truncate, references, trigger/);
  assert.match(migration, /create or replace function public\.email_log_list_v1/);
  for (const field of ["recipient", "error_code", "retry_count", "sent_at", "failed_at", "idempotency_key"]) assert.match(migration, new RegExp(field));
});
