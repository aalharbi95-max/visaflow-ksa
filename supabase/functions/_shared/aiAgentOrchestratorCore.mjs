export const AGENT_TERMINATION_REASONS = Object.freeze([
  "completed",
  "awaiting_external_response",
  "awaiting_human_approval",
  "approved_awaiting_supported_execution",
  "blocked",
  "failed",
  "max_steps_reached",
]);

export const AGENT_RISK = Object.freeze({ GREEN: "GREEN", YELLOW: "YELLOW", RED: "RED" });

export const GREEN_MUTATING_AGENT_TOOLS = Object.freeze([
  "send_agency_followup",
  "create_followup_task",
  "escalate_to_manager",
]);

export const TERMINAL_CANDIDATE_STATUSES = new Set([
  "rejected", "interview failed", "medical failed", "medical fail", "ksa medical failed",
  "cancelled", "joined", "refused to work", "absconded",
]);

export function normalizeAgentText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function safeAgentNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampAgentNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function firstAgentText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export function buildAgentActionKey({ toolName, companyId, caseId, requestId, agencyId = "", period = "" }) {
  const tool = String(toolName || "");
  const company = String(companyId || "");
  const agentCase = String(caseId || "");
  const request = String(requestId || "");
  const agency = String(agencyId || "");
  const timePeriod = String(period || "");
  if (tool === "send_agency_followup") return `${company}:${request}:${agency}:send_agency_followup:${timePeriod}`;
  if (tool === "create_followup_task") return `${agentCase}:${agency}:followup`;
  if (tool === "escalate_to_manager") return `${company}:${request}:manager_escalation:${timePeriod}`;
  return "";
}

export function selectReusableAgentStep(steps, { companyId, toolName, actionKey = "", agencyId = "" }) {
  const candidates = (steps || []).filter((row) => {
    if (String(row?.company_id || "") !== String(companyId || "")) return false;
    if (String(row?.tool_name || "") !== String(toolName || "")) return false;
    if (!["completed", "skipped"].includes(String(row?.status || ""))) return false;
    if (row?.verification?.verified !== true) return false;
    const entityId = firstAgentText(row?.verification?.entity_id, row?.output?.entity_id);
    if (!entityId) return false;
    if (actionKey && row?.idempotency_key && String(row.idempotency_key) !== String(actionKey)) return false;
    if (agencyId && row?.input?.agency_id && String(row.input.agency_id) !== String(agencyId)) return false;
    return true;
  });
  return candidates.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0] || null;
}

export function resolveAgentApprovalState(status) {
  const normalized = String(status || "");
  if (normalized === "Pending") return { state: "awaiting_human_approval", should_wait: true, may_execute: false };
  if (normalized === "Approved") return { state: "approved_awaiting_supported_execution", should_wait: false, may_execute: false };
  if (normalized === "Rejected") return { state: "approval_rejected", should_wait: false, may_execute: false };
  if (normalized === "Executed") return { state: "completed", should_wait: false, may_execute: false };
  if (normalized === "Execution Failed") return { state: "approval_execution_failed", should_wait: false, may_execute: false };
  if (normalized === "Expired") return { state: "approval_expired", should_wait: false, may_execute: false };
  return { state: "approval_missing", should_wait: false, may_execute: false };
}

