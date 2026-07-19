import nodemailer from "npm:nodemailer@6.9.10";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-visaflow-email-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, unknown>;
type Actor = {
  id: string;
  auth_user_id: string;
  email: string;
  role: string;
  company_id: string | null;
  agency_id: string | null;
};
type Caller =
  | { kind: "internal"; key: string }
  | { kind: "authenticated"; key: string; actor: Actor };
type TemplateField = [string, string];
type MessageContract = {
  roles: string[];
  browserEnabled: boolean;
  internalEnabled: boolean;
  requiredId: string | null;
  recipientSource: string;
  ownershipRule: string;
  subject: string;
  fields: TemplateField[];
  allowedInputVariables: string[];
  allowedPath: string;
};
type ResolvedMessage = { recipients: string[]; variables: Record<string, string> };

const MAX_BODY_BYTES = 24 * 1024;
const MAX_RECIPIENTS = 3;
const MAX_VARIABLE_LENGTH = 500;
const MAX_VARIABLES_TOTAL = 3_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_AUTHENTICATED = 12;
const RATE_LIMIT_INTERNAL = 60;
const VISAFLOW_ORIGIN = "https://visaflowksa.com";
const rateBuckets = new Map<string, number[]>();

const PLATFORM_OWNER = "Platform Owner";
const PLATFORM_ACCOUNTS = "Platform Accounts User";
const COMPANY_ADMINS = ["Admin", "Company Admin"];
const RECRUITMENT = ["Recruitment Manager", "Recruitment Officer"];
const COMPANY_EMAIL_ROLES = [...COMPANY_ADMINS, ...RECRUITMENT];

