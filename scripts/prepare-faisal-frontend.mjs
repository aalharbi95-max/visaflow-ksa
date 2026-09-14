// Extend an exact deployed source snapshot, preserving every unrelated byte.
// The source tree is the read-only Vercel /v6/deployments/{id}/files response.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
const [treeFile, sourceArg, outputArg] = process.argv.slice(2);
assert.ok(treeFile && sourceArg && outputArg, 'Usage: tree.json source-directory new-output-directory');
const source = resolve(sourceArg), output = resolve(outputArg);
assert.notEqual(source, output);
await mkdir(output); // Refuse to overwrite an existing release directory.
const tree = JSON.parse((await readFile(treeFile, 'utf8')).replace(/^\uFEFF/, ''));
const files = [];
async function copy(nodes, prefix = '') {
  for (const entry of nodes) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === 'directory') { await copy(entry.children, relative); continue; }
    const src = resolve(source, relative), dest = resolve(output, relative);
    assert.ok(src.startsWith(source + sep) && dest.startsWith(output + sep), 'Unsafe source path');
    const bytes = await readFile(src);
    assert.equal(createHash('sha1').update(bytes).digest('hex'), entry.uid, `Deployed source mismatch: ${relative}`);
    await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, bytes);
    files.push(relative);
  }
}
assert.equal(tree[0].name, 'src');
await copy(tree[0].children);
const appFile = resolve(output, 'src/App.jsx');
let app = await readFile(appFile, 'utf8');
function replaceOnce(before, after) {
  assert.equal(app.split(before).length - 1, 1, `Expected one integration point: ${before}`);
  app = app.replace(before, after);
}
replaceOnce('import { useEffect, useMemo, useRef, useState } from "react";', 'import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";');
replaceOnce('const UI_DIRECTION = getUiDirection();', 'const SalesCommandCenterLazyPage = lazy(() => import("./SalesCommandCenterLazyPage.jsx"));\n\nconst UI_DIRECTION = getUiDirection();');
replaceOnce('const PAGES = [', 'const PAGES = [\n  "Sales Command Center",');
replaceOnce('pages: ["Platform Intelligence", "Executive Dashboard",', 'pages: ["Sales Command Center", "Platform Intelligence", "Executive Dashboard",');
const rolesStart = app.indexOf('const ROLE_PAGES = {');
assert.ok(rolesStart >= 0, 'Company navigation role map missing');
const originalRoles = app.slice(rolesStart, app.indexOf('};', rolesStart) + 2);
let roles = originalRoles;
for (const role of ['CEO', '"Recruitment Manager"', '"Recruitment Officer"']) {
  assert.equal(roles.split(`${role}: [`).length - 1, 1, `Missing navigation role ${role}`);
  roles = roles.replace(`${role}: [`, `${role}: [\n    "Sales Command Center",`);
}
replaceOnce(originalRoles, roles);
replaceOnce('{activePage === "AI Agent" && (', '{activePage === "Sales Command Center" && (\n          <Suspense fallback={<div role="status">Loading Sales Command Center...</div>}><SalesCommandCenterLazyPage key={currentCompanyId} companyId={currentCompanyId} currentRole={currentRole} /></Suspense>\n        )}\n        {activePage === "AI Agent" && (');
await writeFile(appFile, app);
for (const relative of ['src/SalesCommandCenterLazyPage.jsx', 'src/salesCommandCenter.css']) {
  assert.ok(!files.includes(relative), `Sales file already present: ${relative}`);
  await copyFile(relative, resolve(output, relative));
}
console.log(JSON.stringify({ preserved_files: files.length - 1, changed: ['src/App.jsx'], added: ['src/SalesCommandCenterLazyPage.jsx', 'src/salesCommandCenter.css'], output }, null, 2));
