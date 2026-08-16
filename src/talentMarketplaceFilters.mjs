export const DEFAULT_TALENT_MARKETPLACE_FILTERS = Object.freeze({
  profession: "All",
  location: "All",
  minExperience: "",
  maxExperience: "",
  availability: "All",
  profileSource: "All",
  contactAccess: "All",
  sort: "Newest",
});

function optionalExperience(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(60, Math.max(0, Math.trunc(parsed))) : null;
}
function optionalChoice(value) {
  const normalized = String(value || "").trim();
  return !normalized || normalized === "All" ? null : normalized;
}

export function normalizeTalentMarketplaceFilters(filters = {}) {
  const normalized = { ...DEFAULT_TALENT_MARKETPLACE_FILTERS, ...filters };
  const minExperience = optionalExperience(normalized.minExperience);
  let maxExperience = optionalExperience(normalized.maxExperience);
  if (minExperience != null && maxExperience != null && maxExperience < minExperience) {
    maxExperience = minExperience;
  }

  return {
    profession: optionalChoice(normalized.profession),
    location: optionalChoice(normalized.location),
    minExperience,
    maxExperience,
    availability: optionalChoice(normalized.availability),
    profileSource: optionalChoice(normalized.profileSource),
    contactAccess: optionalChoice(normalized.contactAccess),
    sort: optionalChoice(normalized.sort) || "Newest",
  };
}

export function countActiveTalentMarketplaceFilters(filters = {}) {
  const normalized = normalizeTalentMarketplaceFilters(filters);
  return [
    normalized.profession,
    normalized.location,
    normalized.minExperience,
    normalized.maxExperience,
    normalized.availability,
    normalized.profileSource,
    normalized.contactAccess,
  ].filter((value) => value !== null).length;
}