// Security contract table. Every enabled message is resolved from the documented
// database record; callers never choose the SMTP envelope or an external URL.
const messageContracts: Record<string, MessageContract> = {
  EMAIL_TEMPLATE_TEST: {
    roles: [...COMPANY_ADMINS, PLATFORM_OWNER, PLATFORM_ACCOUNTS], browserEnabled: true, internalEnabled: false,
    requiredId: null, recipientSource: "authenticated public.users.email", ownershipRule: "the authenticated actor only",
    subject: "VisaFlow Email Template Test", fields: [["template_name", "Template"]], allowedInputVariables: ["template_name"], allowedPath: "none",
  },
  COMPANY_EMAIL_TEST: {
    roles: [...COMPANY_ADMINS], browserEnabled: true, internalEnabled: false,
    requiredId: null, recipientSource: "authenticated public.users.email", ownershipRule: "active actor linked to an active company",
    subject: "VisaFlow Email Settings Test", fields: [["company_name", "Company"]], allowedInputVariables: [], allowedPath: "none",
  },
  AGENCY_REQUEST_RESPONSE_EMAIL: {
    roles: ["Agency"], browserEnabled: true, internalEnabled: false,
    requiredId: "notification_event_id", recipientSource: "company_email_settings.notifications_email", ownershipRule: "notification agency + active agency_company_user_access for actor",
    subject: "Agency Request Response", fields: [["agency_name", "Agency"], ["request_no", "Request"], ["response_status", "Decision"], ["response_notes", "Notes"], ["sla_due_at", "SLA due"]], allowedInputVariables: [], allowedPath: "/",
  },
  NEW_REQUEST_AGENCY_ALERT_EMAIL: {
    roles: COMPANY_EMAIL_ROLES, browserEnabled: true, internalEnabled: false,
    requiredId: "request_id", recipientSource: "agencies.email", ownershipRule: "request.company_id = actor.company_id + active agency access",
    subject: "New Recruitment Request", fields: [["agency_name", "Agency"], ["request_no", "Request"], ["project", "Project"], ["priority", "Priority"], ["action_url", "Portal"]], allowedInputVariables: [], allowedPath: "/",
  },
  AGENCY_AGREEMENT_SENT: {
    roles: [...COMPANY_ADMINS, "Recruitment Manager"], browserEnabled: true, internalEnabled: false,
    requiredId: "agreement_id", recipientSource: "agency_agreements.agency_name -> unique active agencies.email", ownershipRule: "agreement.company_id = actor.company_id + active agency access",
    subject: "VisaFlow Agreement Requires Acceptance", fields: [["agency_name", "Agency"], ["agreement_no", "Agreement"], ["sla_days", "SLA days"], ["action_url", "Portal"]], allowedInputVariables: [], allowedPath: "/",
  },
  AGENCY_AGREEMENT_ACCEPTED: {
    roles: ["Agency"], browserEnabled: true, internalEnabled: false,
    requiredId: "agreement_id", recipientSource: "company_email_settings.agreements_email", ownershipRule: "agreement agency matches actor agency + active agency access",
    subject: "Agency Agreement Accepted", fields: [["agency_name", "Agency"], ["agreement_no", "Agreement"], ["signer", "Accepted by"]], allowedInputVariables: [], allowedPath: "/",
  },
  AGENCY_PENALTY_SENT: {
    roles: [...COMPANY_ADMINS, "Recruitment Manager"], browserEnabled: true, internalEnabled: false,
    requiredId: "penalty_id", recipientSource: "agency_penalties.agency_id -> agencies.email", ownershipRule: "penalty.company_id = actor.company_id + active agency access",
    subject: "VisaFlow Penalty Notice", fields: [["agency_name", "Agency"], ["penalty_no", "Penalty"], ["candidate_name", "Candidate"], ["request_no", "Request"], ["amount", "Amount (SAR)"], ["action_url", "Portal"]], allowedInputVariables: [], allowedPath: "/",
  },
  AGENCY_PENALTY_JUSTIFICATION_SUBMITTED: {
    roles: ["Agency"], browserEnabled: true, internalEnabled: false,
    requiredId: "penalty_id", recipientSource: "company_email_settings.notifications_email", ownershipRule: "penalty agency = actor.agency_id + active agency access",
    subject: "Penalty Justification Submitted", fields: [["agency_name", "Agency"], ["penalty_no", "Penalty"], ["candidate_name", "Candidate"], ["justification", "Justification"]], allowedInputVariables: [], allowedPath: "/",
  },
  AGENCY_PENALTY_DECISION: {
    roles: [...COMPANY_ADMINS, "Recruitment Manager"], browserEnabled: true, internalEnabled: false,
    requiredId: "penalty_id", recipientSource: "agency_penalties.agency_id -> agencies.email", ownershipRule: "penalty.company_id = actor.company_id + active agency access",
    subject: "Penalty Decision", fields: [["penalty_no", "Penalty"], ["decision", "Decision"], ["amount", "Amount (SAR)"], ["note", "Notes"], ["action_url", "Portal"]], allowedInputVariables: [], allowedPath: "/",
  },
  AI_INTERVIEW_INVITATION: {
    roles: COMPANY_EMAIL_ROLES, browserEnabled: true, internalEnabled: false,
    requiredId: "interview_session_id", recipientSource: "ai_interview_sessions -> candidates.email", ownershipRule: "session and candidate belong to actor.company_id",
    subject: "VisaFlow AI Interview Invitation", fields: [["candidate_name", "Candidate"], ["profession", "Profession"], ["request_no", "Request"], ["scheduled_at", "Scheduled"], ["expires_at", "Expires"], ["action_url", "Interview link"]], allowedInputVariables: [], allowedPath: "/?ai_interview=<record access_token>",
  },
  AI_AGENT_MANAGER_APPROVAL: {
    roles: [...COMPANY_ADMINS, "Recruitment Manager"], browserEnabled: true, internalEnabled: true,
    requiredId: "request_id", recipientSource: "active company manager users", ownershipRule: "request.company_id = authenticated/internal company",
    subject: "AI Agent Manager Approval", fields: [["request_no", "Request"], ["recommended_agency", "Recommended agency"], ["fit_score", "Fit score"]], allowedInputVariables: ["recommended_agency", "fit_score"], allowedPath: "/",
  },
  AI_AGENT_AUTO_MANAGER_APPROVAL: {
    roles: [...COMPANY_ADMINS, "Recruitment Manager"], browserEnabled: true, internalEnabled: true,
    requiredId: "request_id", recipientSource: "active company manager users", ownershipRule: "request.company_id = authenticated/internal company",
    subject: "AI Agent Manager Approval", fields: [["request_no", "Request"], ["recommended_agency", "Recommended agency"], ["fit_score", "Fit score"]], allowedInputVariables: ["recommended_agency", "fit_score"], allowedPath: "/",
  },
  AI_AGENT_AGENCY_DAILY_DIGEST_EMAIL: {
    roles: [], browserEnabled: false, internalEnabled: true,
    requiredId: "agency_id", recipientSource: "active agencies.email", ownershipRule: "internal company_id + active agency access",
    subject: "VisaFlow Agency Daily Follow-up Digest", fields: [["agency", "Agency"], ["request_nos", "Requests"], ["pending_items", "Pending items"], ["highest_priority", "Highest priority"], ["action_url", "Portal"]], allowedInputVariables: ["request_nos", "pending_items", "highest_priority"], allowedPath: "/",
  },
  JOB_OFFER_EMAIL: {
    roles: COMPANY_EMAIL_ROLES, browserEnabled: true, internalEnabled: false,
    requiredId: "candidate_id", recipientSource: "candidates.email", ownershipRule: "candidate.company_id = actor.company_id",
    subject: "VisaFlow Job Offer", fields: [["candidate_name", "Candidate"], ["profession", "Position"], ["request_no", "Request"], ["project", "Project"], ["salary", "Salary / package"], ["joining_date", "Expected joining"]], allowedInputVariables: ["salary", "joining_date"], allowedPath: "none",
  },
  PLATFORM_CLIENT_LOGIN_DETAILS_EMAIL: {
    roles: [PLATFORM_OWNER], browserEnabled: true, internalEnabled: false,
    requiredId: "target_user_id", recipientSource: "target public.users.email", ownershipRule: "Platform Owner with company_id IS NULL; target belongs to an active company",
    subject: "VisaFlow Company Account Setup", fields: [["company_name", "Company"], ["admin_email", "Username"], ["action_url", "Login URL"]], allowedInputVariables: [], allowedPath: "/",
  },
};

