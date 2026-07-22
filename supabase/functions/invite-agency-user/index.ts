import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyAgencyInvitation,
  getAgencyInvitationAction,
} from "../_shared/agencyInvitationPolicy.mjs";

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

function safeProviderError(error: any) {
  const code = String(error?.code || "provider_error").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  return status ? { code, status } : { code };
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

function buildInviteRedirectUrl(invitationId: string) {
  const url = new URL("/", VISAFLOW_ORIGIN);
  // This is a non-secret routing marker. Invitation authorization is derived
  // only from the Supabase Auth session and auth.uid() on the server.
  url.searchParams.set("agency_activation", invitationId);
  return url.toString();
}

async function lookupAuthUserByEmail(admin: any, email: string) {
  const { data: identity, error: lookupError } = await admin.rpc("lookup_auth_identity_by_email", {
    p_email: email,
  });
  if (lookupError) throw lookupError;
  if (identity?.ambiguous) throw new RequestFailure(409, "identity_review_required");
  if (!identity?.id) return null;

  const { data, error } = await admin.auth.admin.getUserById(identity.id);
  const authUser = data?.user || null;
  if (error || !authUser?.id || normalizeEmail(authUser.email) !== email) {
    throw new RequestFailure(409, "identity_review_required");
  }
  return authUser;
}

async function getPendingInvitation(admin: any, authUserId: string) {
  const { data, error } = await admin
    .from("agency_user_invitations")
    .select("id, auth_user_id, expires_at, consumed_at, invalidated_at")
    .eq("auth_user_id", authUserId)
    .is("consumed_at", null)
    .is("invalidated_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
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
    const preliminaryPolicy = classifyAgencyInvitation({
      appUser: existingAppUser,
      authUser: null,
      agencyId,
    });
    if (
      !preliminaryPolicy.allowed &&
      ["incompatible_role", "inactive_agency_user", "agency_mismatch"].includes(preliminaryPolicy.error)
    ) {
      throw new RequestFailure(409, preliminaryPolicy.error);
    }

    const existingAuthUser = await lookupAuthUserByEmail(admin, email);
    const pendingInvitation = existingAuthUser
      ? await getPendingInvitation(admin, String(existingAuthUser.id))
      : null;
    const policy = getAgencyInvitationAction({
      appUser: existingAppUser,
      authUser: existingAuthUser,
      agencyId,
      pendingInvitation,
    });
    if (!policy.allowed) {
      const publicCode = [
        "unlinked_auth_account",
        "trusted_auth_migration_required",
        "auth_identity_mismatch",
      ].includes(policy.error)
        ? "identity_review_required"
        : policy.error;
      throw new RequestFailure(409, publicCode);
    }

    let authUser = existingAuthUser;
    let createdAuthUserId = "";
    const invitationId = ["invite_new", "resend"].includes(policy.action)
      ? crypto.randomUUID()
      : null;
    if (policy.action === "invite_new") {
      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: buildInviteRedirectUrl(invitationId!),
        data: { account_type: "agency", full_name: name, agency_id: agencyId },
      });
      if (inviteError || !inviteData?.user?.id) {
        const racedAuthUser = await lookupAuthUserByEmail(admin, email).catch(() => null);
        if (racedAuthUser) throw new RequestFailure(409, "invitation_in_progress");
        console.error("Agency invitation send failed", safeProviderError(inviteError));
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
        p_invitation_id: invitationId,
        p_delivery_kind: policy.action === "resend" ? "resend" : policy.action === "invite_new" ? "invite" : null,
      });
      if (linkError || !linkedUser?.user_id) throw linkError || new Error("missing_linked_user");

      if (policy.action === "resend") {
        const { error: resendError } = await admin.auth.resetPasswordForEmail(email, {
          redirectTo: buildInviteRedirectUrl(invitationId!),
        });
        if (resendError) {
          console.error("Agency invitation resend failed", safeProviderError(resendError));
          throw new RequestFailure(502, "resend_failed");
        }
      }

      const mode = createdAuthUserId
        ? "invited"
        : policy.action === "resend"
          ? "resent"
          : existingAccess
            ? "already_linked"
            : "linked_existing";
      return jsonResponse({ ok: true, mode, agency_id: agencyId });
    } catch (error) {
      if (createdAuthUserId) {
        const { error: rollbackError } = await admin.auth.admin.deleteUser(createdAuthUserId);
        if (rollbackError) {
          console.error("Unable to roll back incomplete agency invitation", safeProviderError(rollbackError));
        }
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof SyntaxError) return jsonResponse({ error: "invalid_json" }, 400);
    if (error instanceof RequestFailure) return jsonResponse({ error: error.publicCode }, error.status);
    console.error("Unexpected agency invitation failure", {
      kind: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
