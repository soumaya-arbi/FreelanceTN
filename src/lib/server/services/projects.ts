// Règles métier des projets, portées depuis ProjectService.cs.
//
// Un projet appartient au compte client authentifié : lui seul peut le créer,
// le modifier, le supprimer, l'attribuer et le rouvrir. Le catalogue public ne
// contient que les projets publiés ("Open") et non attribués. Le freelance
// retenu consulte ses projets assignés, soumet son travail pour validation et
// met à jour la progression des étapes.

import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import { displayName } from "@/lib/server/session";
import { conflict, forbidden, notFound, unauthorized, validationError } from "@/lib/server/errors";
import { text } from "@/lib/server/serialize";
import { createNotification } from "@/lib/server/notifications";
import { ensureFeedbackRequests } from "@/lib/server/feedbackRequests";
import * as projectsRepo from "@/lib/server/repositories/projects";
import * as proposalsRepo from "@/lib/server/repositories/proposals";
import { findUserById } from "@/lib/server/repositories/users";

export const PROJECT_STATUS = {
  Open: "Open",
  InProgress: "In progress",
  ClientReview: "Client review",
  Completed: "Completed",
  Draft: "Draft",
  Cancelled: "Cancelled",
} as const;

const ALL_PROJECT_STATUSES: string[] = [
  PROJECT_STATUS.Open,
  PROJECT_STATUS.InProgress,
  PROJECT_STATUS.ClientReview,
  PROJECT_STATUS.Completed,
  PROJECT_STATUS.Draft,
  PROJECT_STATUS.Cancelled,
];

const MILESTONE_STATUS = {
  Pending: "Pending",
  InProgress: "In progress",
  Submitted: "Submitted",
  ChangesRequested: "Changes requested",
  Approved: "Approved",
  Completed: "Completed",
} as const;

const MILESTONE_KEY = {
  Kickoff: "kickoff",
  Work: "work",
  Review: "review",
  Completion: "completion",
} as const;

const ASSIGNMENT_RELEASE_REASON = {
  AcceptanceCancelled: "acceptance-cancelled",
  ProjectReopened: "project-reopened",
  Reassigned: "reassigned",
  AssignmentRemoved: "assignment-removed",
} as const;

export type ProjectCatalogParams = {
  category?: string;
  q?: string;
  type?: string;
  minBudget?: number;
  maxBudget?: number;
  durationValue?: number;
  durationUnit?: string;
  limit?: number;
};

export type CreateProjectInput = {
  title: string;
  description: string;
  budget: string;
  type: string;
  skills: string[];
  client: string;
  status: string;
  category?: string;
  deadline?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  durationValue?: number | null;
  durationUnit?: string | null;
};

export type ProjectAttachmentInput = {
  fileName: string;
  url: string;
  size: number;
  uploadedAt: string;
};

export type UpdateProjectInput = {
  title?: string;
  description?: string;
  budget?: string;
  type?: string;
  skills?: string[];
  client?: string;
  status?: string;
  category?: string;
  deadline?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  durationValue?: number | null;
  durationUnit?: string | null;
  assignedTo?: string;
  attachments?: ProjectAttachmentInput[];
  message?: string;
};

export type MilestoneActionInput = {
  action: string;
  message?: string;
  progress?: number;
};

export type CreateMilestoneInput = {
  title: string;
  date?: string | null;
};

export type ProjectMilestoneResponse = {
  id: string;
  key: string;
  title: string;
  status: string;
  progress: number;
  date: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MilestoneHistoryEntryResponse = {
  id: string;
  milestoneId: string | null;
  milestoneTitle: string;
  type: string;
  message: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
};

export type ProjectAttachmentResponse = {
  fileName: string;
  url: string;
  size: number;
  uploadedAt: string;
};

export type AssignmentHistoryEntryResponse = {
  freelancerId: string;
  freelancerName: string;
  assignedAt: string | null;
  releasedAt: string | null;
  reason: string;
};

export type ProjectResponse = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  budget: string;
  budgetMin: number | null;
  budgetMax: number | null;
  type: string;
  durationValue: number | null;
  durationUnit: string | null;
  proposals: number;
  skills: string[];
  client: string;
  status: string;
  category: string | null;
  deadline: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  assignedAt: string | null;
  assignmentHistory: AssignmentHistoryEntryResponse[];
  milestones: ProjectMilestoneResponse[];
  milestoneHistory: MilestoneHistoryEntryResponse[];
  attachments: ProjectAttachmentResponse[];
  createdAt: string;
  updatedAt: string;
};

export type FreelancerSummaryResponse = {
  id: string;
  name: string;
  title: string;
  avatar: string;
};

// --- Machine à états ----------------------------------------------------

function equalsIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function isValidProjectStatus(status: string): boolean {
  return ALL_PROJECT_STATUSES.includes(status);
}

export function isPublishedProjectStatus(status: string): boolean {
  return status === PROJECT_STATUS.Open;
}

/** Transitions autorisées, identiques à ProjectStatus.CanTransition. */
export function canTransition(from: string, to: string): boolean {
  const key = `${from}\u0000${to}`;
  switch (key) {
    case `${PROJECT_STATUS.Draft}\u0000${PROJECT_STATUS.Draft}`:
    case `${PROJECT_STATUS.Draft}\u0000${PROJECT_STATUS.Open}`:
    case `${PROJECT_STATUS.Open}\u0000${PROJECT_STATUS.Open}`:
    case `${PROJECT_STATUS.Open}\u0000${PROJECT_STATUS.Draft}`:
    case `${PROJECT_STATUS.Open}\u0000${PROJECT_STATUS.InProgress}`:
    case `${PROJECT_STATUS.Open}\u0000${PROJECT_STATUS.Completed}`:
    case `${PROJECT_STATUS.InProgress}\u0000${PROJECT_STATUS.InProgress}`:
    case `${PROJECT_STATUS.InProgress}\u0000${PROJECT_STATUS.Open}`:
    case `${PROJECT_STATUS.InProgress}\u0000${PROJECT_STATUS.Draft}`:
    case `${PROJECT_STATUS.InProgress}\u0000${PROJECT_STATUS.ClientReview}`:
    case `${PROJECT_STATUS.InProgress}\u0000${PROJECT_STATUS.Completed}`:
    case `${PROJECT_STATUS.ClientReview}\u0000${PROJECT_STATUS.ClientReview}`:
    case `${PROJECT_STATUS.ClientReview}\u0000${PROJECT_STATUS.InProgress}`:
    case `${PROJECT_STATUS.ClientReview}\u0000${PROJECT_STATUS.Draft}`:
    case `${PROJECT_STATUS.ClientReview}\u0000${PROJECT_STATUS.Completed}`:
    case `${PROJECT_STATUS.Completed}\u0000${PROJECT_STATUS.Completed}`:
    case `${PROJECT_STATUS.Completed}\u0000${PROJECT_STATUS.InProgress}`:
    case `${PROJECT_STATUS.Completed}\u0000${PROJECT_STATUS.Open}`:
    case `${PROJECT_STATUS.Completed}\u0000${PROJECT_STATUS.Draft}`:
      return true;
    default:
      return false;
  }
}

