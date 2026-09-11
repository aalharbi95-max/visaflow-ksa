import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const [auditPath, migrationsDir = "supabase/migrations"] = process.argv.slice(2);
if (!auditPath) throw new Error("Usage: node scripts/classify-staging-migrations.mjs <audit.json> [migrations-dir]");

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const registered = new Set(audit.queries.migrations.map((row) => String(row.version)));
const tables = new Set(audit.queries.tables.map((row) => row.table_name));
const functions = new Set(audit.queries.functions.map((row) => row.function_name));
const columns = new Set(audit.queries.columns.map((row) => `${row.table_name}.${row.column_name}`));

const files = (await readdir(migrationsDir)).filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort();
const report = [];
for (const file of files) {
  const version = file.slice(0, 14);
  if (registered.has(version)) continue;
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  const createdTables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  const createdFunctions = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  const addedColumns = [...sql.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)[\s\S]{0,180}?add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)]
    .map((m) => `${m[1]}.${m[2]}`);
  const evidence = [
    ...createdTables.map((name) => ({ kind: "table", name, present: tables.has(name) })),
    ...createdFunctions.map((name) => ({ kind: "function", name, present: functions.has(name) })),
    ...addedColumns.map((name) => ({ kind: "column", name, present: columns.has(name) })),
  ];
  const present = evidence.filter((item) => item.present).length;
  let suggestedClassification = "unsafe_to_replay";
  if (evidence.length && present === evidence.length) suggestedClassification = "already_reflected_in_schema";
  else if (evidence.length && present === 0) suggestedClassification = "genuinely_missing_candidate";
  else if (evidence.length) suggestedClassification = "partially_reflected_unsafe_to_replay";
  report.push({ version, file, suggested_classification: suggestedClassification, evidence });
}

process.stdout.write(`${JSON.stringify({ project_ref: audit.project_ref, unregistered_count: report.length, migrations: report }, null, 2)}\n`);
