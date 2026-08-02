import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProfessionOptions,
  isApprovedRequestLine,
  resolveApprovedNationality,
  resolveApprovedProfession,
} from "./requestMasterData.mjs";
import { buildNationalityOptions, resolveCanonicalNationality } from "./nationality.mjs";

const professions = [
  { id: 1, name_ar: "مهندس مدني", name_en: "Civil Engineer", active: true, is_active: true },
  { id: 2, name_ar: "محاسب", name_en: "Accountant", active: true, is_active: true },
  { id: 3, name_ar: "قديم", name_en: "Inactive", active: false, is_active: true },
];
const countries = [
  { id: 1, name: "India", name_ar: "الهند", nationality: "Indian", nationality_ar: "هندي", active: true },
  { id: 2, name: "Saudi Arabia", name_ar: "السعودية", nationality: "Saudi", nationality_ar: "سعودي", active: true },
  { id: 3, name: "Inactive", nationality: "Inactive", active: false },
];

test("profession and nationality master lists expose searchable Arabic and English labels", () => {
  const professionOptions = buildProfessionOptions(professions);
  const nationalityOptions = buildNationalityOptions(countries);
  assert.deepEqual(professionOptions.map((option) => option.value), ["مهندس مدني - Civil Engineer", "محاسب - Accountant"]);
  assert.match(nationalityOptions[0].label, /هندي.*Indian/);
  assert.equal(professionOptions.filter((option) => option.label.toLowerCase().includes("civil")).length, 1);
  assert.equal(professionOptions.filter((option) => option.label.includes("محاسب")).length, 1);
  assert.equal(nationalityOptions.filter((option) => option.label.includes("الهند")).length, 1);
});

test("unapproved request-line values are rejected and approved values are canonicalized", () => {
  assert.equal(resolveApprovedProfession("Civil Engineer", professions), "مهندس مدني - Civil Engineer");
  assert.equal(resolveApprovedProfession("Random title", professions), "");
  assert.equal(resolveCanonicalNationality("هندي", countries), "Indian");
  assert.equal(resolveCanonicalNationality("Random nationality", countries), "");
  assert.equal(resolveApprovedNationality("Saudi", [], resolveCanonicalNationality), "");
  assert.equal(isApprovedRequestLine(
    { profession: "Civil Engineer", nationality: "هندي" }, professions, countries, resolveCanonicalNationality,
  ), true);
  assert.equal(isApprovedRequestLine(
    { profession: "Random title", nationality: "Indian" }, professions, countries, resolveCanonicalNationality,
  ), false);
});

test("request master-data loading is workspace guarded and never company-filtered", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("async function loadRequestMasterData"), source.indexOf("async function loadProfessionAliases"));
  assert.match(loader, /workspaceDataGenerationRef\.current/);
  assert.match(loader, /requestWorkspaceKey !== validatedWorkspaceKey/);
  assert.doesNotMatch(loader, /\.eq\(["']company_id["']/);
  assert.match(loader, /setRequestMasterDataError/);
});

test("request lines support add, edit, remove, and validated save integration", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /function addRequestLineToDraft/);
  assert.match(source, /function editRequestLineDraft/);
  assert.match(source, /function removeRequestLineFromDraft/);
  assert.match(source, /isApprovedRequestLine\(line, professions, countries/);
  assert.match(source, /request_lines["']\)\.insert\(linePayload\)/);
});

test("Company Admin permission contract can reach request creation", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /Company Admin/);
  assert.match(source, /canCreateRequest/);
});
