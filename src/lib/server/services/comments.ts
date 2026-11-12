// Règles métier des commentaires de projet (CommentService.cs).
// L'auteur et son rôle viennent de la session ; le projet est relu en base.

import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import { conflict, forbidden, notFound, unauthorized, validationError } from "@/lib/server/errors";
import { text } from "@/lib/server/serialize";
import {
  deleteComment as deleteCommentRecord,
  findCommentById,
  findCommentProjectById,
  insertComment,
  listCommentsByProject,
  replaceComment,
  type CommentDocument,
} from "@/lib/server/repositories/comments";

export type CommentResponse = {
  id: string;
  projectId: string;
  projectTitle: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

function idOf(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function toResponse(doc: CommentDocument): CommentResponse {
  return {
    id: idOf(doc._id),
    projectId: idOf(doc.projectId),
    projectTitle: text(doc.projectTitle),
    authorId: idOf(doc.authorId),
    authorName: text(doc.authorName),
    authorAvatar: text(doc.authorAvatar),
    authorRole: text(doc.authorRole),
    content: text(doc.content),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function invalid(errors: string[]) {
  return validationError("La requête contient des données invalides.", errors);
}

function validateCreateInput(projectId: string, content: string): void {
  const errors: string[] = [];

  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (normalizedProjectId.length === 0 || normalizedProjectId.length > 64) {
    errors.push("Le projet est obligatoire.");
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    errors.push("Le commentaire est obligatoire.");
  } else if (content.length > 2000) {
    errors.push("Le commentaire ne peut pas dépasser 2000 caractères.");
  }

  if (errors.length > 0) throw invalid(errors);
}

function validateContent(content: string): void {
  const errors: string[] = [];

  if (typeof content !== "string" || content.trim().length === 0) {
    errors.push("Le commentaire est obligatoire.");
  } else if (content.length > 2000) {
    errors.push("Le commentaire ne peut pas dépasser 2000 caractères.");
  }

  if (errors.length > 0) throw invalid(errors);
}

export async function listProjectComments(
  requester: SessionUser | null,
  projectId: string,
): Promise<CommentResponse[]> {
  const project = await findCommentProjectById(projectId);
  if (!project) throw notFound("Projet introuvable.");

  if (!requester) {
    throw unauthorized("Authentification requise.");
  }

  const isOwner = idOf(project.ownerId) === requester.id;
  const assignedTo = text(project.assignedTo).trim();
  const isAssigned = assignedTo.length > 0 && assignedTo === requester.id;
  const isOpenFreelancer =
    text(project.status).toLowerCase() === "open" && requester.role === "freelancer";

  if (!isOwner && !isAssigned && !isOpenFreelancer) {
    throw forbidden("Vous n'êtes pas autorisé à consulter cette discussion.");
  }

  const comments = await listCommentsByProject(projectId);
  return comments.map(toResponse);
}

export async function createComment(
  author: SessionUser,
  projectId: string,
  content: string,
): Promise<CommentResponse> {
  validateCreateInput(projectId, content);

  const project = await findCommentProjectById(projectId);
  if (!project) throw notFound("Projet introuvable.");

  const status = text(project.status).toLowerCase();
  if (status !== "open" && status !== "in progress") {
    throw conflict("La discussion est en lecture seule pour ce projet.");
  }

  const isOwner = idOf(project.ownerId) === author.id;
  const isClient = author.role === "client";
  const assignedTo = text(project.assignedTo).trim();
  const isAssigned = assignedTo.length > 0 && assignedTo === author.id;
  const isOpenFreelancer = status === "open" && author.role === "freelancer";
  const isInProgressFreelancer =
    status === "in progress" && author.role === "freelancer" && isAssigned;

  if (isClient && !isOwner) {
    throw forbidden("Seul le client propriétaire du projet peut répondre.");
  }

  if (!isOwner && !isOpenFreelancer && !isInProgressFreelancer) {
    throw forbidden("Vous n'êtes pas autorisé à participer à cette discussion.");
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw conflict("Le commentaire est obligatoire.");
  }
  if (trimmed.length > 2000) {
    throw conflict("Le commentaire ne peut pas dépasser 2000 caractères.");
  }

  const now = new Date();
  const comment: CommentDocument = {
    _id: new ObjectId(),
    projectId: project._id,
    projectTitle: text(project.title),
    authorId: new ObjectId(author.id),
    authorName: `${author.firstName} ${author.lastName}`.trim(),
    authorAvatar: author.avatar,
    authorRole: author.role,
    content: trimmed,
    createdAt: now,
    updatedAt: now,
  };

  await insertComment(comment);
  return toResponse(comment);
}

export async function updateComment(
  author: SessionUser,
  id: string,
  content: string,
): Promise<CommentResponse> {
  validateContent(content);

  const comment = await findCommentById(id);
  if (!comment) throw notFound("Commentaire introuvable.");

  if (idOf(comment.authorId) !== author.id) {
    throw forbidden("Seul l'auteur de ce commentaire peut le modifier.");
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw conflict("Le commentaire est obligatoire.");
  }
  if (trimmed.length > 2000) {
    throw conflict("Le commentaire ne peut pas dépasser 2000 caractères.");
  }

  const updated: CommentDocument = {
    ...comment,
    content: trimmed,
    updatedAt: new Date(),
  };

  await replaceComment(updated);
  return toResponse(updated);
}

export async function deleteComment(author: SessionUser, id: string): Promise<void> {
  const comment = await findCommentById(id);
  if (!comment) throw notFound("Commentaire introuvable.");

  if (idOf(comment.authorId) !== author.id) {
    throw forbidden("Seul l'auteur de ce commentaire peut le supprimer.");
  }

  await deleteCommentRecord(id);
}
