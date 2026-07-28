import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COMPANY_ROLES = new Set([
  "Admin",
  "Visa Team",
  "Recruitment Manager",
  "Recruitment Director",
]);
const AGENCY_ACTIONS = new Set(["view", "acknowledge", "accept", "reject"]);
const COMPANY_ACTIONS = new Set(["create", "send", "cancel"]);
const ALLOWED_ACTIONS = new Set([...AGENCY_ACTIONS, ...COMPANY_ACTIONS]);
const MANAGER_NOTIFICATION_ROLES = ["Recruitment Manager", "Recruitment Director"];

type Json = Record<string, unknown>;
type Actor = {
  id: number;
  auth_user_id: string;
  name: string;
  email: string;
  role: string;
  company_id: string | null;
  agency_id: string | null;
};

class WorkflowError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value: unknown, maxLength = 500) {
  const normalized = text(value, maxLength);
  return normalized || null;
}

function assertUuid(value: unknown, field: string) {
  const normalized = text(value, 50);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new WorkflowError(400, `invalid_${field}`);
  }
  return normalized;
}

function actorLabel(actor: Actor) {
  return actor.name || actor.email || "VisaFlow User";
}

async function exactlyOne(query: PromiseLike<{ data: unknown; error: { message?: string } | null }>, code: string) {
  const { data, error } = await query;
  if (error || !data) throw new WorkflowError(error ? 500 : 404, code);
  return data as Record<string, unknown>;
}

async function requireAgencyMembership(admin: ReturnType<typeof createClient>, actor: Actor, companyId: string) {
  if (!actor.agency_id) throw new WorkflowError(403, "agency_identity_required");

  const { data, error } = await admin
    .from("agency_company_user_access")
    .select("id")
    .eq("user_id", actor.id)
    .eq("company_id", companyId)
    .eq("agency_id", actor.agency_id)
    .eq("status", "Active")
    .maybeSingle();

  if (error || !data) throw new WorkflowError(403, "agency_company_access_denied");
}

async function requireCompanyAgencyAccess(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  agencyId: string
) {
  const { data, error } = await admin
    .from("company_agency_access")
    .select("id")
    .eq("company_id", companyId)
    .eq("agency_id", agencyId)
    .eq("status", "Active")
    .maybeSingle();

  if (error || !data) throw new WorkflowError(400, "agency_not_active_for_company");
}

async function recordEvent(
  admin: ReturnType<typeof createClient>,
  authorization: Record<string, unknown>,
  actor: Actor,
  eventType: string,
  reason: string | null = null,
  metadata: Json = {}
) {
  const { error } = await admin.from("authorization_events").insert({
    authorization_id: authorization.id,
    company_id: authorization.company_id,
    agency_id: authorization.agency_id,
    event_type: eventType,
    actor_user_id: actor.id,
    actor_auth_user_id: actor.auth_user_id,
    actor_name: actorLabel(actor),
    actor_email: actor.email,
    actor_role: actor.role,
    reason,
    metadata,
  });

  if (error) throw new WorkflowError(500, "authorization_event_write_failed");
}

function notificationMessage(
  eventType: string,
  authorization: Record<string, unknown>,
  reason: string | null
) {
  const reference = text(authorization.authorization_no) || text(authorization.visa_no) || "Authorization";
  const suffix = reason ? ` Reason: ${reason}` : "";
  if (eventType === "AUTHORIZATION_SENT") return `${reference} was sent to ${text(authorization.agency) || "the agency"}.`;
  if (eventType === "AUTHORIZATION_ACCEPTED") return `${reference} was accepted by ${text(authorization.agency) || "the agency"}.${suffix}`;
  return `${reference} was rejected by ${text(authorization.agency) || "the agency"}.${suffix}`;
}

