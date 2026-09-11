import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENCY_PROVISIONER_MAX_BODY_BYTES,
  buildAgencyProvisionerCorsHeaders,
  isAllowedInviteRedirect,
  parseAllowedOrigins,
  validateAgencyProvisionerRequest,
} from "../supabase/functions/_shared/agencyProvisionerHttp.mjs";

const allowedOrigins = parseAllowedOrigins(
  "https://staging.example.test, https://app.example.test"
);

test("allowed origins receive explicit CORS headers", () => {
  const result = validateAgencyProvisionerRequest({
    method: "POST",
    origin: "https://staging.example.test",
    allowedOrigins,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    buildAgencyProvisionerCorsHeaders(
      "https://staging.example.test",
      allowedOrigins
    )["Access-Control-Allow-Origin"],
    "https://staging.example.test"
  );
});

test("disallowed origins and originless OPTIONS are rejected", () => {
  assert.deepEqual(
    validateAgencyProvisionerRequest({
      method: "POST",
      origin: "https://evil.example.test",
      allowedOrigins,
    }),
    { ok: false, status: 403, code: "ORIGIN_NOT_ALLOWED" }
  );
  assert.deepEqual(
    validateAgencyProvisionerRequest({
      method: "OPTIONS",
      origin: null,
      allowedOrigins,
    }),
    { ok: false, status: 403, code: "ORIGIN_NOT_ALLOWED" }
  );
  assert.equal(
    validateAgencyProvisionerRequest({
      method: "OPTIONS",
      origin: "https://app.example.test",
      allowedOrigins,
    }).status,
    204
  );
});

test("invite redirect must use HTTPS and an allowed origin", () => {
  assert.equal(
    isAllowedInviteRedirect(
      "https://staging.example.test/agency-invite",
      allowedOrigins
    ),
    true
  );
  assert.equal(
    isAllowedInviteRedirect(
      "http://staging.example.test/agency-invite",
      allowedOrigins
    ),
    false
  );
  assert.equal(
    isAllowedInviteRedirect(
      "https://evil.example.test/agency-invite",
      allowedOrigins
    ),
    false
  );
});

test("declared or actual oversized request bodies are rejected", () => {
  for (const values of [
    { contentLength: AGENCY_PROVISIONER_MAX_BODY_BYTES + 1, bodyBytes: 0 },
    { contentLength: 0, bodyBytes: AGENCY_PROVISIONER_MAX_BODY_BYTES + 1 },
  ]) {
    assert.deepEqual(
      validateAgencyProvisionerRequest({
        method: "POST",
        origin: "https://app.example.test",
        allowedOrigins,
        ...values,
      }),
      { ok: false, status: 413, code: "REQUEST_TOO_LARGE" }
    );
  }
});
