import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AGENT_RISK,
  AGENT_TOOL_DEFINITIONS,
  buildAgencyPerformance,
  buildOperationalMemory,
  buildRecruitmentReviewPlan,
  detectRequestBlockers,
  firstAgentText,
  getAgentToolDefinition,
  normalizeAgentText,
  parseRequestReference,
  safeAgentNumber,
  selectReassignmentRecommendation,
  validateAgentToolCall,
} from "../_shared/aiAgentOrchestratorCore.mjs";

type Json = Record<string, any>;
type Actor = { id: string; auth_user_id: string; role: string; company_id: string };
type Caller = { kind: "authenticated"; actor: Actor } | { kind: "internal"; actor: null };
type ToolContext = {
  supabase: any;
  companyId: string;
  actorId: string | null;
  caseId: string;
  runId: string;
  settings: Json;
  cache: Json;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-visaflow-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ALLOWED_ROLES = new Set(["Admin", "Company Admin", "Recruitment Manager", "Recruitment Officer"]);
const MAX_BODY_BYTES = 16 * 1024;

class AgentFailure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

function response(body: Json, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}

function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0; for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

function bearer(req: Request) {
  return (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

async function authenticate(req: Request, admin: any): Promise<Caller> {
  const configured = Deno.env.get("AI_AGENT_WORKER_SECRET") || "";
  const supplied = req.headers.get("x-visaflow-worker-secret") || "";
  if (configured && supplied && secureEqual(configured, supplied)) return { kind: "internal", actor: null };
  const jwt = bearer(req);
  if (!jwt) throw new AgentFailure(401, "unauthorized");
  const { data: authData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authData?.user?.id) throw new AgentFailure(401, "unauthorized");
  const { data, error } = await admin.from("users")
    .select("id,auth_user_id,role,company_id,status,is_active")
    .eq("auth_user_id", authData.user.id).eq("status", "Active").eq("is_active", true).limit(2);
  if (error || data?.length !== 1 || !data[0].company_id || !ALLOWED_ROLES.has(data[0].role)) throw new AgentFailure(403, "forbidden");
  return { kind: "authenticated", actor: data[0] as Actor };
}

async function exactlyOne(query: any, code: string) {
  const { data, error } = await query.limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) throw new AgentFailure(404, code);
  return data[0];
}

async function audit(ctx: ToolContext, toolName: string, actionKey: string, status: string, details: Json, errorMessage = "") {
  const definition = getAgentToolDefinition(toolName);
  const { data, error } = await ctx.supabase.from("ai_agent_audit_logs").insert({
    company_id: ctx.companyId, run_id: ctx.runId, action_type: toolName.toUpperCase(), action_key: actionKey,
    status, severity: status === "failed" ? "error" : definition?.risk_level === "YELLOW" ? "warning" : "info",
    actor: "VISAFLOW_AGENT_ORCHESTRATOR", target_table: "requests", target_id: String(ctx.cache.request?.id || ""),
    agency_id: details.agency_id || null, agency_name: details.agency || null,
    request_no: firstAgentText(ctx.cache.request?.request_no, ctx.cache.request?.id), title: `${toolName}: ${status}`,
    details: { case_id: ctx.caseId, risk_level: definition?.risk_level || "GREEN", ...details }, error_message: errorMessage || null,
  }).select("id").single();
  if (error) throw error;
  await ctx.supabase.from("ai_agent_case_events").insert({
    company_id: ctx.companyId, case_id: ctx.caseId, run_id: ctx.runId, event_type: "TOOL_EXECUTION",
    tool_name: toolName, action: { action_key: actionKey }, result: { status, ...details }, summary: `${toolName} ${status}`,
  });
  return String(data.id);
}

async function acquire(ctx: ToolContext, toolName: string, actionKey: string, agencyId: string | null = null) {
  const { data, error } = await ctx.supabase.rpc("ai_agent_try_acquire_lock", {
    p_company_id: ctx.companyId, p_action_key: actionKey, p_action_type: toolName.toUpperCase(),
    p_related_table: "requests", p_related_id: String(ctx.cache.request.id), p_agency_id: agencyId,
    p_cooldown_minutes: Math.max(5, safeAgentNumber(ctx.settings.cooldown_minutes, 60)),
  });
  if (error) throw error;
  return data === true;
}

async function release(ctx: ToolContext, actionKey: string, status = "completed", error = "") {
  await ctx.supabase.rpc("ai_agent_release_lock", { p_company_id: ctx.companyId, p_action_key: actionKey, p_status: status, p_error_message: error || null });
}

async function dispatch(ctx: ToolContext, payload: Json) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secret = Deno.env.get("VISAFLOW_EMAIL_DISPATCHER_SECRET") || "";
  if (!url || !anon || !secret) return { ok: false, error: "email_dispatcher_not_configured" };
  const res = await fetch(`${url}/functions/v1/visaflow-email-dispatcher`, {
    method: "POST", headers: { Authorization: `Bearer ${anon}`, apikey: anon, "x-visaflow-email-secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: Json = {}; try { data = await res.json(); } catch { data = {}; }
  return { ...data, ok: res.ok && data.ok !== false, http_status: res.status };
}

function toolResult(overrides: Json = {}) {
  return { ok: true, verified: true, entity_id: null, previous_state: null, new_state: null, audit_id: null, ...overrides };
}

async function executeTool(name: string, input: Json, ctx: ToolContext): Promise<Json> {
  const validation = validateAgentToolCall(name, input);
  if (!validation.ok) throw new AgentFailure(400, validation.error || "invalid_tool_call");
  if (validation.definition.risk_level === AGENT_RISK.RED) throw new AgentFailure(403, "red_action_human_only");
  const blocked = Array.isArray(ctx.settings.blocked_actions) ? ctx.settings.blocked_actions.map(String) : [];
  if (blocked.includes(name)) throw new AgentFailure(403, "tool_blocked_by_tenant_policy");
  const mutating = ["send_agency_followup", "create_followup_task", "escalate_to_manager"].includes(name);
  const allowed = Array.isArray(ctx.settings.allowed_auto_actions) ? ctx.settings.allowed_auto_actions.map(String) : [];
  if (mutating && !allowed.includes(name)) throw new AgentFailure(403, "tool_not_allowed_by_tenant_policy");
  if (mutating) {
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { count, error } = await ctx.supabase.from("ai_agent_audit_logs").select("id", { count: "exact", head: true })
      .eq("company_id", ctx.companyId).eq("actor", "VISAFLOW_AGENT_ORCHESTRATOR").eq("status", "completed").gte("created_at", dayStart.toISOString());
    if (error) throw error;
    if (safeAgentNumber(count, 0) >= Math.max(1, safeAgentNumber(ctx.settings.max_agent_actions_per_day, 50))) throw new AgentFailure(429, "tenant_daily_action_limit_reached");
  }

  if (name === "get_request") {
    const ref = String(input.request_ref);
    let request = null;
    const byNo = await ctx.supabase.from("requests").select("*").eq("company_id", ctx.companyId).eq("request_no", ref).limit(2);
    if (byNo.error) throw byNo.error;
    if (byNo.data?.length === 1) request = byNo.data[0];
    if (!request && /^\d+$/.test(ref)) request = await exactlyOne(ctx.supabase.from("requests").select("*").eq("company_id", ctx.companyId).eq("id", ref), "request_not_found");
    if (!request) throw new AgentFailure(404, "request_not_found");
    ctx.cache.request = request;
    return toolResult({ entity_id: String(request.id), data: request });
  }

  const request = ctx.cache.request;
  if (!request || (name !== "verify_action" && String(request.id) !== String(input.request_id))) throw new AgentFailure(409, "request_context_mismatch");

  if (name === "get_request_lines") {
    const { data, error } = await ctx.supabase.from("request_lines").select("*").eq("company_id", ctx.companyId).eq("request_no", request.request_no).order("line_no");
    if (error) throw error; ctx.cache.requestLines = data || [];
    return toolResult({ entity_id: String(request.id), data: data || [] });
  }
  if (name === "get_request_candidates") {
    const { data, error } = await ctx.supabase.from("candidates").select("*").eq("company_id", ctx.companyId).eq("request_no", request.request_no);
    if (error) throw error; ctx.cache.candidates = data || [];
    return toolResult({ entity_id: String(request.id), data: data || [] });
  }
  if (name === "get_request_agencies") {
    const { data: auths, error: authError } = await ctx.supabase.from("visa_authorizations").select("*").eq("company_id", ctx.companyId).eq("request_no", request.request_no);
    if (authError) throw authError;
    const names = new Set([...(ctx.cache.candidates || []).map((row: Json) => firstAgentText(row.agency, row.agency_name)), ...(auths || []).map((row: Json) => firstAgentText(row.agency, row.agency_name))].filter(Boolean).map(normalizeAgentText));
    const { data: allAgencies, error } = await ctx.supabase.from("agencies").select("id,name,email,status,company_id,updated_at").eq("company_id", ctx.companyId);
    if (error) throw error;
    const responsible = (allAgencies || []).filter((row: Json) => names.has(normalizeAgentText(row.name)));
    ctx.cache.authorizations = auths || []; ctx.cache.allAgencies = allAgencies || []; ctx.cache.agencies = responsible;
    return toolResult({ entity_id: String(request.id), data: responsible, unresolved_agency_names: Array.from(names).filter((key) => !responsible.some((row: Json) => normalizeAgentText(row.name) === key)) });
  }
  if (name === "get_agency_performance") {
    const [candidateResult, authResult] = await Promise.all([
      ctx.supabase.from("candidates").select("id,agency,status,created_at,updated_at,company_id").eq("company_id", ctx.companyId),
      ctx.supabase.from("visa_authorizations").select("id,agency,allocated_qty,status,company_id").eq("company_id", ctx.companyId),
    ]);
    if (candidateResult.error) throw candidateResult.error; if (authResult.error) throw authResult.error;
    const performance = buildAgencyPerformance(ctx.cache.allAgencies || [], candidateResult.data || [], authResult.data || []);
    ctx.cache.performance = performance;
    return toolResult({ entity_id: String(request.id), data: performance });
  }
  if (name === "get_request_blockers") {
    const analysis = detectRequestBlockers({
      request, requestLines: ctx.cache.requestLines || [], candidates: ctx.cache.candidates || [], agencies: ctx.cache.allAgencies || [],
      authorizations: ctx.cache.authorizations || [], reminderDays: safeAgentNumber(ctx.settings.agency_reminder_after_days, 3),
      escalationDays: safeAgentNumber(ctx.settings.escalation_after_days, 7),
    });
    ctx.cache.analysis = analysis;
    return toolResult({ entity_id: String(request.id), data: analysis });
  }

  if (name === "send_agency_followup") {
    const agency = (ctx.cache.agencies || []).find((row: Json) => String(row.id) === String(input.agency_id));
    if (!agency) throw new AgentFailure(403, "agency_not_responsible_for_request");
    const day = new Date().toISOString().slice(0, 10);
    const actionKey = `${ctx.companyId}:${request.id}:${agency.id}:send_agency_followup:${day}`;
    if (!(await acquire(ctx, name, actionKey, agency.id))) return toolResult({ ok: false, verified: true, skipped: true, reason: "cooldown_or_duplicate" });
    try {
      const { data: event, error } = await ctx.supabase.from("notification_events").insert({
        company_id: ctx.companyId, agency_id: agency.id, agency_name: agency.name, type: "AI_AGENT_REQUEST_FOLLOWUP",
        title: `Recruitment request follow-up - ${request.request_no}`, message: `Operational update required for ${request.request_no}. Please update submissions, expected dates, and blockers.`,
        priority: ctx.cache.analysis?.blockers?.some((row: Json) => row.severity === "High") ? "High" : "Medium", status: "Unread",
        related_table: "requests", related_id: String(request.id), request_no: request.request_no, dedupe_key: actionKey,
        data: { source: "VisaFlow Agent Orchestrator", case_id: ctx.caseId, run_id: ctx.runId, gap: ctx.cache.analysis?.gap || {}, blockers: (ctx.cache.analysis?.blockers || []).map((row: Json) => ({ code: row.code, severity: row.severity, summary: row.summary })) },
      }).select("id,company_id,agency_id,type,dedupe_key").single();
      if (error) throw error;
      let delivery: Json = { ok: true, skipped: true, reason: "tenant_email_policy_disabled" };
      if (ctx.settings.allow_auto_agency_emails === true) delivery = await dispatch(ctx, { message_type: "AI_AGENT_REQUEST_FOLLOWUP", company_id: ctx.companyId, notification_event_id: String(event.id), variables: {} });
      const { data: verifiedEvent } = await ctx.supabase.from("notification_events").select("id,company_id,agency_id,dedupe_key").eq("id", event.id).eq("company_id", ctx.companyId).eq("agency_id", agency.id).maybeSingle();
      let emailEvidence: Json | null = null;
      if (ctx.settings.allow_auto_agency_emails === true) {
        const { data } = await ctx.supabase.from("email_logs").select("id,status,provider_message_id,idempotency_key").eq("company_id", ctx.companyId).eq("related_id", String(event.id)).order("created_at", { ascending: false }).limit(1).maybeSingle();
        emailEvidence = data || null;
      }
      const verified = Boolean(verifiedEvent) && (ctx.settings.allow_auto_agency_emails !== true || (delivery.ok && emailEvidence && ["Queued", "Sent"].includes(emailEvidence.status)));
      const auditId = await audit(ctx, name, actionKey, verified ? "completed" : "failed", { agency_id: agency.id, agency: agency.name, notification_event_id: event.id, delivery, email_evidence: emailEvidence });
      await release(ctx, actionKey, verified ? "completed" : "failed", verified ? "" : "followup_verification_failed");
      return toolResult({ ok: verified, verified, entity_id: String(event.id), audit_id: auditId, previous_state: null, new_state: verifiedEvent, delivery, email_evidence: emailEvidence });
    } catch (error) { await release(ctx, actionKey, "failed", error instanceof Error ? error.message : String(error)); throw error; }
  }

  if (name === "create_followup_task") {
    const agency = (ctx.cache.agencies || []).find((row: Json) => String(row.id) === String(input.agency_id));
    if (!agency) throw new AgentFailure(403, "agency_not_responsible_for_request");
    const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const actionKey = `${ctx.caseId}:${agency.id}:followup:${dueAt.slice(0, 13)}`;
    const { data, error } = await ctx.supabase.from("ai_agent_followup_tasks").upsert({
      company_id: ctx.companyId, case_id: ctx.caseId, run_id: ctx.runId, request_id: request.id, request_no: request.request_no,
      agency_id: agency.id, due_at: dueAt, priority: "High", summary: `Re-check agency response and recruitment blockers for ${request.request_no}.`, stable_action_key: actionKey,
    }, { onConflict: "company_id,stable_action_key" }).select("id,company_id,case_id,status,due_at,stable_action_key").single();
    if (error) throw error;
    const { data: verified } = await ctx.supabase.from("ai_agent_followup_tasks").select("id,company_id,case_id,status,due_at").eq("id", data.id).eq("company_id", ctx.companyId).maybeSingle();
    const auditId = await audit(ctx, name, actionKey, verified ? "completed" : "failed", { agency_id: agency.id, agency: agency.name, task_id: data.id, due_at: dueAt });
    return toolResult({ ok: Boolean(verified), verified: Boolean(verified), entity_id: String(data.id), audit_id: auditId, previous_state: null, new_state: verified });
  }

  if (name === "escalate_to_manager") {
    const period = new Date().toISOString().slice(0, 10);
    const actionKey = `${ctx.companyId}:${request.id}:manager_escalation:${period}`;
    const { data, error } = await ctx.supabase.from("notification_events").insert({
      company_id: ctx.companyId, type: "AI_AGENT_OPERATIONAL_ESCALATION", title: `Recruitment delay escalation - ${request.request_no}`,
      message: `Request ${request.request_no} requires manager attention. ${(ctx.cache.analysis?.blockers || []).map((row: Json) => row.summary).join(" ")}`.slice(0, 4000),
      priority: "High", status: "Unread", related_table: "requests", related_id: String(request.id), request_no: request.request_no,
      dedupe_key: actionKey, data: { source: "VisaFlow Agent Orchestrator", case_id: ctx.caseId, run_id: ctx.runId, non_financial: true },
    }).select("id,company_id,type,dedupe_key").single();
    if (error) throw error;
    const { data: verified } = await ctx.supabase.from("notification_events").select("id,company_id,type").eq("id", data.id).eq("company_id", ctx.companyId).maybeSingle();
    const auditId = await audit(ctx, name, actionKey, verified ? "completed" : "failed", { notification_event_id: data.id });
    return toolResult({ ok: Boolean(verified), verified: Boolean(verified), entity_id: String(data.id), audit_id: auditId, previous_state: null, new_state: verified });
  }

  if (name === "create_manager_approval_request") {
    const recommendation = ctx.cache.recommendation;
    if (!recommendation || String(recommendation.to_agency_id) !== String(input.agency_id)) return toolResult({ ok: false, verified: true, skipped: true, reason: "no_supported_yellow_recommendation" });
    const actionKey = `${ctx.caseId}:REASSIGN_REQUEST_QUANTITY:${recommendation.from_agency_id}:${recommendation.to_agency_id}`;
    const payload = { request_id: request.id, request_no: request.request_no, quantity: Math.min(ctx.cache.analysis.gap.gap, 5), ...recommendation };
    const { data, error } = await ctx.supabase.from("ai_agent_approval_requests").upsert({
      company_id: ctx.companyId, case_id: ctx.caseId, agent_run_id: ctx.runId, action_type: recommendation.action,
      tool_name: "assign_agency", target_type: "request", target_id: String(request.id), proposed_payload: payload,
      reason: `The responsible agency is high risk while a stronger tenant-approved alternative is available.`, evidence: recommendation.evidence,
      confidence: recommendation.confidence, risk_level: "YELLOW", stable_action_key: actionKey,
    }, { onConflict: "company_id,stable_action_key" }).select("id,company_id,case_id,approval_status,risk_level,proposed_payload").single();
    if (error) throw error;
    if (data?.approval_status !== "Pending") {
      const auditId = await audit(ctx, name, actionKey, "skipped", { approval_id: data?.id, reason: `approval_already_${String(data?.approval_status || "resolved").toLowerCase()}` });
      return toolResult({ ok: false, verified: true, skipped: true, entity_id: String(data.id), audit_id: auditId, reason: `approval_already_${String(data.approval_status).toLowerCase()}` });
    }
    const verified = data?.company_id === ctx.companyId && data?.approval_status === "Pending" && data?.risk_level === "YELLOW";
    const auditId = await audit(ctx, name, actionKey, verified ? "completed" : "failed", { approval_id: data?.id, proposed_action: recommendation.action, confidence: recommendation.confidence });
    return toolResult({ ok: verified, verified, entity_id: String(data.id), audit_id: auditId, previous_state: null, new_state: data, approval_required: true });
  }

  if (name === "verify_action") {
    const actionType = String(input.action_type); const entityId = String(input.entity_id);
    const tables: Json = { send_agency_followup: "notification_events", create_followup_task: "ai_agent_followup_tasks", escalate_to_manager: "notification_events", create_manager_approval_request: "ai_agent_approval_requests" };
    const table = tables[actionType]; if (!table) throw new AgentFailure(400, "unsupported_verification_target");
    const { data, error } = await ctx.supabase.from(table).select("*").eq("id", entityId).eq("company_id", ctx.companyId).maybeSingle();
    if (error) throw error;
    return toolResult({ ok: Boolean(data), verified: Boolean(data), entity_id: entityId, data });
  }
  throw new AgentFailure(400, "tool_not_implemented");
}

async function saveStep(ctx: ToolContext, stepNo: number, toolName: string, status: string, input: Json, output: Json, error = "") {
  const definition = getAgentToolDefinition(toolName)!;
  await ctx.supabase.from("ai_agent_execution_steps").upsert({
    company_id: ctx.companyId, case_id: ctx.caseId, run_id: ctx.runId, step_no: stepNo, tool_name: toolName,
    risk_level: definition.risk_level, approval_required: definition.human_approval_required, status, input,
    output: output || {}, verification: { verified: output?.verified === true, entity_id: output?.entity_id || null, audit_id: output?.audit_id || null },
    idempotency_key: output?.action_key || null, attempt_count: 1, error_message: error || null,
    started_at: new Date().toISOString(), completed_at: ["completed", "skipped", "failed", "awaiting_approval"].includes(status) ? new Date().toISOString() : null,
  }, { onConflict: "run_id,step_no" });
  await ctx.supabase.from("ai_agent_runs").update({ current_step: stepNo, completed_steps: status === "completed" ? stepNo : Math.max(0, stepNo - 1), failed_step: status === "failed" ? stepNo : null, last_error: error || null }).eq("id", ctx.runId).eq("company_id", ctx.companyId);
}

async function resolveInternalTenant(admin: any, body: Json) {
  if (body.job_id) {
    const job = await exactlyOne(admin.from("ai_agent_jobs").select("id,company_id,payload,job_type,status").eq("id", String(body.job_id)), "job_not_found");
    const payload = { ...(job.payload || {}), ...body, company_id: undefined };
    if (payload.case_id && !payload.request_ref) {
      const agentCase = await exactlyOne(admin.from("ai_agent_cases").select("id,company_id,target_id,goal").eq("id", String(payload.case_id)).eq("company_id", job.company_id), "case_not_found");
      payload.request_ref = agentCase.target_id;
      payload.goal = agentCase.goal;
    }
    return { companyId: String(job.company_id), actorId: null, payload };
  }
  if (body.case_id) {
    const agentCase = await exactlyOne(admin.from("ai_agent_cases").select("id,company_id,target_id,goal").eq("id", String(body.case_id)), "case_not_found");
    return { companyId: String(agentCase.company_id), actorId: null, payload: { ...body, request_ref: agentCase.target_id, goal: agentCase.goal, company_id: undefined } };
  }
  throw new AgentFailure(400, "internal_job_or_case_required");
}

async function runOrchestrator(admin: any, caller: Caller, originalBody: Json) {
  const resolved = caller.kind === "authenticated"
    ? { companyId: caller.actor.company_id, actorId: caller.actor.auth_user_id, payload: originalBody }
    : await resolveInternalTenant(admin, originalBody);
  const companyId = resolved.companyId; const body = resolved.payload;
  const goal = String(body.goal || "").trim().slice(0, 1000);
  const requestRef = parseRequestReference(goal, body.request_ref);
  if (!requestRef) throw new AgentFailure(400, "request_reference_required");

  const settings = await exactlyOne(admin.from("ai_agent_settings").select("*").eq("company_id", companyId).eq("is_active", true).neq("mode", "off"), "agent_not_enabled");
  const entitlement = await exactlyOne(admin.from("platform_clients").select("ai_agent_enabled,ai_agent_plan,ai_agent_trial_end,ai_agent_monthly_credit_limit").eq("operational_company_id", companyId), "agent_entitlement_not_found");
  const expired = entitlement.ai_agent_plan === "Professional Trial" && (!entitlement.ai_agent_trial_end || new Date(`${entitlement.ai_agent_trial_end}T23:59:59Z`) < new Date());
  if (entitlement.ai_agent_enabled !== true || !["Professional", "Professional Trial"].includes(entitlement.ai_agent_plan) || expired) throw new AgentFailure(403, "agent_professional_not_available");

  let request: Json;
  const byNo = await admin.from("requests").select("*").eq("company_id", companyId).eq("request_no", requestRef).limit(2);
  if (byNo.error) throw byNo.error;
  if (byNo.data?.length === 1) request = byNo.data[0];
  else if (/^\d+$/.test(requestRef)) request = await exactlyOne(admin.from("requests").select("*").eq("company_id", companyId).eq("id", requestRef), "request_not_found");
  else throw new AgentFailure(404, "request_not_found");

  const stableCaseKey = `RECRUITMENT_REQUEST_REVIEW:${request.id}`;
  const { data: agentCase, error: caseError } = await admin.from("ai_agent_cases").upsert({
    company_id: companyId, goal_type: "RECRUITMENT_REQUEST_REVIEW", goal: goal || `Review and safely resolve recruitment blockers for ${request.request_no}`,
    target_type: "request", target_id: String(request.id), status: "in_progress", priority: request.priority || "Medium",
    created_by: resolved.actorId, stable_case_key: stableCaseKey, updated_at: new Date().toISOString(), last_agent_run_at: new Date().toISOString(),
  }, { onConflict: "company_id,stable_case_key" }).select("*").single();
  if (caseError) throw caseError;
  const maxSteps = Math.min(20, Math.max(1, safeAgentNumber(body.max_steps, settings.max_agent_steps || 12)));
  const plan = buildRecruitmentReviewPlan({ goal: goal || agentCase.goal, requestRef: String(request.request_no || request.id), maxSteps });
  const { data: run, error: runError } = await admin.from("ai_agent_runs").insert({
    company_id: companyId, case_id: agentCase.id, trigger_type: caller.kind === "internal" ? "background_job" : "user_goal",
    requested_by: resolved.actorId, status: "in_progress", plan, max_steps: maxSteps,
  }).select("*").single();
  if (runError) throw runError;
  const ctx: ToolContext = { supabase: admin, companyId, actorId: resolved.actorId, caseId: agentCase.id, runId: run.id, settings, cache: { request } };
  const actions: Json[] = []; const results: Json = {};

  const planned = plan.steps as Json[];
  for (const plannedStep of planned) {
    const toolName = plannedStep.tool; const stepNo = plannedStep.step;
    let input: Json = { request_id: request.id };
    if (toolName === "get_request") input = { request_ref: String(request.request_no || request.id) };
    if (["send_agency_followup", "create_followup_task"].includes(toolName)) {
      const agency = ctx.cache.agencies?.[0];
      if (!agency || !ctx.cache.analysis?.blockers?.length) { await saveStep(ctx, stepNo, toolName, "skipped", input, { ok: true, verified: true, skipped: true, reason: "no_action_required" }); continue; }
      input = { request_id: request.id, agency_id: agency.id };
    }
    if (toolName === "escalate_to_manager" && !(ctx.cache.analysis?.blockers || []).some((row: Json) => row.severity === "High")) {
      await saveStep(ctx, stepNo, toolName, "skipped", input, { ok: true, verified: true, skipped: true, reason: "escalation_threshold_not_met" }); continue;
    }
    if (toolName === "create_manager_approval_request") {
      ctx.cache.recommendation = selectReassignmentRecommendation(ctx.cache.performance || [], (ctx.cache.agencies || []).map((row: Json) => row.id));
      if (!ctx.cache.recommendation || ctx.cache.analysis?.gap?.gap <= 0) { await saveStep(ctx, stepNo, toolName, "skipped", input, { ok: true, verified: true, skipped: true, reason: "no_supported_yellow_recommendation" }); continue; }
      input = { request_id: request.id, agency_id: ctx.cache.recommendation.to_agency_id };
    }
    if (toolName === "verify_action") {
      const last = [...actions].reverse().find((row) => row.entity_id);
      if (!last) { await saveStep(ctx, stepNo, toolName, "skipped", {}, { ok: true, verified: true, skipped: true, reason: "no_mutation_to_verify" }); continue; }
      input = { action_type: last.tool, entity_id: last.entity_id };
    }
    try {
      const output = await executeTool(toolName, input, ctx);
      results[toolName] = output;
      const status = output.skipped ? "skipped" : output.ok && output.verified ? (output.approval_required ? "awaiting_approval" : "completed") : "failed";
      await saveStep(ctx, stepNo, toolName, status, input, output, status === "failed" ? "verification_failed" : "");
      if (!["get_request", "get_request_lines", "get_request_candidates", "get_request_agencies", "get_agency_performance", "get_request_blockers", "verify_action"].includes(toolName)) actions.push({ tool: toolName, ...output });
      if (status === "failed") throw new AgentFailure(500, `${toolName}_verification_failed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await saveStep(ctx, stepNo, toolName, "failed", input, {}, message);
      await admin.from("ai_agent_runs").update({ status: "failed", termination_reason: "failed", failed_step: stepNo, last_error: message, completed_at: new Date().toISOString() }).eq("id", run.id).eq("company_id", companyId);
      await admin.from("ai_agent_cases").update({ status: "failed", current_summary: `Agent run failed safely at ${toolName}.`, updated_at: new Date().toISOString() }).eq("id", agentCase.id).eq("company_id", companyId);
      throw error;
    }
  }

  const approval = actions.find((row) => row.tool === "create_manager_approval_request" && row.ok);
  const outbound = actions.find((row) => row.tool === "send_agency_followup" && row.ok);
  const blockers = ctx.cache.analysis?.blockers || [];
  const planStoppedEarly = planned.length < 11 && blockers.length > 0 && !approval && !outbound;
  const termination = planStoppedEarly ? "max_steps_reached" : approval ? "awaiting_human_approval" : outbound || blockers.length ? "awaiting_external_response" : "completed";
  const caseStatus = termination === "completed" ? "closed" : termination === "max_steps_reached" ? "blocked" : termination;
  const nextCheckAt = termination === "completed" ? null : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const memory = buildOperationalMemory({ request, analysis: ctx.cache.analysis, agencies: (ctx.cache.performance || []).filter((row: Json) => (ctx.cache.agencies || []).some((agency: Json) => agency.id === row.agency_id)), actions, nextCheckAt });
  await admin.from("ai_agent_case_memory").upsert({ company_id: companyId, case_id: agentCase.id, facts: memory, updated_at: new Date().toISOString() }, { onConflict: "case_id" });
  const summary = {
    request: { id: request.id, request_no: request.request_no }, issues: blockers.map((row: Json) => ({ code: row.code, severity: row.severity, summary: row.summary })),
    gap: ctx.cache.analysis?.gap || {}, actions_completed: actions.filter((row) => row.ok && !row.approval_required).map((row) => ({ tool: row.tool, entity_id: row.entity_id, verified: row.verified })),
    approval_required: approval ? { approval_id: approval.entity_id, recommendation: ctx.cache.recommendation } : null,
    case_status: caseStatus, next_automatic_review: nextCheckAt,
  };
  const persistedRunStatus = termination === "completed" ? "completed" : termination === "max_steps_reached" ? "blocked" : termination;
  await admin.from("ai_agent_runs").update({ status: persistedRunStatus, termination_reason: termination, result_summary: summary, completed_at: new Date().toISOString() }).eq("id", run.id).eq("company_id", companyId);
  await admin.from("ai_agent_cases").update({ status: caseStatus, current_summary: `${blockers.length} blocker(s); ${summary.actions_completed.length} verified action(s).`, next_check_at: nextCheckAt, closed_at: caseStatus === "closed" ? new Date().toISOString() : null, closed_reason: caseStatus === "closed" ? "No active blockers" : null, updated_at: new Date().toISOString() }).eq("id", agentCase.id).eq("company_id", companyId);
  return { ok: true, case_id: agentCase.id, run_id: run.id, termination_reason: termination, plan, summary };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") || ""; const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !service) throw new AgentFailure(500, "server_configuration_error");
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const caller = await authenticate(req, admin);
    const length = Number(req.headers.get("content-length") || 0); if (length > MAX_BODY_BYTES) throw new AgentFailure(413, "request_too_large");
    const raw = await req.text(); if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new AgentFailure(413, "request_too_large");
    let body: Json = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { throw new AgentFailure(400, "invalid_request"); }
    if (Object.prototype.hasOwnProperty.call(body, "company_id")) throw new AgentFailure(400, "company_id_not_allowed");
    if (body.action === "list_tools") return response({ ok: true, tools: AGENT_TOOL_DEFINITIONS });
    return response(await runOrchestrator(admin, caller, body));
  } catch (error) {
    const status = error instanceof AgentFailure ? error.status : 500;
    const code = error instanceof AgentFailure ? error.code : "orchestrator_failed";
    console.error("VisaFlow Agent Orchestrator failed", { code, detail: error instanceof Error ? error.message : String(error) });
    return response({ ok: false, error: code }, status);
  }
});
