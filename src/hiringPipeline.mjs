export const HIRING_PIPELINE_STAGES = Object.freeze([
  "Applicant",
  "Screening",
  "Contact Requested",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
]);

const FORWARD_TRANSITIONS = Object.freeze({
  Applicant: ["Screening", "Rejected"],
  Screening: ["Contact Requested", "Rejected"],
  "Contact Requested": ["Interview", "Rejected"],
  Interview: ["Offer", "Rejected"],
  Offer: ["Hired", "Rejected"],
  Hired: [],
  Rejected: [],
});

export function getHiringStageOptions(currentStage) {
  return FORWARD_TRANSITIONS[String(currentStage || "")] || [];
}

export function canMoveHiringStage(fromStage, toStage) {
  return getHiringStageOptions(fromStage).includes(String(toStage || ""));
}

export function groupHiringPipelineByStage(applications = []) {
  return HIRING_PIPELINE_STAGES.reduce((groups, stage) => {
    groups[stage] = applications.filter((item) => item.stage === stage);
    return groups;
  }, {});
}

export function getHiringPipelineProgress(stage) {
  if (stage === "Rejected") return 100;
  const activeStages = HIRING_PIPELINE_STAGES.filter((item) => item !== "Rejected");
  const index = activeStages.indexOf(stage);
  return index < 0 ? 0 : Math.round((index / (activeStages.length - 1)) * 100);
}

const ROLE_PHRASE_ALIASES = Object.freeze([
  [/human resources/g, "hr"],
  [/director of hr/g, "hr director"],
  [/information technology/g, "it"],
  [/business development/g, "bd"],
  [/quality assurance/g, "qa"],
  [/quality control/g, "qc"],
  [/facilities management/g, "fm"],
  [/operations and maintenance/g, "om"],
  [/مدير الموارد البشرية/g, "hr director"],
  [/الموارد البشرية/g, "hr"],
  [/تقنية المعلومات/g, "it"],
]);

export function normalizeHiringRole(value) {
  let normalized = String(value || "").toLowerCase();
  for (const [pattern, replacement] of ROLE_PHRASE_ALIASES) normalized = normalized.replace(pattern, replacement);
  return normalized
    .replace(/\b(senior|sr|junior|jr)\b/g, " ")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !["of", "and", "the"].includes(token))
    .sort()
    .join(" ");
}

export function doesCandidateMatchHiringJob(candidate, job) {
  const target = normalizeHiringRole(job?.title);
  if (!target) return false;
  return [candidate?.profession, candidate?.current_title, candidate?.headline]
    .map(normalizeHiringRole)
    .some((role) => role === target);
}
