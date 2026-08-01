export function sanitizeProviderError(error) {
  const code = String(error?.code || error?.name || "EMAIL_PROVIDER_ERROR")
    .replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  return { code, message: "Email delivery failed at the provider." };
}

export function buildEmailIdempotencyKey(messageType, identifier, recipients) {
  return [messageType, identifier, [...recipients].map((value) => String(value).toLowerCase()).sort().join(",")].join(":");
}

export async function deliverWithTransport(transport, message) {
  return new Promise((resolve, reject) => {
    transport.sendMail(message, (error, info) => error ? reject(error) : resolve({
      providerMessageId: String(info?.messageId || info?.response || "").slice(0, 255) || null,
      accepted: Array.isArray(info?.accepted) ? info.accepted.length : undefined,
    }));
  });
}
