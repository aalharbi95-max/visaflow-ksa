export const REPLY_CLASSES = ["INTERESTED", "REQUEST_DEMO", "REQUEST_PRICING", "NEED_MORE_INFO", "NOT_NOW", "NOT_INTERESTED", "WRONG_CONTACT", "UNSUBSCRIBE", "OUT_OF_OFFICE", "REFERRAL"];

export function assertPlatformSalesActor(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('forbidden');
  const actor = rows[0];
  if (actor.status !== 'Active' || actor.is_active !== true || actor.role !== 'Platform Owner' || actor.company_id != null) throw new Error('forbidden');
  return actor;
}

// Compliance intent is handled before AI. Ambiguity may suppress contact; it never enables sending.
export function complianceReply(text) {
  const value = String(text || "").normalize("NFKC").toLowerCase().replace(/[\u064b-\u065f\u0670]/g, "");
  if (/\bunsubscribe\b|\bopt[ -]?out\b|do not (?:contact|email)|don['’]?t (?:contact|email)|stop (?:emailing|contacting|sending)|remove me|إلغاء الاشتراك|الغاء الاشتراك|لا (?:تتواصل|تراسل|ترسل)|عدم التواصل|احذف.*(?:القائمة|البريد)/iu.test(value)) return "UNSUBSCRIBE";
  if (/\bpric(?:e|es|ing)\b|\bcost\b|\bquote\b|\bdiscount\b|تسعير|[اأ]سعار|سعر|تكلفة|خصم|عرض مالي/iu.test(value)) return "REQUEST_PRICING";
  return null;
}

export function normalizeSalesResult(action, raw, replyText = "") {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_ai_output");
  const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  if (action === "qualify_lead") {
    if (typeof raw.score !== "number" || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 100) throw new Error("invalid_score");
    const score = Math.round(raw.score);
    const stage = ["NEW", "CONTACT_IDENTIFIED", "READY_TO_CONTACT", "NOT_FIT"].includes(raw.recommended_stage) ? raw.recommended_stage : "NEW";
    return { score, grade: score >= 75 ? "A" : score >= 55 ? "B" : score >= 30 ? "C" : "D", recommended_stage: stage, fit_reason: text(raw.fit_reason, 3000), evidence: Array.isArray(raw.evidence) ? raw.evidence.filter(x => typeof x === "string").slice(0, 12).map(x => x.slice(0, 500)) : [] };
  }
  if (action === "draft_outreach") {
    const subject = text(raw.subject, 240), body = text(raw.body, 8000);
    if (!subject || !body) throw new Error("invalid_outreach_draft");
    return { subject, body, approval_required: true, status: "pending", channel: "email" };
  }
  if (action === "classify_reply") {
    const classification = complianceReply(replyText) || raw.classification;
    if (!REPLY_CLASSES.includes(classification)) throw new Error("invalid_reply_classification");
    const followUp = raw.follow_up_days;
    return { classification, summary: text(raw.summary, 3000), requires_ceo_approval: classification === "REQUEST_PRICING" || raw.requires_ceo_approval === true,
      recommended_stage: classification === "UNSUBSCRIBE" ? "LOST" : "REPLIED",
      follow_up_days: classification === "UNSUBSCRIBE" || followUp === null || followUp === undefined ? null : typeof followUp === "number" && Number.isFinite(followUp) && followUp >= 0 ? Math.min(365, Math.round(followUp)) : null };
  }
  throw new Error("invalid_action");
}

export function assertSalesContactable(lead) {
  if (lead.do_not_contact || lead.status !== "active") throw new Error("lead_do_not_contact");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.contact_email || "")) throw new Error("valid_contact_email_required");
}

export function riyadhDayStart(now = new Date()) {
  const shifted = new Date(now.getTime() + 3 * 3600000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 3 * 3600000).toISOString();
}
