import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildProductionImportGraph,
  findProtectedTableMutationViolations,
  runProductionMutationGuard,
} from "./protected-write-scan.mjs";

async function withFixture(files, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "visaflow-write-scan-"));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(path.dirname(target), { recursive: true })
      );
      await writeFile(target, source, "utf8");
    }
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("production import graph follows nested imported files", async () => {
  await withFixture(
    {
      "src/main.jsx": 'import "./App.jsx";\n',
      "src/App.jsx": 'import "./nested/CompanyAction.mjs";\n',
      "src/nested/CompanyAction.mjs": "export const safe = true;\n",
    },
    async (root) => {
      const graph = await buildProductionImportGraph(
        path.join(root, "src/main.jsx")
      );
      assert.equal(graph.files.length, 3);
      assert.ok(
        graph.files.some((file) => file.endsWith("CompanyAction.mjs"))
      );
    }
  );
});

test("scanner reports direct companies.update with file, line, table and operation", async () => {
  await withFixture(
    {
      "src/main.jsx": 'import "./App.jsx";\n',
      "src/App.jsx":
        'const result = supabase\n  .from("companies")\n  .update({ name: "Unsafe" });\n',
    },
    async (root) => {
      await assert.rejects(
        runProductionMutationGuard({
          entryFile: path.join(root, "src/main.jsx"),
        }),
        (error) => {
          assert.match(error.message, /src[\\/]App\.jsx:2/);
          assert.match(error.message, /companies\.update/);
          return true;
        }
      );
    }
  );
});

test("scanner accepts an import graph without protected direct writes", async () => {
  await withFixture(
    {
      "src/main.jsx": 'import "./App.jsx";\n',
      "src/App.jsx":
        'import { save } from "./save.mjs";\nexport const app = save;\n',
      "src/save.mjs":
        'export const save = () => supabase.functions.invoke("secure-edge");\n',
    },
    async (root) => {
      const graph = await runProductionMutationGuard({
        entryFile: path.join(root, "src/main.jsx"),
      });
      assert.equal(graph.files.length, 3);
    }
  );
});

test("scanner treats dynamic table mutations as review violations", async () => {
  await withFixture(
    {
      "src/main.jsx": 'import "./dynamic.mjs";\n',
      "src/dynamic.mjs":
        "export const mutate = (table) => supabase.from(table).delete();\n",
    },
    async (root) => {
      const graph = await buildProductionImportGraph(
        path.join(root, "src/main.jsx")
      );
      const violations = await findProtectedTableMutationViolations(graph);
      assert.deepEqual(
        violations.map(({ table, operation }) => ({ table, operation })),
        [{ table: "<dynamic:table>", operation: "delete" }]
      );
    }
  );
});
