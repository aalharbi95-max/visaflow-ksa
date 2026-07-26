import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-interview-capability",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function getClients(req: Request) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = req.headers.get("authorization") || "";
  if (!url || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) throw new Error("unauthorized");
  return {
    user: createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }),
    admin: createClient(url, serviceKey, { auth: { persistSession: false } }),
    jwt: authorization.slice(7),
  };
}

export async function requireAuthUser(req: Request, { interview = false } = {}) {
  const clients = getClients(req);
  const { data, error } = await clients.admin.auth.getUser(clients.jwt);
  if (error || !data?.user?.id) throw new Error("unauthorized");
  if (interview && data.user.is_anonymous !== true) throw new Error("forbidden");
  if (interview && data.user.user_metadata?.account_type !== "interview_portal") throw new Error("forbidden");
  return { ...clients, authUser: data.user };
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readJson(req: Request, maximumBytes = 32 * 1024) {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) throw new Error("request_too_large");
  return raw ? JSON.parse(raw) : {};
}

export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "request_failed";
  if (["unauthorized", "forbidden", "request_too_large"].includes(message)) return message;
  return "request_failed";
}
