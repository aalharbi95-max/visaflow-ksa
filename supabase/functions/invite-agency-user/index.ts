import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyAgencyInvitation } from "../_shared/agencyInvitationPolicy.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VISAFLOW_ORIGIN = "https://visaflowksa.com";
const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 8;
const rateBuckets = new Map<string, number[]>();

class RequestFailure extends Error {
  status: number;
  publicCode: string;

  constructor(status: number, publicCode: string) {
    super(publicCode);
    this.status = status;
    this.publicCode = publicCode;
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function requireSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function getBearerToken(req: Request) {
  return (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeText(value: unknown, field: string, maxLength: number) {
  const cleaned = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!cleaned || cleaned.length > maxLength) throw new RequestFailure(400, `invalid_${field}`);
  return cleaned;
}

function safeId(value: unknown, field: string) {
  const id = String(value || "").trim();
  if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new RequestFailure(400, `invalid_${field}`);
  }
  return id;
}

function enforceRateLimit(key: string) {
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) throw new RequestFailure(429, "rate_limited");
  recent.push(now);
  rateBuckets.set(key, recent);
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildInviteRedirectUrl(token: string) {
  const url = new URL("/", VISAFLOW_ORIGIN);
  url.searchParams.set("agency_invite", token);
  return url.toString();
}

async function findAuthUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const matched = users.find((user: any) => normalizeEmail(user.email) === email);
    if (matched) return matched;
    if (users.length < 1000) return null;
  }
  throw new RequestFailure(503, "auth_directory_limit");
}

async function getAuthenticatedAdmin(req: Request, admin: any) {
  const jwt = getBearerToken(req);
  if (!jwt) throw new RequestFailure(401, "unauthorized");

  const { data: authData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authData?.user?.id) throw new RequestFailure(401, "unauthorized");

  const { data: rows, error } = await admin
    .from("users")
    .select("id, auth_user_id, role, status, is_active, company_id")
    .eq("auth_user_id", authData.user.id)
    .limit(2);
  if (error || (rows || []).length !== 1) throw new RequestFailure(403, "forbidden");

  const actor = rows[0];
  if (
    !["Admin", "Company Admin"].includes(String(actor.role || "")) ||
    actor.status !== "Active" ||
    actor.is_active !== true ||
    !actor.company_id
  ) {
    throw new RequestFailure(403, "forbidden");
  }

  const { data: company } = await admin
    .from("companies")
    .select("id")
    .eq("id", actor.company_id)
    .eq("status", "Active")
    .maybeSingle();
  if (!company) throw new RequestFailure(403, "forbidden");

  return { id: String(actor.id), companyId: String(actor.company_id) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) throw new RequestFailure(413, "request_too_large");

    const supabaseUrl = requireSecret("SUPABASE_URL");
    const serviceRoleKey = requireSecret("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const actor = await getAuthenticatedAdmin(req, admin);
    enforceRateLimit(`actor:${actor.id}`);

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      throw new RequestFailure(413, "request_too_large");
    }
    const body = JSON.parse(rawBody || "{}");
    const allowedFields = new Set(["agency_id", "name", "email"]);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestFailure(400, "invalid_request");
    for (const key of Object.keys(body)) {
      if (!allowedFields.has(key)) throw new RequestFailure(400, "unsupported_field");
    }

    const agencyId = safeId(body.agency_id, "agency_id");
    const name = safeText(body.name, "name", 160);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) throw new RequestFailure(400, "invalid_email");

    const { data: agency } = await admin
      .from("agencies")
      .select("id, name, status")
      .eq("id", agencyId)
      .eq("status", "Active")
      .maybeSingle();
    if (!agency) throw new RequestFailure(404, "agency_not_found");

    const { data: companyAgency } = await admin
      .from("company_agency_access")
      .select("company_id, agency_id, status")
      .eq("company_id", actor.companyId)
      .eq("agency_id", agencyId)
      .eq("status", "Active")
      .maybeSingle();
    if (!companyAgency) throw new RequestFailure(403, "agency_not_linked_to_company");

    const emailPattern = email.replaceAll("%", "\\%").replaceAll("_", "\\_");
    const { data: appUsers, error: appUserError } = await admin
      .from("users")
      .select("id, auth_user_id, email, role, status, is_active, agency_id, agency_name")
      .ilike("email", emailPattern)
      .limit(2);
    if (appUserError) throw appUserError;
    if ((appUsers || []).length > 1) throw new RequestFailure(409, "duplicate_app_user");

    const existingAppUser = appUsers?.[0] || null;
    const existingAuthUser = await findAuthUserByEmail(admin, email);
    const policy = classifyAgencyInvitation({
      appUser: existingAppUser,
      authUser: existingAuthUser,
      agencyId,
    });
    if (!policy.allowed) throw new RequestFailure(409, policy.error);

    let authUser = existingAuthUser;
    let createdAuthUserId = "";
    let invitationToken = "";
    let invitationTokenHash = "";
    if (!authUser) {
      invitationToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
      invitationTokenHash = await sha256Hex(invitationToken);
      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: buildInviteRedirectUrl(invitationToken),
        data: { account_type: "agency", full_name: name, agency_id: agencyId },
      });
      if (inviteError || !inviteData?.user?.id) {
        console.error("Agency invitation send failed", inviteError?.message || "missing invited user");
        throw new RequestFailure(502, "invite_failed");
      }
      authUser = inviteData.user;
      createdAuthUserId = String(authUser.id);
    }

    try {
      let existingAccess = null;
      if (existingAppUser?.id) {
        const { data, error } = await admin
          .from("agency_company_user_access")
          .select("user_id")
          .eq("company_id", actor.companyId)
          .eq("agency_id", agencyId)
          .eq("user_id", existingAppUser.id)
          .eq("status", "Active")
          .maybeSingle();
        if (error) throw error;
        existingAccess = data;
      }

      const { data: linkedUser, error: linkError } = await admin.rpc("link_agency_invited_user", {
        p_auth_user_id: authUser.id,
        p_email: email,
        p_name: name,
        p_agency_id: agencyId,
        p_company_id: actor.companyId,
        p_invitation_token_hash: invitationTokenHash || null,
      });
      if (linkError || !linkedUser?.user_id) throw linkError || new Error("missing_linked_user");

      const mode = createdAuthUserId ? "invited" : existingAccess ? "already_linked" : "linked_existing";
      return jsonResponse({ ok: true, mode, agency_id: agencyId });
    } catch (error) {
      if (createdAuthUserId) {
        const { error: rollbackError } = await admin.auth.admin.deleteUser(createdAuthUserId);
        if (rollbackError) console.error("Unable to roll back incomplete agency invitation", rollbackError.message);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof SyntaxError) return jsonResponse({ error: "invalid_json" }, 400);
    if (error instanceof RequestFailure) return jsonResponse({ error: error.publicCode }, error.status);
    console.error("Unexpected agency invitation failure", error instanceof Error ? error.message : error);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
