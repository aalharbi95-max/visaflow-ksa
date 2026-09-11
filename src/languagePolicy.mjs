// Arabic localization is temporarily disabled pending translation and UX review.
export const TEMPORARY_ENGLISH_ONLY = true;

export const DEFAULT_UI_LANGUAGE = "EN";

const LANGUAGE_STORAGE_KEYS = [
  "language",
  "lang",
  "visaflow-language",
  "visaflow_language",
  "visaflow-ui-language",
];

function getStoredLanguage(storage) {
  for (const key of LANGUAGE_STORAGE_KEYS) {
    const value = storage?.getItem?.(key);
    if (value) return value;
  }
  return "";
}

function getQueryLanguage(locationLike) {
  try {
    return new URLSearchParams(locationLike?.search || "").get("language") || "";
  } catch {
    return "";
  }
}

function normalizeLanguage(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["AR", "ARABIC"].includes(normalized) ? "AR" : "EN";
}

export function resolveUiLanguage({
  preferredLanguage,
  localStorage,
  sessionStorage,
  locationLike,
} = {}) {
  if (TEMPORARY_ENGLISH_ONLY) return DEFAULT_UI_LANGUAGE;

  return normalizeLanguage(
    preferredLanguage ||
      getQueryLanguage(locationLike) ||
      getStoredLanguage(sessionStorage) ||
      getStoredLanguage(localStorage)
  );
}

export function getUiDirection(language = DEFAULT_UI_LANGUAGE) {
  if (TEMPORARY_ENGLISH_ONLY) return "ltr";
  return normalizeLanguage(language) === "AR" ? "rtl" : "ltr";
}

export function shouldShowLanguageToggle() {
  return !TEMPORARY_ENGLISH_ONLY;
}
