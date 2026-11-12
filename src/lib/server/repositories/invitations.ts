// Accès aux collections "invitations" et "projects" pour le module invitations.
//
// Aucune règle métier ici : uniquement les lectures/écritures Mongo. Les
// identifiants de projet, client et freelance sont stockés en string dans
// "invitations" ; "projects._id" est un ObjectId (BsonRepresentation ObjectId).

import { ObjectId } from "mongodb";
import { COLLECTIONS, getCollection } from "@/lib/server/db";

export const INVITATION_STATUSES = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
} as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[keyof typeof INVITATION_STATUSES];

export type InvitationDocument = Record<string, unknown> & {
  _id: ObjectId;
  projectId: string;
  projectTitle: string;
  clientId: string;
  clientName: string;
  freelancerId: string;
  freelancerName: string;
  message: string;
  offeredPrice?: string | null;
  offeredDelivery?: string | null;
  status: string;
  declineReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
};

export type ProjectDocument = Record<string, unknown> & {
  _id: ObjectId;
};

function invitations() {
  return getCollection<InvitationDocument>(COLLECTIONS.invitations);
}

function projects() {
  return getCollection<ProjectDocument>(COLLECTIONS.projects);
}

export async function findInvitationById(id: string): Promise<InvitationDocument | null> {
  if (!ObjectId.isValid(id)) return null;
  const collection = await invitations();
  return collection.findOne({ _id: new ObjectId(id) });
}

export async function findPendingInvitation(
  projectId: string,
  freelancerId: string,
): Promise<InvitationDocument | null> {
  const collection = await invitations();
  return collection.findOne({
    projectId,
    freelancerId,
    status: INVITATION_STATUSES.pending,
  });
}

export async function listInvitationsByFreelancer(
  freelancerId: string,
): Promise<InvitationDocument[]> {
  const collection = await invitations();
  return collection.find({ freelancerId }).sort({ createdAt: -1 }).toArray();
}

export async function listInvitationsByClient(clientId: string): Promise<InvitationDocument[]> {
  const collection = await invitations();
  return collection.find({ clientId }).sort({ createdAt: -1 }).toArray();
}

export async function insertInvitation(invitation: InvitationDocument): Promise<void> {
  const collection = await invitations();
  await collection.insertOne(invitation);
}

/**
 * Applique une transition d'état uniquement si l'invitation est encore dans
 * l'état attendu. Renvoie false lorsqu'une autre requête l'a déjà traitée.
 */
export async function transitionInvitationStatus(
  id: ObjectId,
  expectedStatus: string,
  update: Record<string, unknown>,
): Promise<boolean> {
  const collection = await invitations();
  const result = await collection.updateOne(
    { _id: id, status: expectedStatus },
    { $set: update },
  );
  return result.matchedCount === 1;
}

/** Annule toutes les invitations encore en attente d'un projet, sauf une. */
export async function cancelOtherPendingInvitations(
  projectId: string,
  keepInvitationId: ObjectId,
  now: Date,
): Promise<void> {
  const collection = await invitations();
  await collection.updateMany(
    {
      projectId,
      _id: { $ne: keepInvitationId },
      status: INVITATION_STATUSES.pending,
    },
    { $set: { status: INVITATION_STATUSES.cancelled, updatedAt: now } },
  );
}

export async function findProjectById(projectId: string): Promise<ProjectDocument | null> {
  if (!ObjectId.isValid(projectId)) return null;
  const collection = await projects();
  return collection.findOne({ _id: new ObjectId(projectId) });
}

/**
 * Réclame atomiquement l'affectation d'un projet : l'écriture n'aboutit que si
 * le projet est toujours publié (Open) et non attribué, ou déjà attribué au
 * même freelance. Deux acceptations concurrentes ne peuvent donc pas attribuer
 * le projet à deux freelances différents.
 */
export async function replaceProjectIfClaimable(
  projectId: ObjectId,
  ownerId: string,
  freelancerId: string,
  replacement: ProjectDocument,
): Promise<boolean> {
  const collection = await projects();
  const result = await collection.replaceOne(
    {
      _id: projectId,
      ownerId,
      status: "Open",
      $or: [{ assignedTo: null }, { assignedTo: freelancerId }],
    },
    replacement,
  );
  return result.matchedCount === 1;
}