async function createNotifications(
  admin: ReturnType<typeof createClient>,
  authorization: Record<string, unknown>,
  eventType: "AUTHORIZATION_SENT" | "AUTHORIZATION_ACCEPTED" | "AUTHORIZATION_REJECTED",
  reason: string | null,
  sequence: number
) {
  const companyId = String(authorization.company_id);
  const notificationRows: Json[] = [{
    company_id: companyId,
    agency_id: authorization.agency_id,
    agency_name: authorization.agency,
    recipient_role: "Agency",
    type: eventType,
    title: eventType.split("_").map((part) => part[0] + part.slice(1).toLowerCase()).join(" "),
    message: notificationMessage(eventType, authorization, reason),
    priority: eventType === "AUTHORIZATION_REJECTED" ? "High" : "Medium",
    status: "Unread",
    related_table: "visa_authorizations",
    related_id: String(authorization.id),
    request_no: authorization.request_no,
    response_status: authorization.agency_status,
    response_at: eventType === "AUTHORIZATION_SENT" ? null : new Date().toISOString(),
    rejection_reason: eventType === "AUTHORIZATION_REJECTED" ? reason : null,
    dedupe_key: `authorization:${authorization.id}:${eventType}:agency:${sequence}`,
    data: {
      authorization_id: authorization.id,
      authorization_no: authorization.authorization_no,
      agency_status: authorization.agency_status,
      recipient_role: "Agency",
    },
  }];

  const { data: managers, error: managerError } = await admin
    .from("users")
    .select("id, auth_user_id, role")
    .eq("company_id", companyId)
    .eq("status", "Active")
    .eq("is_active", true)
    .in("role", MANAGER_NOTIFICATION_ROLES);

  if (managerError) throw new WorkflowError(500, "notification_recipient_lookup_failed");

  for (const manager of managers || []) {
    notificationRows.push({
      company_id: companyId,
      user_id: manager.auth_user_id,
      agency_id: null,
      agency_name: authorization.agency,
      recipient_role: manager.role,
      type: eventType,
      title: eventType.split("_").map((part) => part[0] + part.slice(1).toLowerCase()).join(" "),
      message: notificationMessage(eventType, authorization, reason),
      priority: eventType === "AUTHORIZATION_REJECTED" ? "High" : "Medium",
      status: "Unread",
      related_table: "visa_authorizations",
      related_id: String(authorization.id),
      request_no: authorization.request_no,
      response_status: authorization.agency_status,
      response_at: eventType === "AUTHORIZATION_SENT" ? null : new Date().toISOString(),
      rejection_reason: eventType === "AUTHORIZATION_REJECTED" ? reason : null,
      dedupe_key: `authorization:${authorization.id}:${eventType}:user:${manager.id}:${sequence}`,
      data: {
        authorization_id: authorization.id,
        authorization_no: authorization.authorization_no,
        agency_status: authorization.agency_status,
        recipient_role: manager.role,
      },
    });
  }

  const { error } = await admin.from("notification_events").insert(notificationRows);
  if (error) throw new WorkflowError(500, "authorization_notification_write_failed");
}

