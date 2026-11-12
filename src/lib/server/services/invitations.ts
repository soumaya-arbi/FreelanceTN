// Règles métier du module invitations, portées depuis InvitationService.cs.
//
// Cycle de vie : un client invite un freelance sur un projet publié qui lui
// appartient ; le freelance accepte (le projet passe « In progress » et lui est
// attribué, les autres invitations en attente sont annulées) ou décline (motif
// facultatif). Chaque étape notifie la partie concernée.

import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import { conflict, forbidden, notFound, unauthorized } from "@/lib/server/errors";
import { text } from "@/lib/server/serialize";
import { createNotification } from "@/lib/server/notifications";
import { findUserById } from "@/lib/server/repositories/users";
import {
  INVITATION_STATUSES,
  cancelOtherPendingInvitations,
  findInvitationById,
  findPendingInvitation,
  findProjectById,
  insertInvitation,
  listInvitationsByClient,
  listInvitationsByFreelancer,
  replaceProjectIfClaimable,
  transitionInvitationStatus,
  type InvitationDocument,
  type ProjectDocument,
} from "@/lib/server/repositories/invitations";

const PROJECT_STATUS_OPEN = "Open";
const PROJECT_STATUS_IN_PROGRESS = "In progress";
const INVITATION_TTL_DAYS = 7;

export type CreateInvitationInput = {
  projectId: string;
  freelancerId: string;
  message: string;
  offeredPrice?: string;
  offeredDelivery?: string;
};

/** Nom dénormalisé identique à InvitationService : prénom + nom, sans repli. */
function personName(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return "";
  return `${text(doc.firstName)} ${text(doc.lastName)}`.trim();
}

function ensureClient(user: SessionUser): void {
  if (user.role !== "client") throw forbidden("Seuls les clients peuvent inviter.");
}

