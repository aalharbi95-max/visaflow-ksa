const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/wav",
  "video/webm",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/mp4",
]);

export function readAndClearInterviewInvitation(location = window.location, history = window.history) {
  const hash = String(location.hash || "").replace(/^#/, "");
  const rawParams = hash.startsWith("/") ? hash.slice(1).split("?")[1] || "" : hash;
  const secret = new URLSearchParams(rawParams).get("interview_invite") || "";
  if (secret) history.replaceState(null, "", `${location.pathname}${location.search}`);
  return secret;
}

export function validateInterviewMedia(file) {
  const type = String(file?.type || "").toLowerCase();
  const size = Number(file?.size || 0);
  if (!ALLOWED_MEDIA_TYPES.has(type)) throw new Error("Unsupported interview media type.");
  const maximum = type.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  if (size <= 0 || size > maximum) throw new Error("Interview media exceeds the allowed size.");
  return { contentType: type, size };
}

async function invoke(client, functionName, body) {
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message || "Secure interview request failed.");
  if (!data?.ok) throw new Error(data?.message || "Secure interview request failed.");
  return data;
}

export async function ensureInterviewAuth(client) {
  const { data: existing } = await client.auth.getSession();
  if (existing?.session?.user?.id) return existing.session;
  const { data, error } = await client.auth.signInAnonymously({
    options: { data: { account_type: "interview_portal" } },
  });
  if (error || !data?.session?.user?.id) throw new Error("The secure interview session could not be established.");
  return data.session;
}

export async function exchangeInterviewInvitation(client, invitationSecret) {
  if (!invitationSecret || invitationSecret.length < 32) throw new Error("This interview link is invalid or expired.");
  await ensureInterviewAuth(client);
  return invoke(client, "interview-portal-exchange", { invitation_secret: invitationSecret });
}

export const loadInterviewPortalState = (client, capabilityId) =>
  invoke(client, "interview-portal-state", { capability_id: capabilityId });

export const transitionInterviewPortal = (client, capabilityId, action, payload = {}, idempotencyKey = "") =>
  invoke(client, "interview-portal-transition", {
    capability_id: capabilityId,
    action,
    payload,
    idempotency_key: idempotencyKey,
  });

export async function uploadInterviewMedia(client, capabilityId, questionId, file) {
  const media = validateInterviewMedia(file);
  const signed = await invoke(client, "interview-media-sign-upload", {
    capability_id: capabilityId,
    question_id: questionId,
    content_type: media.contentType,
    content_length: media.size,
  });
  const response = await fetch(signed.upload_url, {
    method: "PUT",
    headers: { "Content-Type": media.contentType, "x-upsert": "false" },
    body: file,
  });
  if (!response.ok) throw new Error("Interview media upload failed.");
  return invoke(client, "interview-media-finalize", {
    capability_id: capabilityId,
    upload_id: signed.upload_id,
  });
}

export const getInterviewMediaReadUrl = (client, capabilityId, answerId) =>
  invoke(client, "interview-media-sign-read", { capability_id: capabilityId, answer_id: answerId });
