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
import { buildEmailIdempotencyKey } from "../_shared/emailDeliveryCore.mjs";
import { ensureQueuedEmailAttempt, markEmailAttemptFailed } from "../_shared/emailAttemptCore.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const INVITE_REDIRECT_URL = Deno.env.get("AGENCY_INVITE_REDIRECT_URL") || "";
const EMAIL_DISPATCHER_INTERNAL_SECRET = Deno.env.get("VISAFLOW_EMAIL_DISPATCHER_SECRET") || "";
const ALLOWED_ORIGINS = parseAllowedOrigins(
  Deno.env.get("AGENCY_PROVISIONER_ALLOWED_ORIGINS") || ""
);
const SAFE_DISPATCHER_ERROR_CODES = new Set([
  "INVALID_ACTION_URL", "SMTP_AUTH_FAILED", "SMTP_TLS_FAILED", "SMTP_CONNECTION_FAILED",
  "SMTP_SENDER_REJECTED", "SMTP_RELAY_DENIED", "SMTP_TIMEOUT", "SMTP_CONFIG_MISSING",
  "EMAIL_DISPATCH_FAILED",
]);

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
        action,
      }: {
        agencyId: string;
        permissions: Record<string, boolean>;
        action: string;
      }) =>
        rpc(userClient, "agency_invitation_begin_v3", {
          p_agency_id: agencyId,
          p_permissions: permissions,
          p_action: action,
        }),
      revoke: ({ agencyId }: { agencyId: string }) =>
        rpc(userClient, "agency_invitation_revoke_v1", { p_agency_id: agencyId }),
      recordAuthUser: ({
        actorAuthUserId,
        requestId,
        authUserId,
        existingIdentity,
      }: Record<string, any>) =>
        rpc(admin, "agency_invitation_record_auth_user_v3", {
          p_actor_auth_user_id: actorAuthUserId,
          p_request_id: requestId,
          p_auth_user_id: authUserId,
          p_existing_identity: existingIdentity === true,
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
        return matches[0]
          ? { authUserId: matches[0].id, existingIdentity: matches[0].user_metadata?.existing_identity === true }
          : null;
      },
      findExistingAuthUser: async ({ email, agencyId, requestId }: Record<string, string>) => {
        const normalizedEmail = String(email || "").trim().toLowerCase();
        const escapedEmailPattern = normalizedEmail.replace(/[\\%_]/g, "\\$&");
        const matches = [];
        for (let page = 1; page <= 10; page += 1) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) throw error;
          const users = data?.users || [];
          matches.push(...users.filter((user) => String(user.email || "").trim().toLowerCase() === normalizedEmail));
          if (users.length < 1000) break;
        }
        if (matches.length !== 1) {
          if (matches.length > 1) throw new AgencyInvitationError("AGENCY_INVITATION_MANUAL_REVIEW", "Multiple Auth identities matched the email.", 409);
          return null;
        }
        const authUserId = String(matches[0].id);
        const [{ data: byAuth, error: byAuthError }, { data: byEmail, error: byEmailError }] = await Promise.all([
          admin.from("users").select("id, auth_user_id, email, role, agency_id").eq("auth_user_id", authUserId).limit(2),
          admin.from("users").select("id, auth_user_id, email, role, agency_id").ilike("email", escapedEmailPattern).limit(2),
        ]);
        if (byAuthError) throw byAuthError;
        if (byEmailError) throw byEmailError;
        const publicRows = [...(byAuth || []), ...(byEmail || [])].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
        if (publicRows.some((row) => row.role !== "Agency" || String(row.agency_id || "") !== agencyId || (row.auth_user_id && String(row.auth_user_id) !== authUserId))) {
          throw new AgencyInvitationError("AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED", "The existing account is assigned to another role or agency.", 409);
        }
        const declaredAccountType = String(matches[0].user_metadata?.account_type || matches[0].app_metadata?.account_type || "").toLowerCase();
        if (declaredAccountType && declaredAccountType !== "agency") {
          throw new AgencyInvitationError("AGENCY_INVITATION_EMAIL_ALREADY_ASSIGNED", "The existing account is assigned to another account type.", 409);
        }
        const { error: metadataError } = await admin.auth.admin.updateUserById(authUserId, {
          user_metadata: { ...(matches[0].user_metadata || {}), account_type: "agency",
            provisioning_request_id: requestId,
            agency_id: agencyId,
            existing_identity: true },
        });
        if (metadataError) throw metadataError;
        return authUserId;
      },
      deliverInvitation: async ({ requestId, actionLink, companyId, agencyId, recipient }: Record<string, any>) => {
        const normalizedRecipient = String(recipient || "").trim().toLowerCase();
        const idempotencyKey = buildEmailIdempotencyKey(
          "AGENCY_USER_INVITATION",
          requestId,
          [normalizedRecipient],
        );
        const queued = {
          company_id: companyId,
          agency_id: agencyId,
          event_type: "AGENCY_USER_INVITATION",
          type: "AGENCY_USER_INVITATION",
          status: "Queued",
          provider: "SMTP",
          recipient: normalizedRecipient,
          to_email: normalizedRecipient,
          to_emails: normalizedRecipient,
          subject: "VisaFlow Agency Account Invitation",
          related_id: requestId,
          idempotency_key: idempotencyKey,
        };
        if (!companyId) throw new Error("EMAIL_LOG_COMPANY_ID_MISSING");
        const attempt = await ensureQueuedEmailAttempt({
          queued,
          lookup: async () => {
            const { data, error } = await admin.from("email_logs")
              .select("id,status,retry_count,failed_at").eq("company_id", companyId)
              .eq("idempotency_key", idempotencyKey).maybeSingle();
            if (error) throw error;
            return data;
          },
          insert: async (values: Record<string, unknown>) => {
            const { data, error } = await admin.from("email_logs").insert(values).select("id").single();
            if (error) throw error;
            return data;
          },
          requeue: async (id: string, values: Record<string, unknown>) => {
            const { data, error } = await admin.from("email_logs").update(values).eq("id", id).select("id").single();
            if (error) throw error;
            return data;
          },
        });
        const emailLogId = attempt.id;
        const failAttempt = async (code: string) => {
          await markEmailAttemptFailed({
            emailLogId,
            code,
            update: async (id: string, values: Record<string, unknown>) => {
              const { data, error } = await admin.from("email_logs").update(values).eq("id", id).select("id").single();
              if (error) throw error;
              return data;
            },
          });
        };
        if (!EMAIL_DISPATCHER_INTERNAL_SECRET) {
          await failAttempt("DISPATCHER_SECRET_MISSING");
          throw new Error("Email dispatcher is not configured.");
        }
        const response = await fetch(`${SUPABASE_URL}/functions/v1/visaflow-email-dispatcher`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-visaflow-email-secret": EMAIL_DISPATCHER_INTERNAL_SECRET },
          body: JSON.stringify({
            message_type: "AGENCY_USER_INVITATION",
            request_id: requestId,
            email_log_id: emailLogId,
            idempotency_key: idempotencyKey,
            company_id: companyId,
            agency_id: agencyId,
            recipient: normalizedRecipient,
            variables: { action_url: actionLink },
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.ok !== true) {
          const dispatcherCode = String(result?.error || "").toUpperCase();
          const safeCode = response.status === 401 || response.status === 403
            ? "DISPATCHER_AUTH_FAILED"
            : SAFE_DISPATCHER_ERROR_CODES.has(dispatcherCode) ? dispatcherCode : "EMAIL_DISPATCH_FAILED";
          await failAttempt(safeCode);
          throw new Error("email_dispatch_failed");
        }
        return result;
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
