import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const token = process.env.SUPABASE_ACCESS_TOKEN || "";
const password = process.env.SUPABASE_DB_PASSWORD || "";
const projectRef = process.env.SUPABASE_PROJECT_REF || "";
const cliArgs = process.argv.slice(2);
assert.ok(token, "SUPABASE_ACCESS_TOKEN is required");
assert.ok(password, "SUPABASE_DB_PASSWORD is required");
assert.match(projectRef, /^[a-z]{20}$/i, "SUPABASE_PROJECT_REF is invalid");
assert.ok(cliArgs.length >= 2, "A Supabase CLI command is required");

const metadataResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!metadataResponse.ok) throw new Error(`Supabase project metadata failed with HTTP ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
const region = String(metadata.region || "");
assert.match(region, /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/i, "Supabase project region is invalid");

// Supabase documents the shared Session Pooler as the IPv4-safe endpoint for
// migrations from GitHub Actions. Credentials are constructed only in memory.
const provider = String(metadata.cloud_provider || "AWS").toLowerCase();
assert.match(provider, /^(aws|gcp|azure)$/, "Unsupported Supabase cloud provider");
const host = `${provider}-0-${region}.pooler.supabase.com`;
const dbUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${host}:5432/postgres`;
const result = spawnSync("supabase", [...cliArgs, "--db-url", dbUrl], {
  stdio: "inherit",
  shell: false,
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
