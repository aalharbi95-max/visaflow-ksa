// VisaFlow AI Agent Worker v10 - Production Guardrails + Background Processing
// Deploy as: supabase/functions/aiagentworker/index.ts
// Purpose: run AI Recruitment Agent outside the browser with locks, rate limits, audit trail, and safe email dispatch.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type Row = Record<string, any>;

type AgentSettings = {
  company_id: string;
  is_active?: boolean;
  mode?: string;
  auto_manager_approval?: boolean;
  auto_followup_agencies?: boolean;
  allow_auto_agency_emails?: boolean;
  manager_approval_email?: string | null;
  agency_reminder_after_days?: number;
  escalation_after_days?: number;
  daily_brief_enabled?: boolean;
  max_auto_actions_per_run?: number;
  cooldown_minutes?: number;
  max_actions_per_hour?: number;
  max_retry_attempts?: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-visaflow-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_MODES = new Set(["queue_only", "queue_or_scheduled", "scheduled"]);

// Cron transition contract: invoke this function with POST and the
// x-visaflow-worker-secret header backed by AI_AGENT_WORKER_SECRET.
// Do not use SUPABASE_SERVICE_ROLE_KEY as the scheduler invocation secret.

function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function getBearerToken(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function authenticateWorkerCaller(req: Request, adminClient: any) {
  const configuredSecret = Deno.env.get("AI_AGENT_WORKER_SECRET") || "";
  const suppliedSecret = req.headers.get("x-visaflow-worker-secret") || "";
  if (configuredSecret && suppliedSecret && secureEqual(suppliedSecret, configuredSecret)) {
    return { kind: "internal" as const, actorId: "internal-scheduler" };
  }

  const jwt = getBearerToken(req);
  if (!jwt) return { error: "unauthorized", status: 401 } as const;
  const { data: authData, error: authError } = await adminClient.auth.getUser(jwt);
  if (authError || !authData?.user?.id) return { error: "unauthorized", status: 401 } as const;

  const { data: linkedUsers, error: linkedError } = await adminClient
    .from("users")
    .select("id, auth_user_id, role, status, is_active, company_id")
    .eq("auth_user_id", authData.user.id)
    .limit(2);
  if (linkedError) {
    console.error("AI Agent worker caller lookup failed", linkedError.message);
    return { error: "forbidden", status: 403 } as const;
  }
  if ((linkedUsers || []).length !== 1) return { error: "forbidden", status: 403 } as const;

  const actor = linkedUsers[0];
  if (actor.status !== "Active" || actor.is_active !== true || actor.role !== "Platform Owner" || actor.company_id !== null) {
    return { error: "forbidden", status: 403 } as const;
  }
  return { kind: "platform_owner" as const, actorId: String(actor.id) };
}

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function daysBetween(dateValue: unknown) {
  if (!dateValue) return 0;
  const date = new Date(String(dateValue));
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function isTerminalCandidateStatus(status: unknown) {
  const s = normalize(status);
  return [
    "rejected",
    "interview failed",
    "medical failed",
    "medical fail",
    "ksa medical failed",
    "cancelled",
    "joined",
    "refused to work",
    "absconded",
  ].includes(s);
}

function isTerminalAuthorizationStatus(status: unknown) {
  const s = normalize(status);
  return ["cancelled", "completed", "closed"].includes(s);
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function uniqueEmails(raw: string) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[;,]/)
        .map((x) => x.trim())
        .filter((x) => x.includes("@")),
    ),
  ).join(", ");
}

function buildEmailCardHtml(title: string, lines: string[], actionText = "") {
  const escapedTitle = title.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] || char));
  const list = lines
    .map((line) => `<div style="margin:7px 0;">${String(line || "").replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] || char))}</div>`)
    .join("");
  const action = actionText
    ? `<div style="margin-top:18px;padding:14px 16px;background:#eef6ff;border-radius:12px;border:1px solid #bfdbfe;">${actionText.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char] || char))}</div>`
    : "";
  return `
  <div style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Tahoma,sans-serif;color:#0f172a;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
      <div style="background:#061b49;color:#ffffff;padding:22px 26px;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;font-weight:700;">VisaFlow AI Agent</div>
        <h2 style="margin:8px 0 0;font-size:22px;">${escapedTitle}</h2>
      </div>
      <div style="padding:22px 26px;line-height:1.65;font-size:14px;">${list}${action}</div>
      <div style="padding:14px 26px;background:#f8fafc;color:#64748b;font-size:12px;">This message was generated by VisaFlow KSA AI Recruitment Agent.</div>
    </div>
  </div>`;
}

async function safeSelect(supabase: any, table: string, companyId: string, query = "*") {
  const { data, error } = await supabase.from(table).select(query).eq("company_id", companyId);
  if (error) {
    console.warn(`AI Agent: unable to read ${table}:`, error.message);
    return [] as Row[];
  }
  return (data || []) as Row[];
}

async function audit(supabase: any, payload: {
  companyId: string;
  runId: string;
  actionType: string;
  actionKey: string;
  status?: string;
  severity?: string;
  title?: string;
  targetTable?: string;
  targetId?: string;
  agencyId?: string | null;
  agencyName?: string;
  requestNo?: string;
  details?: Json;
  errorMessage?: string;
}) {
  await supabase.from("ai_agent_audit_logs").insert([{
    company_id: payload.companyId,
    run_id: payload.runId,
    action_type: payload.actionType,
    action_key: payload.actionKey,
    status: payload.status || "completed",
    severity: payload.severity || "info",
    actor: "AI_AGENT_WORKER",
    target_table: payload.targetTable || null,
    target_id: payload.targetId || null,
    agency_id: payload.agencyId || null,
    agency_name: payload.agencyName || null,
    request_no: payload.requestNo || null,
    title: payload.title || payload.actionType,
    details: payload.details || {},
    error_message: payload.errorMessage || null,
  }]);
}

