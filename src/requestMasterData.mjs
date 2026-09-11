function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en");
}

export const PROFESSION_PAGE_SIZE = 1000;

export async function loadAllProfessionPages(
  supabase,
  { pageSize = PROFESSION_PAGE_SIZE, isCurrentWorkspace = () => true } = {},
) {
  const professions = [];
  const seenIds = new Set();

  for (let from = 0; ; from += pageSize) {
    if (!isCurrentWorkspace()) return { data: [], error: null, cancelled: true };

    const result = await supabase
      .from("professions")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (!isCurrentWorkspace()) return { data: [], error: null, cancelled: true };
    if (result.error) return { data: [], error: result.error, cancelled: false };

    const page = result.data || [];
    for (const profession of page) {
      const id = profession?.id;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      professions.push(profession);
    }

    if (page.length < pageSize) {
      return { data: professions, error: null, cancelled: false };
    }
  }
}

export function getProfessionOption(profession = {}) {
  const arabic = String(profession.name_ar || "").trim();
  const english = String(profession.name_en || "").trim();
  const value = english ? [arabic, english].filter(Boolean).join(" - ") : arabic;
  return value ? { value, label: value } : null;
}

export function buildProfessionOptions(professions = []) {
  const seen = new Set();
  return professions.flatMap((profession) => {
    if (profession?.active === false || profession?.is_active === false) return [];
    const option = getProfessionOption(profession);
    const key = normalize(option?.value);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [option];
  });
}

export function resolveApprovedProfession(value, professions = []) {
  const key = normalize(value);
  if (!key) return "";
  const match = professions.find((profession) => {
    if (profession?.active === false || profession?.is_active === false) return false;
    const option = getProfessionOption(profession);
    return [profession.name_ar, profession.name_en, option?.value]
      .some((candidate) => normalize(candidate) === key);
  });
  return getProfessionOption(match)?.value || "";
}

export function resolveApprovedNationality(value, countries = [], resolveNationality) {
  const canonical = resolveNationality(value, countries);
  if (!canonical) return "";
  const exists = countries.some((country) => {
    if (country?.active === false) return false;
    return normalize(resolveNationality(country?.nationality || country?.name, countries)) === normalize(canonical);
  });
  return exists ? canonical : "";
}

export function isApprovedRequestLine(line, professions, countries, resolveNationality) {
  return Boolean(
    resolveApprovedProfession(line?.profession, professions)
    && resolveApprovedNationality(line?.nationality, countries, resolveNationality)
  );
}