async function createAuthorization(
  admin: ReturnType<typeof createClient>,
  actor: Actor,
  input: Json
) {
  if (!actor.company_id) throw new WorkflowError(403, "company_identity_required");
  if (!COMPANY_ROLES.has(actor.role)) throw new WorkflowError(403, "company_role_denied");

  const agencyId = assertUuid(input.agency_id, "agency_id");
  await requireCompanyAgencyAccess(admin, actor.company_id, agencyId);

  const agency = await exactlyOne(
    admin.from("agencies").select("id, name").eq("id", agencyId).eq("status", "Active").maybeSingle(),
    "agency_not_found"
  );

  const allocatedQty = Number(input.allocated_qty || 0);
  if (!Number.isSafeInteger(allocatedQty) || allocatedQty <= 0) {
    throw new WorkflowError(400, "allocated_qty_must_be_positive_integer");
  }

  const allocationId = Number(input.visa_allocation_id || 0);
  if (!Number.isSafeInteger(allocationId) || allocationId <= 0) {
    throw new WorkflowError(400, "visa_allocation_id_required");
  }
  const allocation = await exactlyOne(
    admin
      .from("visa_allocations")
      .select("id, company_id, request_no, visa_no, visa_batch_line_id, allocated_qty")
      .eq("id", allocationId)
      .eq("company_id", actor.company_id)
      .maybeSingle(),
    "visa_allocation_not_found"
  );
  const { data: existingRows, error: existingError } = await admin
    .from("visa_authorizations")
    .select("allocated_qty")
    .eq("company_id", actor.company_id)
    .eq("visa_allocation_id", allocationId)
    .neq("status", "Cancelled");
  if (existingError) throw new WorkflowError(500, "authorization_quantity_check_failed");
  const alreadyAuthorized = (existingRows || []).reduce(
    (sum, row) => sum + Number(row.allocated_qty || 0),
    0
  );
  if (alreadyAuthorized + allocatedQty > Number(allocation.allocated_qty || 0)) {
    throw new WorkflowError(409, "authorization_quantity_exceeds_allocation");
  }

  const authorizationNo = text(input.authorization_no, 120);
  if (!authorizationNo) throw new WorkflowError(400, "authorization_no_required");

  const row: Json = {
    company_id: actor.company_id,
    visa_no: nullableText(allocation.visa_no, 120),
    request_no: nullableText(allocation.request_no, 120),
    visa_allocation_id: allocationId,
    visa_batch_line_id: allocation.visa_batch_line_id || null,
    profession: nullableText(input.profession, 200),
    nationality: nullableText(input.nationality, 120),
    gender: nullableText(input.gender, 50),
    authorization_no: authorizationNo,
    agency_id: agencyId,
    agency: agency.name,
    office_country: nullableText(input.office_country, 120),
    allocated_qty: allocatedQty,
    received_candidates: 0,
    interview_passed: 0,
    mobilized: 0,
    status: "New",
    agency_status: "New",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: actor.auth_user_id,
    created_by_name: actorLabel(actor),
    created_by_email: actor.email,
    created_by_role: actor.role,
    updated_by_name: actorLabel(actor),
    updated_by_email: actor.email,
    updated_by_role: actor.role,
  };

  if (input.visa_id) row.visa_id = assertUuid(input.visa_id, "visa_id");

  const authorization = await exactlyOne(
    admin.from("visa_authorizations").insert(row).select("*").single(),
    "authorization_create_failed"
  );
  await recordEvent(admin, authorization, actor, "Created");
  return authorization;
}

async function loadAuthorization(
  admin: ReturnType<typeof createClient>,
  authorizationId: string
) {
  return await exactlyOne(
    admin.from("visa_authorizations").select("*").eq("id", authorizationId).maybeSingle(),
    "authorization_not_found"
  );
}

async function sendAuthorization(
  admin: ReturnType<typeof createClient>,
  actor: Actor,
  authorization: Record<string, unknown>,
  input: Json
) {
  if (!COMPANY_ROLES.has(actor.role) || !actor.company_id || authorization.company_id !== actor.company_id) {
    throw new WorkflowError(403, "company_authorization_access_denied");
  }
  if (!authorization.agency_id) throw new WorkflowError(400, "authorization_agency_required");
  if (authorization.status === "Cancelled") throw new WorkflowError(409, "cancelled_authorization_cannot_be_sent");

  const isResend = Boolean(authorization.sent_at);
  if (isResend && input.confirm_resend !== true) {
    throw new WorkflowError(409, "resend_confirmation_required");
  }

  await requireCompanyAgencyAccess(admin, actor.company_id, String(authorization.agency_id));
  const now = new Date().toISOString();
  const nextCount = Number(authorization.send_count || 0) + 1;
  let update = admin
    .from("visa_authorizations")
    .update({
      status: "Sent to Agency",
      agency_status: isResend ? authorization.agency_status : "New",
      sent_at: now,
      sent_by: actor.auth_user_id,
      send_count: nextCount,
      updated_at: now,
      updated_by: actor.auth_user_id,
      updated_by_name: actorLabel(actor),
      updated_by_email: actor.email,
      updated_by_role: actor.role,
    })
    .eq("id", authorization.id)
    .eq("company_id", actor.company_id);

  update = authorization.sent_at
    ? update.eq("sent_at", input.expected_sent_at || authorization.sent_at)
    : update.is("sent_at", null);

  const { data, error } = await update.select("*").maybeSingle();
  if (error) throw new WorkflowError(500, "authorization_send_failed");
  if (!data) throw new WorkflowError(409, "authorization_was_already_sent_refresh_required");

  await recordEvent(admin, data, actor, "Sent", null, { resend: isResend, send_count: nextCount });
  await createNotifications(admin, data, "AUTHORIZATION_SENT", null, nextCount);
  return data;
}

