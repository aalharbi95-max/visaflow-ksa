import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateAgencyMobilizationScore,
  calculateApplicableWeightedScore,
  calculateInterviewQuality,
  formatOptionalPercentage,
  isVerifiedAgencyArrival,
} from "./agencyPerformance.mjs";

const matches = (interview, candidate) =>
  interview.candidate_id === candidate.id;

test("No Interview makes Quality N/A instead of 70", () => {
  const result = calculateInterviewQuality({
    candidates: [{ id: "no-interview" }],
    interviews: [],
    requiresInterview: () => false,
    interviewMatchesCandidate: matches,
  });
  assert.equal(result.score, null);
  assert.equal(formatOptionalPercentage(result.score), "N/A");
});

test("mixed work evaluates only interview-required candidates", () => {
  const result = calculateInterviewQuality({
    candidates: [
      { id: "required", required: true },
      { id: "excluded", required: false },
    ],
    interviews: [
      { candidate_id: "required", status: "Passed" },
      { candidate_id: "excluded", status: "Rejected" },
    ],
    requiresInterview: (candidate) => candidate.required,
    interviewMatchesCandidate: matches,
  });
  assert.equal(result.score, 100);
  assert.equal(result.rejectedInterviews, 0);
});

test("non-applicable Quality is removed from the denominator", () => {
  assert.equal(
    calculateApplicableWeightedScore([
      { score: 100, weight: 0.3, applicable: true },
      { score: null, weight: 0.2, applicable: false },
      { score: 50, weight: 0.5, applicable: true },
    ]),
    69
  );
});

test("Mobilization uses verified arrival evidence and never defaults to 70", () => {
  assert.equal(calculateAgencyMobilizationScore([]), 0);
  assert.equal(
    calculateAgencyMobilizationScore([
      { status: "Submitted" },
      { status: "Arrived KSA" },
      { status: "Joined" },
      { status: "Ticket Booked", arrival_date: "2026-07-26" },
    ]),
    50
  );
  assert.equal(isVerifiedAgencyArrival({ status: "Joined" }), false);
});

test("blank and invalid values remain N/A", () => {
  assert.equal(formatOptionalPercentage(null), "N/A");
  assert.equal(formatOptionalPercentage(""), "N/A");
  assert.equal(formatOptionalPercentage(Number.NaN), "N/A");
  assert.equal(formatOptionalPercentage(0), "0%");
});

test("Office Portal cannot assert Joined and App uses the focused helpers", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const statuses = app.slice(
    app.indexOf("const OFFICE_STATUSES"),
    app.indexOf("const INTERVIEW_STATUSES")
  );
  const scoring = app.slice(
    app.indexOf("function calculateAgencyPerformanceRows"),
    app.indexOf("async function saveAgencyPerformanceSnapshot")
  );
  assert.doesNotMatch(statuses, /"Joined"/);
  assert.match(scoring, /calculateInterviewQuality/);
  assert.match(scoring, /calculateAgencyMobilizationScore/);
  assert.match(scoring, /calculateApplicableWeightedScore/);
});
