import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260805000200_agency_candidate_ownership.sql", import.meta.url),
  "utf8",
);

const repairMigration = readFileSync(
  new URL("../supabase/migrations/20260809000400_repair_agency_candidate_workflow.sql", import.meta.url),
  "utf8",
);

const membershipRepairMigration = readFileSync(
  new URL("../supabase/migrations/20260809000500_repair_agency_membership_gate.sql", import.meta.url),
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

test("candidate trigger reads interview-only candidate_id dynamically", () => {
  assert.match(repairMigration, /tg_table_name\s*=\s*'interviews'/i);
  assert.match(repairMigration, /to_jsonb\(new\)->>'candidate_id'/i);
  assert.doesNotMatch(repairMigration, /if\s+tg_table_name\s*=\s*'interviews'\s+and\s+new\.candidate_id/i);
});

test("active agency user permissions are repaired from office permissions", () => {
  assert.match(repairMigration, /update\s+public\.agency_company_user_access\s+as\s+user_access/i);
  assert.match(repairMigration, /can_upload_candidates\s*=\s*office_access\.can_upload_candidates/i);
  assert.match(repairMigration, /can_update_candidates\s*=\s*office_access\.can_update_candidates/i);
  assert.match(repairMigration, /lower\(coalesce\(user_access\.status,\s*''\)\)\s*=\s*'active'/i);
});

test("invitation-created agency users do not depend on a legacy membership row", () => {
  assert.match(membershipRepairMigration, /insert\s+into\s+public\.agency_members/i);
  assert.match(membershipRepairMigration, /on\s+conflict\s*\(agency_id,\s*user_id\)\s+do\s+nothing/i);

  const functionBody = membershipRepairMigration.split("create or replace function public.agency_recruitment_access_allowed")[1];
  assert.ok(functionBody, "access function should be replaced");
  assert.match(functionBody, /join\s+public\.agency_company_user_access/i);
  assert.match(functionBody, /user_access\.can_upload_candidates\s+is\s+true/i);
  assert.doesNotMatch(functionBody, /join\s+public\.agency_members/i);
});
