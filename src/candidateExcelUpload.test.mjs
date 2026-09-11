import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getCandidateUploadValidationSummary,
  isAgencyRequestAssignmentInWorkspace,
  resolveAgencyUploadWorkspace,
  secureAgencyCandidatePayload,
} from "./candidateExcelUpload.mjs";

const currentUser = {
  id: "user-1",
  auth_user_id: "auth-1",
  role: "Agency",
  agency_id: "agency-1",
  agency_name: "Trusted Agency",
  active_company_id: "company-1",
};
const agencyClientAccess = [{
  user_id: "user-1",
  agency_id: "agency-1",
  company_id: "company-1",
  status: "Active",
}];

function workspace(overrides = {}) {
  return resolveAgencyUploadWorkspace({
    currentUser: { ...currentUser, ...(overrides.currentUser || {}) },
    activeAgencyCompanyId: overrides.activeAgencyCompanyId ?? "company-1",
    agencyClientAccess: overrides.agencyClientAccess || agencyClientAccess,
  });
}

test("authenticated Agency user resolves the active authorized company workspace", () => {
  assert.deepEqual(
    (({ ok, companyId, agencyId, agencyName }) => ({ ok, companyId, agencyId, agencyName }))(workspace()),
    { ok: true, companyId: "company-1", agencyId: "agency-1", agencyName: "Trusted Agency" },
  );
});

test("missing or cross-company workspace is rejected without stale company fallback", () => {
  assert.match(workspace({ activeAgencyCompanyId: "", currentUser: { active_company_id: "" } }).message, /not selected/i);
  assert.match(workspace({ activeAgencyCompanyId: "company-2" }).message, /not authorized/i);
});

test("Excel tenant fields cannot forge company or agency identity", () => {
  const payload = secureAgencyCandidatePayload({
    candidate_name: "Candidate",
    company_id: "forged-company",
    agency_id: "forged-agency",
    agency: "Forged Agency",
  }, workspace());

  assert.equal(payload.company_id, "company-1");
  assert.equal(payload.agency, "Trusted Agency");
  assert.equal(Object.hasOwn(payload, "agency_id"), false);
});

test("empty Request No routes candidates to the active Agency Talent Pool", () => {
  const payload = secureAgencyCandidatePayload({ candidate_name: "Candidate" }, workspace());
  assert.equal(payload.request_no, "");
  assert.equal(payload.request_line_id, null);
  assert.equal(payload.project, "Agency Talent Pool");
});

test("assigned Request No uses only the validated request assignment", () => {
  const payload = secureAgencyCandidatePayload(
    { request_no: "FORGED", request_line_id: "forged-line", project: "Forged" },
    workspace(),
    { requestNo: "REQ-1", requestLineId: "line-1", project: "Project 1" },
  );
  assert.equal(payload.request_no, "REQ-1");
  assert.equal(payload.request_line_id, "line-1");
  assert.equal(payload.project, "Project 1");
});

test("Request No from another company is rejected without cross-company leakage", () => {
  const resolved = workspace();
  assert.equal(isAgencyRequestAssignmentInWorkspace({
    requestNo: "REQ-1",
    workspace: resolved,
    request: { request_no: "REQ-1", company_id: "company-2" },
    notification: { request_no: "REQ-1", company_id: "company-1", agency_id: "agency-1" },
  }), false);
  assert.equal(isAgencyRequestAssignmentInWorkspace({
    requestNo: "REQ-1",
    workspace: resolved,
    request: { request_no: "REQ-1", company_id: "company-1" },
    notification: { request_no: "REQ-1", company_id: "company-1", agency_id: "agency-1" },
  }), true);
});

test("any validation rejection blocks the whole file before insert", () => {
  let insertCalled = false;
  const summary = getCandidateUploadValidationSummary([{ candidate_name: "Valid" }], ["Row 3: invalid"]);
  if (summary.canInsert) insertCalled = true;
  assert.deepEqual({ accepted: summary.accepted, rejected: summary.rejected, canInsert: summary.canInsert }, {
    accepted: 1,
    rejected: 1,
    canInsert: false,
  });
  assert.equal(insertCalled, false);
  assert.match(summary.message, /Row 3: invalid/);
});

test("a valid 198-row file is accepted as one insert batch", () => {
  const payloads = Array.from({ length: 198 }, (_, index) => secureAgencyCandidatePayload({
    candidate_name: `Candidate ${index + 1}`,
    company_id: "forged-company",
    agency: "Forged Agency",
  }, workspace()));
  const summary = getCandidateUploadValidationSummary(payloads, []);
  assert.equal(summary.accepted, 198);
  assert.equal(summary.rejected, 0);
  assert.equal(summary.canInsert, true);
  assert.equal(payloads.every((payload) => payload.company_id === "company-1"), true);
  assert.equal(payloads.every((payload) => payload.agency === "Trusted Agency"), true);
});

test("candidate upload path has no out-of-scope currentCompanyId reference", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const notificationHelper = source.slice(
    source.indexOf("async function triggerExternalNotification"),
    source.indexOf("function App()"),
  );
  assert.doesNotMatch(notificationHelper, /currentCompanyId/);
  assert.match(source, /resolveAgencyUploadWorkspace/);
  assert.match(source, /secureAgencyCandidatePayload/);
  assert.match(source, /uploadGeneration !== workspaceDataGenerationRef\.current/);
});
