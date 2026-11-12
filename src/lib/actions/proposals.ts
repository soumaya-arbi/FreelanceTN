"use server";

// Server Actions du module candidatures. Aucune règle métier ici : la session
// est vérifiée, le service applique les règles puis l'on sérialise la réponse.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/session";
import { serialize } from "@/lib/server/serialize";
import { revalidateApp } from "@/lib/server/revalidate";
import * as proposalService from "@/lib/server/services/proposals";
import type { CreateProposalInput } from "@/lib/server/services/proposals";

/** Dépose une candidature sur un projet publié (freelance uniquement). */
export async function createProposal(input: CreateProposalInput): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const proposal = await proposalService.createProposal(user, input);
    revalidateApp();
    return serialize(proposal);
  });
}

/** Candidatures déposées par le freelance connecté. */
export async function listMyProposals(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await proposalService.listMyProposals(user));
  });
}

/** Candidatures reçues par le client connecté, sur ses projets uniquement. */
export async function listReceivedProposals(projectId?: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await proposalService.listReceivedProposals(user, projectId));
  });
}

/** Consultation d'une candidature : auteur ou propriétaire du projet. */
export async function getProposal(id: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await proposalService.getProposal(user, id));
  });
}

/** Décision du client : accepter ou refuser une candidature. */
export async function setProposalStatus(
  id: string,
  status: "Accepted" | "Refused",
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const proposal = await proposalService.setProposalStatus(user, id, status);
    revalidateApp();
    return serialize(proposal);
  });
}

/** Retrait d'une propre candidature par le freelance. */
export async function deleteProposal(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await proposalService.deleteProposal(user, id);
    revalidateApp();
    return null;
  });
}
