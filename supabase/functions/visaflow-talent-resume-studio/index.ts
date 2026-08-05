import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "https://esm.sh/docx@9.5.1";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const resumeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "professional_summary",
    "contact",
    "core_competencies",
    "experience",
    "education",
    "certifications",
    "languages",
    "improvements",
    "scores",
  ],
  properties: {
    headline: { type: "string", maxLength: 140 },
    professional_summary: { type: "string", maxLength: 1200 },
    contact: {
      type: "object",
      additionalProperties: false,
      required: ["full_name", "email", "phone", "city", "country", "linkedin"],
      properties: {
        full_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        city: { type: "string" },
        country: { type: "string" },
        linkedin: { type: "string" },
      },
    },
    core_competencies: { type: "array", items: { type: "string" }, maxItems: 14 },
    experience: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["job_title", "employer", "location", "dates", "summary", "achievements"],
        properties: {
          job_title: { type: "string" },
          employer: { type: "string" },
          location: { type: "string" },
          dates: { type: "string" },
          summary: { type: "string" },
          achievements: { type: "array", items: { type: "string" }, maxItems: 5 },
        },
      },
    },
    education: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["qualification", "major", "institution", "date"],
        properties: {
          qualification: { type: "string" },
          major: { type: "string" },
          institution: { type: "string" },
          date: { type: "string" },
        },
      },
    },
    certifications: { type: "array", items: { type: "string" }, maxItems: 16 },
    languages: { type: "array", items: { type: "string" }, maxItems: 10 },
    improvements: { type: "array", items: { type: "string" }, maxItems: 12 },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["overall", "ats", "clarity", "impact", "readability"],
      properties: {
        overall: { type: "integer", minimum: 0, maximum: 100 },
        ats: { type: "integer", minimum: 0, maximum: 100 },
        clarity: { type: "integer", minimum: 0, maximum: 100 },
        impact: { type: "integer", minimum: 0, maximum: 100 },
        readability: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
  },
};

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain structured output.");
}

function safeFileName(value: string) {
  return (value || "resume")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "resume";
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>\"]/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]!),
  );
}

