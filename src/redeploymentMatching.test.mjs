import assert from "node:assert/strict";
import test from "node:test";
import { buildRedeploymentSuggestions, getOpenRequestDemand } from "./redeploymentMatching.mjs";

const normalizeValue = (value) => String(value || "").trim().toLowerCase();
const baseSource = { profession: "Electrician", nationality: "Indian", gender: "Male", current_project: "Project A" };

test("redeployment matching rejects profession and mandatory demographic mismatches", () => {
  const requests = [
    { request_no: "WRONG-PROFESSION", profession: "Plumber", nationality: "Indian", gender: "Male", qty: 2, status: "Open" },
    { request_no: "WRONG-NATIONALITY", profession: "Electrician", nationality: "Nepalese", gender: "Male", qty: 2, status: "Open" },
    { request_no: "WRONG-GENDER", profession: "Electrician", nationality: "Indian", gender: "Female", qty: 2, status: "Open" },
    { request_no: "ELIGIBLE", profession: "Electrician", nationality: "Indian", gender: "Male", qty: 2, status: "Open" },
  ];
  const matches = buildRedeploymentSuggestions({ source: baseSource, requests, normalizeValue });
  assert.deepEqual(matches.map(({ request_no }) => request_no), ["ELIGIBLE"]);
});

test("blank nationality and gender are neutral requirements rather than false mismatches", () => {
  const matches = buildRedeploymentSuggestions({
    source: baseSource,
    requests: [{ request_no: "OPEN", profession: "Electrician", nationality: "", gender: "", qty: 3, status: "Open", priority: "High" }],
    normalizeValue,
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].nationality, "Not restricted");
  assert.equal(matches[0].criteria.find(({ key }) => key === "gender").status, "not-required");
});

test("filled demand is excluded and candidate statuses calculate remaining demand", () => {
  const request = { request_no: "REQ-1", profession: "Electrician", qty: 2, status: "Open" };
  const candidates = [
    { request_no: "REQ-1", status: "Sourcing" },
    { request_no: "REQ-1", status: "Rejected" },
  ];
  assert.deepEqual(getOpenRequestDemand(request, candidates), { required: 2, activeCandidates: 1, remaining: 1 });
  candidates.push({ request_no: "REQ-1", status: "Interview" });
  assert.equal(buildRedeploymentSuggestions({ source: baseSource, requests: [request], candidates, normalizeValue }).length, 0);
});

test("suggestions are ranked deterministically with understandable evidence", () => {
  const now = new Date("2026-08-03T00:00:00Z");
  const matches = buildRedeploymentSuggestions({
    source: baseSource,
    now,
    normalizeValue,
    requests: [
      { request_no: "NORMAL", profession: "Electrician", qty: 1, status: "Open", created_at: "2026-08-02T00:00:00Z" },
      { request_no: "URGENT", profession: "Electrician", nationality: "Indian", gender: "Male", qty: 4, status: "Open", priority: "Urgent", created_at: "2026-07-01T00:00:00Z", project: "Project B" },
    ],
  });
  assert.equal(matches[0].request_no, "URGENT");
  assert.equal(matches[0].confidence, "Strong");
  assert.match(matches[0].reason, /Profession: Electrician/);
  assert.match(matches[0].reason, /Open demand: 4 position/);
});
