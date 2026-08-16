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
