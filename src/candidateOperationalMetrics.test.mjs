import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidateCountSnapshot,
  calculateBoundedProgress,
  getOperationalCandidates,
} from "./candidateOperationalMetrics.mjs";

const companyA = "company-a";
const companyB = "company-b";

function candidates(count, { companyId = companyA, deleted = false, offset = 0 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${companyId}-${offset + index}`,
    company_id: companyId,
    candidate_name: `Candidate ${offset + index}`,
    status: "Candidate Submitted",
    deleted_at: deleted ? "2026-08-02T00:00:00.000Z" : null,
  }));
}

test("198 active plus 198 deleted produces one shared count of 198", () => {
  const rows = [...candidates(198), ...candidates(198, { deleted: true, offset: 198 })];
  const snapshot = buildCandidateCountSnapshot({ candidates: rows, companyId: companyA, required: 199 });

  assert.equal(snapshot.operationalCandidates.length, 198);
  assert.equal(snapshot.activeCount, 198);
  assert.equal(snapshot.candidatesWithoutInterviews.length, 198);
  assert.equal(snapshot.recruitmentProgress, 99);
});

test("progress is capped at 100 percent", () => {
  assert.equal(calculateBoundedProgress(396, 199), 100);
  assert.equal(calculateBoundedProgress(198, 199), 99);
});

test("deleted candidates never enter critical interview alerts", () => {
  const rows = [
    ...candidates(1),
    ...candidates(1, { deleted: true, offset: 1 }),
  ];
  const snapshot = buildCandidateCountSnapshot({ candidates: rows, companyId: companyA });
  assert.deepEqual(snapshot.candidatesWithoutInterviews.map((row) => row.id), ["company-a-0"]);
});

test("restoring a candidate returns it automatically to operational counts", () => {
  const row = candidates(1, { deleted: true })[0];
  assert.equal(getOperationalCandidates([row], companyA).length, 0);
  assert.equal(getOperationalCandidates([{ ...row, deleted_at: null }], companyA).length, 1);
});

test("workspace isolation keeps another company out of screen and export summaries", () => {
  const rows = [...candidates(2), ...candidates(3, { companyId: companyB })];
  const screen = buildCandidateCountSnapshot({ candidates: rows, companyId: companyA, required: 2 });
  const exported = buildCandidateCountSnapshot({ candidates: rows, companyId: companyA, required: 2 });

  assert.equal(screen.activeCount, 2);
  assert.equal(exported.activeCount, screen.activeCount);
  assert.ok(screen.operationalCandidates.every((row) => row.company_id === companyA));
});
