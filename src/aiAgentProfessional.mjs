export const AI_AGENT_PLANS = Object.freeze(["Standard", "Professional", "Professional Trial"]);

export function normalizeAiAgentEntitlement(row = {}) {
  const enabled = row?.ai_agent_enabled === true || row?.enabled === true;
  const requestedPlan = row?.ai_agent_plan || row?.plan;
  const plan = AI_AGENT_PLANS.includes(requestedPlan)
    ? requestedPlan
    : enabled ? "Professional" : "Standard";
  const trialEnd = row?.ai_agent_trial_end || row?.trial_end || "";
  const creditLimit = Math.max(0, Number(row?.ai_agent_monthly_credit_limit || row?.monthly_credit_limit || 0));

  return {
    enabled,
    plan,
    trial_end: trialEnd,
    monthly_credit_limit: Number.isFinite(creditLimit) ? creditLimit : 0,
  };
}

export function isAiAgentProfessionalAvailable(entitlement, now = new Date()) {
  const normalized = normalizeAiAgentEntitlement(entitlement);
  if (!normalized.enabled || !["Professional", "Professional Trial"].includes(normalized.plan)) return false;
  if (normalized.plan !== "Professional Trial" || !normalized.trial_end) return true;

  const end = new Date(normalized.trial_end);
  end.setHours(23, 59, 59, 999);
  return !Number.isNaN(end.getTime()) && end >= now;
}

export function getAiAgentEntitlementLabel(entitlement, now = new Date()) {
  const normalized = normalizeAiAgentEntitlement(entitlement);
  if (!normalized.enabled) return "Disabled";
  if (!isAiAgentProfessionalAvailable(normalized, now)) return "Trial Expired";
  return normalized.plan;
}

export function validateCompanyTrialForm(form = {}) {
  const companyName = String(form.company_name || "").trim();
  const adminName = String(form.admin_name || "").trim();
  const email = String(form.email || "").trim().toLowerCase();
  const phone = String(form.phone || "").trim();
  const accepted = form.accepted_terms === true;

  if (companyName.length < 2) return { ok: false, field: "company_name", error: "Company name is required." };
  if (adminName.length < 2) return { ok: false, field: "admin_name", error: "Administrator name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, field: "email", error: "Enter a valid work email." };
  if (phone && !/^[+\d][\d\s()-]{7,24}$/.test(phone)) return { ok: false, field: "phone", error: "Enter a valid phone number." };
  if (!accepted) return { ok: false, field: "accepted_terms", error: "Accept the trial terms to continue." };

  return {
    ok: true,
    value: {
      company_name: companyName.slice(0, 160),
      admin_name: adminName.slice(0, 160),
      email: email.slice(0, 254),
      phone: phone.slice(0, 40),
      job_title: String(form.job_title || "").trim().slice(0, 120),
      team_size: String(form.team_size || "1-5").trim().slice(0, 40),
      website: String(form.website || "").trim().slice(0, 200),
      accepted_terms: true,
    },
  };
}
