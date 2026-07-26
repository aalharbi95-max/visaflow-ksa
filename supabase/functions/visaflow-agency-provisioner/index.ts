import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ProvisioningError,
  runAgencyProvisioningAction,
} from "../_shared/agencyProvisioningCore.mjs";
import {
  buildCorsHeaders,
  parseAllowedOrigins,
  resolveAllowedOrigin,
} from "../_shared/corsPolicy.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const INVITE_REDIRECT_URL = Deno.env.get("AGENCY_INVITE_REDIRECT_URL") || "";
const ALLOWED_ORIGINS = parseAllowedOrigins(
  Deno.env.get("AGENCY_PROVISIONER_ALLOWED_ORIGINS") || ""
);

function corsHeaders(origin: string | null) {
  return buildCorsHeaders(origin, ALLOWED_ORIGINS);
}

function response(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function rpcRepository(admin: ReturnType<typeof createClient>) {
  const call = async (name: string, params: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(name, params);
    if (error) throw error;
    return data;
  };
  return {
    createDraft: (input: any) =>
      call("agency_provisioning_create_draft", {
        p_actor_auth_user_id: input.actor.authUserId,
        p_idempotency_key: input.idempotencyKey,
        p_agency_name: input.agencyName,
        p_country: input.country,
        p_contact_person: input.contactPerson,
        p_admin_email: input.adminEmail,
        p_phone: input.phone,
        p_permissions: input.permissions,
        p_send_invitation: input.sendInvitation,
      }),
    begin: ({ requestId, actor }: any) =>
      call("agency_provisioning_begin", {
        p_actor_auth_user_id: actor.authUserId,
        p_request_id: requestId,
      }),
    recordAuthUser: ({ requestId, actor, authUserId }: any) =>
      call("agency_provisioning_record_auth_user", {
        p_actor_auth_user_id: actor.authUserId,
        p_request_id: requestId,
        p_auth_user_id: authUserId,
      }),
    completeInvitation: ({ requestId, actor, authUserId }: any) =>
      call("agency_provisioning_complete_invitation", {
        p_actor_auth_user_id: actor.authUserId,
        p_request_id: requestId,
        p_auth_user_id: authUserId,
      }),
    markFailed: ({ requestId, actor, code }: any) =>
      call("agency_provisioning_mark_failed", {
        p_actor_auth_user_id: actor.authUserId,
        p_request_id: requestId,
        p_failure_code: code,
      }),
    prepareResend: ({ requestId, actor }: any) =>
      call("agency_provisioning_prepare_resend", {
        p_actor_auth_user_id: actor.authUserId,
        p_request_id: requestId,
      }),
    recordResend: ({ requestId, actor }: any) =>
      call("agency_provisioning_record_resend", {
        p_actor_auth_user_id: actor.authUserId,
        p_request_id: requestId,
      }),
    activate: ({ actor }: any) =>
      call("agency_provisioning_activate", {
        p_actor_auth_user_id: actor.authUserId,
      }),
    getStatus: ({ requestId, actor }: any) =>
      call("agency_provisioning_get_status", {
        p_actor_auth_user_id: actor.authUserId,
        p_request_id: requestId,
      }),
    updateCompanySettings: ({ actor, targetCompanyId, settings }: any) =>
      call("workspace_admin_update_company_settings", {
        p_actor_auth_user_id: actor.authUserId,
        p_target_company_id: targetCompanyId,
        p_updates: settings,
      }),
    updateAgency: ({ actor, agencyId, updates }: any) =>
      call("workspace_admin_update_agency", {
        p_actor_auth_user_id: actor.authUserId,
        p_agency_id: agencyId,
        p_updates: updates,
      }),
    unlinkAgency: ({ actor, agencyId }: any) =>
      call("workspace_admin_unlink_agency", {
        p_actor_auth_user_id: actor.authUserId,
        p_agency_id: agencyId,
      }),
  };
}

function statusForDatabaseError(error: any) {
  const message = String(error?.message || "");
  if (
    message.includes("EXISTING_AGENCY_REQUIRES_MANUAL_REVIEW") ||
    message.includes("EMAIL_ALREADY_ASSIGNED") ||
    message.includes("DUPLICATE_ACTIVE_REQUEST") ||
    message.includes("SHARED_AGENCY_REQUIRES_MANUAL_REVIEW") ||
    message.includes("DUPLICATE_AGENCY_REQUIRES_MANUAL_REVIEW") ||
    message.includes("AGENCY_PROVISIONING_IN_PROGRESS")
  ) return 409;
  if (message.includes("UNAUTHORIZED")) return 403;
  if (message.includes("NOT_FOUND")) return 404;
  return 400;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !resolveAllowedOrigin(origin, ALLOWED_ORIGINS)) {
    return response(origin, 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  }
  if (request.method === "OPTIONS") return response(origin, 204, null);
  if (request.method !== "POST") {
    return response(origin, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !INVITE_REDIRECT_URL) {
    return response(origin, 503, { ok: false, code: "FUNCTION_NOT_CONFIGURED" });
  }
  try {
    const bearer = request.headers.get("authorization") || "";
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!token) throw new ProvisioningError("UNAUTHORIZED", "Authentication is required.", 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user?.id) {
      throw new ProvisioningError("UNAUTHORIZED", "Authentication is required.", 401);
    }

    const body = await request.json();
    const { data: appUser, error: appUserError } = await admin
      .from("users")
      .select("id,auth_user_id,company_id,role,status,is_active")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (appUserError) throw appUserError;
    const isActivation = body?.action === "activate";
    if (!appUser && !isActivation) {
      throw new ProvisioningError("UNAUTHORIZED", "A linked workspace user is required.", 401);
    }

    const actor = {
      authUserId: authData.user.id,
      userId: appUser?.id || null,
      companyId: appUser?.company_id || null,
      role: appUser?.role || null,
      isActive: appUser?.status === "Active" && appUser?.is_active === true,
    };
    const result = await runAgencyProvisioningAction({
      body,
      actor,
      repository: rpcRepository(admin),
      authAdmin: admin.auth.admin,
      inviteRedirectUrl: INVITE_REDIRECT_URL,
    });
    return response(origin, 200, result);
  } catch (error) {
    const caught = error as any;
    const code =
      error instanceof ProvisioningError
        ? error.code
        : String(caught?.message || "AGENCY_PROVISIONING_FAILED")
            .match(/[A-Z][A-Z0-9_]{4,}/)?.[0] || "AGENCY_PROVISIONING_FAILED";
    const status =
      error instanceof ProvisioningError ? error.status : statusForDatabaseError(caught);
    console.error("Agency provisioning request failed", { code, status });
    return response(origin, status, {
      ok: false,
      code,
      message:
        error instanceof ProvisioningError
          ? error.message
          : "Agency provisioning could not be completed.",
    });
  }
});