async function acquireLock(supabase: any, settings: AgentSettings, runId: string, action: {
  actionKey: string;
  actionType: string;
  relatedTable?: string;
  relatedId?: string;
  agencyId?: string | null;
  title?: string;
  details?: Json;
}) {
  const cooldown = clamp(safeNumber(settings.cooldown_minutes, 60), 5, 1440);
  const { data, error } = await supabase.rpc("ai_agent_try_acquire_lock", {
    p_company_id: settings.company_id,
    p_action_key: action.actionKey,
    p_action_type: action.actionType,
    p_related_table: action.relatedTable || null,
    p_related_id: action.relatedId || null,
    p_agency_id: action.agencyId || null,
    p_cooldown_minutes: cooldown,
  });
  if (error) throw error;
  if (!data) {
    await audit(supabase, {
      companyId: settings.company_id,
      runId,
      actionType: action.actionType,
      actionKey: action.actionKey,
      status: "skipped",
      severity: "warning",
      title: `${action.title || action.actionType} skipped by cooldown lock`,
      targetTable: action.relatedTable,
      targetId: action.relatedId,
      agencyId: action.agencyId,
      details: { reason: "cooldown_or_duplicate", cooldown_minutes: cooldown, ...(action.details || {}) },
    });
    return false;
  }
  await audit(supabase, {
    companyId: settings.company_id,
    runId,
    actionType: action.actionType,
    actionKey: action.actionKey,
    status: "lock_acquired",
    severity: "info",
    title: action.title || "AI Agent lock acquired",
    targetTable: action.relatedTable,
    targetId: action.relatedId,
    agencyId: action.agencyId,
    details: { cooldown_minutes: cooldown, ...(action.details || {}) },
  });
  return true;
}

async function releaseLock(supabase: any, companyId: string, actionKey: string, status = "completed", errorMessage = "") {
  await supabase.rpc("ai_agent_release_lock", {
    p_company_id: companyId,
    p_action_key: actionKey,
    p_status: status,
    p_error_message: errorMessage || null,
  });
}

