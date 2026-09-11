export async function ensureQueuedEmailAttempt({ lookup, insert, requeue, queued }) {
  const existing = await lookup();
  if (!existing) {
    const inserted = await insert({ ...queued, retry_count: 0 });
    if (!inserted?.id) throw new Error("EMAIL_LOG_INSERT_FAILED");
    return { id: String(inserted.id), retryCount: 0 };
  }
  if (existing.status === "Failed") {
    const retryCount = Number(existing.retry_count || 0) + 1;
    const updated = await requeue(String(existing.id), {
      ...queued,
      status: "Queued",
      retry_count: retryCount,
      error_code: null,
      error_message: null,
      failed_at: null,
      dispatch_claimed_at: null,
    });
    if (!updated?.id) throw new Error("EMAIL_LOG_REQUEUE_FAILED");
    return { id: String(updated.id), retryCount };
  }
  return { id: String(existing.id), retryCount: Number(existing.retry_count || 0) };
}

export async function markEmailAttemptFailed({ update, emailLogId, code }) {
  if (!emailLogId) throw new Error("EMAIL_LOG_ID_MISSING");
  const updated = await update(emailLogId, {
    status: "Failed",
    error_code: code,
    error_message: "Email delivery authorization failed.",
    failed_at: new Date().toISOString(),
  });
  if (!updated?.id) throw new Error("EMAIL_LOG_FAILURE_UPDATE_FAILED");
  return updated;
}
