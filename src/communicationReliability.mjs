export const EMAIL_RETRY_DELAYS_MINUTES = Object.freeze([2, 10, 30]);

export function getNextEmailRetryAt({ retryCount = 0, failedAt = Date.now() } = {}) {
  const index = Math.max(0, Math.min(EMAIL_RETRY_DELAYS_MINUTES.length - 1, Number(retryCount) || 0));
  const base = failedAt instanceof Date ? failedAt.getTime() : Number(failedAt);
  return new Date((Number.isFinite(base) ? base : Date.now()) + EMAIL_RETRY_DELAYS_MINUTES[index] * 60_000).toISOString();
}

export function canAutomaticallyRetryEmail(message = {}, now = Date.now()) {
  if (String(message.status || message.email_delivery_status || "") !== "Failed") return false;
  const retryCount = Math.max(0, Number(message.retry_count) || 0);
  const maxRetries = Math.max(0, Number(message.max_retries ?? 3) || 0);
  if (retryCount >= maxRetries) return false;
  const nextRetryAt = Date.parse(String(message.next_retry_at || ""));
  return !Number.isFinite(nextRetryAt) || nextRetryAt <= now;
}

export function summarizeCommunicationStatus(message = {}) {
  const status = String(message.status || message.email_delivery_status || "Queued");
  if (message.response_status) return String(message.response_status);
  if (message.opened_at || status === "Opened") return "Opened";
  if (message.delivered_at || status === "Delivered") return "Delivered";
  return status;
}
