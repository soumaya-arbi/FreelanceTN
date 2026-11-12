// Règles métier des candidatures, portées depuis ProposalService.cs.
//
// Un freelance authentifié candidate sur un projet publié ; le client
// propriétaire accepte ou refuse. L'acceptation réutilise l'affectation du
// module projets : le projet passe « In progress », sort du catalogue, les
// autres candidatures en attente sont refusées et le compteur reste aligné.

import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import { conflict, forbidden, notFound, unauthorized, validationError } from "@/lib/server/errors";
import { text } from "@/lib/server/serialize";
import { createNotification } from "@/lib/server/notifications";
import * as proposalsRepo from "@/lib/server/repositories/proposals";
import * as projectsService from "@/lib/server/services/projects";
import { findUserById } from "@/lib/server/repositories/users";

const PROPOSAL_STATUS = {
  Pending: "Pending",
  Accepted: "Accepted",
  Refused: "Refused",
  Withdrawn: "Withdrawn",
  Cancelled: "Cancelled",
} as const;

export type CreateProposalInput = {
  projectId: string;
  coverLetter: string;
  price: string;
  delivery: string;
  portfolioId?: string | null;
};

export type ProposalResponse = {
  id: string;
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
  createdAt: string;
  updatedAt: string;
};

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function displayNameOf(doc: Record<string, unknown>): string {
  return `${text(doc.firstName)} ${text(doc.lastName)}`.trim();
}

async function ensureFreelancer(user: SessionUser): Promise<Record<string, unknown>> {
  const doc = await findUserById(user.id);
  if (!doc) throw unauthorized("Session invalide.");
  if (!equalsIgnoreCase(text(doc.role), "freelancer")) {
    throw forbidden("Seuls les freelancers peuvent déposer des candidatures.");
  }
  return doc;
}

async function ensureClient(user: SessionUser): Promise<Record<string, unknown>> {
  const doc = await findUserById(user.id);
  if (!doc) throw unauthorized("Session invalide.");
  if (!equalsIgnoreCase(text(doc.role), "client")) {
    throw forbidden("Seuls les clients peuvent examiner les candidatures.");
  }
  return doc;
}

function validateCreateProposal(input: CreateProposalInput): void {
  const errors: string[] = [];
  const projectId = input.projectId ?? "";
  const coverLetter = input.coverLetter ?? "";
  const price = input.price ?? "";
  const delivery = input.delivery ?? "";
  const portfolioId = input.portfolioId ?? "";

  if (projectId.trim().length === 0) errors.push("Le projet est obligatoire.");
  if (projectId.length > 64) errors.push("L'identifiant du projet est trop long (64 caractères maximum).");
  if (coverLetter.trim().length === 0) errors.push("La lettre de motivation est obligatoire.");
  if (coverLetter.length > 0 && coverLetter.length < 20) {
    errors.push("La lettre de motivation doit faire au moins 20 caractères.");
  }
  if (coverLetter.length > 5000) {
    errors.push("La lettre de motivation ne peut pas dépasser 5000 caractères.");
  }
  if (price.trim().length === 0) errors.push("Le montant proposé est obligatoire.");
  if (price.length > 60) errors.push("Le montant proposé ne peut pas dépasser 60 caractères.");
  if (delivery.trim().length === 0) errors.push("Le délai de livraison est obligatoire.");
  if (delivery.length > 60) errors.push("Le délai de livraison ne peut pas dépasser 60 caractères.");
  if (portfolioId.length > 64) {
    errors.push("L'identifiant de la réalisation est trop long (64 caractères maximum).");
  }

  if (errors.length > 0) throw validationError(errors[0], errors);
}

function toProposalResponse(proposal: proposalsRepo.ProposalDocument): ProposalResponse {
  return {
    id: proposalsRepo.proposalIdOf(proposal),
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
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
  };
}

async function findProposalOrThrow(proposalId: string): Promise<proposalsRepo.ProposalDocument> {
  const proposal = await proposalsRepo.findProposalById(proposalId);
  if (!proposal) throw notFound("Candidature introuvable.");
  return proposal;
}

/**
 * Une candidature ne peut référencer qu'une réalisation publiée et
 * partageable du freelance qui candidate.
 */
