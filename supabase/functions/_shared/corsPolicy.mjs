function normalizeOrigin(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function parseAllowedOrigins(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(normalizeOrigin)
      .filter(Boolean)
  );
}

export function resolveAllowedOrigin(origin, allowedOrigins) {
  const normalized = normalizeOrigin(origin);
  return normalized && allowedOrigins.has(normalized) ? normalized : "";
}

export function buildCorsHeaders(origin, allowedOrigins) {
  const allowedOrigin = resolveAllowedOrigin(origin, allowedOrigins);
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