async function agencyTransition(
  admin: ReturnType<typeof createClient>,
  actor: Actor,
  authorization: Record<string, unknown>,
  action: string,
  input: Json
) {
  if (
    actor.role !== "Agency"
    || !actor.agency_id
    || authorization.agency_id !== actor.agency_id
  ) {
    throw new WorkflowError(403, "agency_authorization_access_denied");
  }

  await requireAgencyMembership(admin, actor, String(authorization.company_id));
  if (!authorization.sent_at) throw new WorkflowError(409, "authorization_not_sent");

  const currentStatus = text(authorization.agency_status) || "New";
  const transitionMap: Record<string, { allowed: string[]; status: string; event: string }> = {
    view: { allowed: ["New"], status: "Viewed", event: "Viewed" },
    acknowledge: { allowed: ["New", "Viewed"], status: "Acknowledged", event: "Acknowledged" },
    accept: { allowed: ["Acknowledged"], status: "Accepted", event: "Accepted" },
    reject: { allowed: ["Acknowledged"], status: "Rejected", event: "Rejected" },
  };
  const transition = transitionMap[action];
  if (!transition.allowed.includes(currentStatus)) {
    if (action === "view" && ["Viewed", "Acknowledged", "Accepted", "Rejected"].includes(currentStatus)) {
      return authorization;
    }
    throw new WorkflowError(409, `invalid_transition_${currentStatus.toLowerCase()}_to_${action}`);
  }

  const reason = nullableText(input.reason, 1000);
  if (action === "reject" && !reason) throw new WorkflowError(400, "rejection_reason_required");

  const now = new Date().toISOString();
  const updateRow: Json = {
    agency_status: transition.status,
    status: transition.status,
    updated_at: now,
    updated_by: actor.auth_user_id,
    updated_by_name: actorLabel(actor),
    updated_by_email: actor.email,
    updated_by_role: actor.role,
  };

  if (action === "view") {
    updateRow.viewed_at = now;
    updateRow.viewed_by = actor.auth_user_id;
  } else if (action === "acknowledge") {
    updateRow.acknowledged_at = now;
    updateRow.acknowledged_by = actor.auth_user_id;
    if (!authorization.viewed_at) {
      updateRow.viewed_at = now;
      updateRow.viewed_by = actor.auth_user_id;
    }
  } else {
    updateRow.decision_at = now;
    updateRow.decision_by = actor.auth_user_id;
    updateRow.response_reason = reason;
  }

  const { data, error } = await admin
    .from("visa_authorizations")
    .update(updateRow)
    .eq("id", authorization.id)
    .eq("company_id", authorization.company_id)
    .eq("agency_id", actor.agency_id)
    .eq("agency_status", currentStatus)
    .select("*")
    .maybeSingle();

  if (error) throw new WorkflowError(500, "authorization_transition_failed");
  if (!data) throw new WorkflowError(409, "authorization_state_changed_refresh_required");

  if (action === "acknowledge" && !authorization.viewed_at) {
    await recordEvent(admin, data, actor, "Viewed", null, { implicit: true });
  }
  await recordEvent(admin, data, actor, transition.event, reason);

  if (action === "accept" || action === "reject") {
    await createNotifications(
      admin,
      data,
      action === "accept" ? "AUTHORIZATION_ACCEPTED" : "AUTHORIZATION_REJECTED",
      reason,
      Number(data.send_count || 1)
    );
  }

  return data;
}

