"use server";

// Server Actions de l'assistant IA. Aucune mutation métier ici :
// suggestions uniquement, après vérification de session et de rôle.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/session";
import { serialize } from "@/lib/server/serialize";
import * as aiService from "@/lib/server/services/ai";

export async function getAiStatusAction(): Promise<ActionResult<aiService.AiStatus>> {
  return runAction(async () => {
    await requireUser();
    return serialize(await aiService.getAiStatus()) as aiService.AiStatus;
  });
}

export async function assistProjectDraftAction(input: {
  idea: string;
  category?: string;
  language?: string;
}): Promise<ActionResult<aiService.ProjectAssistSuggestion>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await aiService.assistProjectDraft(user, input)) as aiService.ProjectAssistSuggestion;
  });
}

export async function matchFreelancersAction(
  projectId: string,
): Promise<ActionResult<{ projectId: string; matches: aiService.FreelancerMatchSuggestion[] }>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(
      await aiService.matchFreelancersForProject(user, projectId),
    ) as { projectId: string; matches: aiService.FreelancerMatchSuggestion[] };
  });
}

export async function assistProposalDraftAction(
  projectId: string,
): Promise<ActionResult<aiService.ProposalAssistSuggestion>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await aiService.assistProposalDraft(user, projectId)) as aiService.ProposalAssistSuggestion;
  });
}

export async function breakdownProjectAction(
  projectId: string,
): Promise<ActionResult<aiService.ProjectBreakdownSuggestion>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await aiService.breakdownProject(user, projectId)) as aiService.ProjectBreakdownSuggestion;
  });
}
