const URL_SCHEME_PATTERN = /(?:https?:\/\/|javascript\s*:|data\s*:|file\s*:)/i;

export function validateSupabaseInvitationUrl(rawValue, supabaseUrl, maxLength = 2048) {
  const value = String(rawValue ?? "").trim();
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, error: "INVALID_ACTION_URL" };
  }
  try {
    const candidate = new URL(value);
    const expected = new URL(String(supabaseUrl || ""));
    if (candidate.protocol !== "https:" || expected.protocol !== "https:") return { ok: false, error: "INVALID_ACTION_URL" };
    if (candidate.username || candidate.password) return { ok: false, error: "INVALID_ACTION_URL" };
    if (candidate.hostname !== expected.hostname || candidate.port !== expected.port) return { ok: false, error: "INVALID_ACTION_URL" };
    if (candidate.pathname !== "/auth/v1/verify") return { ok: false, error: "INVALID_ACTION_URL" };
    return { ok: true, value: candidate.toString() };
  } catch (_) {
    return { ok: false, error: "INVALID_ACTION_URL" };
  }
}

export function cleanContractInputVariables({ messageType, value, allowedKeys, supabaseUrl, maxVariableLength = 500, maxTotal = 3000 }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: true, variables: {} };
  const variables = {};
  let total = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (!allowedKeys.includes(key)) return { ok: false, error: "UNSUPPORTED_TEMPLATE_VARIABLE" };
    const text = Array.isArray(raw) ? raw.slice(0, 20).join(", ") : String(raw ?? "");
    let cleaned;
    if (messageType === "AGENCY_USER_INVITATION" && key === "action_url") {
      const validated = validateSupabaseInvitationUrl(text, supabaseUrl);
      if (!validated.ok) return validated;
      cleaned = validated.value;
    } else {
      if (URL_SCHEME_PATTERN.test(text)) return { ok: false, error: "EXTERNAL_URL_NOT_ALLOWED" };
      cleaned = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxVariableLength);
    }
    total += cleaned.length;
    if (total > maxTotal) return { ok: false, error: "INVALID_VARIABLES" };
    variables[key] = cleaned;
  }
  return { ok: true, variables };
}
