import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const expectedProjectRef = "zeocbftriydodzfgixjv";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const schemaPath = process.env.PRODUCTION_SCHEMA_DUMP || "";
const outputPath = process.env.PRODUCTION_BASELINE_OUTPUT || "production-baseline-candidate.json";
assert.equal(projectRef, expectedProjectRef, "Production project mismatch");
assert.ok(schemaPath, "PRODUCTION_SCHEMA_DUMP is required");

const stagingManifest = JSON.parse(await readFile("supabase/release/staging-baseline-20260817.json", "utf8"));
// pg_dump quotes identifiers by default. Removing identifier quotes in memory
// makes object-presence checks format-independent; the dump is never emitted.
const schema = (await readFile(schemaPath, "utf8")).toLowerCase().replaceAll('"', "");
const migrationsDir = "supabase/migrations";
const files = (await readdir(migrationsDir)).filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort();
assert.equal(files.length, 76, "Production baseline requires the reviewed 76-migration inventory");

const reviewedReflected = new Set(stagingManifest.already_reflected_in_schema);
const reviewedObsolete = new Set(stagingManifest.obsolete_or_unsafe_to_replay);
const reviewedMissing = new Set([
  ...stagingManifest.genuinely_missing_and_safe_to_apply,
  ...stagingManifest.post_baseline_safe_to_apply,
]);

function unique(values) {
  return [...new Set(values)];
}

function cleanIdentifier(value) {
  return value.replaceAll('"', "").toLowerCase();
}

