import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260805000200_agency_candidate_ownership.sql", import.meta.url),
  "utf8",
);

test("candidate and interview ownership uses immutable agency ids", () => {
  assert.match(migration, /add column if not exists agency_id uuid/i);
  assert.match(migration, /agency_recruitment_access_allowed\(company_id, agency_id/i);
  assert.match(migration, /old\.agency_id is distinct from v_actor\.agency_id/i);
  assert.match(migration, /new\.agency_id := v_actor\.agency_id/i);
  assert.match(migration, /candidate ownership does not match the interview/i);
  assert.doesNotMatch(migration, /agency_candidate_access_allowed\(company_id, agency,/i);
});

test("legacy permissive policies are replaced for both recruitment tables", () => {
  for (const table of ["candidates", "interviews"]) {
    for (const operation of ["select", "insert", "update", "delete"]) {
      assert.match(
        migration,
        new RegExp(`drop policy if exists ${table}_${operation}_tenant_policy on public\\.${table}`, "i"),
      );
      assert.match(
        migration,
        new RegExp(`create policy ${table}_${operation}_tenant_policy on public\\.${table}`, "i"),
      );
    }
  }
});