export function agentDaysSince(value, now = new Date()) {
  if (!value) return 0;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

export function isTerminalAgentCandidate(status) {
  return TERMINAL_CANDIDATE_STATUSES.has(normalizeAgentText(status));
}

export function parseRequestReference(goal, explicitReference = "") {
  const explicit = String(explicitReference || "").trim();
  if (explicit) return explicit.slice(0, 80);
  const text = String(goal || "");
  const match = text.match(/\b(?:VF[-\s]?)?\d{3,12}\b/i);
  return match ? match[0].replace(/\s+/g, "-") : "";
}

export function calculateRequestGap(request, requestLines, candidates) {
  const lines = (requestLines || []).filter((line) => String(line.request_no || "") === String(request.request_no || ""));
  const required = lines.length
    ? lines.reduce((sum, line) => sum + Math.max(0, safeAgentNumber(line.quantity)), 0)
    : Math.max(0, safeAgentNumber(request.quantity));
  const active = (candidates || []).filter((candidate) => !isTerminalAgentCandidate(candidate.status)).length;
  return { required_quantity: required, active_candidates: active, gap: Math.max(0, required - active) };
}

export function buildAgencyPerformance(agencies, candidates, authorizations, now = new Date()) {
  const names = new Set([
    ...(agencies || []).map((row) => firstAgentText(row.name, row.agency_name)),
    ...(candidates || []).map((row) => firstAgentText(row.agency, row.agency_name)),
    ...(authorizations || []).map((row) => firstAgentText(row.agency, row.agency_name)),
  ].filter(Boolean));

  return Array.from(names).map((agencyName) => {
    const key = normalizeAgentText(agencyName);
    const agency = (agencies || []).find((row) => normalizeAgentText(firstAgentText(row.name, row.agency_name)) === key) || {};
    const rows = (candidates || []).filter((row) => normalizeAgentText(firstAgentText(row.agency, row.agency_name)) === key);
    const active = rows.filter((row) => !isTerminalAgentCandidate(row.status));
    const joined = rows.filter((row) => normalizeAgentText(row.status) === "joined").length;
    const failed = rows.filter((row) => isTerminalAgentCandidate(row.status) && normalizeAgentText(row.status) !== "joined").length;
    const stale = active.filter((row) => agentDaysSince(firstAgentText(row.updated_at, row.created_at), now) >= 3).length;
    const allocated = (authorizations || [])
      .filter((row) => normalizeAgentText(firstAgentText(row.agency, row.agency_name)) === key)
      .reduce((sum, row) => sum + Math.max(0, safeAgentNumber(row.allocated_qty)), 0);
    const submissionRate = allocated ? Math.min(100, Math.round((rows.length / allocated) * 100)) : rows.length ? 100 : 0;
    const successRate = rows.length ? Math.round((joined / rows.length) * 100) : 0;
    const failureRate = rows.length ? Math.round((failed / rows.length) * 100) : 0;
    const score = clampAgentNumber(Math.round(45 + successRate * 0.35 + submissionRate * 0.3 - failureRate * 0.25 - stale * 3), 0, 100);
    const risk = score < 45 || failureRate >= 35 ? "High" : score < 70 || stale > 0 ? "Medium" : "Low";
    return {
      agency_id: agency.id || null,
      agency: agencyName,
      email_available: Boolean(firstAgentText(agency.email, agency.contact_email, agency.official_email)),
      candidates: rows.length,
      active_candidates: active.length,
      stale_candidates: stale,
      allocated_quantity: allocated,
      submission_rate: submissionRate,
      success_rate: successRate,
      failure_rate: failureRate,
      score,
      risk,
    };
  }).sort((left, right) => right.score - left.score);
}

export function detectRequestBlockers({ request, requestLines, candidates, agencies, authorizations, reminderDays = 3, escalationDays = 7, now = new Date() }) {
  const gap = calculateRequestGap(request, requestLines, candidates);
  const blockers = [];
  if (gap.gap > 0) blockers.push({
    code: "REQUEST_QUANTITY_GAP", severity: gap.gap >= Math.max(5, Math.ceil(gap.required_quantity * 0.25)) ? "High" : "Medium",
    summary: `${gap.gap} candidate(s) are still required.`, evidence: gap,
  });

  const staleCandidates = (candidates || []).filter((candidate) =>
    !isTerminalAgentCandidate(candidate.status)
    && agentDaysSince(firstAgentText(candidate.updated_at, candidate.created_at), now) >= reminderDays
  );
  if (staleCandidates.length) blockers.push({
    code: "STALE_CANDIDATES", severity: staleCandidates.some((row) => agentDaysSince(firstAgentText(row.updated_at, row.created_at), now) >= escalationDays) ? "High" : "Medium",
    summary: `${staleCandidates.length} active candidate(s) have stale updates.`,
    evidence: staleCandidates.slice(0, 20).map((row) => ({ candidate_id: row.id, status: row.status, stale_days: agentDaysSince(firstAgentText(row.updated_at, row.created_at), now), agency: firstAgentText(row.agency, row.agency_name) })),
  });

  const missingMedical = (candidates || []).filter((candidate) => {
    const status = normalizeAgentText(candidate.status);
    return !isTerminalAgentCandidate(status)
      && ["approved", "selected", "visa process", "medical"].some((part) => status.includes(part))
      && !firstAgentText(candidate.medical_status, candidate.medical_date);
  });
  if (missingMedical.length) blockers.push({
    code: "MISSING_MEDICAL_STATUS", severity: "Medium",
    summary: `${missingMedical.length} candidate(s) are missing medical status.`,
    evidence: missingMedical.slice(0, 20).map((row) => ({ candidate_id: row.id, agency: firstAgentText(row.agency, row.agency_name) })),
  });

  const requestAge = agentDaysSince(firstAgentText(request.updated_at, request.created_at), now);
  const responsibleAgencyNames = new Set([
    ...(candidates || []).map((row) => firstAgentText(row.agency, row.agency_name)),
    ...(authorizations || []).map((row) => firstAgentText(row.agency, row.agency_name)),
  ].filter(Boolean));
  if (gap.gap > 0 && requestAge >= reminderDays) {
    blockers.push({
      code: "AGENCY_SLA_RISK",
      severity: requestAge >= escalationDays ? "High" : "Medium",
      summary: `The request has remained open for ${requestAge} day(s) with a quantity gap.`,
      evidence: { request_age_days: requestAge, reminder_after_days: reminderDays, escalation_after_days: escalationDays, responsible_agencies: Array.from(responsibleAgencyNames) },
    });
  }
  if (!responsibleAgencyNames.size && gap.gap > 0) blockers.push({
    code: "NO_RESPONSIBLE_AGENCY", severity: "High", summary: "No responsible agency could be derived from tenant-owned candidate or authorization records.", evidence: {},
  });

  const performance = buildAgencyPerformance(agencies, candidates, authorizations, now);
  return { gap, blockers, request_age_days: requestAge, agency_performance: performance };
}

const inputSchemas = {
  requestRef: { type: "object", additionalProperties: false, required: ["request_ref"], properties: { request_ref: { type: "string", minLength: 1, maxLength: 80 } } },
  requestId: { type: "object", additionalProperties: false, required: ["request_id"], properties: { request_id: { type: ["string", "number"] } } },
  agency: { type: "object", additionalProperties: false, required: ["request_id", "agency_id"], properties: { request_id: { type: ["string", "number"] }, agency_id: { type: "string" } } },
};

export const AGENT_TOOL_DEFINITIONS = Object.freeze([
  ["get_request", "Read one tenant-owned recruitment request.", inputSchemas.requestRef, "Recruitment Operator", "GREEN", false, "read-only", 120],
  ["get_request_lines", "Read authoritative request-line requirements.", inputSchemas.requestId, "Recruitment Operator", "GREEN", false, "read-only", 120],
  ["get_request_candidates", "Read candidates for a request.", inputSchemas.requestId, "Recruitment Operator", "GREEN", false, "read-only", 120],
  ["get_request_agencies", "Resolve responsible agencies from tenant-owned records.", inputSchemas.requestId, "Recruitment Operator", "GREEN", false, "read-only", 120],
  ["get_agency_performance", "Calculate a deterministic agency scorecard.", inputSchemas.requestId, "Recruitment Operator", "GREEN", false, "read-only", 120],
  ["get_request_blockers", "Calculate deterministic request blockers and gaps.", inputSchemas.requestId, "Recruitment Operator", "GREEN", false, "read-only", 120],
  ["send_agency_followup", "Create and dispatch one approved agency follow-up.", inputSchemas.agency, "Recruitment Manager", "GREEN", false, "company+request+agency+action+day", 1],
  ["create_followup_task", "Create a verified internal follow-up task.", inputSchemas.agency, "Recruitment Operator", "GREEN", false, "company+case+agency+due_at", 1],
  ["escalate_to_manager", "Create a non-financial operational escalation.", inputSchemas.requestId, "Recruitment Manager", "GREEN", false, "company+request+action+period", 1],
  ["verify_action", "Re-read mutation evidence and audit state.", { type: "object", additionalProperties: false, required: ["action_type", "entity_id"], properties: { action_type: { type: "string" }, entity_id: { type: "string" } } }, "Recruitment Operator", "GREEN", false, "read-only", 120],
  ["create_manager_approval_request", "Create a YELLOW action proposal without executing it.", inputSchemas.agency, "Recruitment Manager", "YELLOW", true, "company+case+proposed-action+target", 1],
].map(([name, description, input_schema, required_role, risk_level, human_approval_required, idempotency_strategy, maximum_execution_frequency]) => ({
  name, description, input_schema,
  output_schema: { type: "object", required: ["ok", "verified"], properties: { ok: { type: "boolean" }, verified: { type: "boolean" }, entity_id: { type: ["string", "null"] }, audit_id: { type: ["string", "null"] } } },
  required_role, tenant_requirements: "company_id is derived by the server and every read/write filters it",
  risk_level, human_approval_required, idempotency_strategy, audit_requirements: "step + case event + append-only audit log",
  maximum_execution_frequency, validation_logic: "strict allowlist plus tenant ownership re-read",
  allowed_database_operations: name.startsWith("get_") || name === "verify_action" ? ["SELECT"] : ["SELECT", "INSERT"],
})));

export function getAgentToolDefinition(name) {
  return AGENT_TOOL_DEFINITIONS.find((tool) => tool.name === name) || null;
}

export function validateAgentToolCall(name, input) {
  const definition = getAgentToolDefinition(name);
  if (!definition) return { ok: false, error: "tool_not_registered" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "invalid_tool_input" };
  const allowed = new Set(Object.keys(definition.input_schema.properties || {}));
  if (Object.keys(input).some((key) => !allowed.has(key) || key === "company_id")) return { ok: false, error: "unsupported_tool_input" };
  for (const required of definition.input_schema.required || []) {
    if (input[required] === undefined || input[required] === null || input[required] === "") return { ok: false, error: `missing_${required}` };
  }
  return { ok: true, definition };
}

export function buildRecruitmentReviewPlan({ goal, requestRef, maxSteps = 12 }) {
  const steps = [
    "get_request", "get_request_lines", "get_request_candidates", "get_request_agencies",
    "get_agency_performance", "get_request_blockers", "send_agency_followup",
    "create_followup_task", "escalate_to_manager", "create_manager_approval_request", "verify_action",
  ].slice(0, clampAgentNumber(Math.trunc(safeAgentNumber(maxSteps, 12)), 1, 20));
  return {
    goal: String(goal || `Review recruitment request ${requestRef}`).slice(0, 1000),
    request_ref: requestRef,
    status: "in_progress",
    max_steps: clampAgentNumber(Math.trunc(safeAgentNumber(maxSteps, 12)), 1, 20),
    steps: steps.map((tool, index) => ({ step: index + 1, tool, status: "pending" })),
  };
}

export function buildOperationalMemory({ request, analysis, agencies, actions, nextCheckAt }) {
  return {
    request_no: firstAgentText(request.request_no, request.id),
    goal: `Resolve recruitment blockers for ${firstAgentText(request.request_no, request.id)}`,
    required_quantity: analysis.gap.required_quantity,
    active_candidates: analysis.gap.active_candidates,
    candidate_gap: analysis.gap.gap,
    responsible_agencies: (agencies || []).map((row) => ({ agency_id: row.id || row.agency_id || null, agency: firstAgentText(row.name, row.agency), score: row.score ?? null, risk: row.risk ?? null })),
    current_blockers: analysis.blockers.map((row) => ({ code: row.code, severity: row.severity, summary: row.summary })),
    actions: (actions || []).map((row) => ({ tool: row.tool, ok: row.ok, verified: row.verified, entity_id: row.entity_id || null })),
    next_check_at: nextCheckAt,
    updated_at: new Date().toISOString(),
  };
}

export function selectReassignmentRecommendation(performance, responsibleAgencyIds) {
  const responsible = new Set((responsibleAgencyIds || []).filter(Boolean).map(String));
  const alternative = (performance || []).find((row) => row.agency_id && !responsible.has(String(row.agency_id)) && row.risk !== "High");
  const weak = (performance || []).find((row) => row.agency_id && responsible.has(String(row.agency_id)) && row.risk === "High");
  if (!alternative || !weak) return null;
  const confidence = clampAgentNumber((alternative.score - weak.score + 60) / 100, 0.5, 0.95);
  return {
    action: "REASSIGN_REQUEST_QUANTITY",
    from_agency_id: weak.agency_id,
    from_agency: weak.agency,
    to_agency_id: alternative.agency_id,
    to_agency: alternative.agency,
    confidence: Number(confidence.toFixed(2)),
    evidence: [
      `${weak.agency} risk is ${weak.risk} with score ${weak.score}`,
      `${alternative.agency} risk is ${alternative.risk} with score ${alternative.score}`,
      `Alternative agency submission rate is ${alternative.submission_rate}%`,
    ],
  };
}
