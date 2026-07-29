import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("src");
const supportedExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(absolutePath));
    } else if (supportedExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function normalizeExpression(expression) {
  const trimmed = expression.trim();
  const literal = trimmed.match(/^["'`]([^"'`]+)["'`]$/);
  return literal ? literal[1] : `[dynamic: ${trimmed.replace(/\s+/g, " ").slice(0, 80)}]`;
}

function addUsage(inventory, type, name, file, line, operations) {
  const key = `${type}:${name}`;
  const resource = inventory.get(key) || {
    type,
    name,
    operations: new Set(),
    usages: [],
  };

  operations.forEach((operation) => resource.operations.add(operation));
  resource.usages.push({ file, line, operations });
  inventory.set(key, resource);
}

function operationAfterCall(source, callEnd) {
  const methodMap = {
    select: "SELECT",
    insert: "INSERT",
    update: "UPDATE",
    upsert: "UPSERT",
    delete: "DELETE",
  };
  const nextMethod = source
    .slice(callEnd, callEnd + 240)
    .match(/^\s*\.\s*(select|insert|update|upsert|delete)\s*\(/);
  return [nextMethod ? methodMap[nextMethod[1]] : "UNKNOWN"];
}

const inventory = new Map();
const files = await listSourceFiles(sourceRoot);

for (const absolutePath of files) {
  const source = await readFile(absolutePath, "utf8");
  const relativeFile = path.relative(process.cwd(), absolutePath).replaceAll("\\", "/");

  for (const match of source.matchAll(/\.from\s*\(\s*([^)]+?)\s*\)/g)) {
    const before = source.slice(Math.max(0, match.index - 120), match.index);
    if (/\.storage\s*$/.test(before)) continue;
    if (!/(?:supabase|talentSupabase)\s*$/.test(before)) continue;
    addUsage(
      inventory,
      "table",
      normalizeExpression(match[1]),
      relativeFile,
      lineNumber(source, match.index),
      operationAfterCall(source, match.index + match[0].length)
    );
  }

  for (const match of source.matchAll(/\.rpc\s*\(\s*([^,\n)]+)/g)) {
    addUsage(
      inventory,
      "rpc",
      normalizeExpression(match[1]),
      relativeFile,
      lineNumber(source, match.index),
      ["RPC"]
    );
  }

  for (const match of source.matchAll(/\.storage\s*\.from\s*\(\s*([^)]+?)\s*\)/g)) {
    const nextStorageMethod = source
      .slice(match.index + match[0].length, match.index + match[0].length + 240)
      .match(/^\s*\.\s*(upload|download|list|remove|createSignedUrl|createSignedUrls|getPublicUrl|move|copy)\s*\(/);
    const storageOperations = nextStorageMethod
      ? [nextStorageMethod[1].toUpperCase()]
      : ["UNKNOWN"];
    addUsage(
      inventory,
      "bucket",
      normalizeExpression(match[1]),
      relativeFile,
      lineNumber(source, match.index),
      storageOperations
    );
  }

  for (const match of source.matchAll(/\.auth\.([A-Za-z0-9_]+)\s*\(/g)) {
    addUsage(
      inventory,
      "auth",
      match[1],
      relativeFile,
      lineNumber(source, match.index),
      ["AUTH"]
    );
  }
}

const result = Array.from(inventory.values())
  .map((resource) => ({
    ...resource,
    operations: Array.from(resource.operations).sort(),
    usages: resource.usages.sort((a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line
    ),
  }))
  .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`Supabase resources: ${result.length}\n`);
  for (const resource of result) {
    const locations = resource.usages
      .map((usage) => `${usage.file}:${usage.line}`)
      .join(", ");
    process.stdout.write(
      `${resource.type}\t${resource.name}\t${resource.operations.join("/")}\t${locations}\n`
    );
  }
}