function ensureFreelancer(user: SessionUser): void {
  if (user.role !== "freelancer") throw forbidden("Seuls les freelances peuvent répondre.");
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toResponse(invitation: InvitationDocument): Record<string, unknown> {
  return {
    id: invitation._id instanceof ObjectId ? invitation._id.toHexString() : text(invitation._id),
    projectId: text(invitation.projectId),
    projectTitle: text(invitation.projectTitle),
    clientId: text(invitation.clientId),
    clientName: text(invitation.clientName),
    freelancerId: text(invitation.freelancerId),
    freelancerName: text(invitation.freelancerName),
    message: text(invitation.message),
    offeredPrice: nullableText(invitation.offeredPrice),
    offeredDelivery: nullableText(invitation.offeredDelivery),
    status: text(invitation.status),
    declineReason: nullableText(invitation.declineReason),
    createdAt: invitation.createdAt ?? null,
    updatedAt: invitation.updatedAt ?? null,
    expiresAt: invitation.expiresAt ?? null,
  };
}

export async function createInvitation(
  user: SessionUser,
  input: CreateInvitationInput,
): Promise<Record<string, unknown>> {
  ensureClient(user);

  const projectId = input.projectId.trim();
  const project = await findProjectById(projectId);
  if (!project || text(project.ownerId) !== user.id) throw notFound("Projet introuvable.");
  if (text(project.status) !== PROJECT_STATUS_OPEN) {
    throw conflict("Le projet doit être publié pour inviter un freelance.");
  }
  if (project.assignedTo !== null && project.assignedTo !== undefined) {
    throw conflict("Ce projet est déjà attribué.");
  }

  const freelancerId = input.freelancerId.trim();
  const freelancer = await findUserById(freelancerId);
  if (!freelancer) throw notFound("Freelance introuvable.");
  if (text(freelancer.role).toLowerCase() !== "freelancer") {
    throw forbidden("Seul un compte freelance peut être invité.");
  }

  const projectTitle = text(project.title);
  const projectKey = project._id.toHexString();
  const freelancerKey =
    freelancer._id instanceof ObjectId ? freelancer._id.toHexString() : text(freelancer._id);
  const existing = await findPendingInvitation(projectKey, freelancerKey);
  if (existing) {
    throw conflict("Une invitation est déjà en attente pour ce freelance sur ce projet.");
  }

  const client = await findUserById(user.id);
  if (!client) throw unauthorized("Session invalide.");

  const now = new Date();
  const invitation: InvitationDocument = {
    _id: new ObjectId(),
    projectId: projectKey,
    projectTitle,
    clientId: user.id,
    clientName: personName(client),
    freelancerId: freelancerKey,
    freelancerName: personName(freelancer),
    message: (input.message ?? "").trim(),
    offeredPrice:
      input.offeredPrice === undefined || input.offeredPrice.trim() === ""
        ? null
        : input.offeredPrice.trim(),
    offeredDelivery:
      input.offeredDelivery === undefined || input.offeredDelivery.trim() === ""
        ? null
        : input.offeredDelivery.trim(),
    status: INVITATION_STATUSES.pending,
    declineReason: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
  await insertInvitation(invitation);

  await createNotification({
    recipientId: freelancerKey,
    type: "invitation",
    title: projectTitle,
    message: `Vous avez reçu une invitation pour le projet « ${projectTitle} ».`,
    projectId: projectKey,
    projectTitle,
    actorName: invitation.clientName,
  });

  return toResponse(invitation);
}

export async function listMyInvitations(
  user: SessionUser,
): Promise<Record<string, unknown>[]> {
  ensureFreelancer(user);
  const items = await listInvitationsByFreelancer(user.id);
  return items.map(toResponse);
}

export async function listSentInvitations(
  user: SessionUser,
): Promise<Record<string, unknown>[]> {
  ensureClient(user);
  const items = await listInvitationsByClient(user.id);
  return items.map(toResponse);
}

export async function acceptInvitation(
  user: SessionUser,
  invitationId: string,
): Promise<Record<string, unknown>> {
  ensureFreelancer(user);

  const invitation = await findInvitationById(invitationId);
  if (!invitation || text(invitation.freelancerId) !== user.id) {
    throw notFound("Invitation introuvable.");
  }
  const currentStatus = text(invitation.status);
  if (currentStatus !== INVITATION_STATUSES.pending) {
    throw conflict(`Cette invitation a déjà été traitée (${currentStatus}).`);
  }
  const expiresAt = invitation.expiresAt instanceof Date ? invitation.expiresAt : null;
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    throw conflict("Cette invitation a expiré.");
  }

  const project = await findProjectById(text(invitation.projectId));
  if (!project) throw notFound("Projet introuvable.");

  const projectStatus = text(project.status);
  const assignedTo = typeof project.assignedTo === "string" ? project.assignedTo : null;
  const isOwner = text(project.ownerId) === user.id;
  const isAssigned = assignedTo !== null && assignedTo === user.id;
  // Même visibilité que ProjectService.GetEntityAsync.
  if (!isOwner && !isAssigned && projectStatus !== PROJECT_STATUS_OPEN) {
    throw notFound("Projet introuvable.");
  }
  if (projectStatus !== PROJECT_STATUS_OPEN) throw conflict("Ce projet n'est plus disponible.");
  if (assignedTo !== null && assignedTo !== user.id) {
    throw conflict("Ce projet a déjà été attribué.");
  }

  const freelancer = await findUserById(user.id);
  if (!freelancer) throw notFound("Freelance introuvable.");
  if (text(freelancer.role).toLowerCase() !== "freelancer") {
    throw forbidden("Seul un compte freelance peut être approuvé sur un projet.");
  }

  const now = new Date();
  const replacement: ProjectDocument = {
    ...project,
    assignedTo: user.id,
    assignedToName: personName(freelancer),
    assignedAt: now,
    status: PROJECT_STATUS_IN_PROGRESS,
    updatedAt: now,
  };
  const claimed = await replaceProjectIfClaimable(
    project._id,
    text(project.ownerId),
    user.id,
    replacement,
  );
  if (!claimed) throw conflict("Ce projet a déjà été attribué à un autre freelance.");

  const accepted = await transitionInvitationStatus(invitation._id, INVITATION_STATUSES.pending, {
    status: INVITATION_STATUSES.accepted,
    updatedAt: now,
  });
  if (!accepted) throw conflict("Cette invitation a déjà été traitée.");

  await cancelOtherPendingInvitations(
    text(invitation.projectId),
    invitation._id,
    now,
  );

  const projectTitle = text(invitation.projectTitle);
  await createNotification({
    recipientId: text(invitation.clientId),
    type: "invitation-accepted",
    title: projectTitle,
    message: `${text(invitation.freelancerName)} a accepté votre invitation pour « ${projectTitle} ».`,
    projectId: text(invitation.projectId),
    projectTitle,
    actorName: text(invitation.freelancerName),
  });

  return toResponse({
    ...invitation,
    status: INVITATION_STATUSES.accepted,
    updatedAt: now,
  });
}

export async function declineInvitation(
  user: SessionUser,
  invitationId: string,
  reason?: string,
): Promise<Record<string, unknown>> {
  ensureFreelancer(user);

  const invitation = await findInvitationById(invitationId);
  if (!invitation || text(invitation.freelancerId) !== user.id) {
    throw notFound("Invitation introuvable.");
  }
  const currentStatus = text(invitation.status);
  if (currentStatus !== INVITATION_STATUSES.pending) {
    throw conflict(`Cette invitation a déjà été traitée (${currentStatus}).`);
  }

  const now = new Date();
  const declineReason =
    reason === undefined || reason.trim() === "" ? null : reason.trim();
  const declined = await transitionInvitationStatus(invitation._id, INVITATION_STATUSES.pending, {
    status: INVITATION_STATUSES.declined,
    declineReason,
    updatedAt: now,
  });
  if (!declined) throw conflict("Cette invitation a déjà été traitée.");

  const projectTitle = text(invitation.projectTitle);
  await createNotification({
    recipientId: text(invitation.clientId),
    type: "invitation-declined",
    title: projectTitle,
    message: `${text(invitation.freelancerName)} a décliné votre invitation pour « ${projectTitle} ».`,
    projectId: text(invitation.projectId),
    projectTitle,
    actorName: text(invitation.freelancerName),
  });

  return toResponse({
    ...invitation,
    status: INVITATION_STATUSES.declined,
    declineReason,
    updatedAt: now,
  });
}