// --- Synchronisation des étapes standard --------------------------------

type MilestoneTemplateItem = {
  key: string;
  title: string;
  status: string;
  progress: number;
  date: Date | null;
};

function buildMilestoneTemplate(status: string): MilestoneTemplateItem[] {
  const normalized = typeof status === "string" ? status.trim() : PROJECT_STATUS.Open;
  const completed = equalsIgnoreCase(normalized, PROJECT_STATUS.Completed);
  const inProgress = equalsIgnoreCase(normalized, PROJECT_STATUS.InProgress);
  const inReview = equalsIgnoreCase(normalized, PROJECT_STATUS.ClientReview);

  const kickoff: [string, number] =
    completed || inProgress || inReview
      ? [MILESTONE_STATUS.Completed, 100]
      : [MILESTONE_STATUS.Pending, 0];

  const work: [string, number] = completed
    ? [MILESTONE_STATUS.Completed, 100]
    : inReview
      ? [MILESTONE_STATUS.Completed, 100]
      : inProgress
        ? [MILESTONE_STATUS.InProgress, 60]
        : [MILESTONE_STATUS.Pending, 0];

  const review: [string, number] = completed
    ? [MILESTONE_STATUS.Completed, 100]
    : inReview
      ? [MILESTONE_STATUS.Submitted, 75]
      : [MILESTONE_STATUS.Pending, 0];

  const completion: [string, number] = completed
    ? [MILESTONE_STATUS.Completed, 100]
    : [MILESTONE_STATUS.Pending, 0];

  return [
    { key: MILESTONE_KEY.Kickoff, title: "Project kickoff", status: kickoff[0], progress: kickoff[1], date: null },
    { key: MILESTONE_KEY.Work, title: "Work in progress", status: work[0], progress: work[1], date: null },
    { key: MILESTONE_KEY.Review, title: "Client review & approval", status: review[0], progress: review[1], date: null },
    { key: MILESTONE_KEY.Completion, title: "Project completion", status: completion[0], progress: completion[1], date: null },
  ];
}

