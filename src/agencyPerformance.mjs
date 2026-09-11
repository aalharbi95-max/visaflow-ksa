function percent(numerator, denominator) {
  const safeDenominator = Number(denominator || 0);
  if (safeDenominator <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, Math.round((Number(numerator || 0) / safeDenominator) * 100))
  );
}

export function calculateInterviewQuality({
  candidates = [],
  interviews = [],
  requiresInterview,
  interviewMatchesCandidate,
}) {
  const applicableCandidates = candidates.filter(requiresInterview);
  const excludedCandidates = candidates.filter(
    (candidate) => !requiresInterview(candidate)
  );
  const applicableInterviews = interviews.filter((interview) =>
    applicableCandidates.some((candidate) =>
      interviewMatchesCandidate(interview, candidate)
    )
  );
  const passedInterviews = applicableInterviews.filter(
    (interview) => interview.status === "Passed"
  ).length;
  const rejectedInterviews = applicableInterviews.filter((interview) =>
    ["Rejected", "Interview Failed"].includes(interview.status)
  ).length;
  const applicable = applicableCandidates.length > 0;

  return {
    applicable,
    applicableCandidates,
    excludedCandidates,
    passedInterviews,
    rejectedInterviews,
    score: applicable
      ? percent(passedInterviews, applicableInterviews.length)
      : null,
  };
}

export function isVerifiedAgencyArrival(candidate) {
  return Boolean(
    candidate &&
      (candidate.arrival_date ||
        ["Arrived KSA", "Arrived"].includes(String(candidate.status || "")))
  );
}

export function calculateAgencyMobilizationScore(candidates = []) {
  if (!candidates.length) return 0;
  return percent(
    candidates.filter(isVerifiedAgencyArrival).length,
    candidates.length
  );
}

export function calculateApplicableWeightedScore(components = []) {
  const applicable = components.filter(
    (component) =>
      component?.applicable !== false &&
      component?.score !== null &&
      component?.score !== undefined &&
      Number.isFinite(Number(component.score)) &&
      Number(component.weight) > 0
  );
  const weight = applicable.reduce(
    (sum, component) => sum + Number(component.weight),
    0
  );
  if (!weight) return null;
  return Math.round(
    applicable.reduce(
      (sum, component) =>
        sum + Number(component.score) * Number(component.weight),
      0
    ) / weight
  );
}

export function formatOptionalPercentage(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const number = Number(value);
  return Number.isFinite(number) ? `${number}%` : "N/A";
}
