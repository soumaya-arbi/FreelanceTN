// Accès à la collection "proposals" (documents camelCase du modèle Proposal.cs)
// et lecture ciblée du portfolio nécessaire à la validation d'une candidature.
// Aucune règle métier ni vérification de session ici.

import { MongoServerError, ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { text, toObjectId } from "@/lib/server/serialize";

export type ProposalDocument = {
  _id: ObjectId;
  projectId: string;
  projectTitle: string;
  projectBudget: string;
  projectType: string;
  projectStatus: string;
  projectOwnerId: string;
  freelancerId: string;
  freelancerName: string;
  freelancerTitle: string;
  coverLetter: string;
  price: string;
  delivery: string;
  portfolioId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function requiredDate(value: unknown): Date {
  return toDate(value) ?? new Date();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function normalizeProposal(value: Record<string, unknown>): ProposalDocument {
  const rawId = value._id;
  const id =
    rawId instanceof ObjectId
      ? rawId
      : typeof rawId === "string" && ObjectId.isValid(rawId)
        ? new ObjectId(rawId)
        : new ObjectId();

  return {
    _id: id,
    projectId: text(value.projectId),
    projectTitle: text(value.projectTitle),
    projectBudget: text(value.projectBudget),
    projectType: text(value.projectType),
    projectStatus: text(value.projectStatus),
    projectOwnerId: text(value.projectOwnerId),
    freelancerId: text(value.freelancerId),
    freelancerName: text(value.freelancerName),
    freelancerTitle: text(value.freelancerTitle),
    coverLetter: text(value.coverLetter),
    price: text(value.price),
    delivery: text(value.delivery),
    portfolioId: optionalString(value.portfolioId),
    status: text(value.status, "Pending"),
    createdAt: requiredDate(value.createdAt),
    updatedAt: requiredDate(value.updatedAt),
  };
}

function toProposalRecord(proposal: ProposalDocument): Record<string, unknown> {
  return {
    _id: proposal._id,
    projectId: proposal.projectId,
    projectTitle: proposal.projectTitle,
    projectBudget: proposal.projectBudget,
    projectType: proposal.projectType,
    projectStatus: proposal.projectStatus,
    projectOwnerId: proposal.projectOwnerId,
    freelancerId: proposal.freelancerId,
    freelancerName: proposal.freelancerName,
    freelancerTitle: proposal.freelancerTitle,
    coverLetter: proposal.coverLetter,
    price: proposal.price,
    delivery: proposal.delivery,
    portfolioId: proposal.portfolioId,
    status: proposal.status,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

async function readProposal(value: Record<string, unknown> | null): Promise<ProposalDocument | null> {
  return value ? normalizeProposal(value) : null;
}

export async function findProposalById(id: string): Promise<ProposalDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const proposals = await collections.proposals();
  const doc = await proposals.findOne({ _id: objectId });
  return readProposal(doc as Record<string, unknown> | null);
}

export async function findProposalOfFreelancer(
  id: string,
  freelancerId: string,
): Promise<ProposalDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const proposals = await collections.proposals();
  const doc = await proposals.findOne({ _id: objectId, freelancerId });
  return readProposal(doc as Record<string, unknown> | null);
}

export async function findDuplicateProposal(
  projectId: string,
  freelancerId: string,
): Promise<ProposalDocument | null> {
  const proposals = await collections.proposals();
  const doc = await proposals.findOne({ projectId, freelancerId });
  return readProposal(doc as Record<string, unknown> | null);
}

export async function findAcceptedProposal(
  projectId: string,
  freelancerId: string,
): Promise<ProposalDocument | null> {
  const proposals = await collections.proposals();
  const doc = await proposals.findOne({ projectId, freelancerId, status: "Accepted" });
  return readProposal(doc as Record<string, unknown> | null);
}

export async function listProposalsOfFreelancer(freelancerId: string): Promise<ProposalDocument[]> {
  const proposals = await collections.proposals();
  const docs = await proposals.find({ freelancerId }).sort({ createdAt: -1 }).toArray();
  return docs.map((doc) => normalizeProposal(doc as Record<string, unknown>));
}

export async function listProposalsOfOwner(
  ownerId: string,
  projectId?: string,
): Promise<ProposalDocument[]> {
  const filter: Record<string, unknown> = { projectOwnerId: ownerId };
  const trimmed = projectId?.trim();
  if (trimmed) filter.projectId = trimmed;

  const proposals = await collections.proposals();
  const docs = await proposals.find(filter).sort({ createdAt: -1 }).toArray();
  return docs.map((doc) => normalizeProposal(doc as Record<string, unknown>));
}

/** Insère une candidature ; false si l'index unique (projectId, freelancerId) la refuse. */
export async function insertProposal(proposal: ProposalDocument): Promise<boolean> {
  const proposals = await collections.proposals();
  try {
    await proposals.insertOne(toProposalRecord(proposal));
    return true;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

/** Remplacement conditionnel sur le statut attendu ; false si la candidature a changé. */
export async function replaceProposal(
  proposal: ProposalDocument,
  expectedStatus: string,
): Promise<boolean> {
  const proposals = await collections.proposals();
  const result = await proposals.replaceOne(
    { _id: proposal._id, status: expectedStatus },
    toProposalRecord(proposal),
  );
  return result.matchedCount > 0;
}

export async function updateProposalStatus(
  proposalId: string,
  fromStatus: string,
  toStatus: string,
  projectStatus: string,
): Promise<void> {
  const objectId = toObjectId(proposalId);
  if (!objectId) return;
  const proposals = await collections.proposals();
  await proposals.updateOne(
    { _id: objectId, status: fromStatus },
    { $set: { status: toStatus, projectStatus, updatedAt: new Date() } },
  );
}

/** Refuse toutes les candidatures encore en attente d'un projet (hors retenue). */
export async function refusePendingProposals(
  projectId: string,
  excludedProposalId: string,
): Promise<void> {
  const filter: Record<string, unknown> = { projectId, status: "Pending" };
  const excluded = toObjectId(excludedProposalId);
  if (excluded) filter._id = { $ne: excluded };

  const proposals = await collections.proposals();
  await proposals.updateMany(filter, { $set: { status: "Refused", updatedAt: new Date() } });
}

export async function deleteProposalById(id: string): Promise<void> {
  const objectId = toObjectId(id);
  if (!objectId) return;
  const proposals = await collections.proposals();
  await proposals.deleteOne({ _id: objectId });
}

export async function deleteProposalsByProject(projectId: string): Promise<void> {
  const proposals = await collections.proposals();
  await proposals.deleteMany({ projectId });
}

/** Candidatures actives (ni retirées ni annulées), hors proposition exclue. */
export async function countActiveProposals(
  projectId: string,
  excludeProposalId?: string,
): Promise<number> {
  const filter: Record<string, unknown> = {
    projectId,
    status: { $nin: ["Withdrawn", "Cancelled"] },
  };
  const excluded = excludeProposalId ? toObjectId(excludeProposalId) : null;
  if (excluded) filter._id = { $ne: excluded };

  const proposals = await collections.proposals();
  return proposals.countDocuments(filter);
}

/** Réalisation du portfolio référencée par une candidature. */
export async function findPortfolioItem(
  id: string,
): Promise<Record<string, unknown> | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const portfolio = await collections.portfolio();
  const doc = await portfolio.findOne({ _id: objectId });
  return (doc as Record<string, unknown> | null) ?? null;
}

export function proposalIdOf(proposal: ProposalDocument): string {
  return proposal._id.toHexString();
}