const allowedTopLevelFields = new Set([
  "message_type", "variables", "request_id", "agency_id", "notification_event_id", "candidate_id",
  "interview_session_id", "agreement_id", "penalty_id", "offer_id", "target_user_id", "company_id",
]);
const forbiddenEnvelopeFields = new Set(["to", "cc", "bcc", "from", "replyTo", "reply_to", "subject", "text", "html", "actionUrl", "action_url"]);

class RequestFailure extends Error {
  status: number;
  publicCode: string;
  constructor(status: number, publicCode: string) {
    super(publicCode);
    this.status = status;
    this.publicCode = publicCode;
  }
}

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}

function requireSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function escapeHtml(value = "") {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function normalizeEmails(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(isValidEmail)));
}

function safeId(value: unknown, field: string) {
  const id = String(value || "").trim();
  if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new RequestFailure(400, `invalid_${field}`);
  return id;
}

function approvedUrl(query?: Record<string, string>) {
  const url = new URL("/", VISAFLOW_ORIGIN);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  if (url.protocol !== "https:" || url.origin !== VISAFLOW_ORIGIN) throw new RequestFailure(400, "invalid_action_url");
  return url.toString();
}

function cleanInputVariables(value: unknown, allowedKeys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  const result: Record<string, string> = {};
  let total = 0;
  for (const [key, raw] of Object.entries(value as Json)) {
    if (!allowedKeys.includes(key)) throw new RequestFailure(400, "unsupported_template_variable");
    const text = Array.isArray(raw) ? raw.slice(0, 20).join(", ") : String(raw ?? "");
    if (/(?:https?:\/\/|javascript\s*:|data\s*:)/i.test(text)) throw new RequestFailure(400, "external_url_not_allowed");
    const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_VARIABLE_LENGTH);
    total += cleaned.length;
    if (total > MAX_VARIABLES_TOTAL) throw new RequestFailure(400, "invalid_variables");
    result[key] = cleaned;
  }
  return result;
}

