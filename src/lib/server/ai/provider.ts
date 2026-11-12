// Client Next.js côté serveur vers le microservice FastAPI privé.
// Le token interne et les prompts ne quittent jamais le serveur Next vers le navigateur.

import { ActionError } from "@/lib/server/errors";
import { getAiConfig } from "@/lib/server/ai/config";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type FastApiResponse = {
  content?: unknown;
  detail?: string | { code?: string; message?: string };
};

export const NOT_CONFIGURED =
  "Le microservice IA n'est pas configuré. Renseignez AI_SERVICE_URL et AI_SERVICE_TOKEN côté serveur Next.js.";
export const UNAVAILABLE =
  "L'assistant IA est temporairement indisponible. Réessayez dans quelques instants.";
export const INVALID_RESPONSE =
  "La réponse de l'assistant IA est invalide ou incomplète. Régénérez pour réessayer.";
const QUOTA = "Le quota gratuit ou la capacité Workers AI est atteint. Réessayez plus tard.";

function upstreamError(status: number, body: FastApiResponse | null): ActionError {
  const detail = body?.detail;
  const code = typeof detail === "object" && detail !== null ? detail.code ?? "" : "";

  if (code === "quota_exhausted") return new ActionError(503, QUOTA);
  if (code === "provider_not_configured") {
    return new ActionError(503, "Workers AI n'est pas configuré dans le microservice FastAPI.");
  }
  if (code === "provider_configuration") {
    return new ActionError(503, "Workers AI a refusé les identifiants serveur ou le modèle configuré.");
  }
  if (code === "provider_timeout") {
    return new ActionError(503, "Le délai d'appel à Workers AI est dépassé. Réessayez.");
  }
  if (code === "invalid_provider_response") return new ActionError(502, INVALID_RESPONSE);
  if (status === 401 || status === 403) {
    return new ActionError(503, "Le microservice IA a refusé la connexion interne.");
  }
  if (status === 413) return new ActionError(413, "La demande est trop volumineuse pour le fournisseur IA.");
  if (status >= 500) return new ActionError(503, UNAVAILABLE);
  return new ActionError(502, INVALID_RESPONSE);
}

/** Envoie les messages inchangés à FastAPI et renvoie le texte JSON brut au parseur existant. */
export async function completeJson(messages: AiChatMessage[]): Promise<string> {
  const config = getAiConfig();
  if (!config.configured) throw new ActionError(503, NOT_CONFIGURED);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.serviceUrl}/v1/generate-json`, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.serviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, temperature: 0.4, max_tokens: config.maxTokens }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ActionError(503, "Délai dépassé lors de l'appel au microservice IA. Réessayez.");
    }
    throw new ActionError(503, UNAVAILABLE);
  } finally {
    clearTimeout(timer);
  }

  let body: FastApiResponse | null = null;
  try {
    body = (await response.json()) as FastApiResponse;
  } catch {
    body = null;
  }
  if (!response.ok) throw upstreamError(response.status, body);

  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) throw new ActionError(502, INVALID_RESPONSE);
  return content;
}
