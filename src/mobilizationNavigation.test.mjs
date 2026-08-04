import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("candidate and edit shortcuts select the matching mobilization request", () => {
  const openFromCandidate = appSource.slice(
    appSource.indexOf("function openMobilizationFromCandidate"),
    appSource.indexOf("function editMobilization")
  );
  const editMobilization = appSource.slice(
    appSource.indexOf("function editMobilization"),
    appSource.indexOf("async function saveMobilization")
  );

  assert.match(openFromCandidate, /setSelectedMobilizationRequestNo\(candidate\.request_no \|\| ""\)/);
  assert.match(openFromCandidate, /setSearch\(""\)/);
  assert.match(editMobilization, /setSelectedMobilizationRequestNo\(item\.request_no \|\| ""\)/);
  assert.match(editMobilization, /setSearch\(""\)/);
});
