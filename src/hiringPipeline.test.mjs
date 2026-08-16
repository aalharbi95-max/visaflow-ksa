import assert from "node:assert/strict";
import test from "node:test";
import { canMoveHiringStage, getHiringPipelineProgress, getHiringStageOptions, groupHiringPipelineByStage } from "./hiringPipeline.mjs";

test("hiring pipeline enforces forward stages and terminal states", () => {
  assert.deepEqual(getHiringStageOptions("Applicant"), ["Screening", "Rejected"]);
  assert.equal(canMoveHiringStage("Interview", "Offer"), true);
  assert.equal(canMoveHiringStage("Offer", "Screening"), false);
  assert.equal(canMoveHiringStage("Hired", "Rejected"), false);
});

test("hiring pipeline groups applications and reports progress", () => {
  const grouped = groupHiringPipelineByStage([{ id: "a", stage: "Applicant" }, { id: "b", stage: "Interview" }]);
  assert.deepEqual(grouped.Applicant.map((item) => item.id), ["a"]);
  assert.equal(getHiringPipelineProgress("Applicant"), 0);
  assert.equal(getHiringPipelineProgress("Hired"), 100);
});
