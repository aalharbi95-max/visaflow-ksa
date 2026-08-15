import assert from "node:assert/strict";
import test from "node:test";

import {
  FINANCE_AI_TEMPLATE_CATALOG,
  HR_AI_TEMPLATE_CATALOG,
  IT_AI_TEMPLATE_CATALOG,
  OPERATIONS_MANAGEMENT_AI_TEMPLATE_CATALOG,
  SPECIALIZED_AI_TEMPLATE_CATALOG,
  TECHNICIAN_AI_TEMPLATE_CATALOG,
} from "./aiInterviewTemplateCatalog.mjs";

test("specialized interview library contains the approved 44 templates", () => {
  assert.equal(TECHNICIAN_AI_TEMPLATE_CATALOG.length, 8);
  assert.equal(FINANCE_AI_TEMPLATE_CATALOG.length, 9);
  assert.equal(HR_AI_TEMPLATE_CATALOG.length, 9);
  assert.equal(IT_AI_TEMPLATE_CATALOG.length, 9);
  assert.equal(OPERATIONS_MANAGEMENT_AI_TEMPLATE_CATALOG.length, 9);
  assert.equal(SPECIALIZED_AI_TEMPLATE_CATALOG.length, 44);
});

test("ready-made professions and Arabic labels are unique and complete", () => {
  const professions = SPECIALIZED_AI_TEMPLATE_CATALOG.map((item) => item.profession);
  const arabicLabels = SPECIALIZED_AI_TEMPLATE_CATALOG.map((item) => item.profession_ar);

  assert.equal(new Set(professions).size, professions.length);
  assert.equal(new Set(arabicLabels).size, arabicLabels.length);
  assert.ok(professions.includes("Electrical Technician"));
  assert.ok(professions.includes("General Accountant"));
  assert.ok(professions.includes("Recruitment Specialist"));
  assert.ok(professions.includes("Cybersecurity Analyst"));
  assert.ok(professions.includes("Operations Manager"));
});

test("every specialized template is safe for AI generation and human review", () => {
  for (const template of SPECIALIZED_AI_TEMPLATE_CATALOG) {
    assert.ok(template.profession.length >= 3);
    assert.ok(template.profession_ar.length >= 3);
    assert.ok(template.focus.length >= 30);
    assert.ok(template.job_description.length >= 250);
    assert.ok(template.years_experience.length >= 3);
    assert.ok(template.qualifications.length >= 20);
    assert.ok(["Medium", "Advanced"].includes(template.difficulty));
    assert.ok(template.question_count >= 10 && template.question_count <= 15);
    assert.ok(template.passing_score >= 70 && template.passing_score <= 80);
    assert.match(template.source_type, /^VisaFlow (Technician|Finance|HR|IT|Operations Management) Master Framework$/);
  }
});

test("catalog categories match the platform profession taxonomy", () => {
  assert.deepEqual(
    new Set(FINANCE_AI_TEMPLATE_CATALOG.map((item) => item.category)),
    new Set(["Finance & Accounting"]),
  );
  assert.deepEqual(
    new Set(HR_AI_TEMPLATE_CATALOG.map((item) => item.category)),
    new Set(["HR & Recruitment"]),
  );
  assert.deepEqual(
    new Set(TECHNICIAN_AI_TEMPLATE_CATALOG.map((item) => item.category)),
    new Set(["Technical / Skilled", "Security & Safety", "Operations"]),
  );
  assert.deepEqual(
    new Set(IT_AI_TEMPLATE_CATALOG.map((item) => item.category)),
    new Set(["IT"]),
  );
  assert.deepEqual(
    new Set(OPERATIONS_MANAGEMENT_AI_TEMPLATE_CATALOG.map((item) => item.category)),
    new Set(["Operations"]),
  );
});
