export const AGENCY_PROVISIONER_MAX_BODY_BYTES = 16 * 1024;

export function parseAllowedOrigins(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
}

export function resolveAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return "";
  try {
    const normalized = new URL(origin).origin;
    return allowedOrigins.has(normalized) ? normalized : "";
  } catch {
    return "";
  }
}

export function isAllowedInviteRedirect(value, allowedOrigins) {
  try {
    const redirect = new URL(value);
    return (
      redirect.protocol === "https:" &&
      allowedOrigins.has(redirect.origin)
    );
  } catch {
    return false;
  }
}

export function buildAgencyProvisionerCorsHeaders(origin, allowedOrigins) {
  const resolved = resolveAllowedOrigin(origin, allowedOrigins);
  return {
    ...(resolved ? { "Access-Control-Allow-Origin": resolved } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function validateAgencyProvisionerRequest({
  method,
  origin,
  contentLength = 0,
  bodyBytes = 0,
  allowedOrigins,
}) {
  const resolvedOrigin = resolveAllowedOrigin(origin, allowedOrigins);
  if (origin && !resolvedOrigin) {
    return { ok: false, status: 403, code: "ORIGIN_NOT_ALLOWED" };
  }
  if (method === "OPTIONS" && !resolvedOrigin) {
    return { ok: false, status: 403, code: "ORIGIN_NOT_ALLOWED" };
  }
  if (method !== "POST" && method !== "OPTIONS") {
    return { ok: false, status: 405, code: "METHOD_NOT_ALLOWED" };
  }
  if (
    Number(contentLength || 0) > AGENCY_PROVISIONER_MAX_BODY_BYTES ||
    Number(bodyBytes || 0) > AGENCY_PROVISIONER_MAX_BODY_BYTES
  ) {
    return { ok: false, status: 413, code: "REQUEST_TOO_LARGE" };
  }
  return { ok: true, status: method === "OPTIONS" ? 204 : 200 };
}
