export const CV_BUILDER_STORAGE_KEY = "visaflow.cv_builder.draft.v1";

export function createId(prefix = "item") {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function emptyExperience() {
  return {
    id: createId("experience"),
    jobTitle: "",
    company: "",
    location: "",
    startDate: "",
    endDate: "",
    current: false,
    description: "",
    achievements: "",
  };
}

export function emptyEducation() {
  return {
    id: createId("education"),
    degree: "",
    major: "",
    institution: "",
    location: "",
    graduationYear: "",
  };
}

export function emptyCourse() {
  return {
    id: createId("course"),
    name: "",
    issuer: "",
    issueDate: "",
    credentialId: "",
  };
}

export function emptyProject() {
  return {
    id: createId("project"),
    name: "",
    role: "",
    description: "",
    outcome: "",
    url: "",
  };
}

export function createEmptyCvDraft() {
  return {
    version: 1,
    language: "AR",
    template: "classic",
    updatedAt: null,
    personal: {
      fullName: "",
      targetTitle: "",
      email: "",
      phone: "",
      city: "",
      country: "Saudi Arabia",
      linkedin: "",
      portfolio: "",
    },
    summary: "",
    experiences: [emptyExperience()],
    education: [emptyEducation()],
    courses: [emptyCourse()],
    projects: [],
    skills: "",
    languages: "",
  };
}

const arrayFactories = {
  experiences: emptyExperience,
  education: emptyEducation,
  courses: emptyCourse,
  projects: emptyProject,
};

export function normalizeCvDraft(value) {
  const base = createEmptyCvDraft();
  const source = value && typeof value === "object" ? value : {};
  const result = {
    ...base,
    ...source,
    personal: { ...base.personal, ...(source.personal || {}) },
  };

  for (const [key, factory] of Object.entries(arrayFactories)) {
    result[key] = Array.isArray(source[key])
      ? source[key].filter(Boolean).map((item) => ({ ...factory(), ...item, id: item.id || createId(key) }))
      : base[key];
  }
  return result;
}

export function addCvItem(draft, section) {
  const factory = arrayFactories[section];
  if (!factory) return draft;
  return { ...draft, [section]: [...(draft[section] || []), factory()] };
}

export function updateCvItem(draft, section, id, field, value) {
  if (!arrayFactories[section]) return draft;
  return {
    ...draft,
    [section]: (draft[section] || []).map((item) => item.id === id ? { ...item, [field]: value } : item),
  };
}

export function removeCvItem(draft, section, id) {
  if (!arrayFactories[section]) return draft;
  return { ...draft, [section]: (draft[section] || []).filter((item) => item.id !== id) };
}

export function splitList(value) {
  return String(value || "")
    .split(/[,،\n|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function calculateCvCompletion(draft) {
  const value = normalizeCvDraft(draft);
  const checks = [
    value.personal.fullName,
    value.personal.targetTitle,
    value.personal.email,
    value.personal.phone,
    value.summary,
    value.experiences.some((item) => item.jobTitle && item.company),
    value.education.some((item) => item.degree || item.institution),
    splitList(value.skills).length >= 3,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function validateCvDraft(draft) {
  const value = normalizeCvDraft(draft);
  const missing = [];
  if (!String(value.personal.fullName).trim()) missing.push("fullName");
  if (!String(value.personal.targetTitle).trim()) missing.push("targetTitle");
  if (!String(value.personal.email).trim()) missing.push("email");
  if (!String(value.personal.phone).trim()) missing.push("phone");
  if (!String(value.summary).trim()) missing.push("summary");
  return { ok: missing.length === 0, missing };
}

export function buildTalentImportPayload(draft) {
  const value = normalizeCvDraft(draft);
  const current = value.experiences.find((item) => item.current) || value.experiences[0] || {};
  const years = value.experiences.reduce((sum, item) => {
    const startYear = Number(String(item.startDate || "").slice(0, 4));
    const endYear = item.current ? new Date().getFullYear() : Number(String(item.endDate || "").slice(0, 4));
    return sum + (startYear && endYear >= startYear ? endYear - startYear : 0);
  }, 0);
  return {
    full_name: String(value.personal.fullName || "").trim(),
    phone: String(value.personal.phone || "").trim(),
    email: String(value.personal.email || "").trim().toLowerCase(),
    city: String(value.personal.city || "").trim(),
    country_of_residence: String(value.personal.country || "").trim(),
    profession: String(value.personal.targetTitle || "").trim(),
    headline: String(value.personal.targetTitle || "").trim(),
    professional_summary: String(value.summary || "").trim(),
    years_experience: years || "",
    current_company: String(current.company || "").trim(),
    current_job_title: String(current.jobTitle || "").trim(),
    languages_text: splitList(value.languages).join(", "),
    linkedin_url: String(value.personal.linkedin || "").trim(),
    portfolio_url: String(value.personal.portfolio || "").trim(),
  };
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[character]));
}
