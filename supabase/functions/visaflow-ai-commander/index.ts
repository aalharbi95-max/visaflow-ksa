import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Referrer-Policy": "no-referrer",
};

type CommanderPayload = {
  action?: "chat" | "commander" | "offer";
  question?: string;
  language?: string;
  mode?: string;
  intent?: string;
  offerData?: Record<string, unknown>;
};

type CommanderContext = {
  scope: "platform" | "company";
  company_name?: string;
  role: string;
  counts: Record<string, number>;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function extractOutputText(result: any) {
  if (typeof result?.output_text === "string" && result.output_text.trim()) return result.output_text;

  const output = Array.isArray(result?.output) ? result.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((content: any) => content?.text || content?.output_text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildOpenAIInput(payload: CommanderPayload, context: CommanderContext) {
  const action = payload.action || "chat";
  const language = payload.language || "Arabic";
  const mode = payload.mode || "Executive Brief";
  const question = payload.question || "مرحبا";

  if (action === "offer") {
    return {
      temperature: 0.2,
      max_output_tokens: 700,
      input: [
        {
          role: "system",
          content:
            "You are an HR Recruitment Director. Generate a professional job offer email in clear business English. Keep it concise, formal, and ready to send. Do not invent benefits, commitments, salaries, dates, or legal terms beyond the provided data.",
        },
        {
          role: "user",
          content: `Generate a job offer email using only this data:\n${JSON.stringify(payload.offerData || {}, null, 2)}`,
        },
      ],
    };
  }

  if (action === "commander") {
    return {
      temperature: 0.12,
      max_output_tokens: 1800,
      input: [
        {
          role: "system",
          content:
            "You are VisaFlow KSA AI Commander, an executive recruitment operations advisor for a SaaS recruitment, visa, authorization, agency, and mobilization platform. You are not a generic chatbot. Always answer like an operations command center. Use only the locked VisaFlow VIE facts, operational_request_lines, and snapshot provided by the application. Do not use request header profession, quantity, nationality, or gender. Do not recalculate totals. Do not combine multiple request lines under the first profession. If the user greeting or question is vague, provide an executive operational welcome and a quick live snapshot from the supplied context. Provide a polished executive response with clear sections, not a raw data dump. Keep the answer actionable and management-ready.",
        },
        {
          role: "user",
          content:
            `User question: ${question}\n` +
            `Commander mode: ${mode}\n` +
            `Language: ${language}\n\n` +
            `SERVER-VERIFIED TENANT SNAPSHOT JSON:\n${JSON.stringify(context, null, 2)}\n\n` +
            "Write the answer in Arabic business style unless Language is English. Use these section headings exactly where relevant: 🧠 VisaFlow AI Commander, 📌 الملخص التنفيذي, 📊 مؤشرات القرار, 🚨 أعلى المخاطر, 🏢 متابعة المكاتب, 🔮 التوقعات, ✅ القرارات المقترحة. Start with a short source note that numbers are based on request lines. Include executive summary, decision KPIs, top risks, agency follow-up, forecast, and recommended decisions. If there is no clear operational question, introduce yourself as VisaFlow AI Commander and provide a quick operational snapshot. Do not show the full locked report unless the user explicitly asks for raw request-line breakdown.",
        },
      ],
    };
  }

  return {
    temperature: 0.35,
    max_output_tokens: 1200,
    input: [
      {
        role: "system",
        content:
          "You are VisaFlow KSA AI Assistant inside AI Commander. You are not a general chatbot. If the user greets you or asks a vague question, introduce yourself as VisaFlow AI Commander and suggest operational questions about requests, visas, candidates, agencies, mobilization, KPI, penalties, risks, or forecast. Use Arabic if the user writes Arabic. Keep responses concise and management-ready.",
      },
      {
        role: "user",
        content: question,
      },
    ],
  };
}

async function getVerifiedTenantContext(admin: any, actor: any): Promise<CommanderContext> {
  const isPlatformOwner = actor.role === "Platform Owner" && actor.company_id === null;
  const scopedCount = async (table: string) => {
    let query = admin.from(table).select("id", { count: "exact", head: true });
    if (!isPlatformOwner) query = query.eq("company_id", actor.company_id);
    const { count, error } = await query;
    if (error) throw new Error("tenant_context_unavailable");
    return Number(count || 0);
  };

  let companyName: string | undefined;
  if (!isPlatformOwner) {
    const { data: companies, error } = await admin.from("companies")
      .select("id, name, status").eq("id", actor.company_id).eq("status", "Active").limit(2);
    if (error || companies?.length !== 1) throw new Error("tenant_context_unavailable");
    companyName = String(companies[0].name || "Company");
  }

  const [requests, candidates, interviews, visas] = await Promise.all([
    scopedCount("requests"), scopedCount("candidates"), scopedCount("interviews"), scopedCount("visa_batches"),
  ]);
  return {
    scope: isPlatformOwner ? "platform" : "company",
    ...(companyName ? { company_name: companyName } : {}),
    role: String(actor.role),
    counts: { requests, candidates, interviews, visas },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !authData?.user?.id) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    const { data: actors, error: actorError } = await admin.from("users")
      .select("id, role, status, is_active, company_id, auth_user_id")
      .eq("auth_user_id", authData.user.id).limit(2);
    const actor = actors?.[0];
    const allowedRoles = new Set(["Admin", "Company Admin", "CEO", "Operations Manager", "Project Manager", "Recruitment Manager", "Recruitment Officer", "Platform Owner"]);
    if (actorError || actors?.length !== 1 || actor?.status !== "Active" || actor?.is_active !== true || !allowedRoles.has(actor?.role)) {
      return jsonResponse({ ok: false, error: "forbidden" }, 403);
    }
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return jsonResponse({ ok: false, error: "OPENAI_API_KEY is not configured in Supabase Secrets." }, 500);
    }

    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > 64 * 1024) return jsonResponse({ ok: false, error: "request_too_large" }, 413);
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) return jsonResponse({ ok: false, error: "request_too_large" }, 413);
    let payload: CommanderPayload;
    try {
      payload = JSON.parse(rawBody || "{}") as CommanderPayload;
    } catch {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "company_id") ||
        Object.prototype.hasOwnProperty.call(payload, "snapshot") ||
        Object.prototype.hasOwnProperty.call(payload, "lockedReport") ||
        Object.prototype.hasOwnProperty.call(payload, "localDecisionContext")) {
      return jsonResponse({ ok: false, error: "untrusted_tenant_context" }, 400);
    }
    const verifiedContext = await getVerifiedTenantContext(admin, actor);
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";
    const requestBody = buildOpenAIInput(payload, verifiedContext);

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        ...requestBody,
      }),
    });

    const result = await openAIResponse.json().catch(() => ({}));
    if (!openAIResponse.ok) {
      return jsonResponse({ ok: false, error: "ai_service_unavailable" }, 502);
    }

    const text = extractOutputText(result);
    return jsonResponse({ ok: true, text: text || "AI did not return an answer." });
  } catch {
    return jsonResponse({ ok: false, error: "request_failed" }, 500);
  }
});
