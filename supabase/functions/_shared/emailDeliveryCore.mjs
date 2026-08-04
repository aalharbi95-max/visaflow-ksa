export function sanitizeProviderError(error) {
  const code = String(error?.code || "").toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  const message = String(error?.message || error?.response || "").toLowerCase();
  if (/missing required server configuration/.test(message)) return { code: "SMTP_CONFIG_MISSING", message: "SMTP configuration is incomplete." };
  if (code === "EAUTH" || responseCode === 535) return { code: "SMTP_AUTH_FAILED", message: "SMTP authentication failed." };
  if (code === "ETIMEDOUT" || /timed?\s*out/.test(message)) return { code: "SMTP_TIMEOUT", message: "SMTP connection timed out." };
  if (["ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"].includes(code)) return { code: "SMTP_CONNECTION_FAILED", message: "SMTP connection failed." };
  if (["ETLS", "ESOCKET"].includes(code) || /tls|starttls|certificate/.test(message)) return { code: "SMTP_TLS_FAILED", message: "SMTP TLS negotiation failed." };
  if (/relay (?:access )?denied|not permitted to relay/.test(message)) return { code: "SMTP_RELAY_DENIED", message: "SMTP relay was denied." };
  if (/sender|from address/.test(message) && /reject|invalid|denied/.test(message)) return { code: "SMTP_SENDER_REJECTED", message: "SMTP sender address was rejected." };
  return { code: "EMAIL_DISPATCH_FAILED", message: "Email delivery failed at the provider." };
}

export function buildEmailIdempotencyKey(messageType, identifier, recipients) {
  return [messageType, identifier, [...recipients].map((value) => String(value).toLowerCase()).sort().join(",")].join(":");
}

export function canRetryEmailDelivery(status, failedAt, now = Date.now(), cooldownMs = 60_000) {
  if (String(status || "") !== "Failed") return false;
  const timestamp = Date.parse(String(failedAt || ""));
  return !Number.isFinite(timestamp) || now - timestamp >= cooldownMs;
}

export async function deliverWithTransport(transport, message) {
  return new Promise((resolve, reject) => {
    transport.sendMail(message, (error, info) => error ? reject(error) : resolve({
      providerMessageId: String(info?.messageId || info?.response || "").slice(0, 255) || null,
      accepted: Array.isArray(info?.accepted) ? info.accepted.length : undefined,
    }));
  });
}
