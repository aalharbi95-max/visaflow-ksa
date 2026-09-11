import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = process.argv[2] || "production-migration-dry-run.txt";
const output = await readFile(path, "utf8");
const proposed = [...output.matchAll(/(?:•|-)\s+(\d{14})_[a-z0-9_]+\.sql/gi)].map((match) => match[1]);

assert.deepEqual(
  proposed,
  ["20260804000200"],
  "Production dry-run must propose only the reviewed pending mobilization migration",
);

console.log("Production dry-run boundary PASS: only 20260804000200 remains proposed and unapplied.");