async function underHourlyRateLimit(supabase: any, settings: AgentSettings) {
  const maxPerHour = clamp(safeNumber(settings.max_actions_per_hour, 20), 1, 500);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("ai_agent_audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("company_id", settings.company_id)
    .eq("actor", "AI_AGENT_WORKER")
    .in("status", ["completed", "queued", "lock_acquired"])
    .gte("created_at", since);
  if (error) {
    console.warn("AI Agent rate limit check failed:", error.message);
    return true;
  }
  return safeNumber(count, 0) < maxPerHour;
}

async function sendViaDispatcher(supabase: any, payload: Json) {
  // v10: call the dispatcher through fetch instead of supabase.functions.invoke.
  // This avoids nested Edge Function client errors and keeps the worker fail-safe.
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const emailDispatcherSecret = Deno.env.get("VISAFLOW_EMAIL_DISPATCHER_SECRET") || "";
    if (!supabaseUrl || !anonKey || !emailDispatcherSecret) {
      return { ok: false, skipped: true, error: "Email dispatcher is not configured" };
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/visaflow-email-dispatcher`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        "x-visaflow-email-secret": emailDispatcherSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message_type: String(payload.type || ""),
        company_id: payload.company_id || null,
        request_id: payload.request_id || undefined,
        agency_id: payload.agency_id || undefined,
        variables: (payload.variables && typeof payload.variables === "object") ? payload.variables : {},
      }),
    });

    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }

    if (!response.ok || data?.ok === false) {
      return { ok: false, status: response.status, error: String(data?.error || "Email dispatcher failed") };
    }

    return data || { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getManagerEmail(supabase: any, settings: AgentSettings, users: Row[]) {
  const override = uniqueEmails(settings.manager_approval_email || "");
  if (override) return override;

  const roleMatches = ["recruitment manager", "recruitment_manager", "manager recruitment", "مدير التوظيف"];
  const managerEmails = users
    .filter((u) => String(u.company_id || settings.company_id) === String(settings.company_id))
    .filter((u) => u.is_active !== false && normalize(u.status || "active") !== "inactive")
    .filter((u) => {
      const role = normalize(firstText(u.role, u.position, u.job_title));
      return roleMatches.some((item) => role.includes(normalize(item)));
    })
    .map((u) => firstText(u.email, u.user_email, u.work_email))
    .filter(Boolean);

  const emails = uniqueEmails(managerEmails.join(","));
  if (emails) return emails;

  // Optional fallback from company_email_settings if the table exists.
  const { data } = await supabase
    .from("company_email_settings")
    .select("notification_email, notifications_email, hr_email, recruitment_email, sender_email")
    .eq("company_id", settings.company_id)
    .maybeSingle();
  return uniqueEmails(firstText(data?.notification_email, data?.notifications_email, data?.recruitment_email, data?.hr_email, data?.sender_email));
}

function getRequestQty(request: Row, requestLines: Row[]) {
  const direct = safeNumber(firstText(request.quantity, request.qty, request.required_qty, request.remaining_qty), 0);
  if (direct > 0) return direct;
  const lines = requestLines.filter((line) => String(line.request_id || "") === String(request.id || "") || String(line.request_no || "") === String(request.request_no || ""));
  const lineQty = lines.reduce((sum, line) => sum + safeNumber(line.quantity, 0), 0);
  return lineQty || 1;
}

function getRequestField(request: Row, requestLines: Row[], field: string) {
  const direct = firstText(request[field]);
  if (direct) return direct;
  const lines = requestLines.filter((line) => String(line.request_id || "") === String(request.id || "") || String(line.request_no || "") === String(request.request_no || ""));
  return firstText(...lines.map((line) => line[field]));
}

function buildAgencyScorecard(agencies: Row[], candidates: Row[], authorizations: Row[], interviews: Row[]) {
  const agencyNames = Array.from(new Set([
    ...agencies.map((a) => firstText(a.name, a.agency_name)).filter(Boolean),
    ...candidates.map((c) => firstText(c.agency, c.agency_name)).filter(Boolean),
    ...authorizations.map((a) => firstText(a.agency, a.agency_name)).filter(Boolean),
  ]));

  return agencyNames.map((agencyName) => {
    const agencyCandidates = candidates.filter((c) => normalize(firstText(c.agency, c.agency_name)) === normalize(agencyName));
    const agencyInterviews = interviews.filter((i) => normalize(firstText(i.agency, i.agency_name)) === normalize(agencyName));
    const agencyAuthorizations = authorizations.filter((a) => normalize(firstText(a.agency, a.agency_name)) === normalize(agencyName) && normalize(a.status) !== "cancelled");
    const passed = agencyInterviews.filter((i) => normalize(i.status) === "passed").length;
    const arrived = agencyCandidates.filter((c) => ["arrived ksa", "arrived", "joined"].includes(normalize(c.status))).length;
    const joined = agencyCandidates.filter((c) => normalize(c.status) === "joined").length;
    const failed = agencyCandidates.filter((c) => isTerminalCandidateStatus(c.status) && normalize(c.status) !== "joined").length;
    const authorizedQty = agencyAuthorizations.reduce((sum, a) => sum + safeNumber(a.allocated_qty, 0), 0);
    const submissionRate = authorizedQty ? Math.round((agencyCandidates.length / authorizedQty) * 100) : agencyCandidates.length ? 100 : 0;
    const successRate = agencyCandidates.length ? Math.round(((arrived + joined) / agencyCandidates.length) * 100) : 0;
    const failRate = agencyCandidates.length ? Math.round((failed / agencyCandidates.length) * 100) : 0;
    const interviewPassRate = agencyInterviews.length ? Math.round((passed / agencyInterviews.length) * 100) : 0;
    const score = clamp(Math.round(successRate * 0.35 + interviewPassRate * 0.25 + Math.min(submissionRate, 100) * 0.25 - failRate * 0.15 + Math.min(agencyCandidates.length, 20)), 0, 100);
    const risk = score < 45 || failRate >= 35 ? "High" : score < 70 || submissionRate < 50 ? "Medium" : "Low";
    return { agency: agencyName, candidates: agencyCandidates.length, authorizedQty, submissionRate, successRate, failRate, interviewPassRate, score, risk };
  }).sort((a, b) => b.score - a.score);
}

function agencyFitScore(request: Row, agency: Row, ctx: { candidates: Row[]; authorizations: Row[]; scorecard: Row[]; requestLines: Row[] }) {
  const agencyName = firstText(agency.name, agency.agency_name);
  const profession = getRequestField(request, ctx.requestLines, "profession");
  const nationality = getRequestField(request, ctx.requestLines, "nationality");
  const requestQty = getRequestQty(request, ctx.requestLines);
  const scoreRow = ctx.scorecard.find((row) => normalize(row.agency) === normalize(agencyName)) || { score: 0, risk: "New" };
  const agencyCandidates = ctx.candidates.filter((c) => normalize(firstText(c.agency, c.agency_name)) === normalize(agencyName));
  const professionExperience = agencyCandidates.filter((c) => normalize(c.profession).includes(normalize(profession)) || normalize(profession).includes(normalize(c.profession))).length;
  const nationalityExperience = agencyCandidates.filter((c) => normalize(c.nationality) === normalize(nationality)).length;
  const openLoad = ctx.authorizations
    .filter((a) => normalize(firstText(a.agency, a.agency_name)) === normalize(agencyName) && !isTerminalAuthorizationStatus(a.status))
    .reduce((sum, a) => sum + safeNumber(a.allocated_qty, 0), 0);

  let score = 40;
  score += Math.min(safeNumber(scoreRow.score, 0) * 0.3, 30);
  if (professionExperience > 0) score += Math.min(10, professionExperience * 2);
  if (nationalityExperience > 0) score += Math.min(10, nationalityExperience * 2);
  if (scoreRow.risk === "Low") score += 8;
  if (scoreRow.risk === "High") score -= 18;
  if (openLoad > 0 && requestQty > 0) score -= Math.min(12, Math.round(openLoad / Math.max(requestQty, 1)));
  if (normalize(agency.status || "active") === "inactive") score -= 30;

  const reasons = [] as string[];
  if (professionExperience) reasons.push(`Handled ${professionExperience} similar profession candidate(s)`);
  if (nationalityExperience) reasons.push(`Handled ${nationalityExperience} candidate(s) from ${nationality || "same nationality"}`);
  if (scoreRow.score) reasons.push(`Agency score ${scoreRow.score} / Risk ${scoreRow.risk}`);
  if (openLoad > 0) reasons.push(`Current open authorization load ${openLoad}`);
  if (!reasons.length) reasons.push("Best available fit based on current agency data.");

  return { score: clamp(Math.round(score), 0, 100), reasons, scorecard: scoreRow, openLoad };
}

function getAssignmentRecommendations(ctx: {
  requests: Row[]; agencies: Row[]; candidates: Row[]; authorizations: Row[]; interviews: Row[]; requestLines: Row[];
}) {
  const openStatuses = ["", "open", "under recruitment", "interview stage", "visa process", "pending"];
  const activeAgencies = ctx.agencies.filter((a) => normalize(a.status || "active") !== "inactive");
  const scorecard = buildAgencyScorecard(ctx.agencies, ctx.candidates, ctx.authorizations, ctx.interviews);

  return ctx.requests
    .filter((r) => openStatuses.includes(normalize(r.status || "open")))
    .map((request) => {
      const requestNo = firstText(request.request_no, request.id);
      const relatedCandidates = ctx.candidates.filter((c) => String(c.request_no || "") === String(requestNo) && !isTerminalCandidateStatus(c.status));
      const requiredQty = getRequestQty(request, ctx.requestLines);
      const remaining = Math.max(requiredQty - relatedCandidates.length, 0);
      if (remaining <= 0) return null;

      const ranked = activeAgencies.map((agency) => {
        const fit = agencyFitScore(request, agency, { ...ctx, scorecard });
        return {
          id: agency.id || null,
          agency: firstText(agency.name, agency.agency_name),
          email: firstText(agency.email, agency.contact_email, agency.official_email),
          fitScore: fit.score,
          fitReasons: fit.reasons,
          risk: fit.scorecard.risk || "New",
          agencyScore: fit.scorecard.score || 0,
          openLoad: fit.openLoad,
        };
      }).sort((a, b) => b.fitScore - a.fitScore);

      const bestAgency = ranked[0];
      const daysOpen = daysBetween(request.created_at);
      return {
        request,
        request_no: requestNo,
        project: firstText(request.project_name, request.project),
        profession: getRequestField(request, ctx.requestLines, "profession"),
        nationality: getRequestField(request, ctx.requestLines, "nationality"),
        gender: getRequestField(request, ctx.requestLines, "gender"),
        requiredQty,
        currentCandidates: relatedCandidates.length,
        remaining,
        daysOpen,
        priority: firstText(request.priority, daysOpen >= 15 ? "High" : "Medium"),
        bestAgency,
        rankedAgencies: ranked.slice(0, 3),
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => safeNumber(b.remaining) - safeNumber(a.remaining));
}

function buildManagerApprovalContent(item: Row) {
  const reason = item.bestAgency?.fitReasons?.length ? item.bestAgency.fitReasons.join("; ") : "Best current fit based on agency performance and available request data.";
  const subject = `[VisaFlow AI Agent] Approval Required - ${item.request_no}`;
  const lines = [
    "AI Recruitment Agent detected a request that needs agency assignment approval.",
    `Request No: ${item.request_no}`,
    `Project: ${item.project || "-"}`,
    `Profession: ${item.profession || "-"}`,
    `Nationality: ${item.nationality || "-"}`,
    `Gender: ${item.gender || "-"}`,
    `Required Quantity: ${item.requiredQty || 0}`,
    `Remaining Quantity: ${item.remaining || 0}`,
    `Recommended Agency: ${item.bestAgency.agency}`,
    `Fit Score: ${item.bestAgency.fitScore || 0}%`,
    `Reason: ${reason}`,
    "Suggested Action: Approve assignment and request first candidate batch within 72 hours.",
  ];
  const message = `AI Agent recommends assigning ${item.request_no} to ${item.bestAgency.agency}.\n\nReason: ${reason}\n\nSuggested action: approve and notify agency to submit first candidate batch within 72 hours.`;
  return { subject, lines, message, title: `Manager Approval Required - ${item.request_no}` };
}

async function processManagerApprovals(supabase: any, settings: AgentSettings, runId: string, ctx: any, remainingBudget: number) {
  if (!settings.auto_manager_approval) return { created: 0, skipped: 0, errors: 0 };
  const mode = normalize(settings.mode || "auto_notify_manager");
  if (!["auto_notify_manager", "auto_followup_agencies", "full_auto"].includes(mode)) return { created: 0, skipped: 0, errors: 0 };

  const managerEmail = await getManagerEmail(supabase, settings, ctx.users);
  const recommendations = getAssignmentRecommendations(ctx).slice(0, remainingBudget);
  let created = 0, skipped = 0, errors = 0;

  for (const item of recommendations) {
    if (created >= remainingBudget) break;
    if (!item.bestAgency || !managerEmail) { skipped++; continue; }
    if (!(await underHourlyRateLimit(supabase, settings))) { skipped++; break; }

    const actionType = "AI_AGENT_AUTO_MANAGER_APPROVAL";
    const actionKey = `manager_approval:${item.request_no}:${item.bestAgency.id || item.bestAgency.agency}`;

    try {
      const locked = await acquireLock(supabase, settings, runId, {
        actionKey,
        actionType,
        relatedTable: "requests",
        relatedId: item.request_no,
        agencyId: item.bestAgency.id || null,
        title: `Manager approval prepared for ${item.request_no}`,
        details: { recommended_agency: item.bestAgency.agency, fit_score: item.bestAgency.fitScore },
      });
      if (!locked) { skipped++; continue; }

      // A second dedupe layer: do not create duplicate notification for same request/agency.
      const { data: duplicate } = await supabase
        .from("notification_events")
        .select("id")
        .eq("company_id", settings.company_id)
        .eq("type", "AI_AGENT_ASSIGNMENT_APPROVAL")
        .eq("related_id", item.request_no)
        .limit(1);
      if ((duplicate || []).length) {
        skipped++;
        await releaseLock(supabase, settings.company_id, actionKey, "skipped", "notification_exists");
        continue;
      }

      const content = buildManagerApprovalContent(item);
      await supabase.from("notification_events").insert([{
        company_id: settings.company_id,
        agency_id: item.bestAgency.id || null,
        type: "AI_AGENT_ASSIGNMENT_APPROVAL",
        title: content.title,
        message: content.message,
        priority: item.priority || "Medium",
        status: "Unread",
        related_table: "requests",
        related_id: item.request_no,
        data: {
          source: "AI Agent Worker / Request Assignment",
          delivery_channel: "Manager Approval Inbox + Email",
          manager_email: managerEmail,
          recommendation: item,
          auto_generated: true,
        },
      }]);

      const managerEmailResult = await sendViaDispatcher(supabase, {
        company_id: settings.company_id,
        type: actionType,
        request_id: item.request?.id,
        variables: { recommended_agency: item.bestAgency.agency, fit_score: item.bestAgency.fitScore },
      });

      await audit(supabase, {
        companyId: settings.company_id,
        runId,
        actionType,
        actionKey,
        status: "completed",
        severity: managerEmailResult?.ok ? "info" : "warning",
        title: `Manager approval notification prepared for ${item.request_no}`,
        targetTable: "requests",
        targetId: item.request_no,
        agencyId: item.bestAgency.id || null,
        agencyName: item.bestAgency.agency,
        requestNo: item.request_no,
        details: {
          recommended_agency: item.bestAgency.agency,
          fit_score: item.bestAgency.fitScore,
          manager_email_sent: !!managerEmailResult?.ok,
          manager_email_error: managerEmailResult?.ok ? null : managerEmailResult?.error || null,
        },
      });
      await releaseLock(supabase, settings.company_id, actionKey, "completed");
      created++;
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      await audit(supabase, {
        companyId: settings.company_id,
        runId,
        actionType,
        actionKey,
        status: "failed",
        severity: "error",
        title: `Manager approval failed for ${item.request_no}`,
        targetTable: "requests",
        targetId: item.request_no,
        agencyId: item.bestAgency?.id || null,
        agencyName: item.bestAgency?.agency || "",
        requestNo: item.request_no,
        errorMessage: message,
      });
      await releaseLock(supabase, settings.company_id, actionKey, "failed", message);
    }
  }
  return { created, skipped, errors };
}

function getAgencyMap(agencies: Row[]) {
  const map = new Map<string, Row>();
  for (const agency of agencies) {
    const name = normalize(firstText(agency.name, agency.agency_name));
    if (name) map.set(name, agency);
  }
  return map;
}

function buildAgencyEmail(task: Row) {
  const subject = `[VisaFlow Follow-up] ${task.title}`;
  const body = `Dear ${task.agency} Team,\n\nVisaFlow AI Agent detected an item requiring your immediate update.\n\nFollow-up Type: ${task.type}\nPriority: ${task.priority}\nReference: ${task.reference || "-"}\nRequest No: ${task.request_no || "-"}\n\nReason:\n${task.reason}\n\nRequired Action:\n${task.action_required}\n\nPlease update the candidate / authorization record in the Office Portal or reply with the latest status, expected completion date, and any blockers.\n\nBest regards,\nVisaFlow AI Agent\nRecruitment Follow-up Assistant`;
  return { subject, body };
}

function getAgencyFollowUpTasks(settings: AgentSettings, ctx: any) {
  const reminderDays = clamp(safeNumber(settings.agency_reminder_after_days, 3), 1, 90);
  const escalationDays = clamp(safeNumber(settings.escalation_after_days, 7), 2, 180);
  const agencyMap = getAgencyMap(ctx.agencies);
  const scorecard = buildAgencyScorecard(ctx.agencies, ctx.candidates, ctx.authorizations, ctx.interviews);
  const tasks: Row[] = [];

  for (const candidate of ctx.candidates) {
    if (isTerminalCandidateStatus(candidate.status)) continue;
    const lastUpdate = firstText(candidate.updated_at, candidate.created_at);
    const staleDays = daysBetween(lastUpdate);
    if (staleDays < reminderDays) continue;
    const agencyName = firstText(candidate.agency, candidate.agency_name, "Unassigned Agency");
    const agency = agencyMap.get(normalize(agencyName)) || {};
    tasks.push({
      type: "Candidate Update Follow-up",
      priority: staleDays >= escalationDays ? "High" : "Medium",
      agency: agencyName,
      agency_id: agency.id || null,
      agency_email: firstText(agency.email, agency.contact_email, agency.official_email),
      reference: firstText(candidate.candidate_name, candidate.passport_no, candidate.id),
      request_no: firstText(candidate.request_no, "-"),
      related_table: "candidates",
      related_id: String(candidate.id || ""),
      title: `Candidate update required: ${firstText(candidate.candidate_name, candidate.passport_no, candidate.id)}`,
      reason: `${firstText(candidate.candidate_name, candidate.passport_no, candidate.id)} has no update for ${staleDays} day(s). Current status: ${firstText(candidate.status, "-")}.`,
      action_required: "Update candidate status, latest stage, expected next date, and blockers within 24 hours.",
    });
  }

  // Authorization has allocation but no candidates submitted.
  for (const auth of ctx.authorizations) {
    if (isTerminalAuthorizationStatus(auth.status)) continue;
    const daysOpen = daysBetween(auth.created_at);
    if (daysOpen < reminderDays) continue;
    const hasCandidate = ctx.candidates.some((c: Row) =>
      String(c.visa_no || "") === String(auth.visa_no || "") ||
      String(c.authorization_no || "") === String(auth.authorization_no || ""),
    );
    if (hasCandidate) continue;
    const agencyName = firstText(auth.agency, auth.agency_name, "Unassigned Agency");
    const agency = agencyMap.get(normalize(agencyName)) || {};
    tasks.push({
      type: "Authorization Follow-up",
      priority: daysOpen >= escalationDays ? "High" : "Medium",
      agency: agencyName,
      agency_id: agency.id || null,
      agency_email: firstText(agency.email, agency.contact_email, agency.official_email),
      reference: firstText(auth.authorization_no, auth.visa_no, auth.id),
      request_no: firstText(auth.request_no, "-"),
      related_table: "visa_authorizations",
      related_id: String(auth.id || ""),
      title: `No candidates submitted for authorization ${firstText(auth.authorization_no, auth.visa_no, auth.id)}`,
      reason: `Authorization ${firstText(auth.authorization_no, "-")} / Visa ${firstText(auth.visa_no, "-")} has allocated quantity ${safeNumber(auth.allocated_qty, 0)} but no submitted candidates yet.`,
      action_required: "Submit candidates or provide a clear sourcing recovery plan today.",
    });
  }

  // Agency performance risk, limited to High/Medium risk agencies.
  for (const row of scorecard.filter((x: Row) => x.risk !== "Low")) {
    const agency = agencyMap.get(normalize(row.agency)) || {};
    tasks.push({
      type: "Agency Performance Follow-up",
      priority: row.risk === "High" ? "High" : "Medium",
      agency: row.agency,
      agency_id: agency.id || null,
      agency_email: firstText(agency.email, agency.contact_email, agency.official_email),
      reference: `Agency score ${row.score}`,
      request_no: "-",
      related_table: "agencies",
      related_id: String(agency.id || row.agency),
      title: `Agency performance follow-up: ${row.agency}`,
      reason: `Agency risk level is ${row.risk}. Score: ${row.score}. Success rate: ${row.successRate}%. Fail rate: ${row.failRate}%.`,
      action_required: "Confirm corrective action plan, pending candidates, and expected delivery dates.",
    });
  }

  const unique = new Map<string, Row>();
  for (const task of tasks) {
    const key = `${task.type}|${task.agency_id || task.agency}|${task.related_table}|${task.related_id}`;
    if (!unique.has(key)) unique.set(key, task);
  }
  return Array.from(unique.values()).sort((a, b) => ({ High: 2, Medium: 1, Low: 0 }[b.priority] || 0) - ({ High: 2, Medium: 1, Low: 0 }[a.priority] || 0));
}


function getPriorityWeight(priority: unknown) {
  const value = String(priority || "Medium");
  if (value === "High" || value === "Urgent") return 3;
  if (value === "Medium") return 2;
  if (value === "Low") return 1;
  return 0;
}

function groupAgencyFollowUpTasks(settings: AgentSettings, tasks: Row[]) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const groups = new Map<string, Row>();

  for (const task of tasks) {
    const agencyName = firstText(task.agency, task.agency_name, "Unassigned Agency");
    const agencyKey = String(task.agency_id || normalize(agencyName) || "unassigned-agency");
    const key = `${settings.company_id}|${agencyKey}`;

    if (!groups.has(key)) {
      groups.set(key, {
        agency: agencyName,
        agency_id: task.agency_id || null,
        agency_email: firstText(task.agency_email),
        related_table: "agencies",
        related_id: String(task.agency_id || agencyKey),
        highest_priority: task.priority || "Medium",
        tasks: [],
        request_nos: [],
        dedupe_key: `AI_AGENT_AGENCY_DAILY_DIGEST|${settings.company_id}|${agencyKey}|${todayKey}`,
      });
    }

    const group = groups.get(key);
    group.tasks.push(task);

    if (!group.agency_email && task.agency_email) {
      group.agency_email = task.agency_email;
    }

    if (getPriorityWeight(task.priority) > getPriorityWeight(group.highest_priority)) {
      group.highest_priority = task.priority || "Medium";
    }

    const requestNo = firstText(task.request_no);
    if (requestNo && requestNo !== "-" && !group.request_nos.includes(requestNo)) {
      group.request_nos.push(requestNo);
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const priorityDiff = getPriorityWeight(b.highest_priority) - getPriorityWeight(a.highest_priority);
    if (priorityDiff) return priorityDiff;
    return safeNumber(b.tasks?.length, 0) - safeNumber(a.tasks?.length, 0);
  });
}

function buildAgencyDigestEmail(digest: Row) {
  const tasks = (digest.tasks || []) as Row[];
  const requestNos = (digest.request_nos || []) as string[];
  const requestSummary = requestNos.length ? requestNos.join(", ") : "-";
  const shownTasks = tasks.slice(0, 60);
  const hiddenCount = Math.max(0, tasks.length - shownTasks.length);

  const tasksByRequest = new Map<string, Row[]>();
  for (const task of shownTasks) {
    const requestNo = firstText(task.request_no, "-");
    if (!tasksByRequest.has(requestNo)) tasksByRequest.set(requestNo, []);
    tasksByRequest.get(requestNo)?.push(task);
  }

  const sections = Array.from(tasksByRequest.entries()).map(([requestNo, requestTasks]) => {
    const lines = requestTasks.map((task, index) =>
      `${index + 1}. [${task.type || "Follow-up"}] ${task.reference || task.title || "-"} | Priority: ${task.priority || "Medium"}\n   Reason: ${task.reason || "-"}\n   Required Action: ${task.action_required || "-"}`
    ).join("\n\n");

    return `Request No: ${requestNo}\n${lines}`;
  }).join("\n\n----------------------------------------\n\n");

  const subject = `[VisaFlow Daily Follow-up] ${digest.agency || "Agency"} - ${tasks.length} pending item(s)`;
  const body = `Dear ${digest.agency || "Agency"} Team,

VisaFlow AI Agent detected pending updates that require your action.

Daily Digest Summary:
Agency: ${digest.agency || "-"}
Total Pending Items: ${tasks.length}
Highest Priority: ${digest.highest_priority || "Medium"}
Request(s): ${requestSummary}

Pending Items:
${sections || "-"}

${hiddenCount ? `Additional hidden items: ${hiddenCount}. Please open VisaFlow Office Portal to review all pending items.\n\n` : ""}Required Action:
Please update candidate status, latest stage, expected next date, and blockers from the Office Portal. If an item is delayed, add the reason and expected completion date.

Best regards,
VisaFlow AI Agent
Recruitment Follow-up Assistant`;

  return { subject, body };
}

async function notificationHasDedupeColumn(supabase: any, settings: AgentSettings, dedupeKey: string) {
  const { data, error } = await supabase
    .from("notification_events")
    .select("id")
    .eq("company_id", settings.company_id)
    .eq("dedupe_key", dedupeKey)
    .limit(1);

  if (error) {
    console.warn("AI Agent digest dedupe_key check failed. Falling back to date-based duplicate check:", error.message);
    return { supported: false, duplicate: false };
  }

  return { supported: true, duplicate: (data || []).length > 0 };
}

async function processAgencyFollowUps(supabase: any, settings: AgentSettings, runId: string, ctx: any, remainingBudget: number) {
  const mode = normalize(settings.mode || "auto_notify_manager");
  if (!settings.auto_followup_agencies || !["auto_followup_agencies", "full_auto"].includes(mode)) {
    return { created: 0, skipped: 0, errors: 0, emailSkipped: 0, groupedTasks: 0 };
  }

  const allTasks = getAgencyFollowUpTasks(settings, ctx);
  const allDigests = groupAgencyFollowUpTasks(settings, allTasks);
  const digests = allDigests.slice(0, remainingBudget);

  let created = 0, skipped = Math.max(0, allDigests.length - digests.length), errors = 0, emailSkipped = 0;
  const groupedTasks = allTasks.length;

  for (const digest of digests) {
    if (created >= remainingBudget) break;
    if (!(await underHourlyRateLimit(supabase, settings))) { skipped++; break; }

    const actionType = "AI_AGENT_AGENCY_DAILY_DIGEST";
    const actionKey = digest.dedupe_key;
    const email = buildAgencyDigestEmail(digest);
    const requestNoForHeader = digest.request_nos?.length === 1 ? digest.request_nos[0] : digest.request_nos?.length > 1 ? "Multiple" : "-";

    try {
      const locked = await acquireLock(supabase, settings, runId, {
        actionKey,
        actionType,
        relatedTable: "agencies",
        relatedId: digest.related_id,
        agencyId: digest.agency_id || null,
        title: email.subject,
        details: {
          agency: digest.agency,
          pending_items: digest.tasks?.length || 0,
          request_nos: digest.request_nos || [],
          priority: digest.highest_priority,
          send_email: !!settings.allow_auto_agency_emails,
        },
      });
      if (!locked) { skipped++; continue; }

      const dedupeCheck = await notificationHasDedupeColumn(supabase, settings, digest.dedupe_key);

      if (dedupeCheck.duplicate) {
        skipped++;
        await releaseLock(supabase, settings.company_id, actionKey, "skipped", "daily_digest_duplicate");
        continue;
      }

      if (!dedupeCheck.supported) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);

        let fallbackDuplicateQuery = supabase
          .from("notification_events")
          .select("id")
          .eq("company_id", settings.company_id)
          .eq("type", actionType)
          .eq("related_table", "agencies")
          .eq("related_id", digest.related_id)
          .gte("created_at", start.toISOString())
          .limit(1);

        const { data: fallbackDuplicate } = await fallbackDuplicateQuery;
        if ((fallbackDuplicate || []).length) {
          skipped++;
          await releaseLock(supabase, settings.company_id, actionKey, "skipped", "daily_digest_duplicate");
          continue;
        }
      }

      const notificationRow: Row = {
        company_id: settings.company_id,
        agency_id: digest.agency_id || null,
        agency_name: digest.agency || "",
        type: actionType,
        title: `Daily agency follow-up digest - ${digest.agency || "Agency"}`,
        message: email.body,
        priority: digest.highest_priority || "Medium",
        status: "Unread",
        related_table: "agencies",
        related_id: digest.related_id,
        request_no: requestNoForHeader,
        data: {
          source: "AI Agent Worker / Agency Daily Digest",
          delivery_channel: settings.allow_auto_agency_emails ? "Notification + Email" : "Notification Only",
          auto_generated: true,
          digest: true,
          total_pending_items: digest.tasks?.length || 0,
          agency: digest.agency,
          agency_id: digest.agency_id || null,
          agency_email: digest.agency_email || "",
          request_nos: digest.request_nos || [],
          highest_priority: digest.highest_priority || "Medium",
          tasks: digest.tasks || [],
        },
      };

      if (dedupeCheck.supported) {
        notificationRow.dedupe_key = digest.dedupe_key;
      }

      const { error: insertError } = await supabase.from("notification_events").insert([notificationRow]);
      if (insertError) throw insertError;

      if (settings.allow_auto_agency_emails) {
        if (digest.agency_email) {
          const agencyEmailResult = await sendViaDispatcher(supabase, {
            company_id: settings.company_id,
            type: "AI_AGENT_AGENCY_DAILY_DIGEST_EMAIL",
            agency_id: digest.agency_id || null,
            variables: {
              request_nos: digest.request_nos || [],
              pending_items: digest.tasks?.length || 0,
              highest_priority: digest.highest_priority || "Medium",
            },
          });
          if (!agencyEmailResult?.ok) emailSkipped++;
        } else {
          emailSkipped++;
        }
      }

      await audit(supabase, {
        companyId: settings.company_id,
        runId,
        actionType,
        actionKey,
        status: "completed",
        severity: digest.highest_priority === "High" ? "warning" : "info",
        title: `Daily agency follow-up digest - ${digest.agency || "Agency"}`,
        targetTable: "agencies",
        targetId: digest.related_id,
        agencyId: digest.agency_id || null,
        agencyName: digest.agency,
        requestNo: requestNoForHeader,
        details: {
          digest: true,
          pending_items: digest.tasks?.length || 0,
          request_nos: digest.request_nos || [],
          email_sent: !!settings.allow_auto_agency_emails && !!digest.agency_email,
          email_skipped: !!settings.allow_auto_agency_emails && !digest.agency_email,
        },
      });
      await releaseLock(supabase, settings.company_id, actionKey, "completed");
      created++;
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      await audit(supabase, {
        companyId: settings.company_id,
        runId,
        actionType,
        actionKey,
        status: "failed",
        severity: "error",
        title: `Agency daily digest failed: ${digest.agency || "Agency"}`,
        targetTable: "agencies",
        targetId: digest.related_id,
        agencyId: digest.agency_id || null,
        agencyName: digest.agency,
        requestNo: requestNoForHeader,
        errorMessage: message,
      });
      await releaseLock(supabase, settings.company_id, actionKey, "failed", message);
    }
  }

  return { created, skipped, errors, emailSkipped, groupedTasks };
}

async function loadCompanyContext(supabase: any, companyId: string) {
  const [requests, agencies, candidates, authorizations, interviews, requestLines, users] = await Promise.all([
    safeSelect(supabase, "requests", companyId),
    safeSelect(supabase, "agencies", companyId),
    safeSelect(supabase, "candidates", companyId),
    safeSelect(supabase, "visa_authorizations", companyId),
    safeSelect(supabase, "interviews", companyId),
    safeSelect(supabase, "request_lines", companyId),
    safeSelect(supabase, "users", companyId),
  ]);
  return { requests, agencies, candidates, authorizations, interviews, requestLines, users };
}

async function processCompany(supabase: any, settings: AgentSettings, runId: string) {
  if (settings.is_active === false || normalize(settings.mode || "") === "off") {
    return { company_id: settings.company_id, skipped: true, reason: "AI Agent disabled" };
  }

  const maxPerRun = clamp(safeNumber(settings.max_auto_actions_per_run, 5), 1, 100);
  const ctx = await loadCompanyContext(supabase, settings.company_id);

  const manager = await processManagerApprovals(supabase, settings, runId, ctx, maxPerRun);
  const used = safeNumber(manager.created, 0);
  const remaining = Math.max(0, maxPerRun - used);
  const agency = remaining > 0 ? await processAgencyFollowUps(supabase, settings, runId, ctx, remaining) : { created: 0, skipped: 0, errors: 0, emailSkipped: 0 };

  return { company_id: settings.company_id, manager, agency, max_per_run: maxPerRun };
}

async function claimQueuedJobs(supabase: any, limit: number) {
  const { data: jobs, error } = await supabase
    .from("ai_agent_jobs")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return jobs || [];
}

async function getActiveSettings(supabase: any, companyId = "") {
  let query = supabase.from("ai_agent_settings").select("*").eq("is_active", true).neq("mode", "off");
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as AgentSettings[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("AI Agent worker server configuration is incomplete");
    return jsonResponse({ ok: false, error: "server_configuration_error" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const caller = await authenticateWorkerCaller(req, supabase);
  if ("error" in caller) return jsonResponse({ ok: false, error: caller.error }, caller.status);

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return jsonResponse({ ok: false, error: "request_too_large" }, 413);
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "request_too_large" }, 413);
  }

  let body: Json = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_) {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }

  const mode = String(body.mode || "queue_or_scheduled");
  if (!ALLOWED_MODES.has(mode)) return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  const jobLimit = clamp(Math.trunc(safeNumber(body.job_limit, 5)), 1, 10);
  const companyLimit = clamp(Math.trunc(safeNumber(body.company_limit, 10)), 1, 25);
  const runId = crypto.randomUUID();
  const results: Row[] = [];

  try {
    if (mode === "queue_only" || mode === "queue_or_scheduled") {
      const jobs = await claimQueuedJobs(supabase, jobLimit);
      for (const job of jobs) {
        const now = new Date().toISOString();
        const { error: claimError } = await supabase
          .from("ai_agent_jobs")
          .update({ status: "running", attempts: safeNumber(job.attempts, 0) + 1, locked_at: now, locked_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(), updated_at: now })
          .eq("id", job.id)
          .eq("status", "queued");
        if (claimError) {
          results.push({ job_id: job.id, ok: false, error: claimError.message });
          continue;
        }

        try {
          const settingsRows = await getActiveSettings(supabase, String(job.company_id));
          const settings = settingsRows[0];
          if (!settings) throw new Error("No active AI Agent settings for company");
          const result = await processCompany(supabase, settings, runId);
          await supabase.from("ai_agent_jobs").update({ status: "completed", completed_at: new Date().toISOString(), result, updated_at: new Date().toISOString() }).eq("id", job.id);
          results.push({ job_id: job.id, ok: true, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const attempts = safeNumber(job.attempts, 0) + 1;
          const finalStatus = attempts >= safeNumber(job.max_attempts, 3) ? "failed" : "queued";
          await supabase.from("ai_agent_jobs").update({ status: finalStatus, error_message: message, scheduled_for: new Date(Date.now() + 15 * 60 * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
          results.push({ job_id: job.id, ok: false, error: message, status: finalStatus });
        }
      }

      if (jobs.length > 0 || mode === "queue_only") {
        return jsonResponse({
          ok: true,
          mode,
          processed: results.length,
          succeeded: results.filter((item) => item.ok).length,
          failed: results.filter((item) => !item.ok).length,
        });
      }
    }

    // Scheduled mode: if no queued jobs exist, process active companies directly.
    const settingsRows = await getActiveSettings(supabase);
    for (const settings of settingsRows.slice(0, companyLimit)) {
      const result = await processCompany(supabase, settings, runId);
      results.push({ ok: true, result });
    }

    return jsonResponse({
      ok: true,
      mode: "scheduled",
      processed: results.length,
      succeeded: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("AI Agent worker run failed", { runId, caller: caller.kind, message });
    return jsonResponse({ ok: false, error: "worker_failed" }, 500);
  }
});
