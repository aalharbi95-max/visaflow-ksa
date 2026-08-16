import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_BODY_BYTES = 16 * 1024;

function parseAllowedOrigins(value: string) {
  return new Set(String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    try { return new URL(entry).origin; } catch { return ""; }
  }).filter(Boolean));
}

function resolveAllowedOrigin(origin: string | null, allowedOrigins: Set<string>) {
  if (!origin) return "";
  try {
    const normalized = new URL(origin).origin;
    return allowedOrigins.has(normalized) ? normalized : "";
  } catch { return ""; }
}

function corsHeaders(origin: string | null, allowedOrigins: Set<string>) {
  const resolved = resolveAllowedOrigin(origin, allowedOrigins);
  return {
    ...(resolved ? { "Access-Control-Allow-Origin": resolved } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED_ORIGINS = new Set([
  ...parseAllowedOrigins(Deno.env.get("AGENCY_PROVISIONER_ALLOWED_ORIGINS") || ""),
  "https://visaflowksa.com",
  "https://www.visaflowksa.com",
  "https://visaflow-ksa-staging.vercel.app",
  "https://visaflow-ksa-gc5t.vercel.app",
]);
const ADMIN_ROLES = new Set(["Admin", "Company Admin"]);
const PLATFORM_OWNER_ROLE = "Platform Owner";
const PLATFORM_ROLES = new Set([
  "Platform Owner", "Platform Accounts User", "Platform Support User", "Platform Marketing User",
]);
const ALLOWED_ROLES = new Set([
  "Admin", "CEO", "Operations Manager", "Project Manager", "Recruitment Director",
  "Recruitment Manager", "Recruitment Officer", "Visa Team", "Viewer",
]);

class RequestError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function respond(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin, ALLOWED_ORIGINS), "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function cleanEmail(value: unknown) {
  const normalized = cleanText(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new RequestError("COMPANY_USER_INVALID_EMAIL");
  return normalized;
}

function cleanRole(value: unknown) {
  const normalized = cleanText(value, 80);
  if (!ALLOWED_ROLES.has(normalized)) throw new RequestError("COMPANY_USER_INVALID_ROLE");
  return normalized;
}

function cleanPlatformRole(value: unknown) {
  const normalized = cleanText(value, 80);
  if (!PLATFORM_ROLES.has(normalized)) throw new RequestError("PLATFORM_USER_INVALID_ROLE");
  return normalized;
}

async function exactlyOne(query: any, code: string) {
  const { data, error } = await query.limit(2);
  if (error) throw error;
  if ((data || []).length !== 1) throw new RequestError(code, 404);
  return data[0];
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !resolveAllowedOrigin(origin, ALLOWED_ORIGINS)) return respond(origin, 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  if (request.method !== "POST" && request.method !== "OPTIONS") return respond(origin, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return respond(origin, 413, { ok: false, code: "REQUEST_TOO_LARGE" });
  if (request.method === "OPTIONS") return respond(origin, 204, null);
  if (!resolveAllowedOrigin(origin, ALLOWED_ORIGINS)) return respond(origin, 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) return respond(origin, 503, { ok: false, code: "FUNCTION_NOT_CONFIGURED" });

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new RequestError("REQUEST_TOO_LARGE", 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw || "{}"); } catch { throw new RequestError("INVALID_REQUEST"); }

    const authorization = request.headers.get("authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
    if (!token) throw new RequestError("COMPANY_USER_UNAUTHORIZED", 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user?.id) throw new RequestError("COMPANY_USER_UNAUTHORIZED", 401);
    const actor = await exactlyOne(admin.from("users").select("id,auth_user_id,company_id,role,status,is_active").eq("auth_user_id", authData.user.id), "COMPANY_USER_UNAUTHORIZED");
    const action = cleanText(body.action, 40);
    const isPlatformOwner = actor.company_id == null && actor.role === PLATFORM_OWNER_ROLE && actor.status === "Active" && actor.is_active === true;

    if (["invite_platform_user", "update_platform_user", "deactivate_platform_user"].includes(action)) {
      if (!isPlatformOwner) throw new RequestError("PLATFORM_USER_FORBIDDEN", 403);
      if (action === "invite_platform_user") {
        const userName = cleanText(body.name);
        const userEmail = cleanEmail(body.email);
        const userRole = cleanPlatformRole(body.role);
        if (!userName) throw new RequestError("COMPANY_USER_NAME_REQUIRED");
        const { data: existingRows, error: existingError } = await admin.from("users").select("id").ilike("email", userEmail).limit(2);
        if (existingError) throw existingError;
        if ((existingRows || []).length) throw new RequestError("COMPANY_USER_EMAIL_ALREADY_ASSIGNED", 409);
        const { data: createdAuth, error: createAuthError } = await admin.auth.admin.createUser({
          email: userEmail,
          email_confirm: true,
          user_metadata: { account_type: "platform", role: userRole },
        });
        if (createAuthError || !createdAuth.user?.id) {
          const detail = String(createAuthError?.message || "").toLowerCase();
          throw new RequestError(detail.includes("already") ? "COMPANY_USER_EMAIL_ALREADY_ASSIGNED" : "COMPANY_USER_AUTH_CREATE_FAILED", detail.includes("already") ? 409 : 502);
        }
        const authUserId = createdAuth.user.id;
        const { data: createdUser, error: insertError } = await admin.from("users").insert({
          auth_user_id: authUserId, company_id: null, agency_id: null, agency_name: null,
          name: userName, email: userEmail, role: userRole, status: "Active", is_active: true, password: null,
        }).select("id,name,email,role,status,company_id,auth_user_id,created_at").single();
        if (insertError) {
          await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
          throw insertError;
        }
        return respond(origin, 200, { ok: true, action, user: createdUser });
      }

      const targetId = cleanText(body.user_id, 128);
      const target = await exactlyOne(admin.from("users").select("id,auth_user_id,email,role,status,is_active,company_id").eq("id", targetId).is("company_id", null), "COMPANY_USER_NOT_FOUND");
      if (!PLATFORM_ROLES.has(target.role)) throw new RequestError("PLATFORM_USER_FORBIDDEN", 403);
      const nextStatus = action === "deactivate_platform_user" ? "Inactive" : cleanText(body.status, 20);
      const nextRole = action === "deactivate_platform_user" ? target.role : cleanPlatformRole(body.role);
      if (!["Active", "Inactive"].includes(nextStatus)) throw new RequestError("COMPANY_USER_INVALID_STATUS");
      if (String(target.id) === String(actor.id) && (nextStatus !== "Active" || nextRole !== PLATFORM_OWNER_ROLE)) throw new RequestError("COMPANY_USER_SELF_DEACTIVATION", 409);
      if (target.role === PLATFORM_OWNER_ROLE && (nextStatus !== "Active" || nextRole !== PLATFORM_OWNER_ROLE)) {
        const { count, error } = await admin.from("users").select("id", { count: "exact", head: true }).is("company_id", null).eq("role", PLATFORM_OWNER_ROLE).eq("status", "Active").eq("is_active", true);
        if (error) throw error;
        if (Number(count || 0) <= 1) throw new RequestError("PLATFORM_USER_LAST_OWNER", 409);
      }
      const updates: Record<string, unknown> = { role: nextRole, status: nextStatus, is_active: nextStatus === "Active" };
      if (action === "update_platform_user") {
        const requestedEmail = cleanEmail(body.email);
        if (requestedEmail !== String(target.email || "").toLowerCase()) throw new RequestError("COMPANY_USER_EMAIL_IMMUTABLE", 409);
        const userName = cleanText(body.name);
        if (!userName) throw new RequestError("COMPANY_USER_NAME_REQUIRED");
        updates.name = userName;
      }
      if (target.auth_user_id && nextStatus !== target.status) {
        const { error: authStatusError } = await admin.auth.admin.updateUserById(target.auth_user_id, { ban_duration: nextStatus === "Active" ? "none" : "876000h" });
        if (authStatusError) throw new RequestError("COMPANY_USER_AUTH_STATUS_FAILED", 502);
      }
      const { data: updated, error } = await admin.from("users").update(updates).eq("id", target.id).select("id,name,email,role,status,company_id,auth_user_id,created_at").single();
      if (error) throw error;
      return respond(origin, 200, { ok: true, action, user: updated });
    }

    if (!actor.company_id || actor.status !== "Active" || actor.is_active !== true || !ADMIN_ROLES.has(actor.role)) throw new RequestError("COMPANY_USER_FORBIDDEN", 403);
    const company = await exactlyOne(admin.from("companies").select("id,status,max_users").eq("id", actor.company_id).eq("status", "Active"), "COMPANY_USER_COMPANY_NOT_FOUND");
    if (action === "invite_user") {
      const userName = cleanText(body.name);
      const userEmail = cleanEmail(body.email);
      const userRole = cleanRole(body.role);
      if (!userName) throw new RequestError("COMPANY_USER_NAME_REQUIRED");
      const { count, error: countError } = await admin.from("users").select("id", { count: "exact", head: true }).eq("company_id", actor.company_id).eq("is_active", true);
      if (countError) throw countError;
      const maxUsers = Number(company.max_users || 0);
      if (maxUsers > 0 && Number(count || 0) >= maxUsers) throw new RequestError("COMPANY_USER_LIMIT_REACHED", 409);
      const { data: existingRows, error: existingError } = await admin.from("users").select("id,company_id,auth_user_id").ilike("email", userEmail).limit(2);
      if (existingError) throw existingError;
      if ((existingRows || []).length) throw new RequestError("COMPANY_USER_EMAIL_ALREADY_ASSIGNED", 409);
      const { data: createdAuth, error: createAuthError } = await admin.auth.admin.createUser({ email: userEmail, email_confirm: true, user_metadata: { account_type: "workspace", company_id: actor.company_id, role: userRole } });
      if (createAuthError || !createdAuth.user?.id) {
        const detail = String(createAuthError?.message || "").toLowerCase();
        throw new RequestError(detail.includes("already") ? "COMPANY_USER_EMAIL_ALREADY_ASSIGNED" : "COMPANY_USER_AUTH_CREATE_FAILED", detail.includes("already") ? 409 : 502);
      }
      const authUserId = createdAuth.user.id;
      const { data: createdUser, error: insertError } = await admin.from("users").insert({ auth_user_id: authUserId, company_id: actor.company_id, agency_id: null, agency_name: null, name: userName, email: userEmail, role: userRole, status: "Active", is_active: true, password: null }).select("id,name,email,role,status,company_id,auth_user_id,created_at").single();
      if (insertError) {
        await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
        throw insertError;
      }
      return respond(origin, 200, { ok: true, action, user: createdUser });
    }

    if (action === "update_user" || action === "deactivate_user") {
      const targetId = cleanText(body.user_id, 128);
      if (!targetId) throw new RequestError("COMPANY_USER_NOT_FOUND", 404);
      const target = await exactlyOne(admin.from("users").select("id,auth_user_id,company_id,email,role,status,is_active").eq("id", targetId).eq("company_id", actor.company_id), "COMPANY_USER_NOT_FOUND");
      const nextStatus = action === "deactivate_user" ? "Inactive" : cleanText(body.status, 20);
      const nextRole = action === "deactivate_user" ? target.role : cleanRole(body.role);
      if (!["Active", "Inactive"].includes(nextStatus)) throw new RequestError("COMPANY_USER_INVALID_STATUS");
      if (String(target.id) === String(actor.id) && nextStatus !== "Active") throw new RequestError("COMPANY_USER_SELF_DEACTIVATION", 409);
      if (target.role === "Admin" && (nextStatus !== "Active" || nextRole !== "Admin")) {
        const { count, error } = await admin.from("users").select("id", { count: "exact", head: true }).eq("company_id", actor.company_id).eq("role", "Admin").eq("status", "Active").eq("is_active", true);
        if (error) throw error;
        if (Number(count || 0) <= 1) throw new RequestError("COMPANY_USER_LAST_ADMIN", 409);
      }
      const updates: Record<string, unknown> = { role: nextRole, status: nextStatus, is_active: nextStatus === "Active" };
      if (action === "update_user") {
        const requestedEmail = cleanEmail(body.email);
        if (requestedEmail !== String(target.email || "").toLowerCase()) throw new RequestError("COMPANY_USER_EMAIL_IMMUTABLE", 409);
        const userName = cleanText(body.name);
        if (!userName) throw new RequestError("COMPANY_USER_NAME_REQUIRED");
        updates.name = userName;
      }
      if (target.auth_user_id && nextStatus !== target.status) {
        const { error: authStatusError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
          ban_duration: nextStatus === "Active" ? "none" : "876000h",
        });
        if (authStatusError) throw new RequestError("COMPANY_USER_AUTH_STATUS_FAILED", 502);
      }
      const { data: updated, error } = await admin.from("users").update(updates).eq("id", target.id).eq("company_id", actor.company_id).select("id,name,email,role,status,company_id,auth_user_id,created_at").single();
      if (error) throw error;
      return respond(origin, 200, { ok: true, action, user: updated });
    }
    throw new RequestError("COMPANY_USER_INVALID_ACTION");
  } catch (error) {
    const caught = error as any;
    const code = error instanceof RequestError ? error.code : "COMPANY_USER_ACTION_FAILED";
    const status = error instanceof RequestError ? error.status : 500;
    console.error("Company user management failed", { code, name: caught?.name || "Error" });
    return respond(origin, status, { ok: false, code });
  }
});