function newMilestoneId(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Crée ou met à jour les étapes standard selon le statut du projet.
 * Idempotent : une étape existante est retrouvée par sa clé, jamais dupliquée.
 */
export function syncProjectMilestones(
  project: projectsRepo.ProjectDocument,
  previousStatus: string | null,
  nextStatus: string,
  now: Date,
): void {
  void previousStatus;
  const template = buildMilestoneTemplate(nextStatus);

  for (const item of template) {
    const existing = project.milestones.find((milestone) => milestone.key === item.key);
    if (!existing) {
      project.milestones.push({
        id: newMilestoneId(),
        key: item.key,
        title: item.title,
        status: item.status,
        progress: item.progress,
        date: item.date,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    existing.title = item.title;
    existing.status = item.status;
    existing.progress = item.progress;
    existing.date = item.date;
    existing.updatedAt = now;
  }
}

function appendMilestoneHistory(
  project: projectsRepo.ProjectDocument,
  type: string,
  message: string,
  authorId: string,
  authorName: string,
  authorRole: string,
  now: Date,
  milestone?: projectsRepo.ProjectMilestoneDocument,
): void {
  project.milestoneHistory.push({
    id: newMilestoneId(),
    milestoneId: milestone?.id ?? null,
    milestoneTitle: milestone?.title ?? "",
    type,
    message: message ?? "",
    authorId,
    authorName,
    authorRole,
    createdAt: now,
  });
}

function appendAssignmentHistory(
  project: projectsRepo.ProjectDocument,
  freelancerId: string,
  freelancerName: string | null,
  assignedAt: Date | null,
  reason: string,
  releasedAt: Date,
): void {
  const alreadyTraced = project.assignmentHistory.some(
    (entry) =>
      entry.freelancerId === freelancerId &&
      entry.reason === reason &&
      entry.releasedAt instanceof Date &&
      Math.abs(entry.releasedAt.getTime() - releasedAt.getTime()) < 1000,
  );
  if (alreadyTraced) return;

  project.assignmentHistory.push({
    freelancerId,
    freelancerName: freelancerName ?? "",
    assignedAt,
    releasedAt,
    reason,
  });
}

function describeStatusChange(from: string, to: string): string {
  return `Statut du projet : ${from} → ${to}.`;
}

// --- Rôles et documents -------------------------------------------------

function displayNameOf(doc: Record<string, unknown>): string {
  return displayName({
    firstName: text(doc.firstName),
    lastName: text(doc.lastName),
    email: text(doc.email),
  });
}

async function ensureClient(user: SessionUser): Promise<Record<string, unknown>> {
  const doc = await findUserById(user.id);
  if (!doc) throw unauthorized("Session invalide.");
  if (!equalsIgnoreCase(text(doc.role), "client")) {
    throw forbidden("Seuls les clients peuvent gérer leurs projets.");
  }
  return doc;
}

async function ensureFreelancer(user: SessionUser): Promise<Record<string, unknown>> {
  const doc = await findUserById(user.id);
  if (!doc) throw unauthorized("Session invalide.");
  if (!equalsIgnoreCase(text(doc.role), "freelancer")) {
    throw forbidden("Seuls les freelancers peuvent consulter les projets qui leur sont confiés.");
  }
  return doc;
}

function projectIdOf(project: projectsRepo.ProjectDocument): string {
  return project._id.toHexString();
}

async function findProjectOrThrow(projectId: string): Promise<projectsRepo.ProjectDocument> {
  const project = await projectsRepo.findProjectById(projectId);
  if (!project) throw notFound("Projet introuvable.");
  return project;
}

/** Projet appartenant au compte authentifié (404 identique si absent ou étranger). */
export async function getOwnedProject(
  ownerId: string,
  projectId: string,
): Promise<projectsRepo.ProjectDocument> {
  const project = await projectsRepo.findProjectOwned(ownerId, projectId);
  if (!project) throw notFound("Projet introuvable.");
  return project;
}

async function ensureMilestones(
  project: projectsRepo.ProjectDocument,
): Promise<projectsRepo.ProjectDocument> {
  if (project.milestones.length > 0) return project;

  const now = new Date();
  syncProjectMilestones(project, null, project.status, now);
  await projectsRepo.setProjectMilestones(project._id, project.milestones);
  return project;
}

async function ensureMilestonesForMany(
  projects: projectsRepo.ProjectDocument[],
): Promise<void> {
  for (const project of projects) {
    if (project.milestones.length === 0) await ensureMilestones(project);
  }
}

// --- Réponses -----------------------------------------------------------

function iso(value: Date): string {
  return value.toISOString();
}

function isoOrNull(value: Date | null): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

export function toProjectResponse(project: projectsRepo.ProjectDocument): ProjectResponse {
  return {
    id: projectIdOf(project),
    ownerId: project.ownerId,
    title: project.title,
    description: project.description,
    budget: project.budget,
    budgetMin: project.budgetMin,
    budgetMax: project.budgetMax,
    type: project.type,
    durationValue: project.durationValue,
    durationUnit: project.durationUnit,
    proposals: project.proposals,
    skills: project.skills,
    client: project.client,
    status: project.status,
    category: project.category,
    deadline: project.deadline,
    assignedTo: project.assignedTo,
    assignedToName: project.assignedToName,
    assignedAt: isoOrNull(project.assignedAt),
    assignmentHistory: project.assignmentHistory.map((entry) => ({
      freelancerId: entry.freelancerId,
      freelancerName: entry.freelancerName,
      assignedAt: isoOrNull(entry.assignedAt),
      releasedAt: isoOrNull(entry.releasedAt),
      reason: entry.reason,
    })),
    milestones: project.milestones.map((milestone) => ({
      id: milestone.id,
      key: milestone.key,
      title: milestone.title,
      status: milestone.status,
      progress: milestone.progress,
      date: isoOrNull(milestone.date),
      createdAt: iso(milestone.createdAt),
      updatedAt: iso(milestone.updatedAt),
    })),
    milestoneHistory: project.milestoneHistory.map((entry) => ({
      id: entry.id,
      milestoneId: entry.milestoneId,
      milestoneTitle: entry.milestoneTitle,
      type: entry.type,
      message: entry.message,
      authorId: entry.authorId,
      authorName: entry.authorName,
      authorRole: entry.authorRole,
      createdAt: iso(entry.createdAt),
    })),
    attachments: project.attachments.map((attachment) => ({
      fileName: attachment.fileName,
      url: attachment.url,
      size: attachment.size,
      uploadedAt: iso(attachment.uploadedAt),
    })),
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
  };
}

// --- Validation (règles des validators FluentValidation) ----------------

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function validateCreateProject(input: CreateProjectInput): void {
  const errors: string[] = [];
  const isDraft = equalsIgnoreCase((input.status ?? "").trim(), PROJECT_STATUS.Draft);
  const title = input.title ?? "";
  const description = input.description ?? "";
  const budget = input.budget ?? "";
  const type = input.type ?? "";
  const client = input.client ?? "";
  const hasBudgetRange = typeof input.budgetMin === "number" || typeof input.budgetMax === "number";

  if (!isDraft && isBlank(title)) errors.push("Le titre est obligatoire.");
  if (title.length > 200) errors.push("Le titre ne peut pas dépasser 200 caractères.");
  if (!isDraft && isBlank(description)) errors.push("La description est obligatoire.");
  if (description.length > 5000) errors.push("La description ne peut pas dépasser 5000 caractères.");
  if (!isDraft && !hasBudgetRange && isBlank(budget)) errors.push("Le budget est obligatoire.");
  if (budget.length > 100) errors.push("Le budget ne peut pas dépasser 100 caractères.");
  if (!isDraft && isBlank(type)) errors.push("Le type de contrat est obligatoire.");
  if (type.length > 60) errors.push("Le type de contrat ne peut pas dépasser 60 caractères.");
  if (!isDraft && isBlank(client)) errors.push("Le client est obligatoire.");
  if (client.length > 160) errors.push("Le client ne peut pas dépasser 160 caractères.");
  if ((input.category ?? "").length > 120) errors.push("La catégorie ne peut pas dépasser 120 caractères.");
  if ((input.deadline ?? "").length > 40) errors.push("L'échéance ne peut pas dépasser 40 caractères.");

  if (typeof input.budgetMin === "number" && input.budgetMin <= 0) {
    errors.push("Le budget minimum doit être positif.");
  }
  if (typeof input.budgetMax === "number" && input.budgetMax <= 0) {
    errors.push("Le budget maximum doit être positif.");
  }
  if (
    typeof input.budgetMin === "number" &&
    typeof input.budgetMax === "number" &&
    input.budgetMin > input.budgetMax
  ) {
    errors.push("Le budget minimum ne peut pas dépasser le budget maximum.");
  }
  if (typeof input.durationValue === "number" && input.durationValue <= 0) {
    errors.push("La durée doit être positive.");
  }
  if (!isValidDurationUnit(input.durationUnit)) {
    errors.push("L'unité de durée doit être Days, Weeks ou Months.");
  }
  if ((input.skills ?? []).length > 50) errors.push("Trop de compétences (50 maximum).");
  for (const skill of input.skills ?? []) {
    if (skill.length > 60) {
      errors.push("Une compétence ne peut pas dépasser 60 caractères.");
      break;
    }
  }
  const status = input.status ?? "";
  if (status.length > 0 && !isValidProjectStatus(status)) {
    errors.push("Le statut est invalide.");
  }

  if (errors.length > 0) throw validationError(errors[0], errors);
}

function isValidDurationUnit(unit: string | null | undefined): boolean {
  if (unit === null || unit === undefined) return true;
  if (isBlank(unit)) return true;
  return unit === "Days" || unit === "Weeks" || unit === "Months";
}

function validateUpdateProject(input: UpdateProjectInput): void {
  const errors: string[] = [];

  if (typeof input.title === "string") {
    if (isBlank(input.title)) errors.push("Le titre est obligatoire.");
    if (input.title.length > 200) errors.push("Le titre ne peut pas dépasser 200 caractères.");
  }
  if (typeof input.description === "string") {
    if (isBlank(input.description)) errors.push("La description est obligatoire.");
    if (input.description.length > 5000) errors.push("La description ne peut pas dépasser 5000 caractères.");
  }
  if (typeof input.budget === "string" && input.budget.length > 100) {
    errors.push("Le budget ne peut pas dépasser 100 caractères.");
  }
  if (typeof input.type === "string" && input.type.length > 60) {
    errors.push("Le type de contrat ne peut pas dépasser 60 caractères.");
  }
  if (typeof input.client === "string" && input.client.length > 160) {
    errors.push("Le client ne peut pas dépasser 160 caractères.");
  }
  if (typeof input.category === "string" && input.category.length > 120) {
    errors.push("La catégorie ne peut pas dépasser 120 caractères.");
  }
  if (typeof input.deadline === "string" && input.deadline.length > 40) {
    errors.push("L'échéance ne peut pas dépasser 40 caractères.");
  }

  if (typeof input.budgetMin === "number" && input.budgetMin <= 0) {
    errors.push("Le budget minimum doit être positif.");
  }
  if (typeof input.budgetMax === "number" && input.budgetMax <= 0) {
    errors.push("Le budget maximum doit être positif.");
  }
  if (
    typeof input.budgetMin === "number" &&
    typeof input.budgetMax === "number" &&
    input.budgetMin > input.budgetMax
  ) {
    errors.push("Le budget minimum ne peut pas dépasser le budget maximum.");
  }
  if (typeof input.durationValue === "number" && input.durationValue <= 0) {
    errors.push("La durée doit être positive.");
  }
  if (input.durationUnit !== undefined && input.durationUnit !== null && !isValidDurationUnit(input.durationUnit)) {
    errors.push("L'unité de durée doit être Days, Weeks ou Months.");
  }
  if ((input.skills ?? []).length > 50) errors.push("Trop de compétences (50 maximum).");
  for (const skill of input.skills ?? []) {
    if (skill.length > 60) {
      errors.push("Une compétence ne peut pas dépasser 60 caractères.");
      break;
    }
  }
  if (typeof input.assignedTo === "string" && input.assignedTo.length > 64) {
    errors.push("L'identifiant du freelance est trop long (64 caractères maximum).");
  }
  if (typeof input.status === "string" && !isValidProjectStatus(input.status)) {
    errors.push("Le statut est invalide.");
  }

  if (errors.length > 0) throw validationError(errors[0], errors);
}

// --- Normalisations -----------------------------------------------------

function normalizeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const skill of skills) {
    const trimmed = skill.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function dedupAttachments(
  incoming: ProjectAttachmentInput[],
): projectsRepo.ProjectAttachmentDocument[] {
  const seenUrls = new Set<string>();
  const deduped: projectsRepo.ProjectAttachmentDocument[] = [];
  for (const item of incoming) {
    const url = (item.url ?? "").trim();
    if (url.length === 0) continue;
    const key = url.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    const uploadedAt = item.uploadedAt ? new Date(item.uploadedAt) : new Date();
    deduped.push({
      fileName: (item.fileName ?? "").trim(),
      url,
      size: Number.isFinite(item.size) ? Math.trunc(item.size) : 0,
      uploadedAt: Number.isNaN(uploadedAt.getTime()) ? new Date() : uploadedAt,
    });
  }
  return deduped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// --- Filtres du catalogue ----------------------------------------------

function parseBudgetNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/,/g, "").trim();
  if (cleaned.length === 0) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBudgetRange(project: projectsRepo.ProjectDocument): { min: number; max: number } | null {
  if (project.budgetMin !== null || project.budgetMax !== null) {
    const min = project.budgetMin ?? project.budgetMax ?? 0;
    const max = project.budgetMax ?? project.budgetMin ?? 0;
    return min <= max ? { min, max } : { min: max, max: min };
  }

  const matches = project.budget.match(/\d[\d.,\s]*/g) ?? [];
  const numbers = matches
    .map(parseBudgetNumber)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (numbers.length === 0) return null;
  return { min: numbers[0], max: numbers[numbers.length - 1] };
}

function matchesBudget(
  project: projectsRepo.ProjectDocument,
  minBudget: number | null,
  maxBudget: number | null,
): boolean {
  const range = getBudgetRange(project);
  if (!range) return false;
  if (minBudget !== null && range.max < minBudget) return false;
  if (maxBudget !== null && range.min > maxBudget) return false;
  return true;
}

function normalizeDurationUnit(unit: string | null | undefined): string | null {
  const normalized = (unit ?? "").trim().toLowerCase();
  switch (normalized) {
    case "day":
    case "days":
      return "days";
    case "week":
    case "weeks":
      return "weeks";
    case "month":
    case "months":
      return "months";
    default:
      return null;
  }
}

function toDays(value: number | null, unit: string | null): number | null {
  if (value === null || unit === null) return null;
  const factor = unit === "days" ? 1 : unit === "weeks" ? 7 : unit === "months" ? 30 : 0;
  return factor === 0 ? null : value * factor;
}

function matchesDuration(
  project: projectsRepo.ProjectDocument,
  value: number | null,
  unit: string | null,
): boolean {
  const normalizedUnit = normalizeDurationUnit(unit);
  const hasUnit = (unit ?? "").trim().length > 0;

  if (value !== null && hasUnit) {
    const requestedDays = toDays(value, normalizedUnit);
    const projectDays = toDays(project.durationValue, normalizeDurationUnit(project.durationUnit));
    return requestedDays !== null && projectDays !== null && projectDays <= requestedDays;
  }

  if (hasUnit) {
    return normalizeDurationUnit(project.durationUnit) === normalizedUnit;
  }

  if (value !== null) {
    return project.durationValue === value;
  }

  return true;
}

// --- Lecture ------------------------------------------------------------

/** Projets du compte connecté, tous statuts confondus. */
export async function listProjects(user: SessionUser): Promise<ProjectResponse[]> {
  const projects = await projectsRepo.listProjectsByOwner(user.id);
  await ensureMilestonesForMany(projects);
  return projects.map(toProjectResponse);
}

/** Catalogue public : projets publiés et non attribués. */
export async function listProjectCatalog(params: ProjectCatalogParams): Promise<ProjectResponse[]> {
  let projects = await projectsRepo.findCatalogProjects({
    category: params.category,
    query: params.q,
    type: params.type,
  });

  const minBudget = typeof params.minBudget === "number" ? params.minBudget : null;
  const maxBudget = typeof params.maxBudget === "number" ? params.maxBudget : null;
  if (minBudget !== null || maxBudget !== null) {
    projects = projects.filter((project) => matchesBudget(project, minBudget, maxBudget));
  }

  const durationValue = typeof params.durationValue === "number" ? params.durationValue : null;
  const durationUnit = typeof params.durationUnit === "string" ? params.durationUnit : null;
  if (durationValue !== null || (durationUnit ?? "").trim().length > 0) {
    projects = projects.filter((project) => matchesDuration(project, durationValue, durationUnit));
  }

  await ensureMilestonesForMany(projects);

  const limit = clamp(typeof params.limit === "number" ? params.limit : 50, 1, 200);
  return projects.slice(0, limit).map(toProjectResponse);
}

/** Projets approuvés par un client pour le freelance connecté. */
export async function listAssignedProjects(user: SessionUser): Promise<ProjectResponse[]> {
  await ensureFreelancer(user);
  const projects = await projectsRepo.listProjectsAssignedTo(user.id);
  await ensureMilestonesForMany(projects);
  return projects.map(toProjectResponse);
}

/** Comptes freelances qu'un client peut approuver sur un projet. */
export async function listProjectAssignees(user: SessionUser): Promise<FreelancerSummaryResponse[]> {
  await ensureClient(user);
  const users = await projectsRepo.listFreelancerUsers();
  return users.map((doc) => ({
    id: doc._id.toHexString(),
    name: `${text(doc.firstName)} ${text(doc.lastName)}`.trim(),
    title: text(doc.title),
    avatar: text(doc.avatar),
  }));
}

/**
 * Accès à l'entité projet (usage interne service). Vérifie la visibilité :
 * un projet non publié reste réservé à son propriétaire et au freelance assigné.
 */
export async function getProjectEntity(
  requesterId: string | null,
  projectId: string,
): Promise<projectsRepo.ProjectDocument> {
  const project = await findProjectOrThrow(projectId);
  const isOwner = requesterId !== null && project.ownerId === requesterId;
  const isAssigned =
    requesterId !== null &&
    (project.assignedTo ?? "").trim().length > 0 &&
    project.assignedTo === requesterId;

  if (!isOwner && !isAssigned && !isPublishedProjectStatus(project.status)) {
    throw notFound("Projet introuvable.");
  }

  await ensureMilestones(project);
  return project;
}

/** Consultation d'un projet (catalogue public ou projet privé du propriétaire). */
export async function getProject(
  requesterId: string | null,
  projectId: string,
): Promise<ProjectResponse> {
  const project = await getProjectEntity(requesterId, projectId);
  return toProjectResponse(project);
}

/** Catégories réellement présentes dans le catalogue. */
export async function listProjectCatalogCategories(): Promise<string[]> {
  const categories = await projectsRepo.findCatalogCategories();
  const seen = new Set<string>();
  const distinct: string[] = [];

  for (const category of categories) {
    const key = category.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(category);
  }

  distinct.sort((left, right) => {
    const a = left.toLowerCase();
    const b = right.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return distinct;
}

// --- Écriture -----------------------------------------------------------

export async function createProject(
  user: SessionUser,
  input: CreateProjectInput,
): Promise<ProjectResponse> {
  validateCreateProject(input);
  await ensureClient(user);

  const now = new Date();
  const rawStatus = input.status ?? "";
  const rawDurationUnit = (input.durationUnit ?? "").trim();

  const project: projectsRepo.ProjectDocument = {
    _id: new ObjectId(),
    ownerId: user.id,
    title: (input.title ?? "").trim(),
    description: (input.description ?? "").trim(),
    budget: (input.budget ?? "").trim(),
    budgetMin: typeof input.budgetMin === "number" ? input.budgetMin : null,
    budgetMax: typeof input.budgetMax === "number" ? input.budgetMax : null,
    type: (input.type ?? "").trim(),
    durationValue: typeof input.durationValue === "number" ? Math.trunc(input.durationValue) : null,
    durationUnit: rawDurationUnit.length === 0 ? null : rawDurationUnit,
    proposals: 0,
    skills: normalizeSkills(input.skills ?? []),
    client: (input.client ?? "").trim(),
    status: isBlank(rawStatus) ? PROJECT_STATUS.Open : rawStatus,
    category: (input.category ?? "").trim().length === 0 ? null : (input.category ?? "").trim(),
    deadline: (input.deadline ?? "").trim().length === 0 ? null : (input.deadline ?? "").trim(),
    assignedTo: null,
    assignedToName: null,
    assignedAt: null,
    assignmentHistory: [],
    createdAt: now,
    updatedAt: now,
    attachments: [],
    milestones: [],
    milestoneHistory: [],
  };

  syncProjectMilestones(project, null, project.status, now);
  await projectsRepo.insertProject(project);
  return toProjectResponse(project);
}

export async function updateProject(
  user: SessionUser,
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectResponse> {
  validateUpdateProject(input);

  const author = await ensureClient(user);
  const project = await getOwnedProject(user.id, projectId);
  const now = new Date();

  const previousStatus = project.status;
  const previousAssignedTo = project.assignedTo;
  const previousAssignedToName = project.assignedToName;
  const previousAssignedAt = project.assignedAt;

  const targetStatus = (input.status ?? "").trim();

  if (targetStatus.length > 0 && !canTransition(previousStatus, targetStatus)) {
    throw conflict(
      `Transition de statut non autorisée : « ${previousStatus} » vers « ${targetStatus} ».`,
    );
  }

  const cancelsAcceptance =
    targetStatus.length > 0 &&
    equalsIgnoreCase(previousStatus, PROJECT_STATUS.InProgress) &&
    equalsIgnoreCase(targetStatus, PROJECT_STATUS.Open);
  const reopensProject =
    targetStatus.length > 0 &&
    equalsIgnoreCase(previousStatus, PROJECT_STATUS.Completed) &&
    equalsIgnoreCase(targetStatus, PROJECT_STATUS.Open);
  const reopensExecution =
    targetStatus.length > 0 &&
    equalsIgnoreCase(previousStatus, PROJECT_STATUS.Completed) &&
    equalsIgnoreCase(targetStatus, PROJECT_STATUS.InProgress);

  const assignedProvided = typeof input.assignedTo === "string";
  const assignedTo = (input.assignedTo ?? "").trim();
  const removesApproval = assignedProvided && assignedTo.length === 0;

  if ((cancelsAcceptance || reopensProject) && assignedProvided && assignedTo.length > 0) {
    throw conflict(
      "Impossible d'affecter un freelance pendant l'annulation d'une acceptation ou la réouverture d'un projet.",
    );
  }

  if (typeof input.title === "string") project.title = input.title.trim();
  if (typeof input.description === "string") project.description = input.description.trim();
  if (typeof input.budget === "string") project.budget = input.budget.trim();
  if (typeof input.type === "string") project.type = input.type.trim();
  if (typeof input.budgetMin === "number") project.budgetMin = input.budgetMin;
  if (typeof input.budgetMax === "number") project.budgetMax = input.budgetMax;
  if (typeof input.durationValue === "number") project.durationValue = Math.trunc(input.durationValue);
  if (typeof input.durationUnit === "string") {
    const unit = input.durationUnit.trim();
    project.durationUnit = unit.length === 0 ? null : unit;
  }
  if (typeof input.client === "string") project.client = input.client.trim();
  if (typeof input.category === "string") project.category = input.category.trim();
  if (typeof input.deadline === "string") project.deadline = input.deadline.trim();
  if (Array.isArray(input.skills)) project.skills = normalizeSkills(input.skills);
  if (Array.isArray(input.attachments)) project.attachments = dedupAttachments(input.attachments);

  if (targetStatus.length > 0) {
    project.status = targetStatus;
    syncProjectMilestones(project, previousStatus, targetStatus, now);
  }

  let releasedAssignment = false;

  if (assignedProvided && !cancelsAcceptance && !reopensProject) {
    await applyAssignment(project, assignedTo);

    if (
      assignedTo.length > 0 &&
      (previousAssignedTo ?? "").trim().length > 0 &&
      assignedTo !== previousAssignedTo
    ) {
      appendAssignmentHistory(
        project,
        previousAssignedTo as string,
        previousAssignedToName,
        previousAssignedAt,
        ASSIGNMENT_RELEASE_REASON.Reassigned,
        new Date(),
      );
      releasedAssignment = true;
    }
  }

  if (cancelsAcceptance || reopensProject || removesApproval) {
    if ((previousAssignedTo ?? "").trim().length > 0) {
      const reason = reopensProject
        ? ASSIGNMENT_RELEASE_REASON.ProjectReopened
        : cancelsAcceptance
          ? ASSIGNMENT_RELEASE_REASON.AcceptanceCancelled
          : ASSIGNMENT_RELEASE_REASON.AssignmentRemoved;

      appendAssignmentHistory(
        project,
        previousAssignedTo as string,
        previousAssignedToName,
        previousAssignedAt,
        reason,
        new Date(),
      );
      releasedAssignment = true;
    }

    project.assignedTo = null;
    project.assignedToName = null;
    project.assignedAt = null;
  }

  project.updatedAt = now;

  const statusChanged =
    targetStatus.length > 0 && !equalsIgnoreCase(previousStatus, project.status);
  const eventMessage = (input.message ?? "").trim();
  if (statusChanged || eventMessage.length > 0) {
    const eventType = reopensExecution
      ? "project-reopened"
      : statusChanged
        ? "project-status"
        : "comment";
    const message =
      eventMessage.length === 0
        ? describeStatusChange(previousStatus, project.status)
        : eventMessage;

    appendMilestoneHistory(
      project,
      eventType,
      message,
      user.id,
      displayNameOf(author),
      text(author.role),
      now,
    );
  }

  let acceptedProposal: proposalsRepo.ProposalDocument | null = null;
  if (cancelsAcceptance && (previousAssignedTo ?? "").trim().length > 0) {
    acceptedProposal = await proposalsRepo.findAcceptedProposal(
      projectIdOf(project),
      previousAssignedTo as string,
    );
  }

  if (cancelsAcceptance) {
    project.proposals = await proposalsRepo.countActiveProposals(
      projectIdOf(project),
      acceptedProposal ? proposalsRepo.proposalIdOf(acceptedProposal) : undefined,
    );
  }

  const replaced = await projectsRepo.replaceProject(project, {
    ownerId: user.id,
    status: targetStatus.length > 0 ? previousStatus : undefined,
  });
  if (!replaced) {
    throw conflict("Ce projet a été modifié entre-temps. Rechargez-le puis réessayez.");
  }

  if (acceptedProposal) {
    await proposalsRepo.updateProposalStatus(
      proposalsRepo.proposalIdOf(acceptedProposal),
      "Accepted",
      "Cancelled",
      project.status,
    );
  }

  if (cancelsAcceptance) {
    const proposalCount = await proposalsRepo.countActiveProposals(projectIdOf(project));
    if (proposalCount !== project.proposals) {
      await projectsRepo.setProjectProposals(project._id, proposalCount, user.id);
      project.proposals = proposalCount;
    }
  }

  if (
    cancelsAcceptance &&
    releasedAssignment &&
    (previousAssignedTo ?? "").trim().length > 0 &&
    previousAssignedTo !== user.id
  ) {
    await createNotification({
      recipientId: previousAssignedTo as string,
      type: "proposal-cancelled",
      title: project.title,
      message: `L'acceptation de votre proposition pour « ${project.title} » a été annulée.`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });
  }

  if (
    reopensProject &&
    releasedAssignment &&
    (previousAssignedTo ?? "").trim().length > 0 &&
    previousAssignedTo !== user.id
  ) {
    await createNotification({
      recipientId: previousAssignedTo as string,
      type: "project-reopened",
      title: project.title,
      message: `Le projet « ${project.title} » a été réouvert.`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });
  }

  if (
    reopensExecution &&
    (project.assignedTo ?? "").trim().length > 0 &&
    project.assignedTo !== user.id
  ) {
    const detail =
      eventMessage.length === 0
        ? `Le projet « ${project.title} » a été rouvert.`
        : `Le projet « ${project.title} » a été rouvert : ${eventMessage}`;
    await createNotification({
      recipientId: project.assignedTo as string,
      type: "project-reopened",
      title: project.title,
      message: detail,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });
  }

  if (
    project.status === PROJECT_STATUS.Completed &&
    previousStatus !== PROJECT_STATUS.Completed &&
    (project.assignedTo ?? "").trim().length > 0
  ) {
    await createNotification({
      recipientId: project.assignedTo as string,
      type: "project-completed",
      title: project.title,
      message: `Le projet « ${project.title} » a été marqué comme terminé.`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });

    // Ouvre les deux demandes d'évaluation (client et freelancer) sur le
    // projet réellement terminé. Idempotent côté API : un changement de statut
    // répété ne crée pas de doublon.
    await ensureFeedbackRequests(projectIdOf(project));
  }

  if (
    equalsIgnoreCase(previousStatus, PROJECT_STATUS.ClientReview) &&
    equalsIgnoreCase(project.status, PROJECT_STATUS.InProgress) &&
    (project.assignedTo ?? "").trim().length > 0
  ) {
    await createNotification({
      recipientId: project.assignedTo as string,
      type: "project-revision-requested",
      title: project.title,
      message: `Le client a demandé des corrections sur « ${project.title} ».`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });
  }

  return toProjectResponse(project);
}

/**
 * Soumission du travail du freelance pour validation client. Le projet doit
 * être attribué au freelance et se trouver « In progress ».
 */
export async function submitProjectForReview(
  user: SessionUser,
  projectId: string,
  message?: string,
): Promise<ProjectResponse> {
  const freelancer = await ensureFreelancer(user);
  const project = await findProjectOrThrow(projectId);

  if (project.assignedTo !== user.id) {
    throw forbidden("Vous n'êtes pas le freelance attribué à ce projet.");
  }
  if (!canTransition(project.status, PROJECT_STATUS.ClientReview)) {
    throw conflict(
      `Transition de statut non autorisée : ${project.status} vers ${PROJECT_STATUS.ClientReview}.`,
    );
  }

  const previousStatus = project.status;
  const now = new Date();
  project.status = PROJECT_STATUS.ClientReview;
  project.updatedAt = now;

  syncProjectMilestones(project, previousStatus, PROJECT_STATUS.ClientReview, now);

  const trimmed = (message ?? "").trim();
  const submittedMessage =
    trimmed.length === 0 ? "Le freelance a soumis le projet pour validation." : trimmed;
  appendMilestoneHistory(
    project,
    "submitted",
    submittedMessage,
    user.id,
    displayNameOf(freelancer),
    text(freelancer.role),
    now,
  );

  const replaced = await projectsRepo.replaceProject(project, {
    assignedTo: user.id,
    status: previousStatus,
  });
  if (!replaced) {
    throw conflict("Ce projet a été modifié entre-temps. Rechargez-le puis réessayez.");
  }

  if ((project.ownerId ?? "").trim().length > 0 && project.ownerId !== user.id) {
    await createNotification({
      recipientId: project.ownerId,
      type: "project-submitted-review",
      title: project.title,
      message: `Le projet ${project.title} a été soumis pour votre validation.`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.assignedToName ?? "",
    });
  }

  return toProjectResponse(project);
}

/** Suppression du projet et de toutes ses candidatures (aucune orpheline). */
export async function deleteProject(user: SessionUser, projectId: string): Promise<null> {
  await getOwnedProject(user.id, projectId);
  await projectsRepo.deleteProject(projectId, user.id);
  await proposalsRepo.deleteProposalsByProject(projectId);
  return null;
}

/**
 * Réouverture d'un projet terminé par son client : le projet reprend en cours
 * d'exécution avec le même freelance, l'historique est conservé.
 */
export async function reopenProject(
  user: SessionUser,
  projectId: string,
  message?: string,
): Promise<ProjectResponse> {
  const author = await ensureClient(user);
  const project = await getOwnedProject(user.id, projectId);

  if (!equalsIgnoreCase(project.status, PROJECT_STATUS.Completed)) {
    throw conflict("Seul un projet terminé peut être rouvert.");
  }

  const previousStatus = project.status;
  const now = new Date();
  project.status = PROJECT_STATUS.InProgress;
  project.updatedAt = now;
  syncProjectMilestones(project, previousStatus, PROJECT_STATUS.InProgress, now);

  const trimmed = (message ?? "").trim();
  appendMilestoneHistory(
    project,
    "project-reopened",
    trimmed.length === 0 ? "Le client a rouvert le projet." : trimmed,
    user.id,
    displayNameOf(author),
    text(author.role),
    now,
  );

  const replaced = await projectsRepo.replaceProject(project, {
    ownerId: user.id,
    status: previousStatus,
  });
  if (!replaced) {
    throw conflict("Ce projet a été modifié entre-temps. Rechargez-le puis réessayez.");
  }

  if ((project.assignedTo ?? "").trim().length > 0 && project.assignedTo !== user.id) {
    await createNotification({
      recipientId: project.assignedTo as string,
      type: "project-reopened",
      title: project.title,
      message:
        trimmed.length === 0
          ? `Le projet « ${project.title} » a été rouvert.`
          : `Le projet « ${project.title} » a été rouvert : ${trimmed}`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });
  }

  return toProjectResponse(project);
}

/**
 * Action sur une étape : progression du freelance assigné, validation ou
 * demande de modifications du client propriétaire, ou simple commentaire.
 */
export async function projectMilestoneAction(
  user: SessionUser,
  projectId: string,
  milestoneId: string,
  input: MilestoneActionInput,
): Promise<ProjectResponse> {
  const author = await findUserById(user.id);
  if (!author) throw unauthorized("Session invalide.");

  const project = await findProjectOrThrow(projectId);
  const isOwner = project.ownerId === user.id;
  const isAssigned =
    (project.assignedTo ?? "").trim().length > 0 && project.assignedTo === user.id;

  if (!isOwner && !isAssigned) {
    throw forbidden("Vous n'êtes pas autorisé à modifier les étapes de ce projet.");
  }

  const action = (input.action ?? "").trim().toLowerCase();
  if (action.length === 0) {
    throw conflict("Action de milestone manquante.");
  }

  const previousStatus = project.status;
  const now = new Date();
  const message = (input.message ?? "").trim();

  const movesBackToProgress =
    action === "request-changes" &&
    equalsIgnoreCase(project.status, PROJECT_STATUS.ClientReview);
  if (movesBackToProgress) {
    project.status = PROJECT_STATUS.InProgress;
    syncProjectMilestones(project, previousStatus, PROJECT_STATUS.InProgress, now);
  }

  const milestone = project.milestones.find((item) => item.id === milestoneId);
  if (!milestone) throw notFound("Étape introuvable.");

  let eventType: string;
  let eventMessage: string;

  switch (action) {
    case "progress":
    case "submit": {
      if (!isAssigned) {
        throw forbidden("Seul le freelance assigné peut mettre à jour la progression.");
      }
      if (!equalsIgnoreCase(project.status, PROJECT_STATUS.InProgress)) {
        throw conflict("La progression ne peut être mise à jour que sur un projet en cours.");
      }

      milestone.status =
        action === "submit" ? MILESTONE_STATUS.Submitted : MILESTONE_STATUS.InProgress;
      const requestedProgress =
        typeof input.progress === "number" && Number.isFinite(input.progress)
          ? Math.trunc(input.progress)
          : action === "submit"
            ? 100
            : milestone.progress;
      milestone.progress = clamp(requestedProgress, 0, 100);
      eventType = "milestone-status";
      eventMessage =
        message.length === 0
          ? `Le freelance a mis à jour l'étape « ${milestone.title} » (${milestone.progress} %).`
          : message;
      break;
    }

    case "approve": {
      if (!isOwner) {
        throw forbidden("Seul le client propriétaire peut valider une étape.");
      }
      milestone.status = MILESTONE_STATUS.Approved;
      milestone.progress = 100;
      eventType = "approved";
      eventMessage =
        message.length === 0
          ? `Le client a validé l'étape « ${milestone.title} ».`
          : message;
      break;
    }

    case "request-changes": {
      if (!isOwner) {
        throw forbidden("Seul le client propriétaire peut demander des modifications.");
      }
      if (message.length < 5) {
        throw conflict("Expliquez les modifications attendues (au moins 5 caractères).");
      }
      milestone.status = MILESTONE_STATUS.ChangesRequested;
      milestone.progress = Math.min(milestone.progress, 90);
      eventType = "changes-requested";
      eventMessage = message;
      break;
    }

    case "comment": {
      if (message.length === 0) {
        throw conflict("Le message est obligatoire.");
      }
      eventType = "comment";
      eventMessage = message;
      break;
    }

    default:
      throw conflict("Action de milestone inconnue.");
  }

  milestone.updatedAt = now;
  project.updatedAt = now;
  appendMilestoneHistory(
    project,
    eventType,
    eventMessage,
    user.id,
    displayNameOf(author),
    text(author.role),
    now,
    milestone,
  );

  const replaced = await projectsRepo.replaceProject(project, { status: previousStatus });
  if (!replaced) {
    throw conflict("Ce projet a été modifié entre-temps. Rechargez-le puis réessayez.");
  }

  if (movesBackToProgress && (project.assignedTo ?? "").trim().length > 0) {
    await createNotification({
      recipientId: project.assignedTo as string,
      type: "project-revision-requested",
      title: project.title,
      message: `Le client a demandé des modifications sur « ${project.title} » : ${message}`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });
  }

  if (
    action === "approve" &&
    (project.assignedTo ?? "").trim().length > 0 &&
    project.assignedTo !== user.id
  ) {
    await createNotification({
      recipientId: project.assignedTo as string,
      type: "milestone-approved",
      title: project.title,
      message: `Le client a validé l'étape « ${milestone.title} » du projet « ${project.title} ».`,
      projectId: projectIdOf(project),
      projectTitle: project.title,
      actorName: project.client,
    });
  }

  return toProjectResponse(project);
}

/** Ajoute une étape personnalisée au projet (client propriétaire). */
export async function addProjectMilestone(
  user: SessionUser,
  projectId: string,
  input: CreateMilestoneInput,
): Promise<ProjectResponse> {
  const author = await ensureClient(user);
  const project = await getOwnedProject(user.id, projectId);

  const title = (input.title ?? "").trim();
  if (title.length === 0) {
    throw conflict("Le titre de l'étape est obligatoire.");
  }

  const now = new Date();
  let date: Date | null = null;
  if (typeof input.date === "string" && input.date.trim().length > 0) {
    const parsed = new Date(input.date);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  const milestone: projectsRepo.ProjectMilestoneDocument = {
    id: newMilestoneId(),
    key: "",
    title,
    status: MILESTONE_STATUS.Pending,
    progress: 0,
    date,
    createdAt: now,
    updatedAt: now,
  };
  project.milestones.push(milestone);
  project.updatedAt = now;

  appendMilestoneHistory(
    project,
    "milestone-status",
    `Nouvelle étape ajoutée : « ${title} ».`,
    user.id,
    displayNameOf(author),
    text(author.role),
    now,
    milestone,
  );

  await projectsRepo.replaceProject(project, { ownerId: user.id });
  return toProjectResponse(project);
}

// --- Opérations partagées avec le module propositions -------------------

/**
 * Applique (ou retire) l'approbation d'un freelance. Le compte visé doit
 * exister et avoir le rôle freelance.
 */
export async function applyAssignment(
  project: projectsRepo.ProjectDocument,
  assignedTo: string,
): Promise<void> {
  const normalized = assignedTo.trim();
  if (normalized.length === 0) {
    project.assignedTo = null;
    project.assignedToName = null;
    project.assignedAt = null;
    return;
  }

  if (!ObjectId.isValid(normalized)) {
    throw notFound("Freelance introuvable.");
  }

  const user = await findUserById(normalized);
  if (!user) throw notFound("Freelance introuvable.");
  if (!equalsIgnoreCase(text(user.role), "freelancer")) {
    throw forbidden("Seul un compte freelance peut être approuvé sur un projet.");
  }

  project.assignedTo = String(user._id);
  project.assignedToName = `${text(user.firstName)} ${text(user.lastName)}`.trim();
  project.assignedAt = new Date();
}

/**
 * Réclamation atomique de l'affectation : l'écriture n'aboutit que si le projet
 * est toujours "Open" et non attribué à un autre freelance.
 */
export async function tryClaimAssignment(
  project: projectsRepo.ProjectDocument,
  freelancerId: string,
): Promise<boolean> {
  return projectsRepo.claimProjectAssignment(project, freelancerId);
}

/**
 * Ajuste le compteur de candidatures actives du projet (jamais sous zéro).
 */
export async function addProposalsCount(projectId: string, delta: number): Promise<void> {
  if (delta === 0) return;

  if (delta > 0) {
    await projectsRepo.incrementProjectProposals(projectId, delta);
    return;
  }

  const project = await projectsRepo.findProjectById(projectId);
  if (!project) return;

  const next = Math.max(0, project.proposals + delta);
  if (next === project.proposals) return;

  await projectsRepo.setProjectProposals(project._id, next);
}
