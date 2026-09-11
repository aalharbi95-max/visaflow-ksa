const OPEN_REQUEST_STATUSES = new Set(["Open", "Under Recruitment", "Interview Stage", "Visa Process"]);
const BLOCKED_CANDIDATE_STATUSES = new Set(["Rejected", "Interview Failed", "Medical Failed", "Cancelled", "Joined"]);

function hasRequirement(value, normalizeValue) {
  const normalized = normalizeValue(value);
  return Boolean(normalized) && !["all", "any", "both", "open"].includes(normalized);
}

export function getOpenRequestDemand(request, candidates = []) {
  const required = Number(request?.quantity || request?.qty || 0);
  const activeCandidates = candidates.filter((candidate) =>
    String(candidate?.request_no || "") === String(request?.request_no || "") &&
    !BLOCKED_CANDIDATE_STATUSES.has(candidate?.status)
  ).length;
  return {
    required,
    activeCandidates,
    remaining: Math.max(required - activeCandidates, 0),
  };
}

export function buildRedeploymentSuggestions({
  source = {},
  requests = [],
  candidates = [],
  normalizeValue = (value) => String(value || "").trim().toLowerCase(),
  nationalityMatches = (left, right) => normalizeValue(left) === normalizeValue(right),
  now = new Date(),
} = {}) {
  return requests
    .filter((request) => OPEN_REQUEST_STATUSES.has(request?.status || "Open"))
    .map((request) => {
      const demand = getOpenRequestDemand(request, candidates);
      if (demand.remaining <= 0) return null;

      const professionMatch = Boolean(normalizeValue(source.profession)) &&
        normalizeValue(request.profession) === normalizeValue(source.profession);
      if (!professionMatch) return null;

      const nationalityRequired = hasRequirement(request.nationality, normalizeValue);
      const nationalityMatch = !nationalityRequired || (
        Boolean(normalizeValue(source.nationality)) && nationalityMatches(request.nationality, source.nationality)
      );
      if (!nationalityMatch) return null;

      const genderRequired = hasRequirement(request.gender, normalizeValue);
      const genderMatch = !genderRequired || (
        Boolean(normalizeValue(source.gender)) && normalizeValue(request.gender) === normalizeValue(source.gender)
      );
      if (!genderMatch) return null;

      const createdAt = request.created_at ? new Date(request.created_at) : null;
      const daysOpen = createdAt && !Number.isNaN(createdAt.getTime())
        ? Math.max(0, Math.floor((now - createdAt) / 86400000))
        : 0;
      const priority = request.priority || "Normal";
      const highPriority = ["Urgent", "High"].includes(priority);
      const project = request.project_name || request.project || "-";
      const projectDifferent = Boolean(normalizeValue(source.current_project)) &&
        normalizeValue(project) !== normalizeValue(source.current_project);

      let score = 50;
      score += nationalityRequired ? 15 : 10;
      score += genderRequired ? 10 : 5;
      score += highPriority ? 10 : 0;
      score += daysOpen >= 30 ? 10 : daysOpen >= 15 ? 7 : daysOpen >= 7 ? 4 : 0;
      score += Math.min(10, Math.max(3, demand.remaining));
      score += projectDifferent ? 5 : 0;
      score = Math.min(100, score);

      const criteria = [
        { key: "profession", label: "Profession", status: "matched", detail: request.profession || source.profession },
        { key: "nationality", label: "Nationality", status: nationalityRequired ? "matched" : "not-required", detail: nationalityRequired ? request.nationality : "Not restricted" },
        { key: "gender", label: "Gender", status: genderRequired ? "matched" : "not-required", detail: genderRequired ? request.gender : "Not restricted" },
        { key: "demand", label: "Open demand", status: "matched", detail: `${demand.remaining} position(s)` },
      ];

      const reason = criteria.map((criterion) => `${criterion.label}: ${criterion.detail}`).join(" · ");
      const recommendation = score >= 85
        ? "Strong match. Confirm with Operations and reserve this employee before external sourcing."
        : score >= 70
          ? "Good match. Review availability and project approval before confirming redeployment."
          : "Eligible match. Validate operational timing before confirming redeployment.";

      return {
        request_no: request.request_no,
        project,
        profession: request.profession || "-",
        nationality: request.nationality || "Not restricted",
        gender: request.gender || "Not restricted",
        priority,
        required: demand.required,
        active_candidates: demand.activeCandidates,
        remaining: demand.remaining,
        days_open: daysOpen,
        score,
        confidence: score >= 85 ? "Strong" : score >= 70 ? "Good" : "Review",
        recommendation,
        reason,
        criteria,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || right.days_open - left.days_open || String(left.request_no).localeCompare(String(right.request_no)));
}
