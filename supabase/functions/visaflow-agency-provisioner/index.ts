import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AgencyInvitationError,
  runAgencyInvitationAction,
} from "../_shared/agencyInvitationCore.mjs";
import {
  AGENCY_ADMINISTRATION_ACTIONS,
  AgencyAdministrationError,
  runAgencyAdministrationAction,
} from "../_shared/agencyAdministrationCore.mjs";
import {
  AGENCY_PROVISIONER_MAX_BODY_BYTES,
  buildAgencyProvisionerCorsHeaders,
  isAllowedInviteRedirect,
  parseAllowedOrigins,
  resolveAllowedOrigin,
  validateAgencyProvisionerRequest,
} from "../_shared/agencyProvisionerHttp.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const INVITE_REDIRECT_URL = Deno.env.get("AGENCY_INVITE_REDIRECT_URL") || "";
const ALLOWED_ORIGINS = parseAllowedOrigins(
  Deno.env.get("AGENCY_PROVISIONER_ALLOWED_ORIGINS") || ""
);

function allowedOrigin(origin: string | null) {
  return resolveAllowedOrigin(origin, ALLOWED_ORIGINS);
}

function redirectConfigured() {
  return isAllowedInviteRedirect(INVITE_REDIRECT_URL, ALLOWED_ORIGINS);
}

function corsHeaders(origin: string | null) {
  return buildAgencyProvisionerCorsHeaders(origin, ALLOWED_ORIGINS);
}

function respond(origin: string | null, status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
    },
  });
}