function anchors(sql) {
  const normalized = sql.toLowerCase();
  const evidence = [];
  for (const match of normalized.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(["a-z0-9_]+)/g)) {
    const table = cleanIdentifier(match[1]);
    evidence.push(schema.includes(`create table public.${table}`) || schema.includes(`create table if not exists public.${table}`));
  }
  for (const match of normalized.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(["a-z0-9_]+)/g)) {
    const fn = cleanIdentifier(match[1]);
    evidence.push(schema.includes(`function public.${fn}(`));
  }
  for (const match of normalized.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+public\.(["a-z0-9_]+)/g)) {
    const view = cleanIdentifier(match[1]);
    evidence.push(schema.includes(`view public.${view} as`));
  }
  for (const match of normalized.matchAll(/create\s+type\s+public\.(["a-z0-9_]+)/g)) {
    const type = cleanIdentifier(match[1]);
    evidence.push(schema.includes(`create type public.${type} as`));
  }
  for (const match of normalized.matchAll(/create\s+sequence\s+(?:if\s+not\s+exists\s+)?public\.(["a-z0-9_]+)/g)) {
    const sequence = cleanIdentifier(match[1]);
    evidence.push(schema.includes(`create sequence public.${sequence}`));
  }
  for (const match of normalized.matchAll(/create\s+(?:unique\s+)?index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?\s+(["a-z0-9_]+)/g)) {
    const index = cleanIdentifier(match[1]);
    evidence.push(schema.includes(`index ${index} `) || schema.includes(`index public.${index} `));
  }
  for (const match of normalized.matchAll(/create\s+policy\s+"?([a-z0-9_ ]+)"?\s+on\s+public\.(["a-z0-9_]+)/g)) {
    const policy = cleanIdentifier(match[1]).trim();
    const table = cleanIdentifier(match[2]);
    evidence.push(schema.includes(`policy ${policy} on public.${table}`) || schema.includes(`policy "${policy}" on public.${table}`));
  }
  for (const match of normalized.matchAll(/create\s+(?:constraint\s+)?trigger\s+(["a-z0-9_]+)[\s\S]{0,500}?\s+on\s+public\.(["a-z0-9_]+)/g)) {
    const trigger = cleanIdentifier(match[1]);
    const table = cleanIdentifier(match[2]);
    evidence.push(schema.includes(`trigger ${trigger} `) && schema.includes(`on public.${table}`));
  }
  for (const statement of normalized.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.(["a-z0-9_]+)[\s\S]*?;/g)) {
    const table = cleanIdentifier(statement[1]);
    for (const match of statement[0].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(["a-z0-9_]+)/g)) {
      const column = cleanIdentifier(match[1]);
      const tableStart = schema.indexOf(`create table public.${table}`);
      const tableEnd = tableStart >= 0 ? schema.indexOf(";", tableStart) : -1;
      const tableDefinition = tableStart >= 0 && tableEnd > tableStart ? schema.slice(tableStart, tableEnd) : "";
      evidence.push(new RegExp(`\\n\\s*"?${column}"?\\s+`).test(tableDefinition));
    }
    for (const match of statement[0].matchAll(/add\s+(?:constraint\s+)?(["a-z0-9_]+)\s+(?:check|unique|foreign|primary)/g)) {
      const constraint = cleanIdentifier(match[1]);
      evidence.push(schema.includes(`constraint ${constraint} `) || schema.includes(`constraint "${constraint}" `));
    }
    if (/enable\s+row\s+level\s+security/.test(statement[0])) {
      evidence.push(new RegExp(`alter\\s+table\\s+(?:only\\s+)?public\\.${table}\\s+enable\\s+row\\s+level\\s+security`).test(schema));
    }
  }
  return evidence;
}

function hasReplayRisk(sql) {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
  return /\b(drop|truncate|delete\s+from|update\s+public\.|insert\s+into|alter\s+column|set\s+not\s+null|do\s+\$\$)\b/i.test(withoutComments);
}

const classifications = {
  already_reflected_in_schema: [],
  obsolete_or_unsafe_to_replay: [],
  genuinely_missing_and_safe_to_apply: [],
};
const failures = [];

for (const file of files) {
  const version = file.slice(0, 14);
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  const checks = anchors(sql);
  const present = checks.filter(Boolean).length;
  const allPresent = checks.length > 0 && present === checks.length;
  const allMissing = checks.length > 0 && present === 0;
  const expected = reviewedObsolete.has(version)
    ? "obsolete_or_unsafe_to_replay"
    : reviewedMissing.has(version)
      ? "genuinely_missing_and_safe_to_apply"
      : "already_reflected_in_schema";

  if (expected === "already_reflected_in_schema") {
    if (allPresent) classifications.already_reflected_in_schema.push(version);
    else if (checks.length === 0 && hasReplayRisk(sql)) classifications.obsolete_or_unsafe_to_replay.push(version);
    else failures.push({ version, expected, anchor_count: checks.length, present_count: present });
  } else if (expected === "obsolete_or_unsafe_to_replay") {
    if (hasReplayRisk(sql) || !allMissing) classifications.obsolete_or_unsafe_to_replay.push(version);
    else failures.push({ version, expected, anchor_count: checks.length, present_count: present });
  } else if (allMissing) {
    classifications.genuinely_missing_and_safe_to_apply.push(version);
  } else {
    failures.push({ version, expected, anchor_count: checks.length, present_count: present });
  }
}

const classified = Object.values(classifications).flat();
assert.equal(new Set(classified).size, classified.length, "Duplicate Production migration classification");
if (failures.length) {
  const summary = failures.map(({ version, expected, anchor_count, present_count }) =>
    `${version}:${expected}:${present_count}/${anchor_count}`).join(",");
  throw new Error(`Production migration classification is not proven: ${summary}`);
}
assert.equal(classified.length, files.length, "Every Production migration must be classified exactly once");

const manifest = {
  project_ref: expectedProjectRef,
  repository_migration_count: files.length,
  captured_registered_count: 0,
  ...classifications,
  controls: {
    evidence_source: "ephemeral_schema_only_runner_file",
    schema_dump_persisted: false,
    fail_closed: true,
    safety_basis: "Current Production schema evidence plus migrations previously proven safe on Staging.",
  },
};
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
for (const [category, versions] of Object.entries(classifications)) {
  console.log(`${category} (${versions.length}): ${versions.join(",")}`);
}
