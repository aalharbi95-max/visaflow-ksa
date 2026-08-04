import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROTECTED_TABLES = Object.freeze([
  "visa_authorizations",
  "authorization_events",
  "notification_events",
  "companies",
  "users",
  "agencies",
  "company_agency_access",
  "agency_company_user_access",
  "agency_provisioning_requests",
  "agency_provisioning_events",
]);

const SOURCE_EXTENSIONS = Object.freeze([
  "",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".css",
]);

async function firstExistingFile(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard ESM/Vite resolution candidate.
    }
  }
  return null;
}

async function resolveLocalImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`);
  candidates.push(
    ...SOURCE_EXTENSIONS.slice(1).map((extension) =>
      path.join(base, `index${extension}`)
    )
  );
  const resolved = await firstExistingFile(candidates);
  if (!resolved) {
    throw new Error(
      `Unresolved local production import "${specifier}" from ${importer}`
    );
  }
  return path.normalize(resolved);
}

export function extractLocalImportSpecifiers(source) {
  const specifiers = new Set();
  const staticImports =
    /\b(?:import|export)\s+(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImports = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticImports, dynamicImports]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith(".")) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

export async function buildProductionImportGraph(entryFile) {
  const entry = path.resolve(
    entryFile instanceof URL ? fileURLToPath(entryFile) : entryFile
  );
  const visited = new Set();
  const edges = new Map();
  const pending = [entry];

  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = await readFile(current, "utf8");
    const imports = [];
    for (const specifier of extractLocalImportSpecifiers(source)) {
      const resolved = await resolveLocalImport(current, specifier);
      if (!resolved) continue;
      imports.push(resolved);
      if (!visited.has(resolved)) pending.push(resolved);
    }
    edges.set(current, imports);
  }

  return { entry, files: [...visited].sort(), edges };
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

export async function findProtectedTableMutationViolations(graph) {
  const violations = [];
  const sourceFiles = graph.files.filter((file) =>
    /\.(?:js|jsx|mjs|ts|tsx)$/.test(file)
  );
  const namedTablePattern = new RegExp(
    String.raw`\.from\s*\(\s*(["'])(${PROTECTED_TABLES.join("|")})\1\s*\)\s*\.\s*(insert|update|upsert|delete)\s*\(`,
    "g"
  );
  const dynamicTablePattern =
    /\.from\s*\(\s*(?!["'])([^)]+)\)\s*\.\s*(insert|update|upsert|delete)\s*\(/g;

  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(namedTablePattern)) {
      violations.push({
        file,
        line: lineNumberAt(source, match.index),
        table: match[2],
        operation: match[3],
      });
    }
    for (const match of source.matchAll(dynamicTablePattern)) {
      violations.push({
        file,
        line: lineNumberAt(source, match.index),
        table: `<dynamic:${match[1].trim()}>`,
        operation: match[2],
      });
    }
  }
  return violations;
}

export async function runProductionMutationGuard({
  entryFile = path.resolve("src/main.jsx"),
} = {}) {
  const graph = await buildProductionImportGraph(entryFile);
  const violations = await findProtectedTableMutationViolations(graph);
  if (violations.length) {
    const workspace = process.cwd();
    const details = violations
      .map(
        (item) =>
          `${path.relative(workspace, item.file)}:${item.line} ` +
          `${item.table}.${item.operation}`
      )
      .join("\n");
    throw new Error(`Direct protected-table mutations found:\n${details}`);
  }
  return graph;
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  try {
    const graph = await runProductionMutationGuard();
    console.log(
      `Protected-table mutation guard passed for ${graph.files.length} production files.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
