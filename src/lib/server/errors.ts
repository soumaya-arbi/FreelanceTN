// Erreurs applicatives et conversion vers un ActionResult sérialisable.

import type { ActionResult } from "@/lib/actions/types";

/** Erreur métier destinée au client (statut HTTP + message français). */
export class ActionError extends Error {
  readonly status: number;
  readonly errors: string[];

  constructor(status: number, message: string, errors: string[] = []) {
    super(message);
    this.name = "ActionError";
    this.status = status;
    this.errors = errors;
  }
}

/** 400 : validation. */
export function validationError(message: string, errors: string[] = []): ActionError {
  return new ActionError(400, message, errors.length > 0 ? errors : [message]);
}

/** 401 : aucune session valide. */
export function unauthorized(message = "Authentification requise."): ActionError {
  return new ActionError(401, message);
}

/** 403 : rôle ou propriété insuffisants. */
export function forbidden(message = "Accès refusé."): ActionError {
  return new ActionError(403, message);
}

/** 404 : ressource inexistante. */
export function notFound(message = "Ressource introuvable."): ActionError {
  return new ActionError(404, message);
}

/** 409 : conflit d'état. */
export function conflict(message: string): ActionError {
  return new ActionError(409, message);
}

function isControlFlowError(error: unknown): boolean {
  // redirect() / notFound() de Next lèvent des erreurs internes qui doivent
  // traverser la Server Action sans être transformées en échec métier.
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/**
 * Exécute une Server Action et capture uniquement les erreurs métier.
 * Les erreurs inattendues sont journalisées côté serveur et remplacées par un
 * message générique afin de ne jamais fuiter de détail interne.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (isControlFlowError(error)) throw error;
    if (error instanceof ActionError) {
      return { ok: false, status: error.status, message: error.message, errors: error.errors };
    }
    console.error("[server-action]", error);
    return {
      ok: false,
      status: 500,
      message: "Une erreur interne est survenue. Veuillez réessayer.",
      errors: [],
    };
  }
}
