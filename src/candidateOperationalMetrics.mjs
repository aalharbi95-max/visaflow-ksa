export const OPERATIONALLY_EXCLUDED_CANDIDATE_STATUSES = Object.freeze([
  "Rejected",
  "Interview Failed",
  "Cancelled",
  "Medical Failed",
  "Medical Fail",
]);

export function isCandidateNotDeleted(candidate) {
  return candidate?.deleted_at === null || candidate?.deleted_at === undefined || candidate?.deleted_at === "";
}

export function getOperationalCandidates(candidates = [], companyId = null) {
  const workspaceId = String(companyId || "").trim();
  return (candidates || []).filter((candidate) => {
    if (!isCandidateNotDeleted(candidate)) return false;
    if (!workspaceId) return true;
    return String(candidate?.company_id || "").trim() === workspaceId;
  });
}

export function getActiveOperationalCandidates(candidates = [], companyId = null) {
  return getOperationalCandidates(candidates, companyId).filter(
    (candidate) => !OPERATIONALLY_EXCLUDED_CANDIDATE_STATUSES.includes(candidate?.status)
  );
}

export function calculateBoundedProgress(value, required) {
  const denominator = Number(required || 0);
  if (denominator <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((Number(value || 0) / denominator) * 100)));
}

export function buildCandidateCountSnapshot({
  candidates = [],
  companyId = null,
  required = 0,
  interviews = [],
} = {}) {
  const operational = getOperationalCandidates(candidates, companyId);
  const active = getActiveOperationalCandidates(operational);
  const hasInterview = (candidate) => interviews.some(
    (interview) =>
      String(interview?.company_id || companyId || "") === String(candidate?.company_id || companyId || "") &&
      (
        String(interview?.candidate_id || "") === String(candidate?.id || "") ||
        (candidate?.passport_no && String(interview?.passport_no || "") === String(candidate.passport_no)) ||
        (candidate?.candidate_name && String(interview?.candidate_name || "") === String(candidate.candidate_name))
      )
  );

  return {
    operationalCandidates: operational,
    activeCandidates: active,
    activeCount: active.length,
    recruitmentProgress: calculateBoundedProgress(active.length, required),
    candidatesWithoutInterviews: operational.filter((candidate) => !hasInterview(candidate)),
  };
}
