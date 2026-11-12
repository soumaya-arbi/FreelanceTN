// Compatibilité de chemin pour d'éventuels imports internes anciens.
// Les appels sont désormais délégués au transport FastAPI, jamais à OpenAI.
export {
  completeJson,
  INVALID_RESPONSE,
  NOT_CONFIGURED,
  UNAVAILABLE,
} from "@/lib/server/ai/provider";
export type { AiChatMessage } from "@/lib/server/ai/provider";
