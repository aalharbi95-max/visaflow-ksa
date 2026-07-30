import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AgencyInvitationError,
  runAgencyInvitationAction,
} from "../_shared/agencyInvitationCore.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const INVITE_REDIRECT_URL = Deno.env.get("AGENCY_INVITE_REDIRECT_URL") || "";
const ALLOWED_ORIGINS = new Set(
  String(Deno.env.get("AGENCY_PROVISIONER_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const MAX_BODY_BYTES = 16 * 1024;

function allowedOrigin(origin: string | null) {
  if (!origin) return "";
  try {
    const normalized = new URL(origin).origin;
    return ALLOWED_ORIGINS.has(normalized) ? normalized : "";
  } catch {
    return "";
  }
}

function redirectConfigured() {
  try {
    const redirect = new URL(INVITE_REDIRECT_URL);
    return redirect.protocol === "https:" && ALLOWED_ORIGINS.has(redirect.origin);
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null) {
  const resolved = allowedOrigin(origin);
  return {
    ...(resolved ? { "Access-Control-Allow-Origin": resolved } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
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
  if (message.includes("UNAUTHORIZED")) return 403;
  if (
    message.includes("ALREADY") ||
    message.includes("IN_PROGRESS") ||
    message.includes("INVALID_STATE")
  ) return 409;
  if (message.includes("NOT_FOUND") || message.includes("NOT_AVAILABLE")) {
    return 404;
  }
  return 400;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigin(origin)) {
    return respond(origin, 403, {
      ok: false,
      code: "ORIGIN_NOT_ALLOWED",
    });
  }
  if (request.method === "OPTIONS") return respond(origin, 204, null);
  if (request.method !== "POST") {
    return respond(origin, 405, {
      ok: false,
      code: "METHOD_NOT_ALLOWED",
    });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
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

    const body = await request.json();
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
      begin: ({ agencyId }: { agencyId: string }) =>
        rpc(userClient, "agency_invitation_begin", {
          p_agency_id: agencyId,
        }),
      recordAuthUser: ({
        actorAuthUserId,
        requestId,
        authUserId,
      }: Record<string, string>) =>
        rpc(admin, "agency_invitation_record_auth_user", {
          p_actor_auth_user_id: actorAuthUserId,
          p_request_id: requestId,
          p_auth_user_id: authUserId,
        }),
      complete: ({
        actorAuthUserId,
        requestId,
        authUserId,
      }: Record<string, string>) =>
        rpc(admin, "agency_invitation_complete", {
          p_actor_auth_user_id: actorAuthUserId,
          p_request_id: requestId,
          p_auth_user_id: authUserId,
        }),
      markFailed: ({
        actorAuthUserId,
        requestId,
        code,
      }: Record<string, string>) =>
        rpc(admin, "agency_invitation_mark_failed", {
          p_actor_auth_user_id: actorAuthUserId,
          p_request_id: requestId,
          p_failure_code: code,
        }),
      activate: () => rpc(userClient, "agency_invitation_activate"),
    };

    const result = await runAgencyInvitationAction({
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
      error instanceof AgencyInvitationError
        ? error.code
        : String(caught?.message || "AGENCY_INVITATION_FAILED")
            .match(/[A-Z][A-Z0-9_]{4,}/)?.[0] ||
          "AGENCY_INVITATION_FAILED";
    const status =
      error instanceof AgencyInvitationError
        ? error.status
        : databaseStatus(caught);
    console.error("Agency invitation failed", { code, status });
    return respond(origin, status, {
      ok: false,
      code,
      message:
        error instanceof AgencyInvitationError
          ? error.message
          : "The agency invitation could not be completed.",
    });
  }
});
