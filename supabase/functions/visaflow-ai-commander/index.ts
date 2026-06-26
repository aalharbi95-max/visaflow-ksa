const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CommanderPayload = {
  action?: "chat" | "commander" | "offer";
  question?: string;
  language?: string;
  mode?: string;
  intent?: string;
  lockedReport?: string;
  snapshot?: unknown;
  localDecisionContext?: string;
  offerData?: Record<string, unknown>;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
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

function buildOpenAIInput(payload: CommanderPayload) {
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
            "You are VisaFlow KSA AI Commander, an executive recruitment operations advisor. Use only the locked VisaFlow VIE facts, operational_request_lines, and snapshot provided by the application. Do not use request header profession, quantity, nationality, or gender. Do not recalculate totals. Do not combine multiple request lines under the first profession. Provide a polished executive response with clear sections, not a raw data dump. Keep the answer actionable and management-ready.",
        },
        {
          role: "user",
          content:
            `User question: ${question}\n` +
            `Commander mode: ${mode}\n` +
            `Language: ${language}\n\n` +
            `LOCKED VIE FACTS - DO NOT ALTER OR RECALCULATE:\n${payload.lockedReport || ""}\n\n` +
            `STRICT OPERATIONAL SNAPSHOT JSON:\n${JSON.stringify(payload.snapshot || {}, null, 2)}\n\n` +
            `LOCAL COMMANDER DECISION CONTEXT:\n${payload.localDecisionContext || ""}\n\n` +
            "Write the answer in Arabic business style unless Language is English. Start with a short source note that numbers are based on request lines. Include: executive summary, decision KPIs, top risks, agency follow-up, forecast, and recommended decisions. Do not show the full locked report unless the user explicitly asks for raw request-line breakdown.",
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
          "You are VisaFlow KSA AI Assistant. Answer naturally and directly. Do not generate locked recruitment reports unless the user explicitly asks about recruitment operations, requests, visas, candidates, agencies, mobilization, KPI, penalties, risks, or forecast. Use Arabic if the user writes Arabic.",
      },
      {
        role: "user",
        content: question,
      },
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return jsonResponse({ ok: false, error: "OPENAI_API_KEY is not configured in Supabase Secrets." }, 500);
    }

    const payload = (await req.json()) as CommanderPayload;
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";
    const requestBody = buildOpenAIInput(payload);

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

    const result = await openAIResponse.json();
    if (!openAIResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          error: result?.error?.message || "OpenAI request failed.",
          status: openAIResponse.status,
        },
        200,
      );
    }

    const text = extractOutputText(result);
    return jsonResponse({ ok: true, text: text || "AI did not return an answer." });
  } catch (error) {
    return jsonResponse({ ok: false, error: error?.message || "Unexpected Edge Function error." }, 200);
  }
});
