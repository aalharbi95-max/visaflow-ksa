import test from "node:test";
import assert from "node:assert/strict";
import {
  getAiAgentEntitlementLabel,
  isAiAgentProfessionalAvailable,
  normalizeAiAgentEntitlement,
  validateCompanyTrialForm,
} from "./aiAgentProfessional.mjs";

test("professional entitlement is enabled without a trial expiry", () => {
  const value = normalizeAiAgentEntitlement({ ai_agent_enabled: true, ai_agent_plan: "Professional", ai_agent_monthly_credit_limit: 5000 });
  assert.equal(isAiAgentProfessionalAvailable(value), true);
  assert.equal(value.monthly_credit_limit, 5000);
});

test("expired professional trial is rejected", () => {
  const entitlement = { enabled: true, ai_agent_plan: "Professional Trial", ai_agent_trial_end: "2026-08-01" };
  assert.equal(isAiAgentProfessionalAvailable(entitlement, new Date("2026-08-09T12:00:00+03:00")), false);
  assert.equal(getAiAgentEntitlementLabel(entitlement, new Date("2026-08-09T12:00:00+03:00")), "Trial Expired");
});

test("company trial form requires a valid email and accepted terms", () => {
  assert.equal(validateCompanyTrialForm({ company_name: "Zahran", admin_name: "Adel", email: "bad" }).ok, false);
  const result = validateCompanyTrialForm({
    company_name: " Zahran ",
    admin_name: " Adel ",
    email: "ADEL@ZAHRAN.COM",
    phone: "+966 50 000 0000",
    accepted_terms: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.email, "adel@zahran.com");
});