function normalizePunctuation(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeInternalNotes(value: unknown) {
  return normalizePunctuation(value)
    .replace(/\b(?:note|editorial note|source note)\s*:\s*[^.]+(?:\.|$)/gi, "")
    .replace(/[^.]*candidate-provided[^.]*(?:\.|$)/gi, "")
    .replace(/[^.]*preserved exactly[^.]*(?:\.|$)/gi, "")
    .replace(/[^.]*source cv[^.]*(?:\.|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function optionalValue(value: unknown) {
  const text = removeInternalNotes(value);
  if (/^(?:not specified|unknown|n\/a|na|-)+$/i.test(text)) return "";
  return text;
}

function pdfSafeText(value: unknown) {
  return removeInternalNotes(value)
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseName(value: unknown) {
  const text = optionalValue(value);
  if (!text || text !== text.toLowerCase()) return text;
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function truncateWords(value: unknown, maxWords: number) {
  const words = removeInternalNotes(value).split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function cleanResume(raw: any) {
  const contact = raw?.contact || {};
  return {
    ...raw,
    headline: truncateWords(raw?.headline, 16),
    professional_summary: removeInternalNotes(raw?.professional_summary),
    contact: {
      full_name: titleCaseName(contact.full_name),
      email: optionalValue(contact.email),
      phone: optionalValue(contact.phone),
      city: optionalValue(contact.city),
      country: optionalValue(contact.country),
      linkedin: optionalValue(contact.linkedin),
    },
    core_competencies: (raw?.core_competencies || [])
      .map(optionalValue)
      .filter(Boolean)
      .slice(0, 14),
    experience: (raw?.experience || []).map((item: any, index: number) => ({
      job_title: optionalValue(item?.job_title),
      employer: optionalValue(item?.employer),
      location: optionalValue(item?.location),
      dates: optionalValue(item?.dates),
      summary: removeInternalNotes(item?.summary),
      achievements: (item?.achievements || [])
        .map(removeInternalNotes)
        .filter(Boolean)
        .slice(0, index < 2 ? 5 : 3),
    })),
    education: (raw?.education || []).map((item: any) => ({
      qualification: optionalValue(item?.qualification),
      major: optionalValue(item?.major),
      institution: optionalValue(item?.institution),
      date: optionalValue(item?.date),
    })),
    certifications: (raw?.certifications || []).map(removeInternalNotes).filter(Boolean).slice(0, 16),
    languages: (raw?.languages || []).map(optionalValue).filter(Boolean).slice(0, 10),
    improvements: (raw?.improvements || []).map(removeInternalNotes).filter(Boolean),
  };
}

function contactLine(contact: any) {
  const location = [contact?.city, contact?.country].filter(Boolean).join(", ");
  return [contact?.email, contact?.phone, location, contact?.linkedin].filter(Boolean).join(" | ");
}

function educationLine(item: any) {
  const qualification = [item?.qualification, item?.major].filter(Boolean).join(" - ");
  const provider = [item?.institution, item?.date].filter(Boolean).join(" | ");
  return [qualification, provider].filter(Boolean).join(", ");
}

function buildHtml(resume: any) {
  const experience = (resume.experience || []).map((item: any) => {
    const title = [item.job_title, item.employer].filter(Boolean).join(" - ");
    const meta = [item.location, item.dates].filter(Boolean).join(" | ");
    return `<section class="experience"><h3>${escapeHtml(title)}</h3>${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}<ul>${(item.achievements || []).map((achievement: string) => `<li>${escapeHtml(achievement)}</li>`).join("")}</ul></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(resume.contact?.full_name)} Resume</title><style>@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;line-height:1.42;max-width:850px;margin:auto}h1{font-size:30px;margin:0;color:#0e3a75;text-transform:capitalize}h2{font-size:15px;text-transform:uppercase;letter-spacing:.07em;color:#0e3a75;border-bottom:2px solid #12b8b0;padding-bottom:4px;margin:20px 0 8px}h3{font-size:14px;margin:12px 0 2px}.headline{font-weight:700;color:#40546d;margin:5px 0}.contact,.meta{font-size:11px;color:#64748b}.skills{font-size:11.5px;line-height:1.6}.experience{break-inside:avoid;page-break-inside:avoid}p,li{font-size:11.5px;margin-top:4px}ul{margin:4px 0 0;padding-left:18px}</style></head><body><h1>${escapeHtml(resume.contact?.full_name)}</h1><div class="headline">${escapeHtml(resume.headline)}</div><div class="contact">${escapeHtml(contactLine(resume.contact))}</div><h2>Professional Summary</h2><p>${escapeHtml(resume.professional_summary)}</p><h2>Core Competencies</h2><div class="skills">${(resume.core_competencies || []).map(escapeHtml).join(" | ")}</div><h2>Professional Experience</h2>${experience}<h2>Education</h2>${(resume.education || []).map((item: any) => `<p><strong>${escapeHtml(educationLine(item))}</strong></p>`).join("")}<h2>Certifications</h2><ul>${(resume.certifications || []).map((item: string) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>Languages</h2><p>${(resume.languages || []).map(escapeHtml).join(" | ")}</p></body></html>`;
}

async function buildDocx(resume: any) {
  const children: any[] = [
    new Paragraph({ children: [new TextRun({ text: resume.contact?.full_name || "", bold: true, size: 34, color: "0E3A75" })] }),
    new Paragraph({ children: [new TextRun({ text: resume.headline || "", bold: true, size: 22, color: "40546D" })] }),
    new Paragraph({ children: [new TextRun({ text: contactLine(resume.contact), size: 18, color: "64748B" })] }),
    new Paragraph({ text: "PROFESSIONAL SUMMARY", heading: HeadingLevel.HEADING_2, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "12B8B0" } } }),
    new Paragraph({ text: resume.professional_summary || "" }),
    new Paragraph({ text: "CORE COMPETENCIES", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: (resume.core_competencies || []).join(" | ") }),
    new Paragraph({ text: "PROFESSIONAL EXPERIENCE", heading: HeadingLevel.HEADING_2 }),
  ];
  for (const item of resume.experience || []) {
    children.push(new Paragraph({ children: [new TextRun({ text: [item.job_title, item.employer].filter(Boolean).join(" - "), bold: true })], keepNext: true }));
    const meta = [item.location, item.dates].filter(Boolean).join(" | ");
    if (meta) children.push(new Paragraph({ children: [new TextRun({ text: meta, italics: true, color: "64748B" })], keepNext: true }));
    if (item.summary) children.push(new Paragraph({ text: item.summary, keepNext: Boolean(item.achievements?.length) }));
    for (const achievement of item.achievements || []) children.push(new Paragraph({ text: achievement, bullet: { level: 0 } }));
  }
  children.push(new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }));
  for (const item of resume.education || []) children.push(new Paragraph({ text: educationLine(item) }));
  children.push(new Paragraph({ text: "CERTIFICATIONS", heading: HeadingLevel.HEADING_2 }));
  for (const item of resume.certifications || []) children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
  children.push(
    new Paragraph({ text: "LANGUAGES", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: (resume.languages || []).join(" | ") }),
  );
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] })));
}

