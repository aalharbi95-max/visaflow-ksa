import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const files = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql")).sort();
const versions = new Map();

for (const file of files) {
  const match = file.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
  assert.ok(match, `Invalid Supabase migration filename: ${file}`);
  const version = match[1];
  assert.ok(!versions.has(version), `Duplicate Supabase migration version ${version}: ${versions.get(version)} and ${file}`);
  versions.set(version, file);

  const sql = await readFile(new URL(file, migrationsUrl), "utf8");
  assert.ok(sql.trim().length > 0, `Empty Supabase migration: ${file}`);
  assert.doesNotMatch(sql, /SUPABASE_SERVICE_ROLE_KEY\s*=|OPENAI_API_KEY\s*=|AI_AGENT_WORKER_SECRET\s*=/i,
    `Secret assignment found in migration: ${file}`);
}

console.log(`Validated ${files.length} unique Supabase migrations.`);
