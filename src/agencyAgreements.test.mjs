import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENCY_AGREEMENT_CREATE_RPC,
  createAgencyAgreement,
  getAgencyAgreementSaveError,
  isSameAgencyWorkspace,
  retryAgreementDelivery,
  shouldShowAgencyAgreements,
} from "./agencyAgreements.mjs";

test("selecting the current workspace is a no-op that preserves agreements", () => {
  const agreements = [{ agreement_no: "AGR-2026-0001", status: "Pending Signature" }];
  assert.equal(isSameAgencyWorkspace("company-1", { company_id: "company-1" }), true);
  assert.deepEqual(agreements, [{ agreement_no: "AGR-2026-0001", status: "Pending Signature" }]);
});

test("a pending agreement card remains visible while loading and after loading", () => {
  assert.equal(shouldShowAgencyAgreements({ role: "Agency", loading: true, agreements: [] }), true);
  assert.equal(shouldShowAgencyAgreements({ role: "Agency", loading: false, agreements: [{ status: "Pending Signature" }] }), true);
});

test("agreement creation delegates numbering and insert to the server RPC", async () => {
  let call;
  const client = { rpc: async (...args) => { call = args; return { data: { agreement_no: "AGR-2026-0002" }, error: null }; } };
  await createAgencyAgreement(client, { agency_id: "agency-1", agency_name: "Agency", agreement_no: "AGR-2026-9999", company_id: "other" });
  assert.equal(call[0], AGENCY_AGREEMENT_CREATE_RPC);
  assert.equal("agreement_no" in call[1].p_agreement, false);
});

test("raw unique violations are hidden", () => {
  assert.doesNotMatch(getAgencyAgreementSaveError({ code: "23505", message: "duplicate key violates unique constraint" }), /23505|duplicate|unique constraint/i);
});

test("retry delivery references the existing agreement id and creates no agreement", async () => {
  const calls = [];
  await retryAgreementDelivery(async (request) => { calls.push(request); }, { id: "agreement-1" });
  assert.deepEqual(calls, [{ type: "AGENCY_AGREEMENT_SENT", identifiers: { agreement_id: "agreement-1" } }]);
});
