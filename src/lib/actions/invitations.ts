"use server";

// Server Actions du module invitations. La session est lue côté serveur ; le
// rôle (client pour inviter, freelance pour répondre) est vérifié par le
// service, qui reprend les messages français du backend .NET.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { serialize } from "@/lib/server/serialize";
import { requireUser } from "@/lib/server/session";
import {
  acceptInvitation as acceptInvitationService,
  createInvitation as createInvitationService,
  declineInvitation as declineInvitationService,
  listMyInvitations as listMyInvitationsService,
  listSentInvitations as listSentInvitationsService,
  type CreateInvitationInput,
} from "@/lib/server/services/invitations";

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invitation = await createInvitationService(user, input);
    revalidateApp();
    return serialize(invitation);
  });
}

export async function listMyInvitations(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invitations = await listMyInvitationsService(user);
    return serialize(invitations);
  });
}

export async function listSentInvitations(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invitations = await listSentInvitationsService(user);
    return serialize(invitations);
  });
}

export async function acceptInvitation(id: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invitation = await acceptInvitationService(user, id);
    revalidateApp();
    return serialize(invitation);
  });
}

export async function declineInvitation(
  id: string,
  reason?: string,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invitation = await declineInvitationService(user, id, reason);
    revalidateApp();
    return serialize(invitation);
  });
}
