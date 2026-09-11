function same(left, right) {
  return String(left ?? "") === String(right ?? "");
}

export function isValidInternalHandoff({ callerKind, handoff, expected }) {
  return callerKind === "internal" && Boolean(handoff) &&
    same(handoff.emailLogId, expected.emailLogId) &&
    same(handoff.idempotencyKey, expected.idempotencyKey) &&
    same(handoff.companyId, expected.companyId) &&
    same(handoff.agencyId, expected.agencyId) &&
    String(handoff.recipient || "").trim().toLowerCase() === String(expected.recipient || "").trim().toLowerCase();
}

export async function acquireEmailDispatch({
  prior,
  callerKind,
  handoff,
  expected,
  preclaimedId,
  canRetry,
  claimQueued,
  claimFailed,
  insertQueued,
  reloadAfterConflict,
}) {
  if (prior?.status === "Sent") return { action: "sent", id: String(prior.id) };
  if (prior?.status === "Queued") {
    if (preclaimedId && same(preclaimedId, prior.id)) return { action: "send", id: String(prior.id) };
    if (!isValidInternalHandoff({ callerKind, handoff, expected })) return { action: "in_progress", id: String(prior.id) };
    const claimed = await claimQueued(prior);
    return claimed?.id ? { action: "send", id: String(claimed.id) } : { action: "in_progress", id: String(prior.id) };
  }
  if (prior?.status === "Failed") {
    if (!canRetry(prior)) return { action: "cooldown", id: String(prior.id) };
    const claimed = await claimFailed(prior);
    return claimed?.id ? { action: "send", id: String(claimed.id) } : { action: "in_progress", id: String(prior.id) };
  }
  if (prior?.id) return { action: "in_progress", id: String(prior.id) };
  if (handoff) return { action: "invalid_handoff" };
  try {
    const inserted = await insertQueued();
    if (!inserted?.id) throw new Error("EMAIL_LOG_INSERT_FAILED");
    return { action: "send", id: String(inserted.id) };
  } catch (error) {
    if (String(error?.code || "") !== "23505") throw error;
    const raced = await reloadAfterConflict();
    return raced?.id ? { action: "in_progress", id: String(raced.id), raced: true } : { action: "in_progress", raced: true };
  }
}
