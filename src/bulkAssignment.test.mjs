import assert from "node:assert/strict";
import test from "node:test";
import { buildBulkAssignmentPreview, candidateMatchesRequestLine, getBatchCandidateIds } from "./bulkAssignment.mjs";

const line = { request_no: "REQ-2026-0002", profession: "Electrician", nationality: "India", gender: "Male", quantity: 200 };
const candidate = (id, extra = {}) => ({ id, profession: "Electrician", nationality: "India", gender: "Male", ...extra });

test("confirmation preview preserves a selection of 198 candidates", () => {
  const preview = buildBulkAssignmentPreview(Array.from({ length: 198 }, (_, index) => candidate(index + 1)), line, 1);
  assert.equal(preview.selectedCount, 198); assert.equal(preview.matchingCount, 198); assert.equal(preview.remaining, 199); assert.equal(preview.capacityValid, true);
});

test("REQ-2026-0002 accepts matching candidates and REQ-2026-0003 rejects gender mismatch", () => {
  assert.equal(candidateMatchesRequestLine(candidate(1), line).matches, true);
  assert.deepEqual(candidateMatchesRequestLine(candidate(2), { ...line, request_no: "REQ-2026-0003", gender: "Female" }).reasons, ["Gender mismatch"]);
});

test("profession, nationality, gender, deleted, and duplicate validation is explicit", () => {
  assert.deepEqual(candidateMatchesRequestLine(candidate(1, { profession: "Plumber" }), line).reasons, ["Profession mismatch"]);
  assert.deepEqual(candidateMatchesRequestLine(candidate(1, { nationality: "Nepal" }), line).reasons, ["Nationality mismatch"]);
  assert.deepEqual(candidateMatchesRequestLine(candidate(1, { gender: "Female" }), line).reasons, ["Gender mismatch"]);
  assert.deepEqual(candidateMatchesRequestLine(candidate(1, { deleted_at: "2026-08-02" }), line).reasons, ["Candidate is deleted"]);
  assert.deepEqual(candidateMatchesRequestLine(candidate(1, { request_line_id: "line-1" }), line).reasons, ["Already assigned to an active request"]);
});

test("capacity and upload batch selection are deterministic and side-effect free", () => {
  assert.equal(buildBulkAssignmentPreview([candidate(1), candidate(2)], { ...line, quantity: 1 }, 0).capacityValid, false);
  assert.deepEqual(getBatchCandidateIds([candidate(1, { upload_batch_id: "a" }), candidate(2, { upload_batch_id: "b" }), candidate(3, { upload_batch_id: "a", deleted_at: "x" })], "a"), ["1"]);
});
