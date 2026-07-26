import { corsHeaders, requireAuthUser } from "../_shared/visaflow-security.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" || !(req.headers.get("content-type") || "").includes("application/sdp")) {
    return new Response("Invalid request", { status: 400, headers: corsHeaders });
  }
  try {
    const { user } = await requireAuthUser(req, { interview: true });
    const capabilityId = req.headers.get("x-interview-capability") || "";
    const { data: state, error } = await user.rpc("get_ai_interview_portal_state", { p_capability_id: capabilityId });
    if (error || state?.session?.status !== "In Progress" || state?.session?.interaction_mode !== "Live Conversational") {
      return new Response("Interview unavailable", { status: 403, headers: corsHeaders });
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return new Response("Realtime service unavailable", { status: 503, headers: corsHeaders });
    const sdp = await req.text();
    if (!sdp || sdp.length > 128 * 1024) return new Response("Invalid request", { status: 400, headers: corsHeaders });
    const model = encodeURIComponent(Deno.env.get("OPENAI_REALTIME_MODEL") || "gpt-4o-realtime-preview");
    const upstream = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/sdp", "OpenAI-Beta": "realtime=v1" },
      body: sdp,
    });
    const upstreamBody = await upstream.text();
    if (!upstream.ok) {
      return new Response("Realtime service unavailable", { status: 502, headers: corsHeaders });
    }
    return new Response(upstreamBody, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/sdp", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Interview unavailable", { status: 403, headers: corsHeaders });
  }
});