async function cancelAuthorization(
  admin: ReturnType<typeof createClient>,
  actor: Actor,
  authorization: Record<string, unknown>,
  input: Json
) {
  if (!COMPANY_ROLES.has(actor.role) || !actor.company_id || authorization.company_id !== actor.company_id) {
    throw new WorkflowError(403, "company_authorization_access_denied");
  }

  const cancellationNo = text(input.cancellation_no, 120);
  const cancelledAt = text(input.cancelled_at, 20);
  if (!cancellationNo || !/^\d{4}-\d{2}-\d{2}$/.test(cancelledAt)) {
    throw new WorkflowError(400, "valid_cancellation_details_required");
  }

  const now = new Date().toISOString();
  const updated = await exactlyOne(
    admin
      .from("visa_authorizations")
      .update({
        status: "Cancelled",
        cancellation_no: cancellationNo,
        cancelled_at: cancelledAt,
        updated_at: now,
        updated_by: actor.auth_user_id,
        updated_by_name: actorLabel(actor),
        updated_by_email: actor.email,
        updated_by_role: actor.role,
      })
      .eq("id", authorization.id)
      .eq("company_id", actor.company_id)
      .neq("status", "Cancelled")
      .select("*")
      .maybeSingle(),
    "authorization_cancel_failed"
  );
  await recordEvent(admin, updated, actor, "Cancelled", nullableText(input.reason, 1000));
  return updated;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new WorkflowError(500, "service_configuration_missing");
    }

    const authorizationHeader = req.headers.get("Authorization") || "";
    const accessToken = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) throw new WorkflowError(401, "authentication_required");

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user) throw new WorkflowError(401, "invalid_session");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const actor = await exactlyOne(
      admin
        .from("users")
        .select("id, auth_user_id, name, email, role, company_id, agency_id")
        .eq("auth_user_id", authData.user.id)
        .eq("status", "Active")
        .eq("is_active", true)
        .maybeSingle(),
      "active_application_user_required"
    ) as unknown as Actor;

    const payload = await req.json() as Json;
    const action = text(payload.action, 30).toLowerCase();
    const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
      ? payload.input as Json
      : {};

    if (!ALLOWED_ACTIONS.has(action)) throw new WorkflowError(400, "unsupported_action");
    if ("company_id" in payload || "company_id" in input) {
      throw new WorkflowError(400, "company_id_is_server_controlled");
    }
    if (COMPANY_ACTIONS.has(action) && !COMPANY_ROLES.has(actor.role)) {
      throw new WorkflowError(403, "company_role_denied");
    }
    if (AGENCY_ACTIONS.has(action) && actor.role !== "Agency") {
      throw new WorkflowError(403, "agency_role_required");
    }

    let authorization: Record<string, unknown>;
    if (action === "create") {
      authorization = await createAuthorization(admin, actor, input);
    } else {
      const authorizationId = assertUuid(payload.authorization_id, "authorization_id");
      const current = await loadAuthorization(admin, authorizationId);
      if (action === "send") authorization = await sendAuthorization(admin, actor, current, input);
      else if (action === "cancel") authorization = await cancelAuthorization(admin, actor, current, input);
      else authorization = await agencyTransition(admin, actor, current, action, input);
    }

    const { data: events, error: timelineError } = await admin
      .from("authorization_events")
      .select("id, event_type, actor_name, actor_email, actor_role, reason, metadata, created_at")
      .eq("authorization_id", authorization.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (timelineError) throw new WorkflowError(500, "authorization_timeline_read_failed");

    return jsonResponse({ ok: true, authorization, events: events || [] });
  } catch (error) {
    const workflowError = error instanceof WorkflowError
      ? error
      : new WorkflowError(500, "authorization_workflow_failed");
    console.error("authorization-workflow", workflowError.code, error);
    return jsonResponse({ ok: false, error: workflowError.code }, workflowError.status);
  }
});
