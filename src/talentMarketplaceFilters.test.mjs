import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TALENT_MARKETPLACE_FILTERS,
  countActiveTalentMarketplaceFilters,
  normalizeTalentMarketplaceFilters,
} from "./talentMarketplaceFilters.mjs";

test("normalizes empty marketplace filters for the RPC", () => {
  assert.deepEqual(normalizeTalentMarketplaceFilters(DEFAULT_TALENT_MARKETPLACE_FILTERS), {
    profession: null,
    location: null,
    minExperience: null,
    maxExperience: null,
    availability: null,
    profileSource: null,
    contactAccess: null,
    sort: "Newest",
  });
});
test("clamps experience and keeps the range valid", () => {
  assert.deepEqual(normalizeTalentMarketplaceFilters({ minExperience: "8", maxExperience: "3", profession: " Finance " }), {
    profession: "Finance",
    location: null,
    minExperience: 8,
    maxExperience: 8,
    availability: null,
    profileSource: null,
    contactAccess: null,
    sort: "Newest",
  });
});

test("counts only filters that narrow candidate results", () => {
  assert.equal(countActiveTalentMarketplaceFilters({ profession: "Accounting", minExperience: 5, sort: "Experience: high to low" }), 2);
});
