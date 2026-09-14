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
const app = await readFile(appFile, 'utf8');
assert.ok(app.includes('key="platform-sales" currentRole={currentRole}'), 'Deployed owner Sales integration required');
const changed = ['src/SalesCommandCenterLazyPage.jsx'];
for (const relative of changed) {
  assert.ok(files.includes(relative), 'Existing Sales source required');
  await copyFile(relative, resolve(output, relative));
}
const added=['public/faisal-unsubscribe.html','public/faisal-unsubscribe.js'];
for(const relative of added){assert.ok(!files.includes(relative),'New unsubscribe asset already exists');await copyFile(relative,resolve(output,relative));}
console.log(JSON.stringify({ preserved_files: files.length - changed.length, changed, added, output }, null, 2));
