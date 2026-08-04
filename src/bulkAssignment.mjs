const norm = (value) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function candidateMatchesRequestLine(candidate, line) {
  const reasons = [];
  if (candidate?.deleted_at) reasons.push("Candidate is deleted");
  if (candidate?.request_line_id || String(candidate?.request_no || "").trim()) reasons.push("Already assigned to an active request");
  if (norm(candidate?.profession) !== norm(line?.profession)) reasons.push("Profession mismatch");
  if (norm(candidate?.nationality) !== norm(line?.nationality)) reasons.push("Nationality mismatch");
  if (norm(candidate?.gender) !== norm(line?.gender)) reasons.push("Gender mismatch");
  return { matches: reasons.length === 0, reasons };
}

export function buildBulkAssignmentPreview(candidates = [], line = {}, linkedCount = 0) {
  const accepted = [];
  const rejected = [];
  for (const candidate of candidates) {
    const validation = candidateMatchesRequestLine(candidate, line);
    (validation.matches ? accepted : rejected).push(validation.matches ? candidate : { candidate, reasons: validation.reasons });
  }
  const required = Number(line.quantity || 0);
  const remaining = Math.max(required - Number(linkedCount || 0), 0);
  return { selectedCount: candidates.length, required, linked: Number(linkedCount || 0), remaining,
    profession: line.profession || "-", nationality: line.nationality || "-", gender: line.gender || "-",
    matchingCount: accepted.length, rejectedCount: rejected.length, accepted, rejected,
    capacityValid: accepted.length <= remaining };
}

export function getBatchCandidateIds(candidates = [], uploadBatchId) {
  return candidates.filter((candidate) => !candidate.deleted_at && String(candidate.upload_batch_id || "") === String(uploadBatchId || "")).map((candidate) => String(candidate.id));
}

export function getMatchingCandidateIds(candidates = [], line = {}) {
  return candidates.filter((candidate) => candidateMatchesRequestLine(candidate, line).matches).map((candidate) => String(candidate.id));
}
