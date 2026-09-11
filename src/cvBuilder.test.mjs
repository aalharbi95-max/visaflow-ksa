import assert from "node:assert/strict";
import test from "node:test";
import {
  addCvItem,
  buildTalentImportPayload,
  calculateCvCompletion,
  createEmptyCvDraft,
  removeCvItem,
  splitList,
  updateCvItem,
  validateCvDraft,
} from "./cvBuilder.mjs";

test("repeating CV sections support add, update, and remove", () => {
  const base = createEmptyCvDraft();
  const withTwo = addCvItem(base, "experiences");
  assert.equal(withTwo.experiences.length, 2);
  const secondId = withTwo.experiences[1].id;
  const updated = updateCvItem(withTwo, "experiences", secondId, "company", "VisaFlow");
  assert.equal(updated.experiences[1].company, "VisaFlow");
  assert.equal(removeCvItem(updated, "experiences", secondId).experiences.length, 1);
});

test("CV completeness and required field validation are deterministic", () => {
  const draft = createEmptyCvDraft();
  assert.equal(validateCvDraft(draft).ok, false);
  assert.equal(calculateCvCompletion(draft), 0);
  draft.personal = { ...draft.personal, fullName: "Ali", targetTitle: "Engineer", email: "ali@example.com", phone: "+966500000000" };
  draft.summary = "Experienced engineer focused on delivery.";
  assert.equal(validateCvDraft(draft).ok, true);
  assert.ok(calculateCvCompletion(draft) >= 63);
});

test("CV draft maps safely into the Talent profile import shape", () => {
  const draft = createEmptyCvDraft();
  draft.personal = { ...draft.personal, fullName: "Ali A", targetTitle: "Civil Engineer", email: "ALI@EXAMPLE.COM", phone: "+9665", city: "Riyadh" };
  draft.summary = "Civil engineer";
  draft.skills = "AutoCAD، Primavera, Planning";
  draft.languages = "Arabic, English";
  draft.experiences[0] = { ...draft.experiences[0], jobTitle: "Site Engineer", company: "Build Co", startDate: "2020-01", endDate: "2024-01" };
  const result = buildTalentImportPayload(draft);
  assert.equal(result.email, "ali@example.com");
  assert.equal(result.profession, "Civil Engineer");
  assert.equal(result.current_company, "Build Co");
  assert.deepEqual(splitList(draft.skills), ["AutoCAD", "Primavera", "Planning"]);
});
