import assert from "node:assert/strict";
import test from "node:test";
import { canMoveHiringStage, doesCandidateMatchHiringJob, getHiringPipelineProgress, getHiringStageOptions, groupHiringPipelineByStage, normalizeHiringRole } from "./hiringPipeline.mjs";

test("hiring pipeline enforces forward stages and terminal states", () => {
  assert.deepEqual(getHiringStageOptions("Applicant"), ["Screening", "Rejected"]);
  assert.equal(canMoveHiringStage("Interview", "Offer"), true);
  assert.equal(canMoveHiringStage("Offer", "Screening"), false);
  assert.equal(canMoveHiringStage("Hired", "Rejected"), false);
});

test("hiring jobs only enable matching candidate roles", () => {
  assert.equal(normalizeHiringRole("Director of Human Resources"), normalizeHiringRole("HR Director"));
  assert.equal(doesCandidateMatchHiringJob({ profession: "HR Director" }, { title: "HR Director" }), true);
  assert.equal(doesCandidateMatchHiringJob({ profession: "Quality Engineer" }, { title: "HR Director" }), false);
  assert.equal(doesCandidateMatchHiringJob({ current_title: "Senior HR Director" }, { title: "HR Director" }), true);
});

test("hiring pipeline groups applications and reports progress", () => {
  const grouped = groupHiringPipelineByStage([{ id: "a", stage: "Applicant" }, { id: "b", stage: "Interview" }]);
  assert.deepEqual(grouped.Applicant.map((item) => item.id), ["a"]);
  assert.equal(getHiringPipelineProgress("Applicant"), 0);
  assert.equal(getHiringPipelineProgress("Hired"), 100);
});
