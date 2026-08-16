import assert from "node:assert/strict";
import test from "node:test";
import { canAutomaticallyRetryEmail, getNextEmailRetryAt, summarizeCommunicationStatus } from "./communicationReliability.mjs";

test("email retry uses bounded backoff and stops at the retry limit", () => {
  const failedAt = Date.parse("2026-08-16T00:00:00Z");
  assert.equal(getNextEmailRetryAt({ retryCount: 0, failedAt }), "2026-08-16T00:02:00.000Z");
  assert.equal(getNextEmailRetryAt({ retryCount: 2, failedAt }), "2026-08-16T00:30:00.000Z");
  assert.equal(canAutomaticallyRetryEmail({ status: "Failed", retry_count: 1, max_retries: 3, next_retry_at: "2026-08-16T00:05:00Z" }, Date.parse("2026-08-16T00:06:00Z")), true);
  assert.equal(canAutomaticallyRetryEmail({ status: "Failed", retry_count: 3, max_retries: 3 }, failedAt), false);
});

test("communication summary prioritizes candidate response and engagement", () => {
  assert.equal(summarizeCommunicationStatus({ status: "Sent", delivered_at: "2026-08-16T00:01:00Z" }), "Delivered");
  assert.equal(summarizeCommunicationStatus({ status: "Sent", opened_at: "2026-08-16T00:02:00Z" }), "Opened");
  assert.equal(summarizeCommunicationStatus({ status: "Opened", response_status: "Approved" }), "Approved");
});
