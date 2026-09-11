import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MAX_BODY_BYTES = 12 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://visaflowksa.com",
  "https://www.visaflowksa.com",
  "https://visaflow-ksa-staging.vercel.app",
  "http://localhost:5173",
]);

class TrialError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function clean(value: unknown, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function cleanEmail(value: unknown) {
  const email = clean(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TrialError("INVALID_WORK_EMAIL");
  return email;
}

function originAllowed(origin: string | null) {
  if (!origin) return false;
  try { return ALLOWED_ORIGINS.has(new URL(origin).origin); } catch { return false; }
}

function headers(origin: string | null) {
  return {
    ...(originAllowed(origin) ? { "Access-Control-Allow-Origin": new URL(origin!).origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function respond(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: headers(origin) });
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function workspaceRecoveryUrl() {
  const url = new URL("https://visaflowksa.com");
  url.searchParams.set("login", "1");
  url.searchParams.set("auth_flow", "workspace");
  url.searchParams.set("recovery", "1");
  return url.toString();
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return originAllowed(origin) ? respond(origin, 204, null) : respond(origin, 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  if (request.method !== "POST") return respond(origin, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  if (!originAllowed(origin)) return respond(origin, 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return respond(origin, 503, { ok: false, code: "FUNCTION_NOT_CONFIGURED" });
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) return respond(origin, 413, { ok: false, code: "REQUEST_TOO_LARGE" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let companyId = "";
  let platformClientId = "";
  let authUserId = "";
  let appUserId = "";
  let requestId = "";

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new TrialError("REQUEST_TOO_LARGE", 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw || "{}"); } catch { throw new TrialError("INVALID_REQUEST"); }

    // Honeypot: real users never see or fill this field.
    if (clean(body.company_fax, 40)) throw new TrialError("REQUEST_REJECTED", 400);
    if (body.accepted_terms !== true) throw new TrialError("TERMS_REQUIRED");

    const companyName = clean(body.company_name);
    const adminName = clean(body.admin_name);
    const email = cleanEmail(body.email);
    const phone = clean(body.phone, 40);
    const jobTitle = clean(body.job_title, 120);
    const teamSize = clean(body.team_size, 40) || "1-5";
    const website = clean(body.website, 200);
    if (companyName.length < 2) throw new TrialError("COMPANY_NAME_REQUIRED");
    if (adminName.length < 2) throw new TrialError("ADMIN_NAME_REQUIRED");

    const ip = clean(request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown", 80);
    const ipHash = await sha256(`${ip}:${Deno.env.get("COMPANY_TRIAL_HASH_SALT") || SUPABASE_URL}`);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: countError } = await admin
      .from("company_trial_requests")
      .select("id", { head: true, count: "exact" })
      .eq("request_ip_hash", ipHash)
      .gte("created_at", since);
    if (countError) throw countError;
    if (Number(recentCount || 0) >= 3) throw new TrialError("TRIAL_RATE_LIMITED", 429);

    const { data: existingRequest, error: existingRequestError } = await admin
      .from("company_trial_requests")
      .select("id,status")
      .ilike("email", email)
      .maybeSingle();
    if (existingRequestError) throw existingRequestError;
    if (existingRequest) throw new TrialError("TRIAL_ALREADY_REQUESTED", 409);

    const { data: requestRow, error: requestError } = await admin.from("company_trial_requests").insert({
      company_name: companyName,
      admin_name: adminName,
      email,
      phone: phone || null,
      job_title: jobTitle || null,
      team_size: teamSize,
      website: website || null,
      request_ip_hash: ipHash,
      status: "Pending",
    }).select("id").single();
    if (requestError) throw requestError;
    requestId = requestRow.id;

    const start = new Date();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const domain = website || email.split("@")[1];

    const { data: company, error: companyError } = await admin.from("companies").insert({
      name: companyName,
      domain,
      status: "Active",
      subscription_plan: "Trial",
      subscription_status: "Active",
      subscription_start: dateOnly(start),
      subscription_end: dateOnly(end),
      max_users: 3,
      notes: `Seven-day self-service trial. Request ${requestId}`,
    }).select("id").single();
    if (companyError) throw companyError;
    companyId = company.id;

    const { data: platformClient, error: clientError } = await admin.from("platform_clients").insert({
      company_name: companyName,
      domain,
      subscription_status: "Trial",
      users_count: 3,
      start_date: dateOnly(start),
      end_date: dateOnly(end),
      monthly_amount: 0,
      operational_company_id: companyId,
      ai_agent_enabled: true,
      ai_agent_plan: "Professional Trial",
      ai_agent_trial_start: dateOnly(start),
      ai_agent_trial_end: dateOnly(end),
      ai_agent_monthly_credit_limit: 2500,
    }).select("id").single();
    if (clientError) throw clientError;
    platformClientId = platformClient.id;

    const { data: invited, error: inviteError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { account_type: "workspace", company_id: companyId, role: "Admin", trial: true },
    });
    if (inviteError || !invited.user?.id) {
      const detail = String(inviteError?.message || "").toLowerCase();
      throw new TrialError(detail.includes("already") ? "EMAIL_ALREADY_REGISTERED" : "INVITATION_FAILED", detail.includes("already") ? 409 : 502);
    }
    authUserId = invited.user.id;

    const { data: appUser, error: userError } = await admin.from("users").insert({
      auth_user_id: authUserId,
      company_id: companyId,
      name: adminName,
      email,
      password: null,
      role: "Admin",
      status: "Active",
      is_active: true,
    }).select("id").single();
    if (userError) throw userError;
    appUserId = String(appUser.id);

    const { error: settingsError } = await admin.from("ai_agent_settings").upsert({
      company_id: companyId,
      is_active: true,
      mode: "auto_notify_manager",
      auto_manager_approval: true,
      auto_followup_agencies: true,
      allow_auto_agency_emails: false,
      run_in_background: true,
      client_auto_enabled: false,
      daily_brief_enabled: true,
      max_auto_actions_per_run: 5,
      max_actions_per_hour: 10,
    }, { onConflict: "company_id" });
    if (settingsError) throw settingsError;

    const { error: finalizeError } = await admin.from("company_trial_requests").update({
      status: "Provisioned",
      operational_company_id: companyId,
      platform_client_id: platformClientId,
      provisioned_at: new Date().toISOString(),
    }).eq("id", requestId);
    if (finalizeError) throw finalizeError;

    const { error: recoveryError } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: workspaceRecoveryUrl(),
    });
    if (recoveryError) throw new TrialError("INVITATION_FAILED", 502);

    return respond(origin, 200, { ok: true, trial_days: 7, trial_end: dateOnly(end), email });
  } catch (error) {
    const caught = error as any;
    const code = error instanceof TrialError ? error.code : "TRIAL_PROVISIONING_FAILED";
    const status = error instanceof TrialError ? error.status : 500;
    console.error("Company trial provisioning failed", { code, name: caught?.name || "Error" });

    if (appUserId) await admin.from("users").delete().eq("id", appUserId);
    if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    if (platformClientId) await admin.from("platform_clients").delete().eq("id", platformClientId);
    if (companyId) await admin.from("companies").delete().eq("id", companyId);
    if (requestId) await admin.from("company_trial_requests").update({ status: "Failed" }).eq("id", requestId);

    return respond(origin, status, { ok: false, code });
  }
});