async function validatePortfolioId(
  freelancerId: string,
  portfolioId: string | null | undefined,
): Promise<string | null> {
  if (portfolioId === null || portfolioId === undefined) return null;
  const normalized = portfolioId.trim();
  if (normalized.length === 0) return null;

  if (!ObjectId.isValid(normalized)) {
    throw notFound("Réalisation introuvable.");
  }

  const item = await proposalsRepo.findPortfolioItem(normalized);
  if (!item) throw notFound("Réalisation introuvable.");

  if (text(item.ownerId) !== freelancerId) {
    throw forbidden("Cette réalisation ne vous appartient pas.");
  }

  if (item.published !== true || text(item.visibility) === "Private") {
    throw conflict("Cette réalisation n'est pas publiée pour les clients.");
  }

  return normalized;
}

/**
 * Dépose une candidature. Le freelance et le propriétaire du projet sont
 * dérivés de la session et du document projet.
 */
export async function createProposal(
  user: SessionUser,
  input: CreateProposalInput,
): Promise<ProposalResponse> {
  validateCreateProposal(input);
  const freelancer = await ensureFreelancer(user);

  const project = await projectsService.getProjectEntity(user.id, (input.projectId ?? "").trim());

  if (project.ownerId === user.id) {
    throw forbidden("Vous ne pouvez pas candidater sur un projet qui vous appartient.");
  }
  if (!projectsService.isPublishedProjectStatus(project.status)) {
    throw conflict("Ce projet n'est plus ouvert aux candidatures.");
  }
  if (project.assignedTo !== null) {
    throw conflict("Ce projet a déjà été attribué à un freelance.");
  }

  const duplicate = await proposalsRepo.findDuplicateProposal(
    project._id.toHexString(),
    user.id,
  );
  if (duplicate) {
    throw conflict("Vous avez déjà déposé une candidature sur ce projet.");
  }

  const portfolioId = await validatePortfolioId(user.id, input.portfolioId);
  const now = new Date();
  const freelancerName = displayNameOf(freelancer);

  const proposal: proposalsRepo.ProposalDocument = {
    _id: new ObjectId(),
    projectId: project._id.toHexString(),
    projectTitle: project.title,
    projectBudget: project.budget,
    projectType: project.type,
    projectStatus: project.status,
    projectOwnerId: project.ownerId,
    freelancerId: user.id,
    freelancerName,
    freelancerTitle: text(freelancer.title),
    coverLetter: (input.coverLetter ?? "").trim(),
    price: (input.price ?? "").trim(),
    delivery: (input.delivery ?? "").trim(),
    portfolioId,
    status: PROPOSAL_STATUS.Pending,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await proposalsRepo.insertProposal(proposal);
  if (!inserted) {
    throw conflict("Vous avez déjà déposé une candidature sur ce projet.");
  }

  await projectsService.addProposalsCount(proposal.projectId, 1);

  if (project.ownerId.trim().length > 0 && project.ownerId !== user.id) {
    await createNotification({
      recipientId: project.ownerId,
      type: "proposal",
      title: project.title,
      message: `Nouvelle proposition reçue pour « ${project.title} » de ${freelancerName}.`,
      projectId: proposal.projectId,
      projectTitle: project.title,
      actorName: freelancerName,
    });
  }

  return toProposalResponse(proposal);
}

/** Candidatures déposées par le freelance connecté. */
export async function listMyProposals(user: SessionUser): Promise<ProposalResponse[]> {
  await ensureFreelancer(user);
  const proposals = await proposalsRepo.listProposalsOfFreelancer(user.id);
  return proposals.map(toProposalResponse);
}

/** Candidatures reçues par le client connecté, sur ses projets uniquement. */
export async function listReceivedProposals(
  user: SessionUser,
  projectId?: string,
): Promise<ProposalResponse[]> {
  await ensureClient(user);
  const proposals = await proposalsRepo.listProposalsOfOwner(user.id, projectId);
  return proposals.map(toProposalResponse);
}

/** Consultation : réservée à l'auteur et au propriétaire du projet. */
export async function getProposal(
  user: SessionUser,
  proposalId: string,
): Promise<ProposalResponse> {
  const proposal = await findProposalOrThrow(proposalId);

  if (proposal.freelancerId !== user.id && proposal.projectOwnerId !== user.id) {
    throw notFound("Candidature introuvable.");
  }

  return toProposalResponse(proposal);
}

/** Décision du client : accepter ou refuser une candidature en attente. */
export async function setProposalStatus(
  user: SessionUser,
  proposalId: string,
  status: string,
): Promise<ProposalResponse> {
  const rawStatus = (status ?? "").trim();
  if (rawStatus.length === 0) {
    throw validationError("Le statut est obligatoire.");
  }
  const isAccepted = equalsIgnoreCase(rawStatus, PROPOSAL_STATUS.Accepted);
  const isRefused = equalsIgnoreCase(rawStatus, PROPOSAL_STATUS.Refused);
  if (!isAccepted && !isRefused) {
    throw validationError("Seules les décisions « Accepted » et « Refused » sont autorisées.");
  }

  await ensureClient(user);
  const proposal = await findProposalOrThrow(proposalId);

  if (proposal.projectOwnerId !== user.id) {
    throw notFound("Candidature introuvable.");
  }
  if (!equalsIgnoreCase(proposal.status, PROPOSAL_STATUS.Pending)) {
    throw conflict(`Cette candidature a déjà été traitée (statut « ${proposal.status} »).`);
  }

  const decision = isAccepted ? PROPOSAL_STATUS.Accepted : PROPOSAL_STATUS.Refused;
  const expectedStatus = proposal.status;

  if (decision === PROPOSAL_STATUS.Accepted) {
    await acceptProposal(user.id, proposal);
  } else {
    proposal.status = PROPOSAL_STATUS.Refused;
  }

  proposal.updatedAt = new Date();
  const replaced = await proposalsRepo.replaceProposal(proposal, expectedStatus);
  if (!replaced) {
    throw conflict(`Cette candidature a déjà été traitée (statut « ${expectedStatus} »).`);
  }

  if (proposal.freelancerId.trim().length > 0 && proposal.freelancerId !== user.id) {
    const accepted = equalsIgnoreCase(proposal.status, PROPOSAL_STATUS.Accepted);
    await createNotification({
      recipientId: proposal.freelancerId,
      type: accepted ? "proposal-accepted" : "proposal-refused",
      title: proposal.projectTitle,
      message: accepted
        ? `Votre proposition pour « ${proposal.projectTitle} » a été acceptée.`
        : `Votre proposition pour « ${proposal.projectTitle} » a été refusée.`,
      projectId: proposal.projectId,
      projectTitle: proposal.projectTitle,
      actorName: "",
    });
  }

  return toProposalResponse(proposal);
}

/** Retrait d'une propre candidature (jamais celle d'autrui ni une acceptée). */
export async function deleteProposal(user: SessionUser, proposalId: string): Promise<null> {
  await ensureFreelancer(user);

  const proposal = await proposalsRepo.findProposalOfFreelancer(proposalId, user.id);
  if (!proposal) throw notFound("Candidature introuvable.");

  if (equalsIgnoreCase(proposal.status, PROPOSAL_STATUS.Accepted)) {
    throw conflict(
      "Une candidature acceptée ne peut pas être retirée : le projet vous a été attribué.",
    );
  }

  await proposalsRepo.deleteProposalById(proposalsRepo.proposalIdOf(proposal));
  await projectsService.addProposalsCount(proposal.projectId, -1);
  return null;
}

// --- Logique interne ---------------------------------------------------

/** Acceptation : affecte le freelance et aligne le projet. */
async function acceptProposal(
  clientId: string,
  proposal: proposalsRepo.ProposalDocument,
): Promise<void> {
  const project = await projectsService.getOwnedProject(clientId, proposal.projectId);

  if (!projectsService.isPublishedProjectStatus(project.status)) {
    throw conflict("Ce projet n'est plus ouvert : impossible d'accepter cette candidature.");
  }

  if (project.assignedTo !== null && project.assignedTo !== proposal.freelancerId) {
    throw conflict("Ce projet a déjà été attribué à un autre freelance.");
  }

  await projectsService.applyAssignment(project, proposal.freelancerId);

  const now = new Date();
  projectsService.syncProjectMilestones(
    project,
    project.status,
    projectsService.PROJECT_STATUS.InProgress,
    now,
  );
  project.status = projectsService.PROJECT_STATUS.InProgress;
  project.updatedAt = now;

  const claimed = await projectsService.tryClaimAssignment(project, proposal.freelancerId);
  if (!claimed) {
    throw conflict("Ce projet a déjà été attribué à un autre freelance.");
  }

  proposal.status = PROPOSAL_STATUS.Accepted;
  proposal.projectStatus = project.status;

  // Un seul freelance retenu : les autres candidatures en attente sont refusées.
  await proposalsRepo.refusePendingProposals(
    proposal.projectId,
    proposalsRepo.proposalIdOf(proposal),
  );
}
