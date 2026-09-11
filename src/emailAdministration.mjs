export const EMAIL_DELIVERY_RETRY_COOLDOWN_MS = 60_000;

export function canRetryAgreementEmail(agreement, now = Date.now()) {
  if (String(agreement?.email_delivery_status || "") !== "Failed") return false;
  const failedAt = Date.parse(String(agreement?.email_failed_at || agreement?.email_last_attempt_at || ""));
  return !Number.isFinite(failedAt) || now - failedAt >= EMAIL_DELIVERY_RETRY_COOLDOWN_MS;
}

export function filterEmailLogs(rows = [], filters = {}) {
  const normalizedRecipient = String(filters.recipient || "").trim().toLowerCase();
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00.000Z`) : null;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999Z`) : null;
  return rows.filter((item) => {
    const created = item.created_at ? new Date(item.created_at) : null;
    const recipient = String(item.recipient || item.to_email || "").toLowerCase();
    return (!filters.eventType || filters.eventType === "All" || (item.event_type || item.type) === filters.eventType)
      && (!filters.status || filters.status === "All" || item.status === filters.status)
      && (!filters.agency || filters.agency === "All" || String(item.agency_id || "") === String(filters.agency))
      && (!normalizedRecipient || recipient.includes(normalizedRecipient))
      && (!from || (created && created >= from))
      && (!to || (created && created <= to));
  });
}
