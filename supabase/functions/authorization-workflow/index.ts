import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.3";

const MAX_BODY_BYTES = 32 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set([
  "create", "send", "resend", "view", "acknowledge", "accept", "reject", "cancel",
]);
const SAFE_RPC_ERRORS = new Set([
  "authentication_required", "valid_idempotency_key_required", "server_controlled_field",
  "active_application_user_required",
  "company_role_denied", "allocated_qty_must_be_positive",
  "authorization_quantity_exceeds_allocation", "agency_not_active_for_company",
  "authorization_no_required", "company_authorization_access_denied",
  "agency_authorization_access_denied", "authorization_not_sent",
  "authorization_cannot_be_sent", "already_sent_use_resend",
  "resend_confirmation_required", "already_cancelled",
  "valid_cancellation_details_required", "invalid_view_transition",
  "invalid_acknowledge_transition", "invalid_accept_transition",
  "invalid_reject_transition", "valid_rejection_reason_required",
  "protected_resource_not_found", "ambiguous_actor_identity",
]);
const rateBuckets = new Map<string, number[]>();

class WorkflowError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

function allowedOrigins() {
  return new Set(
    (Deno.env.get("AUTHORIZATION_WORKFLOW_ALLOWED_ORIGINS") || "")
      .split(",").map((value) => value.trim()).filter(Boolean),
  );
}

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function requireAllowedOrigin(req: Request) {
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  if (!allowedOrigins().has(origin)) throw new WorkflowError(403, "origin_not_allowed");
  return origin;
}

function response(origin: string | null, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function rateLimit(actorId: string, action: string) {
  const key = `${actorId}:${action}`;
  const cutoff = Date.now() - RATE_WINDOW_MS;
  const recent = (rateBuckets.get(key) || []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= RATE_LIMIT) throw new WorkflowError(429, "rate_limit_exceeded");
  recent.push(Date.now());
  rateBuckets.set(key, recent);
}

async function parseBody(req: Request) {
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new WorkflowError(413, "request_body_too_large");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new WorkflowError(413, "request_body_too_large");
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new WorkflowError(400, "invalid_json");
  }
}

Deno.serve(async (req) => {
  let origin: string | null = null;
  try {
    origin = requireAllowedOrigin(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
    if (req.method !== "POST") return response(origin, { ok: false, error: "method_not_allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) throw new WorkflowError(500, "service_configuration_missing");

    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new WorkflowError(401, "authentication_required");

    // The end-user JWT is forwarded to PostgREST. No service-role key is used:
    // the atomic SECURITY DEFINER RPC validates auth.uid(), actor, role and tenant.
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) throw new WorkflowError(401, "invalid_session");

    const payload = await parseBody(req);
    const action = String(payload.action || "").trim().toLowerCase();
    if (!ALLOWED_ACTIONS.has(action)) throw new WorkflowError(400, "unsupported_action");
    if ("company_id" in payload) throw new WorkflowError(400, "company_id_is_server_controlled");
    const input = payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
      ? payload.input as Record<string, unknown>
      : {};
    if ("company_id" in input || "actor_user_id" in input || "recipient_role" in input) {
      throw new WorkflowError(400, "server_controlled_field");
    }

    const idempotencyKey = String(payload.idempotency_key || "");
    if (!UUID.test(idempotencyKey)) throw new WorkflowError(400, "valid_idempotency_key_required");
    const authorizationId = payload.authorization_id == null ? null : String(payload.authorization_id);
    if (authorizationId && !UUID.test(authorizationId)) {
      throw new WorkflowError(400, "invalid_authorization_id");
    }
    rateLimit(authData.user.id, action);

    const { data, error } = await client.rpc("authorization_workflow_mutate", {
      p_action: action,
      p_authorization_id: authorizationId,
      p_input: input,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      console.error("authorization-workflow rpc", error.code, error.message);
      const status = error.code === "42501" ? 403
        : error.code === "P0002" ? 404
        : ["23505", "23514"].includes(error.code) ? 409
        : error.code === "22023" ? 400 : 500;
      const safeCode = SAFE_RPC_ERRORS.has(error.message) ? error.message : "authorization_workflow_failed";
      throw new WorkflowError(status, safeCode);
    }
    return response(origin, { ok: true, ...(data || {}) });
  } catch (error) {
    const known = error instanceof WorkflowError
      ? error
      : new WorkflowError(500, "authorization_workflow_failed");
    if (!(error instanceof WorkflowError)) console.error("authorization-workflow", error);
    return response(origin, { ok: false, error: known.code }, known.status);
  }
});
