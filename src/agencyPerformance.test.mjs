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

const matchesCandidate = (interview, candidate) =>
  interview.candidate_id === candidate.id;

test("No Interview work makes Quality not applicable instead of 70 percent", () => {
  const quality = calculateInterviewQuality({
    candidates: [{ id: "no-interview" }],
    interviews: [],
    requiresInterview: () => false,
    interviewMatchesCandidate: matchesCandidate,
  });

  assert.equal(quality.applicable, false);
  assert.equal(quality.score, null);
  assert.equal(formatOptionalPercentage(quality.score), "N/A");
});

test("mixed work calculates Quality only from interview-required candidates", () => {
  const candidates = [
    { id: "required", interviewRequired: true },
    { id: "not-required", interviewRequired: false },
  ];
  const quality = calculateInterviewQuality({
    candidates,
    interviews: [
      { candidate_id: "required", status: "Passed" },
      { candidate_id: "not-required", status: "Rejected" },
    ],
    requiresInterview: (candidate) => candidate.interviewRequired,
    interviewMatchesCandidate: matchesCandidate,
  });

  assert.equal(quality.applicable, true);
  assert.equal(quality.applicableInterviews.length, 1);
  assert.equal(quality.passedInterviews, 1);
  assert.equal(quality.rejectedInterviews, 0);
  assert.equal(quality.score, 100);
});

test("non-applicable Quality is removed from the score denominator", () => {
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

test("blank and invalid optional values stay N/A", () => {
  assert.equal(formatOptionalPercentage(null), "N/A");
  assert.equal(formatOptionalPercentage(""), "N/A");
  assert.equal(formatOptionalPercentage(Number.NaN), "N/A");
  assert.equal(formatOptionalPercentage(0), "0%");
});

test("Office Portal cannot assert Joined and the live score uses the safe helpers", async () => {
  const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const officeStatuses = appSource.slice(
    appSource.indexOf("const OFFICE_STATUSES"),
    appSource.indexOf("const INTERVIEW_STATUSES")
  );
  const performanceSource = appSource.slice(
    appSource.indexOf("function calculateAgencyPerformanceRows"),
    appSource.indexOf("async function saveAgencyPerformanceSnapshot")
  );

  assert.doesNotMatch(officeStatuses, /"Joined"/);
  assert.match(performanceSource, /calculateInterviewQuality/);
  assert.match(performanceSource, /calculateAgencyMobilizationScore/);
  assert.match(performanceSource, /calculateApplicableWeightedScore/);
});