function renderTemplate(contract: MessageContract, variables: Record<string, string>) {
  const populated = contract.fields.map(([key, label]) => [label, variables[key] || "-"] as const);
  const text = [contract.subject, "", ...populated.map(([label, value]) => `${label}: ${value}`), "", "VisaFlow KSA"].join("\n").slice(0, 6_000);
  const rows = populated.map(([label, value]) => `<div style="margin:7px 0;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join("");
  const html = `<div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Tahoma,sans-serif;color:#0f172a;"><div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;"><div style="background:#061b49;color:#fff;padding:22px 26px;"><h2 style="margin:0;">${escapeHtml(contract.subject)}</h2></div><div style="padding:22px 26px;line-height:1.65;font-size:14px;">${rows}</div><div style="padding:14px 26px;background:#f8fafc;color:#64748b;font-size:12px;">VisaFlow KSA</div></div></div>`;
  return { subject: contract.subject.slice(0, 160), text, html };
}

function getBearerToken(req: Request) {
  return (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

async function authenticateCaller(req: Request, adminClient: any): Promise<Caller | { error: string; status: number }> {
  const configuredSecret = Deno.env.get("VISAFLOW_EMAIL_DISPATCHER_SECRET") || "";
  const suppliedSecret = req.headers.get("x-visaflow-email-secret") || "";
  if (configuredSecret && suppliedSecret && secureEqual(suppliedSecret, configuredSecret)) return { kind: "internal", key: "internal" };

  const jwt = getBearerToken(req);
  if (!jwt) return { error: "unauthorized", status: 401 };
  const { data: authData, error: authError } = await adminClient.auth.getUser(jwt);
  if (authError || !authData?.user?.id) return { error: "unauthorized", status: 401 };

  const { data: rows, error } = await adminClient.from("users")
    .select("id, auth_user_id, email, role, status, is_active, company_id, agency_id")
    .eq("auth_user_id", authData.user.id).limit(2);
  if (error) {
    console.error("Email dispatcher actor lookup failed", error.message);
    return { error: "forbidden", status: 403 };
  }
  if ((rows || []).length !== 1) return { error: "forbidden", status: 403 };

  const row = rows[0];
  if (row.status !== "Active" || row.is_active !== true || !isValidEmail(String(row.email || ""))) return { error: "forbidden", status: 403 };
  const isPlatform = [PLATFORM_OWNER, PLATFORM_ACCOUNTS, "Platform Support User"].includes(row.role);
  if (isPlatform && row.company_id !== null) return { error: "forbidden", status: 403 };
  if (row.role === "Agency") {
    if (!row.agency_id) return { error: "forbidden", status: 403 };
    const { data: agency } = await adminClient.from("agencies").select("id").eq("id", row.agency_id).eq("status", "Active").maybeSingle();
    if (!agency) return { error: "forbidden", status: 403 };
  } else if (!isPlatform) {
    if (!row.company_id) return { error: "forbidden", status: 403 };
    const { data: company } = await adminClient.from("companies").select("id").eq("id", row.company_id).eq("status", "Active").maybeSingle();
    if (!company) return { error: "forbidden", status: 403 };
  }
  return { kind: "authenticated", key: `user:${row.id}`, actor: {
    id: String(row.id), auth_user_id: String(row.auth_user_id), email: String(row.email).toLowerCase(), role: String(row.role),
    company_id: row.company_id ? String(row.company_id) : null, agency_id: row.agency_id ? String(row.agency_id) : null,
  } };
}

async function exactlyOne(query: any, notFoundCode = "record_not_found") {
  const { data, error } = await query.limit(2);
  if (error) throw error;
  if ((data || []).length !== 1) throw new RequestFailure(404, notFoundCode);
  return data[0];
}

async function activeAgency(admin: any, agencyId: string) {
  return exactlyOne(admin.from("agencies").select("id, name, email, status").eq("id", agencyId).eq("status", "Active"), "agency_not_found");
}

async function agencyByUniqueName(admin: any, agencyName: string) {
  return exactlyOne(admin.from("agencies").select("id, name, email, status").eq("name", agencyName).eq("status", "Active"), "agency_not_found");
}

async function assertAgencyAccess(admin: any, companyId: string, agencyId: string, actorId = "") {
  let query = admin.from("agency_company_user_access").select("company_id, agency_id, user_id, status")
    .eq("company_id", companyId).eq("agency_id", agencyId).eq("status", "Active");
  if (actorId) query = query.eq("user_id", actorId);
  const { data, error } = await query.limit(actorId ? 2 : 1);
  if (error) throw error;
  if (!(data || []).length || (actorId && data.length !== 1)) throw new RequestFailure(403, "forbidden");
}

async function companyMailbox(admin: any, companyId: string, kind: "notifications" | "agreements" | "support" = "notifications") {
  const { data: settings, error } = await admin.from("company_email_settings")
    .select("notifications_email, agreements_email, support_email, is_active")
    .eq("company_id", companyId).eq("is_active", true).limit(2);
  if (error) throw error;
  if ((settings || []).length > 1) throw new RequestFailure(404, "company_mailbox_not_found");
  const row = settings?.[0] || {};
  const preferred = kind === "agreements" ? row.agreements_email : kind === "support" ? row.support_email : row.notifications_email;
  const emails = normalizeEmails([preferred, row.notifications_email, row.support_email, row.agreements_email]);
  if (emails.length) return [emails[0]];

  const { data: users, error: userError } = await admin.from("users")
    .select("email").eq("company_id", companyId).eq("status", "Active").eq("is_active", true)
    .in("role", ["Admin", "Company Admin", "Recruitment Manager"]).limit(MAX_RECIPIENTS);
  if (userError) throw userError;
  const fallback = normalizeEmails((users || []).map((user: Json) => user.email));
  if (!fallback.length) throw new RequestFailure(404, "company_mailbox_not_found");
  return fallback.slice(0, MAX_RECIPIENTS);
}

async function companyManagers(admin: any, companyId: string) {
  const { data, error } = await admin.from("users").select("email")
    .eq("company_id", companyId).eq("status", "Active").eq("is_active", true)
    .in("role", ["Recruitment Manager", "Admin", "Company Admin"]).limit(MAX_RECIPIENTS);
  if (error) throw error;
  const emails = normalizeEmails((data || []).map((row: Json) => row.email));
  if (!emails.length) throw new RequestFailure(404, "manager_recipient_not_found");
  return emails.slice(0, MAX_RECIPIENTS);
}

function agencyRecipients(agency: Json) {
  const emails = normalizeEmails([agency.email]);
  if (!emails.length) throw new RequestFailure(404, "agency_recipient_not_found");
  return [emails[0]];
}

async function resolveMessage(admin: any, caller: Caller, type: string, contract: MessageContract, body: Json, input: Record<string, string>): Promise<ResolvedMessage> {
  if (caller.kind === "authenticated") {
    if (!contract.browserEnabled || !contract.roles.includes(caller.actor.role)) throw new RequestFailure(403, "forbidden");
    if (body.company_id !== undefined) throw new RequestFailure(400, "company_id_not_allowed");
  } else if (!contract.internalEnabled) throw new RequestFailure(403, "forbidden");

  if (type === "EMAIL_TEMPLATE_TEST") return { recipients: [caller.kind === "authenticated" ? caller.actor.email : ""], variables: input };
  if (type === "COMPANY_EMAIL_TEST") {
    if (caller.kind !== "authenticated" || !caller.actor.company_id) throw new RequestFailure(403, "forbidden");
    const company = await exactlyOne(admin.from("companies").select("id, name").eq("id", caller.actor.company_id).eq("status", "Active"), "company_not_found");
    return { recipients: [caller.actor.email], variables: { company_name: String(company.name || "Company") } };
  }

  if (type === "AGENCY_REQUEST_RESPONSE_EMAIL") {
    if (caller.kind !== "authenticated" || !caller.actor.agency_id) throw new RequestFailure(403, "forbidden");
    const id = safeId(body.notification_event_id, "notification_event_id");
    const event = await exactlyOne(admin.from("notification_events")
      .select("id, company_id, agency_id, agency_name, request_no, response_status, rejection_reason, sla_due_at, data")
      .eq("id", id).eq("agency_id", caller.actor.agency_id), "notification_not_found");
    await assertAgencyAccess(admin, String(event.company_id), caller.actor.agency_id, caller.actor.id);
    const eventData = event.data && typeof event.data === "object" ? event.data : {};
    return { recipients: await companyMailbox(admin, String(event.company_id), "notifications"), variables: {
      agency_name: String(event.agency_name || eventData.agency_name || "Agency"), request_no: String(event.request_no || eventData.request_no || "-"),
      response_status: String(event.response_status || eventData.response_status || "-"), response_notes: String(event.rejection_reason || eventData.response_notes || "-"),
      sla_due_at: String(event.sla_due_at || eventData.sla_due_at || "-"),
    } };
  }

  if (type === "NEW_REQUEST_AGENCY_ALERT_EMAIL") {
    if (caller.kind !== "authenticated" || !caller.actor.company_id) throw new RequestFailure(403, "forbidden");
    const requestId = safeId(body.request_id, "request_id");
    const agencyId = safeId(body.agency_id, "agency_id");
    const request = await exactlyOne(admin.from("requests").select("id, company_id, request_no, project_name, priority")
      .eq("id", requestId).eq("company_id", caller.actor.company_id), "request_not_found");
    const agency = await activeAgency(admin, agencyId);
    await assertAgencyAccess(admin, caller.actor.company_id, agencyId);
    return { recipients: agencyRecipients(agency), variables: {
      agency_name: String(agency.name || "Agency"), request_no: String(request.request_no || request.id),
      project: String(request.project_name || "-"), priority: String(request.priority || "Medium"), action_url: approvedUrl(),
    } };
  }

  if (type === "AGENCY_AGREEMENT_SENT" || type === "AGENCY_AGREEMENT_ACCEPTED") {
    const agreementId = safeId(body.agreement_id, "agreement_id");
    let query = admin.from("agency_agreements").select("id, company_id, agency_name, agreement_no, sla_days, status").eq("id", agreementId);
    if (caller.kind === "authenticated" && caller.actor.company_id) query = query.eq("company_id", caller.actor.company_id);
    const agreement = await exactlyOne(query, "agreement_not_found");
    const agency = caller.kind === "authenticated" && caller.actor.role === "Agency"
      ? await activeAgency(admin, String(caller.actor.agency_id))
      : await agencyByUniqueName(admin, String(agreement.agency_name || ""));
    if (String(agency.name || "").trim().toLowerCase() !== String(agreement.agency_name || "").trim().toLowerCase()) throw new RequestFailure(403, "forbidden");
    await assertAgencyAccess(admin, String(agreement.company_id), String(agency.id), caller.kind === "authenticated" && caller.actor.role === "Agency" ? caller.actor.id : "");
    if (type === "AGENCY_AGREEMENT_SENT") return { recipients: agencyRecipients(agency), variables: {
      agency_name: String(agency.name), agreement_no: String(agreement.agreement_no || agreement.id), sla_days: String(agreement.sla_days || "-"), action_url: approvedUrl(),
    } };
    if (caller.kind !== "authenticated" || caller.actor.role !== "Agency") throw new RequestFailure(403, "forbidden");
    return { recipients: await companyMailbox(admin, String(agreement.company_id), "agreements"), variables: {
      agency_name: String(agency.name), agreement_no: String(agreement.agreement_no || agreement.id), signer: caller.actor.email,
    } };
  }

  if (["AGENCY_PENALTY_SENT", "AGENCY_PENALTY_JUSTIFICATION_SUBMITTED", "AGENCY_PENALTY_DECISION"].includes(type)) {
    const penaltyId = safeId(body.penalty_id, "penalty_id");
    let query = admin.from("agency_penalties")
      .select("id, company_id, agency_id, agency_name, penalty_no, candidate_name, request_no, approved_amount, calculated_amount, agency_justification, decision_notes, final_decision, status")
      .eq("id", penaltyId);
    if (caller.kind === "authenticated" && caller.actor.company_id) query = query.eq("company_id", caller.actor.company_id);
    const penalty = await exactlyOne(query, "penalty_not_found");
    const agencyId = String(penalty.agency_id || (caller.kind === "authenticated" ? caller.actor.agency_id || "" : ""));
    if (!agencyId) throw new RequestFailure(404, "agency_not_found");
    if (caller.kind === "authenticated" && caller.actor.role === "Agency" && caller.actor.agency_id !== agencyId) throw new RequestFailure(403, "forbidden");
    const agency = await activeAgency(admin, agencyId);
    await assertAgencyAccess(admin, String(penalty.company_id), agencyId, caller.kind === "authenticated" && caller.actor.role === "Agency" ? caller.actor.id : "");
    if (type === "AGENCY_PENALTY_JUSTIFICATION_SUBMITTED") {
      if (caller.kind !== "authenticated" || caller.actor.role !== "Agency") throw new RequestFailure(403, "forbidden");
      return { recipients: await companyMailbox(admin, String(penalty.company_id), "notifications"), variables: {
        agency_name: String(agency.name), penalty_no: String(penalty.penalty_no || penalty.id), candidate_name: String(penalty.candidate_name || "-"), justification: String(penalty.agency_justification || "-"),
      } };
    }
    const amount = String(penalty.approved_amount ?? penalty.calculated_amount ?? "-");
    if (type === "AGENCY_PENALTY_SENT") return { recipients: agencyRecipients(agency), variables: {
      agency_name: String(agency.name), penalty_no: String(penalty.penalty_no || penalty.id), candidate_name: String(penalty.candidate_name || "-"), request_no: String(penalty.request_no || "-"), amount, action_url: approvedUrl(),
    } };
    return { recipients: agencyRecipients(agency), variables: {
      penalty_no: String(penalty.penalty_no || penalty.id), decision: String(penalty.final_decision || penalty.status || "Decision recorded"), amount,
      note: String(penalty.decision_notes || "-"), action_url: approvedUrl(),
    } };
  }

  if (type === "AI_INTERVIEW_INVITATION") {
    if (caller.kind !== "authenticated" || !caller.actor.company_id) throw new RequestFailure(403, "forbidden");
    const sessionId = safeId(body.interview_session_id, "interview_session_id");
    const session = await exactlyOne(admin.from("ai_interview_sessions")
      .select("id, company_id, candidate_id, candidate_name, candidate_email, profession, request_no, scheduled_at, expires_at, access_token, status")
      .eq("id", sessionId).eq("company_id", caller.actor.company_id), "interview_session_not_found");
    if (!session.candidate_id || !session.access_token) throw new RequestFailure(404, "interview_invitation_not_ready");
    const candidate = await exactlyOne(admin.from("candidates").select("id, company_id, candidate_name, email, profession, request_no")
      .eq("id", session.candidate_id).eq("company_id", caller.actor.company_id), "candidate_not_found");
    const recipients = normalizeEmails([session.candidate_email, candidate.email]);
    if (!recipients.length) throw new RequestFailure(404, "candidate_recipient_not_found");
    return { recipients: [recipients[0]], variables: {
      candidate_name: String(session.candidate_name || candidate.candidate_name || "Candidate"), profession: String(session.profession || candidate.profession || "-"),
      request_no: String(session.request_no || candidate.request_no || "-"), scheduled_at: String(session.scheduled_at || "-"), expires_at: String(session.expires_at || "-"),
      action_url: approvedUrl({ ai_interview: String(session.access_token) }),
    } };
  }

  if (type === "AI_AGENT_MANAGER_APPROVAL" || type === "AI_AGENT_AUTO_MANAGER_APPROVAL") {
    const requestId = safeId(body.request_id, "request_id");
    let query = admin.from("requests").select("id, company_id, request_no").eq("id", requestId);
    if (caller.kind === "authenticated") {
      if (!caller.actor.company_id) throw new RequestFailure(403, "forbidden");
      query = query.eq("company_id", caller.actor.company_id);
    }
    const request = await exactlyOne(query, "request_not_found");
    if (caller.kind === "internal" && String(body.company_id || "") !== String(request.company_id)) throw new RequestFailure(403, "forbidden");
    return { recipients: await companyManagers(admin, String(request.company_id)), variables: {
      request_no: String(request.request_no || request.id), recommended_agency: input.recommended_agency || "-", fit_score: input.fit_score || "-",
    } };
  }

  if (type === "AI_AGENT_AGENCY_DAILY_DIGEST_EMAIL") {
    if (caller.kind !== "internal") throw new RequestFailure(403, "forbidden");
    const companyId = safeId(body.company_id, "company_id");
    const agencyId = safeId(body.agency_id, "agency_id");
    const agency = await activeAgency(admin, agencyId);
    await assertAgencyAccess(admin, companyId, agencyId);
    return { recipients: agencyRecipients(agency), variables: { agency: String(agency.name), ...input, action_url: approvedUrl() } };
  }

  if (type === "JOB_OFFER_EMAIL") {
    if (caller.kind !== "authenticated" || !caller.actor.company_id) throw new RequestFailure(403, "forbidden");
    const candidateId = safeId(body.candidate_id, "candidate_id");
    const candidate = await exactlyOne(admin.from("candidates")
      .select("id, company_id, candidate_name, email, profession, request_no, project, joining_date")
      .eq("id", candidateId).eq("company_id", caller.actor.company_id), "candidate_not_found");
    const recipients = normalizeEmails([candidate.email]);
    if (!recipients.length) throw new RequestFailure(404, "candidate_recipient_not_found");
    return { recipients: [recipients[0]], variables: {
      candidate_name: String(candidate.candidate_name || "Candidate"), profession: String(candidate.profession || "-"), request_no: String(candidate.request_no || "-"),
      project: String(candidate.project || "-"), salary: input.salary || "To be confirmed", joining_date: input.joining_date || String(candidate.joining_date || "To be confirmed"),
    } };
  }

  if (type === "PLATFORM_CLIENT_LOGIN_DETAILS_EMAIL") {
    if (caller.kind !== "authenticated" || caller.actor.role !== PLATFORM_OWNER || caller.actor.company_id !== null) throw new RequestFailure(403, "forbidden");
    const targetUserId = safeId(body.target_user_id, "target_user_id");
    const target = await exactlyOne(admin.from("users").select("id, email, name, role, status, is_active, company_id")
      .eq("id", targetUserId).eq("status", "Active").eq("is_active", true), "target_user_not_found");
    if (!target.company_id) throw new RequestFailure(403, "forbidden");
    const company = await exactlyOne(admin.from("companies").select("id, name, status").eq("id", target.company_id).eq("status", "Active"), "company_not_found");
    const recipients = normalizeEmails([target.email]);
    if (!recipients.length) throw new RequestFailure(404, "target_recipient_not_found");
    return { recipients: [recipients[0]], variables: { company_name: String(company.name || "Company"), admin_email: recipients[0], action_url: approvedUrl() } };
  }

  throw new RequestFailure(400, "message_type_not_allowed");
}

function consumeRateLimit(key: string, limit: number) {
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= limit) return false;
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
}

function parseBoolean(value: string | undefined, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "ssl"].includes(String(value).toLowerCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = requireSecret("SUPABASE_URL");
    const serviceRoleKey = requireSecret("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const caller = await authenticateCaller(req, admin);
    if ("error" in caller) return jsonResponse({ ok: false, error: caller.error }, caller.status);

    const limit = caller.kind === "internal" ? RATE_LIMIT_INTERNAL : RATE_LIMIT_AUTHENTICATED;
    if (!consumeRateLimit(caller.key, limit)) return jsonResponse({ ok: false, error: "rate_limited" }, 429);

    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "request_too_large" }, 413);
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "request_too_large" }, 413);
    let body: Json;
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { return jsonResponse({ ok: false, error: "invalid_request" }, 400); }

    for (const key of Object.keys(body)) {
      if (forbiddenEnvelopeFields.has(key)) return jsonResponse({ ok: false, error: "smtp_envelope_not_allowed" }, 400);
      if (!allowedTopLevelFields.has(key)) return jsonResponse({ ok: false, error: "unsupported_request_field" }, 400);
    }

    const messageType = String(body.message_type || "").trim();
    const contract = messageContracts[messageType];
    if (!contract) return jsonResponse({ ok: false, error: "message_type_not_allowed" }, 400);
    const inputVariables = cleanInputVariables(body.variables, contract.allowedInputVariables);
    const resolved = await resolveMessage(admin, caller, messageType, contract, body, inputVariables);
    const recipients = normalizeEmails(resolved.recipients).slice(0, MAX_RECIPIENTS);
    if (!recipients.length || recipients.length > MAX_RECIPIENTS) throw new RequestFailure(404, "recipient_not_found");
    const rendered = renderTemplate(contract, resolved.variables);

    const smtpHost = Deno.env.get("SMTP_HOSTNAME") || "mail.privateemail.com";
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
    const smtpSecure = parseBoolean(Deno.env.get("SMTP_SECURE"), smtpPort === 465);
    const smtpUser = requireSecret("SMTP_USERNAME");
    const smtpPass = requireSecret("SMTP_PASSWORD");
    const smtpFrom = Deno.env.get("SMTP_FROM") || `VisaFlow KSA <${smtpUser}>`;
    const approvedReplyTo = Deno.env.get("SMTP_REPLY_TO") || "support@visaflowksa.com";
    const transport = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpSecure, auth: { user: smtpUser, pass: smtpPass } });
    await new Promise<void>((resolve, reject) => {
      transport.sendMail({ from: smtpFrom, to: recipients, replyTo: approvedReplyTo, subject: rendered.subject, text: rendered.text, html: rendered.html },
        (error) => error ? reject(error) : resolve());
    });
    return jsonResponse({ ok: true, message_type: messageType });
  } catch (error) {
    if (error instanceof RequestFailure) return jsonResponse({ ok: false, error: error.publicCode }, error.status);
    console.error("Email dispatcher internal failure", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ ok: false, error: "email_dispatch_failed" }, 500);
  }
});