function databaseStatus(error: any) {
  const message = String(error?.message || "");
  if (
    message.includes("UNAUTHORIZED") ||
    message.includes("TENANT_MISMATCH")
  ) return 403;
  if (
    message.includes("ALREADY") ||
    message.includes("IN_PROGRESS") ||
    message.includes("INVALID_STATE") ||
    message.includes("MANUAL_REVIEW")
  ) return 409;
  if (
    message.includes("NOT_FOUND") ||
    message.includes("NOT_AVAILABLE") ||
    message.includes("NOT_LINKED")
  ) {
    return 404;
  }
  return 400;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const preflight = validateAgencyProvisionerRequest({
    method: request.method,
    origin,
    contentLength: Number(request.headers.get("content-length") || 0),
    allowedOrigins: ALLOWED_ORIGINS,
  });
  if (!preflight.ok) {
    return respond(origin, preflight.status, {
      ok: false,
      code: preflight.code,
    });
  }
  if (request.method === "OPTIONS") return respond(origin, 204, null);
  const rawBody = await request.text();
  if (
    new TextEncoder().encode(rawBody).byteLength >
    AGENCY_PROVISIONER_MAX_BODY_BYTES
  ) {
    return respond(origin, 413, {
      ok: false,
      code: "REQUEST_TOO_LARGE",
    });
  }
  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !SERVICE_ROLE_KEY ||
    !redirectConfigured()
  ) {
    return respond(origin, 503, {
      ok: false,
      code: "FUNCTION_NOT_CONFIGURED",
    });
  }

  try {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!token) {
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_UNAUTHORIZED",
        "Authentication is required.",
        401
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: authorization },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user?.id) {
      throw new AgencyInvitationError(
        "AGENCY_INVITATION_UNAUTHORIZED",
        "Authentication is required.",
        401
      );
    }

    const body = JSON.parse(rawBody);
    const { data: appUser, error: appUserError } = await admin
      .from("users")
      .select("id,auth_user_id,company_id,role,status,is_active")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();
    if (appUserError) throw appUserError;

    const actor = {
      authUserId: authData.user.id,
      userId: appUser?.id || null,
      companyId: appUser?.company_id || null,
      role: appUser?.role || null,
      isActive:
        appUser?.status === "Active" && appUser?.is_active === true,
    };

    const rpc = async (
      client: ReturnType<typeof createClient>,
      name: string,
      params: Record<string, unknown> = {}
    ) => {
      const { data, error } = await client.rpc(name, params);
      if (error) throw error;
      return data;
    };
    const repository = {
      begin: ({
        agencyId,
        permissions,
      }: {
        agencyId: string;
        permissions: Record<string, boolean>;
      }) =>
        rpc(userClient, "agency_invitation_begin_v2", {
          p_agency_id: agencyId,
          p_permissions: permissions,
        }),
      recordAuthUser: ({
        actorAuthUserId,
        requestId,
        authUserId,
      }: Record<string, string>) =>
        rpc(admin, "agency_invitation_record_auth_user_v2", {
          p_actor_auth_user_id: actorAuthUserId,
          p_request_id: requestId,
          p_auth_user_id: authUserId,
        }),
      complete: ({
        actorAuthUserId,
        requestId,
        authUserId,
      }: Record<string, string>) =>
        rpc(admin, "agency_invitation_complete_v2", {
          p_actor_auth_user_id: actorAuthUserId,
          p_request_id: requestId,
          p_auth_user_id: authUserId,
        }),
      markFailed: ({
        actorAuthUserId,
        requestId,
        code,
        stage,
        lastSuccessfulOperation,
        authUserId,
        metadata,
      }: any) =>
        rpc(admin, "agency_invitation_mark_failed_v2", {
          p_actor_auth_user_id: actorAuthUserId,
          p_request_id: requestId,
          p_failure_code: code,
          p_failure_stage: stage,
          p_last_successful_operation: lastSuccessfulOperation,
          p_auth_user_id: authUserId || null,
          p_failure_metadata: metadata || {},
        }),
      activate: () => rpc(userClient, "agency_invitation_activate_v2"),
      markActivationFailed: ({ code }: { code: string }) =>
        rpc(userClient, "agency_invitation_mark_activation_failed", {
          p_failure_code: code,
        }),
      findRecoverableAuthUser: async ({
        email,
        requestId,
        agencyId,
      }: Record<string, string>) => {
        const normalizedEmail = String(email || "").trim().toLowerCase();
        const matches = [];
        for (let page = 1; page <= 10; page += 1) {
          const { data, error } = await admin.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (error) throw error;
          const users = data?.users || [];
          matches.push(
            ...users.filter((user) =>
              String(user.email || "").trim().toLowerCase() === normalizedEmail &&
              user.user_metadata?.account_type === "agency" &&
              user.user_metadata?.provisioning_request_id === requestId &&
              user.user_metadata?.agency_id === agencyId
            )
          );
          if (users.length < 1000) break;
        }
        if (matches.length > 1) {
          throw new AgencyInvitationError(
            "AGENCY_INVITATION_MANUAL_REVIEW",
            "Multiple Auth identities matched the invitation.",
            409
          );
        }
        return matches[0]?.id || null;
      },
      updateCompanySettings: ({
        actor,
        targetCompanyId,
        settings,
      }: any) =>
        rpc(admin, "workspace_admin_update_company_settings", {
          p_actor_auth_user_id: actor.authUserId,
          p_target_company_id: targetCompanyId,
          p_updates: settings,
        }),
      updateAgency: ({ actor, agencyId, updates }: any) =>
        rpc(admin, "workspace_admin_update_agency", {
          p_actor_auth_user_id: actor.authUserId,
          p_agency_id: agencyId,
          p_updates: updates,
        }),
      unlinkAgency: ({ actor, agencyId }: any) =>
        rpc(admin, "workspace_admin_unlink_agency", {
          p_actor_auth_user_id: actor.authUserId,
          p_agency_id: agencyId,
        }),
    };

    const result = AGENCY_ADMINISTRATION_ACTIONS.includes(body?.action)
      ? await runAgencyAdministrationAction({
          body,
          actor,
          repository,
        })
      : await runAgencyInvitationAction({
          body,
          actor,
          repository,
          authAdmin: admin.auth.admin,
          inviteRedirectUrl: INVITE_REDIRECT_URL,
        });
    return respond(origin, 200, result);
  } catch (error) {
    const caught = error as any;
    const code =
      error instanceof AgencyInvitationError ||
      error instanceof AgencyAdministrationError
        ? error.code
        : String(caught?.message || "AGENCY_INVITATION_FAILED")
            .match(/[A-Z][A-Z0-9_]{4,}/)?.[0] ||
          "AGENCY_INVITATION_FAILED";
    const status =
      error instanceof AgencyInvitationError ||
      error instanceof AgencyAdministrationError
        ? error.status
        : databaseStatus(caught);
    console.error("Agency invitation failed", { code, status });
    return respond(origin, status, {
      ok: false,
      code,
      message:
        error instanceof AgencyInvitationError ||
        error instanceof AgencyAdministrationError
          ? error.message
          : "The agency invitation could not be completed.",
    });
  }
});
