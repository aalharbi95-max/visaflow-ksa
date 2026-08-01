import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildNationalityOptions, getNationalityMatchKeys, nationalitiesMatch, resolveCanonicalNationality } from "./nationality.mjs";

const countries = [
  { id: 1, iso_code: "IN", name: "India", name_ar: "الهند", nationality: "Indian", nationality_ar: "هندي", active: true },
  { id: 2, iso_code: "SA", name: "Saudi Arabia", name_ar: "المملكة العربية السعودية", nationality: "Saudi", nationality_ar: "سعودي", active: true },
];

test("nationality aliases resolve to one stable stored value", () => {
  for (const value of ["India", "Indian", "الهند", "هندي", "Indian (India)"]) {
    assert.equal(resolveCanonicalNationality(value, countries), "Indian");
  }
});

test("nationality options expose bilingual labels but canonical values", () => {
  assert.deepEqual(buildNationalityOptions(countries)[0], {
    value: "Indian", label: "هندي — Indian — الهند — India",
  });
});

test("matching includes country, nationality, Arabic labels and ISO code", () => {
  assert.deepEqual(new Set(getNationalityMatchKeys("الهند", countries)),
    new Set(["indian", "هندي", "india", "الهند", "in"]));
});

test("unknown free text is rejected instead of creating a new spelling", () => {
  assert.equal(resolveCanonicalNationality("Custom Nationality", countries), "");
});

test("request, visa, and authorization aliases share one canonical comparison", () => {
  for (const value of ["India", "Indian", "الهند", "هندي", "IN"]) {
    assert.equal(nationalitiesMatch(value, "Indian", countries), true);
  }
  assert.equal(nationalitiesMatch("Saudi", "IN", countries), false);
});

test("operational request, visa, candidate, and authorization paths use canonical nationality matching", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(app, /nationalitiesMatch\(req\.nationality, selectedLine\.nationality, countries\)/);
  assert.match(app, /nationalitiesMatch\(authorization\.nationality, line\.nationality, countries\)/);
  assert.match(app, /nationality: resolveCanonicalNationality\(line\.nationality, countries\)/);
  assert.match(app, /options=\{countries\.length \? buildNationalityOptions\(countries\) : COUNTRIES\}/);
  assert.doesNotMatch(app, /normalize\([^\n]*nationality[^\n]*===\s*normalize\([^\n]*nationality/i);
});
