import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260812000700_global_security_manager_interview.sql",
  import.meta.url,
);

test("Security Manager interview is bilingual, approved and global", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /Security Manager \| مدير الأمن/);
  assert.match(sql, /'Security & Safety'/);
  assert.match(sql, /'Arabic \/ English'/);
  assert.match(sql, /'Approved'/);
  assert.match(sql, /is_global/);
  assert.match(sql, /passing_score[\s\S]*75/);
});

test("Security Manager interview contains ten ordered assessment questions", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const rows = [...sql.matchAll(/\(v_company_id,v_template_id,(\d+),/g)];
  assert.deepEqual(rows.map((match) => Number(match[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(sql, /Risk assessment/);
  assert.match(sql, /Emergency response/);
  assert.match(sql, /Access control/);
  assert.match(sql, /Incident investigation/);
  assert.match(sql, /De-escalation/);
  assert.match(sql, /Crisis decision making/);
});
