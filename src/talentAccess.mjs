export function isTalentEmailNotConfirmed(error) {
  const value = `${error?.code || ""} ${error?.message || error || ""}`.toLowerCase();
  return value.includes("email_not_confirmed") || value.includes("email not confirmed");
}

export function getOwnerTalentProfiles(rows, limit = 50) {
  if (!Array.isArray(rows)) return [];
  const safeLimit = Math.max(0, Number(limit) || 0);
  return rows.slice(0, safeLimit);
}

export function getTalentEnabledPages(pages, { enabled = false, isPlatformUser = false, isAgency = false } = {}) {
  const basePages = Array.isArray(pages) ? pages : [];
  if (!enabled || isPlatformUser || isAgency) return basePages;
  return Array.from(new Set([...basePages, "Talent Marketplace"]));
}
