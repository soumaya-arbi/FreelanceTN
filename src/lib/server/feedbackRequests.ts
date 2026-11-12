// Déclencheur Feedback à la clôture d'un projet.
//
// Le module Feedback vit dans l'API .NET (source unique de vérité). Le module
// Projects du front est encore porté par des Server Actions Next : à la
// transition réelle vers « Completed », on appelle donc l'endpoint idempotent
// de l'API pour créer les deux demandes d'évaluation. En cas d'échec (API
// momentanément indisponible), la lecture de l'espace Feedback répare l'état
// via le même endpoint côté service .NET : aucune donnée n'est perdue et aucun
// doublon n'est créé.

import { cookies } from "next/headers";

const COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME ?? process.env.Jwt__CookieName ?? "freelancetn_auth";

const API_BASE = (process.env.API_PROXY_TARGET ?? "http://localhost:5080").replace(/\/$/, "");

/**
 * Demande la création idempotente des deux évaluations d'un projet terminé.
 * Cette fonction ne doit jamais faire échouer la clôture du projet.
 */
export async function ensureFeedbackRequests(projectId: string): Promise<void> {
  if (!projectId) return;

  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return;

    await fetch(`${API_BASE}/api/feedbacks/requests/${encodeURIComponent(projectId)}`, {
      method: "POST",
      headers: {
        cookie: `${COOKIE_NAME}=${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  } catch {
    // Le filet de sécurité est exécuté à la prochaine lecture de l'espace
    // Feedback : la clôture du projet ne doit pas être bloquée.
  }
}