async function buildPdf(resume: any) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  const bottom = 46;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = 798;

  const addPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = 798;
  };
  const ensureSpace = (height: number) => {
    if (y - height < bottom) addPage();
  };
  const wrap = (value: unknown, font: any, size: number, width: number) => {
    const words = pdfSafeText(value).split(/\s+/).filter(Boolean);
    const output: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else {
        if (line) output.push(line);
        line = word;
      }
    }
    if (line) output.push(line);
    return output;
  };
  const drawWrapped = (value: unknown, options: { size?: number; isBold?: boolean; color?: any; gap?: number; indent?: number; prefix?: string } = {}) => {
    const size = options.size ?? 9;
    const font = options.isBold ? bold : regular;
    const gap = options.gap ?? 3.2;
    const indent = options.indent ?? 0;
    const prefix = options.prefix ?? "";
    const lines = wrap(`${prefix}${pdfSafeText(value)}`, font, size, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(size + gap);
      page.drawText(line, { x: margin + indent, y, size, font, color: options.color || rgb(0.09, 0.14, 0.22) });
      y -= size + gap;
    }
    return lines.length * (size + gap);
  };
  const estimateWrapped = (value: unknown, size = 9, isBold = false, indent = 0, gap = 3.2) =>
    wrap(value, isBold ? bold : regular, size, contentWidth - indent).length * (size + gap);
  const sectionHeading = (title: string) => {
    ensureSpace(27);
    y -= 7;
    page.drawText(title, { x: margin, y, size: 11.5, font: bold, color: rgb(0.055, 0.227, 0.459) });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 1.2, color: rgb(0.071, 0.722, 0.69) });
    y -= 10;
  };

  pdf.setTitle(`${pdfSafeText(resume.contact?.full_name)} - Resume`);
  pdf.setAuthor(pdfSafeText(resume.contact?.full_name));
  pdf.setSubject("ATS-friendly professional resume");
  pdf.setKeywords(["resume", "human resources", "ATS"]);

  drawWrapped(titleCaseName(resume.contact?.full_name), { size: 23, isBold: true, color: rgb(0.055, 0.227, 0.459), gap: 6 });
  drawWrapped(resume.headline, { size: 11, isBold: true, color: rgb(0.25, 0.33, 0.43), gap: 5 });
  drawWrapped(contactLine(resume.contact), { size: 8.5, color: rgb(0.39, 0.45, 0.55), gap: 5 });

  sectionHeading("PROFESSIONAL SUMMARY");
  drawWrapped(resume.professional_summary, { size: 9.2, gap: 3.6 });
  sectionHeading("CORE COMPETENCIES");
  drawWrapped((resume.core_competencies || []).join(" | "), { size: 8.8, gap: 3.4 });
  sectionHeading("PROFESSIONAL EXPERIENCE");

  for (const item of resume.experience || []) {
    const title = [item.job_title, item.employer].filter(Boolean).join(" - ");
    const meta = [item.location, item.dates].filter(Boolean).join(" | ");
    const blockHeight =
      estimateWrapped(title, 10.2, true, 0, 3.2) +
      (meta ? estimateWrapped(meta, 8.2, false, 0, 3) : 0) +
      (item.summary ? estimateWrapped(item.summary, 8.8, false, 0, 3.2) : 0) +
      (item.achievements || []).reduce((sum: number, achievement: string) => sum + estimateWrapped(`- ${achievement}`, 8.7, false, 8, 3.1), 0) + 8;
    ensureSpace(Math.min(blockHeight, pageHeight - bottom - margin));
    drawWrapped(title, { size: 10.2, isBold: true, gap: 3.2 });
    if (meta) drawWrapped(meta, { size: 8.2, color: rgb(0.39, 0.45, 0.55), gap: 3 });
    if (item.summary) drawWrapped(item.summary, { size: 8.8, gap: 3.2 });
    for (const achievement of item.achievements || []) drawWrapped(achievement, { size: 8.7, gap: 3.1, indent: 8, prefix: "- " });
    y -= 5;
  }

  sectionHeading("EDUCATION");
  for (const item of resume.education || []) drawWrapped(educationLine(item), { size: 8.9, gap: 3.2 });
  sectionHeading("CERTIFICATIONS");
  for (const item of resume.certifications || []) drawWrapped(item, { size: 8.7, gap: 3.1, indent: 8, prefix: "- " });
  sectionHeading("LANGUAGES");
  drawWrapped((resume.languages || []).join(" | "), { size: 8.9, gap: 3.2 });

  const pages = pdf.getPages();
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({ start: { x: margin, y: 30 }, end: { x: pageWidth - margin, y: 30 }, thickness: 0.5, color: rgb(0.84, 0.88, 0.93) });
    const label = `Page ${index + 1} of ${pages.length}`;
    currentPage.drawText(label, { x: pageWidth - margin - regular.widthOfTextAtSize(label, 7.5), y: 18, size: 7.5, font: regular, color: rgb(0.45, 0.5, 0.58) });
  });
  return new Uint8Array(await pdf.save());
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const key = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_CV_MODEL") || "gpt-5-mini";
  if (!key) return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 500);
  const auth = request.headers.get("Authorization") || "";
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, service);
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const documentId = body.document_id;
  const versionType = body.version_type || "AI Optimized";
  const { data: candidate } = await admin.from("talent_candidates").select("*").eq("auth_user_id", userData.user.id).single();
  if (!candidate) return json({ ok: false, error: "Candidate not found" }, 404);
  const { data: document } = await admin.from("talent_candidate_documents").select("*").eq("id", documentId).eq("candidate_id", candidate.id).single();
  if (!document) return json({ ok: false, error: "CV not found" }, 404);
  if (candidate.ai_cv_status !== "Completed" || !candidate.ai_cv_summary) return json({ ok: false, error: "Complete AI CV analysis first" }, 400);
  const { data: last } = await admin.from("talent_resume_versions").select("version_number").eq("candidate_id", candidate.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version_number || 0) + 1;
  const { data: row, error: rowError } = await admin.from("talent_resume_versions").insert({
    candidate_id: candidate.id,
    source_document_id: document.id,
    version_number: version,
    version_type: versionType,
    title: `${versionType} Resume v${version}`,
    status: "Processing",
    model_name: model,
    source_score: candidate.ai_cv_summary.overall_score || null,
    source_metrics: candidate.ai_cv_summary || {},
  }).select("*").single();
  if (rowError) return json({ ok: false, error: rowError.message }, 500);
  try {
    const { data: blob, error: downloadError } = await admin.storage.from(document.storage_bucket || "talent-cv").download(document.storage_path);
    if (downloadError || !blob) throw new Error(downloadError?.message || "Unable to download CV");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    const fileData = `data:${document.mime_type || "application/pdf"};base64,${btoa(binary)}`;
    const prompt = `Rewrite the attached CV into a truthful, ATS-friendly, executive-quality English resume for the Saudi/GCC market.

Candidate-facing output rules:
- Return resume content only. Never include notes, caveats, explanations, verification statements, source commentary, model instructions, or phrases such as "candidate-provided", "preserved exactly", or "source CV".
- Never invent facts, numbers, employers, dates, degrees, certifications, technologies, locations, achievements, employment type, or job relationships.
- Preserve supported metrics accurately, but avoid repeating the same metric in the headline, summary, and experience.
- Write all output in English using Latin transliteration for names when necessary.
- Keep the headline to 16 words or fewer and do not place metrics in the headline.
- Use MMM YYYY - MMM YYYY or MMM YYYY - Present for employment dates. Use an unambiguous date style for certifications.
- Leave unknown location and institution fields blank. Never write "not specified", "unknown", or "N/A".
- Keep the professional summary concise and executive. Use no more than five achievements for each of the two most recent roles and no more than three for older roles.
- Do not claim overlapping roles were part-time, consulting, or concurrent unless the source explicitly states that.

Candidate profile: ${JSON.stringify({ name: candidate.full_name, email: candidate.email, phone: candidate.phone, city: candidate.city, country: candidate.country_of_residence, linkedin: candidate.linkedin_url, profession: candidate.profession, title: candidate.current_job_title })}.
Existing analysis: ${JSON.stringify(candidate.ai_cv_summary)}.
Target version: ${versionType}.`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_file", filename: document.file_name, file_data: fileData }] }],
        text: { format: { type: "json_schema", name: "visaflow_resume_version", strict: true, schema: resumeSchema } },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI failed (${response.status})`);
    const resume = cleanResume(JSON.parse(outputText(payload)));
    const base = `${candidate.id}/v${version}_${safeFileName(candidate.full_name || "candidate")}`;
    const htmlPath = `${base}.html`;
    const docxPath = `${base}.docx`;
    const pdfPath = `${base}.pdf`;
    const html = buildHtml(resume);
    const docx = await buildDocx(resume);
    const pdf = await buildPdf(resume);
    for (const [path, data, type] of [
      [htmlPath, new TextEncoder().encode(html), "text/html"],
      [docxPath, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      [pdfPath, pdf, "application/pdf"],
    ] as const) {
      const { error } = await admin.storage.from("talent-resume-versions").upload(path, data, { contentType: type, upsert: true });
      if (error) throw new Error(error.message);
    }
    await admin.from("talent_resume_versions").update({
      status: "Completed",
      optimized_score: resume.scores.overall,
      optimized_metrics: resume.scores,
      resume_data: resume,
      improvements: resume.improvements,
      pdf_storage_path: pdfPath,
      docx_storage_path: docxPath,
      html_storage_path: htmlPath,
      completed_at: new Date().toISOString(),
    }).eq("id", row.id);
    return json({ ok: true, version_id: row.id, version_number: version, resume, scores: resume.scores });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("talent_resume_versions").update({ status: "Failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", row.id);
    return json({ ok: false, error: message }, 500);
  }
});
