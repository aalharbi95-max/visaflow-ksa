import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAX_BODY_BYTES = 12 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://visaflowksa.com",
  "https://www.visaflowksa.com",
  "https://visaflow-ksa-staging.vercel.app",
  "https://visaflow-ksa-gc5t.vercel.app",
  "http://localhost:5173",
]);

class SalesError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function clean(value: unknown, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function allowedOrigin(origin: string | null) {
  if (!origin) return false;
  try { return ALLOWED_ORIGINS.has(new URL(origin).origin); } catch { return false; }
}

function headers(origin: string | null) {
  return {
    ...(allowedOrigin(origin) ? { "Access-Control-Allow-Origin": new URL(origin!).origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function respond(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: headers(origin) });
}

function workspaceRecoveryUrl() {
  const url = new URL("https://www.visaflowksa.com/");
  url.searchParams.set("login", "1");
  url.searchParams.set("auth_flow", "workspace");
  url.searchParams.set("recovery", "1");
  return url.toString();
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return allowedOrigin(origin) ? respond(origin, 204, null) : respond(origin, 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  if (request.method !== "POST") return respond(origin, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  if (!allowedOrigin(origin)) return respond(origin, 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return respond(origin, 503, { ok: false, code: "FUNCTION_NOT_CONFIGURED" });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return respond(origin, 413, { ok: false, code: "REQUEST_TOO_LARGE" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let createdCompanyId = "";
  let createdClientId = "";
  let createdAuthUserId = "";
  let createdAppUserId = "";

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new SalesError("REQUEST_TOO_LARGE", 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw || "{}"); } catch { throw new SalesError("INVALID_REQUEST"); }

    const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
    if (!token) throw new SalesError("UNAUTHORIZED", 401);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user?.id) throw new SalesError("UNAUTHORIZED", 401);
    const { data: actor, error: actorError } = await admin.from("users")
      .select("id,role,status,is_active,company_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (actorError || !actor || actor.role !== "Platform Owner" || actor.company_id != null || actor.status !== "Active" || actor.is_active !== true) {
      throw new SalesError("PLATFORM_OWNER_REQUIRED", 403);
    }

    const action = clean(body.action, 24);
    const requestId = clean(body.request_id, 64);
    if (!requestId) throw new SalesError("REQUEST_ID_REQUIRED");
    const { data: lead, error: leadError } = await admin.from("marketing_company_requests")
      .select("*").eq("id", requestId).eq("status", "Pending").maybeSingle();
    if (leadError) throw leadError;
    if (!lead) throw new SalesError("REQUEST_NOT_PENDING", 409);

    if (action === "reject") {
      const { error } = await admin.from("marketing_company_requests").update({
        status: "Rejected", commission_rate: null, platform_client_id: null,
        reviewed_by: actor.id, reviewed_at: new Date().toISOString(),
        review_notes: clean(body.notes, 1000) || null, updated_at: new Date().toISOString(),
      }).eq("id", requestId).eq("status", "Pending");
      if (error) throw error;
      return respond(origin, 200, { ok: true, action, status: "Rejected" });
    }
    if (action !== "approve") throw new SalesError("INVALID_ACTION");

    const commissionRate = Number(body.commission_rate);
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) throw new SalesError("COMMISSION_RATE_REQUIRED");
    const companyName = clean(lead.company_name);
    const adminName = clean(lead.contact_name) || "Company Administrator";
    const adminEmail = clean(lead.contact_email, 254).toLowerCase();
    if (!companyName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new SalesError("INVALID_COMPANY_CONTACT");

    let platformClient: any = null;
    const requestedClientId = clean(body.platform_client_id, 64);
    if (requestedClientId) {
      const { data, error } = await admin.from("platform_clients").select("id,operational_company_id,company_name").eq("id", requestedClientId).maybeSingle();
      if (error) throw error;
      if (!data) throw new SalesError("PLATFORM_CLIENT_NOT_FOUND", 404);
      platformClient = data;
    }

    const { data: emailUser, error: emailUserError } = await admin.from("users")
      .select("id,company_id,role,email").ilike("email", adminEmail).maybeSingle();
    if (emailUserError) throw emailUserError;
    if (!platformClient && emailUser?.company_id) {
      const { data, error } = await admin.from("platform_clients")
        .select("id,operational_company_id,company_name").eq("operational_company_id", emailUser.company_id).maybeSingle();
      if (error) throw error;
      platformClient = data;
    }
    if (!platformClient) {
      const { data, error } = await admin.from("platform_clients")
        .select("id,operational_company_id,company_name").ilike("company_name", companyName).limit(2);
      if (error) throw error;
      if ((data || []).length > 1) throw new SalesError("DUPLICATE_COMPANY_MATCH", 409);
      platformClient = data?.[0] || null;
    }

    let accountCreated = false;
    let setupEmailSent = false;
    if (!platformClient) {
      if (emailUser) throw new SalesError("EMAIL_ALREADY_REGISTERED", 409);
      const domain = adminEmail.split("@")[1] || null;
      const months = Math.max(1, Math.min(60, Number(lead.billing_cycle_months || 1)));
      const subscriptionEnd = new Date();
      subscriptionEnd.setUTCMonth(subscriptionEnd.getUTCMonth() + months);
      const { data: company, error: companyError } = await admin.from("companies").insert({
        name: companyName, domain, status: "Active", subscription_plan: clean(lead.requested_product) || "Recruitment",
        subscription_status: "Active", subscription_start: isoDate(), subscription_end: isoDate(subscriptionEnd),
        max_users: 5, notes: `Created after Platform Owner approval of marketing request ${requestId}`,
      }).select("id").single();
      if (companyError) throw companyError;
      createdCompanyId = company.id;

      const quote = Math.max(0, Number(lead.quoted_amount || 0));
      const { data: client, error: clientError } = await admin.from("platform_clients").insert({
        company_name: companyName, domain, subscription_status: "Active", users_count: 1,
        start_date: isoDate(), end_date: isoDate(subscriptionEnd), monthly_amount: quote / months,
        operational_company_id: createdCompanyId, product_access_mode: "Recruitment Only", recruitment_access_enabled: true,
      }).select("id,operational_company_id,company_name").single();
      if (clientError) throw clientError;
      platformClient = client;
      createdClientId = client.id;

      const { data: authCreated, error: authCreateError } = await admin.auth.admin.createUser({
        email: adminEmail, email_confirm: true,
        user_metadata: { account_type: "workspace", company_id: createdCompanyId, role: "Admin", source: "marketing_sales" },
      });
      if (authCreateError || !authCreated.user?.id) {
        const detail = String(authCreateError?.message || "").toLowerCase();
        throw new SalesError(detail.includes("already") ? "EMAIL_ALREADY_REGISTERED" : "AUTH_CREATE_FAILED", detail.includes("already") ? 409 : 502);
      }
      createdAuthUserId = authCreated.user.id;

      const { data: appUser, error: appUserError } = await admin.from("users").insert({
        auth_user_id: createdAuthUserId, company_id: createdCompanyId, agency_id: null, agency_name: null,
        name: adminName, email: adminEmail, password: null, role: "Admin", status: "Active", is_active: true,
      }).select("id").single();
      if (appUserError) throw appUserError;
      createdAppUserId = String(appUser.id);
      accountCreated = true;
    }

    if (!platformClient?.id) throw new SalesError("PLATFORM_CLIENT_NOT_FOUND", 404);
    const { data: approved, error: approveError } = await admin.from("marketing_company_requests").update({
      status: "Approved", commission_rate: commissionRate, platform_client_id: platformClient.id,
      reviewed_by: actor.id, reviewed_at: new Date().toISOString(),
      review_notes: clean(body.notes, 1000) || null, updated_at: new Date().toISOString(),
    }).eq("id", requestId).eq("status", "Pending").select("id").maybeSingle();
    if (approveError) throw approveError;
    if (!approved) throw new SalesError("REQUEST_NOT_PENDING", 409);

    if (accountCreated) {
      const { error: recoveryError } = await admin.auth.resetPasswordForEmail(adminEmail, { redirectTo: workspaceRecoveryUrl() });
      setupEmailSent = !recoveryError;
      if (recoveryError) console.error("Marketing company setup email failed", { code: "SETUP_EMAIL_FAILED" });
    }

    return respond(origin, 200, {
      ok: true, action, status: "Approved", platform_client_id: platformClient.id,
      company_name: platformClient.company_name, admin_email: adminEmail,
      account_created: accountCreated, setup_email_sent: setupEmailSent,
    });
  } catch (error) {
    const caught = error as any;
    const code = error instanceof SalesError ? error.code : "MARKETING_SALES_ACTION_FAILED";
    const status = error instanceof SalesError ? error.status : 500;
    console.error("Marketing sales management failed", { code, name: caught?.name || "Error" });
    if (createdAppUserId) await admin.from("users").delete().eq("id", createdAppUserId);
    if (createdAuthUserId) await admin.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
    if (createdClientId) await admin.from("platform_clients").delete().eq("id", createdClientId);
    if (createdCompanyId) await admin.from("companies").delete().eq("id", createdCompanyId);
    return respond(origin, status, { ok: false, code });
  }
});
