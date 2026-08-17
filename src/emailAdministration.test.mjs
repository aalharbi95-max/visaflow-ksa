import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canRetryAgreementEmail, filterEmailLogs } from "./emailAdministration.mjs";

test("email log filters cover event, status, agency, recipient and date range", () => {
  const rows = [
    { id: "a", event_type: "AGENCY_AGREEMENT_SENT", status: "Failed", agency_id: "agency-a", recipient: "admin@agency.test", created_at: "2026-08-01T10:00:00Z" },
    { id: "b", event_type: "AGENCY_USER_INVITATION", status: "Sent", agency_id: "agency-b", recipient: "user@other.test", created_at: "2026-08-02T10:00:00Z" },
  ];
  assert.deepEqual(filterEmailLogs(rows, { eventType: "AGENCY_AGREEMENT_SENT", status: "Failed", agency: "agency-a", recipient: "ADMIN@", dateFrom: "2026-08-01", dateTo: "2026-08-01" }).map((row) => row.id), ["a"]);
  assert.deepEqual(filterEmailLogs(rows, { dateFrom: "2026-08-02", dateTo: "2026-08-02" }).map((row) => row.id), ["b"]);
});

test("agreement email retry is available only after failed delivery cooldown", () => {
  const now = Date.parse("2026-08-02T12:00:00Z");
  assert.equal(canRetryAgreementEmail({ email_delivery_status: "Failed", email_failed_at: "2026-08-02T11:58:00Z" }, now), true);
  assert.equal(canRetryAgreementEmail({ email_delivery_status: "Failed", email_failed_at: "2026-08-02T11:59:30Z" }, now), false);
  assert.equal(canRetryAgreementEmail({ email_delivery_status: "Sent", email_failed_at: "2026-08-02T11:00:00Z" }, now), false);
});

test("Email Logs is a sidebar page with required columns and no browser mutations", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(app, /pages: \["Notifications", "Email Logs"/);
  for (const label of ["Event Type", "Recipient", "Agency", "Status", "Provider", "Provider Message ID", "Error Code", "Safe Error Message", "Retry Count", "Created At", "Sent At", "Failed At"]) assert.match(app, new RegExp(label));
  assert.match(app, /currentRole !== "Agency"[\s\S]{0,120}"Email Logs"/);
  assert.doesNotMatch(app, /from\("email_logs"\)[\s\S]{0,160}\.(?:insert|update|upsert|delete)\(/);
});

test("email log consistency migration clears stale failures from sent rows", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260817000900_fix_email_log_status_consistency.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /where lower\(coalesce\(status, ''\)\) = 'sent'/);
  assert.match(migration, /error_message = null/);
  assert.match(migration, /sent_at = coalesce\(sent_at, created_at\)/);
  assert.match(migration, /lower\(coalesce\(log\.status, ''\)\) = 'failed'/);
});
