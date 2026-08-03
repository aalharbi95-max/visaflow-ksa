import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

test("demobilization and redeployment do not calculate or display unsupported financial estimates", () => {
  assert.doesNotMatch(appSource, /\b3150\b/);
  assert.doesNotMatch(appSource, /estimateRedeploymentCost/);
  assert.doesNotMatch(appSource, /Potential Saving/);
  assert.doesNotMatch(appSource, /Estimated Saving/);
  assert.doesNotMatch(appSource, /placeholder="Redeployment Cost"/);
  assert.doesNotMatch(appSource, /placeholder="New Recruitment Cost"/);
  assert.doesNotMatch(appSource, /estimated_saving/);
  assert.doesNotMatch(appSource, /estimated_new_recruitment_cost/);
  assert.doesNotMatch(appSource, /redeployment_cost/);
  assert.doesNotMatch(appSource, /<th>Saving<\/th>/);
});

test("operational redeployment matching remains available without financial claims", () => {
  assert.match(appSource, /AI Redeployment Suggestions/);
  assert.match(appSource, /Match Score/);
  assert.match(appSource, /Recruitment Avoided/);
  assert.match(appSource, /AI Suggest Match/);
});
