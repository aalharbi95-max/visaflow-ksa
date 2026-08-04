const NATIONALITY_ALIASES = new Map([
  ["india", "Indian"], ["indian", "Indian"], ["الهند", "Indian"],
  ["هندي", "Indian"], ["هندية", "Indian"],
  ["saudi arabia", "Saudi"], ["saudi", "Saudi"],
  ["المملكة العربية السعودية", "Saudi"], ["السعودية", "Saudi"],
  ["سعودي", "Saudi"], ["سعودية", "Saudi"],
]);

export function normalizeNationalityKey(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en")
    .replace(/[()\[\],._/-]+/g, " ").replace(/\s+/g, " ");
}

function countryValues(country) {
  return [country?.nationality, country?.nationality_ar, country?.name,
    country?.name_ar, country?.iso_code].filter(Boolean);
}

export function getCanonicalNationality(country) {
  const preferred = String(country?.nationality || "").trim();
  if (preferred) return NATIONALITY_ALIASES.get(normalizeNationalityKey(preferred)) || preferred;
  const countryName = String(country?.name || "").trim();
  return NATIONALITY_ALIASES.get(normalizeNationalityKey(countryName)) || countryName;
}

export function resolveCanonicalNationality(value, countries = []) {
  const key = normalizeNationalityKey(value);
  if (!key) return "";
  if (NATIONALITY_ALIASES.has(key)) return NATIONALITY_ALIASES.get(key);
  const exact = countries.find((country) => countryValues(country)
    .some((candidate) => normalizeNationalityKey(candidate) === key));
  if (exact) return getCanonicalNationality(exact);
  const canonicalMatches = new Set(countries.flatMap((country) => {
    const containsKnownValue = countryValues(country).some((candidate) => {
      const candidateKey = normalizeNationalityKey(candidate);
      return candidateKey && key.includes(candidateKey);
    });
    return containsKnownValue ? [getCanonicalNationality(country)] : [];
  }).filter(Boolean));
  return canonicalMatches.size === 1 ? Array.from(canonicalMatches)[0] : "";
}

export function buildNationalityOptions(countries = []) {
  const seen = new Set();
  return countries.flatMap((country) => {
    const value = getCanonicalNationality(country);
    const key = normalizeNationalityKey(value);
    if (!key || seen.has(key) || country?.active === false) return [];
    seen.add(key);
    const label = [country?.nationality_ar, country?.nationality,
      country?.name_ar, country?.name]
      .map((item) => String(item || "").trim()).filter(Boolean);
    return [{ value, label: Array.from(new Set(label)).join(" — ") || value }];
  });
}

export function getNationalityMatchKeys(value, countries = []) {
  const canonical = resolveCanonicalNationality(value, countries) || String(value || "").trim();
  const matched = countries.find((country) => getCanonicalNationality(country) === canonical);
  const values = matched ? [canonical, ...countryValues(matched)] : [canonical];
  return Array.from(new Set(values.map(normalizeNationalityKey).filter(Boolean)));
}

export function nationalitiesMatch(left, right, countries = []) {
  const leftKeys = new Set(getNationalityMatchKeys(left, countries));
  const rightKeys = getNationalityMatchKeys(right, countries);
  if (!leftKeys.size || !rightKeys.length) return false;
  return rightKeys.some((key) => leftKeys.has(key));
}
