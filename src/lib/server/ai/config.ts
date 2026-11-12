// Configuration du client Next.js vers le microservice FastAPI privé.
// Les identifiants Cloudflare ne sont jamais chargés dans Next.js.

export type AiProviderConfig = {
  configured: boolean;
  provider: "cloudflare-workers-ai";
  serviceToken: string;
  serviceUrl: string;
  timeoutMs: number;
  maxTokens: number;
};

/** Lit la configuration runtime. Aucune clé n'est journalisée. */
export function getAiConfig(): AiProviderConfig {
  const serviceUrl = (process.env.AI_SERVICE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceToken = (process.env.AI_SERVICE_TOKEN ?? "").trim();
  const timeoutRaw = Number(process.env.AI_TIMEOUT_MS ?? 60000);
  const maxTokensRaw = Number(process.env.AI_MAX_TOKENS ?? 2500);

  let secureServiceUrl = false;
  try {
    const parsed = new URL(serviceUrl);
    secureServiceUrl =
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  } catch {
    secureServiceUrl = false;
  }

  return {
    configured: secureServiceUrl && serviceToken.length >= 32,
    provider: "cloudflare-workers-ai",
    serviceToken,
    serviceUrl,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 5000 ? timeoutRaw : 60000,
    maxTokens: Number.isFinite(maxTokensRaw) && maxTokensRaw >= 200 ? Math.min(maxTokensRaw, 8000) : 2500,
  };
}

export function isAiConfigured(): boolean {
  return getAiConfig().configured;
}
