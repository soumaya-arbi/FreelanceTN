// Accès à la collection "projects" (documents camelCase du modèle Project.cs).
// Aucune règle métier ni vérification de session ici : uniquement la lecture,
// l'écriture et la normalisation des documents réellement stockés.

import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { number, text, toDecimal, toObjectId } from "@/lib/server/serialize";

export type ProjectMilestoneDocument = {
  id: string;
  key: string;
  title: string;
  status: string;
  progress: number;
  date: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MilestoneHistoryDocument = {
  id: string;
  milestoneId: string | null;
  milestoneTitle: string;
  type: string;
  message: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  createdAt: Date;
};

export type AssignmentHistoryDocument = {
  freelancerId: string;
  freelancerName: string;
  assignedAt: Date | null;
  releasedAt: Date | null;
  reason: string;
};

export type ProjectAttachmentDocument = {
  fileName: string;
  url: string;
  size: number;
  uploadedAt: Date;
};

export type ProjectDocument = {
  _id: ObjectId;
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
  assignedAt: Date | null;
  assignmentHistory: AssignmentHistoryDocument[];
  createdAt: Date;
  updatedAt: Date;
  attachments: ProjectAttachmentDocument[];
  milestones: ProjectMilestoneDocument[];
  milestoneHistory: MilestoneHistoryDocument[];
};

/** Filtre de comparaison-et-échange appliqué à un remplacement de projet. */
export type ProjectCasFilter = {
  ownerId?: string;
  status?: string;
  assignedTo?: string;
};

export type ProjectCatalogQuery = {
  category?: string;
  query?: string;
  type?: string;
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

function decimalOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = number(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = number(value, Number.NaN);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeMilestone(value: unknown): ProjectMilestoneDocument {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: text(raw.id),
    key: text(raw.key),
    title: text(raw.title),
    status: text(raw.status, "Pending"),
    progress: Math.trunc(number(raw.progress)),
    date: toDate(raw.date),
    createdAt: requiredDate(raw.createdAt),
    updatedAt: requiredDate(raw.updatedAt),
  };
}

function normalizeMilestoneHistory(value: unknown): MilestoneHistoryDocument {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: text(raw.id),
    milestoneId: optionalString(raw.milestoneId),
    milestoneTitle: text(raw.milestoneTitle),
    type: text(raw.type),
    message: text(raw.message),
    authorId: text(raw.authorId),
    authorName: text(raw.authorName),
    authorRole: text(raw.authorRole),
    createdAt: requiredDate(raw.createdAt),
  };
}

function normalizeAssignmentHistory(value: unknown): AssignmentHistoryDocument {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    freelancerId: text(raw.freelancerId),
    freelancerName: text(raw.freelancerName),
    assignedAt: toDate(raw.assignedAt),
    releasedAt: toDate(raw.releasedAt),
    reason: text(raw.reason),
  };
}

function normalizeAttachment(value: unknown): ProjectAttachmentDocument {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    fileName: text(raw.fileName),
    url: text(raw.url),
    size: Math.trunc(number(raw.size)),
    uploadedAt: requiredDate(raw.uploadedAt),
  };
}

function normalizeList<T>(value: unknown, mapper: (entry: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(mapper) : [];
}

export function normalizeProject(value: Record<string, unknown>): ProjectDocument {
  const rawId = value._id;
  const id =
    rawId instanceof ObjectId
      ? rawId
      : typeof rawId === "string" && ObjectId.isValid(rawId)
        ? new ObjectId(rawId)
        : new ObjectId();

  return {
    _id: id,
    ownerId: text(value.ownerId),
    title: text(value.title),
    description: text(value.description),
    budget: text(value.budget),
    budgetMin: decimalOrNull(value.budgetMin),
    budgetMax: decimalOrNull(value.budgetMax),
    type: text(value.type),
    durationValue: intOrNull(value.durationValue),
    durationUnit: optionalString(value.durationUnit),
    proposals: Math.trunc(number(value.proposals)),
    skills: stringList(value.skills),
    client: text(value.client),
    status: text(value.status, "Open"),
    category: optionalString(value.category),
    deadline: optionalString(value.deadline),
    assignedTo: optionalString(value.assignedTo),
    assignedToName: optionalString(value.assignedToName),
    assignedAt: toDate(value.assignedAt),
    assignmentHistory: normalizeList(value.assignmentHistory, normalizeAssignmentHistory),
    createdAt: requiredDate(value.createdAt),
    updatedAt: requiredDate(value.updatedAt),
    attachments: normalizeList(value.attachments, normalizeAttachment),
    milestones: normalizeList(value.milestones, normalizeMilestone),
    milestoneHistory: normalizeList(value.milestoneHistory, normalizeMilestoneHistory),
  };
}

function milestoneRecord(milestone: ProjectMilestoneDocument): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: milestone.id,
    key: milestone.key,
    title: milestone.title,
    status: milestone.status,
    progress: milestone.progress,
    createdAt: milestone.createdAt,
    updatedAt: milestone.updatedAt,
  };
  // Le backend .NET omet la date nulle (BsonIgnoreIfNull).
  if (milestone.date) record.date = milestone.date;
  return record;
}

function milestoneHistoryRecord(entry: MilestoneHistoryDocument): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: entry.id,
    milestoneTitle: entry.milestoneTitle,
    type: entry.type,
    message: entry.message,
    authorId: entry.authorId,
    authorName: entry.authorName,
    authorRole: entry.authorRole,
    createdAt: entry.createdAt,
  };
  if (entry.milestoneId) record.milestoneId = entry.milestoneId;
  return record;
}

/** Document Mongo prêt à être écrit (montants en Decimal128, dates en Date). */
export function toProjectRecord(project: ProjectDocument): Record<string, unknown> {
  return {
    _id: project._id,
    ownerId: project.ownerId,
    title: project.title,
    description: project.description,
    budget: project.budget,
    budgetMin: project.budgetMin === null ? null : toDecimal(project.budgetMin),
    budgetMax: project.budgetMax === null ? null : toDecimal(project.budgetMax),
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
    assignedAt: project.assignedAt,
    assignmentHistory: project.assignmentHistory.map((entry) => ({
      freelancerId: entry.freelancerId,
      freelancerName: entry.freelancerName,
      assignedAt: entry.assignedAt,
      releasedAt: entry.releasedAt,
      reason: entry.reason,
    })),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    attachments: project.attachments.map((entry) => ({
      fileName: entry.fileName,
      url: entry.url,
      size: entry.size,
      uploadedAt: entry.uploadedAt,
    })),
    milestones: project.milestones.map(milestoneRecord),
    milestoneHistory: project.milestoneHistory.map(milestoneHistoryRecord),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readProject(value: Record<string, unknown> | null): Promise<ProjectDocument | null> {
  return value ? normalizeProject(value) : null;
}

export async function findProjectById(id: string): Promise<ProjectDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const projects = await collections.projects();
  const doc = await projects.findOne({ _id: objectId });
  return readProject(doc as Record<string, unknown> | null);
}

export async function findProjectOwned(ownerId: string, projectId: string): Promise<ProjectDocument | null> {
  const objectId = toObjectId(projectId);
  if (!objectId) return null;
  const projects = await collections.projects();
  const doc = await projects.findOne({ _id: objectId, ownerId });
  return readProject(doc as Record<string, unknown> | null);
}

export async function listProjectsByOwner(ownerId: string): Promise<ProjectDocument[]> {
  const projects = await collections.projects();
  const docs = await projects.find({ ownerId }).sort({ createdAt: -1 }).toArray();
  return docs.map((doc) => normalizeProject(doc as Record<string, unknown>));
}

export async function listProjectsAssignedTo(freelancerId: string): Promise<ProjectDocument[]> {
  const projects = await collections.projects();
  const docs = await projects.find({ assignedTo: freelancerId }).sort({ updatedAt: -1 }).toArray();
  return docs.map((doc) => normalizeProject(doc as Record<string, unknown>));
}

/** Catalogue : projets publiés ("Open") et non attribués, filtrés côté Mongo. */
export async function findCatalogProjects(query: ProjectCatalogQuery): Promise<ProjectDocument[]> {
  const conditions: Record<string, unknown>[] = [{ status: "Open" }, { assignedTo: null }];

  const category = query.category?.trim();
  if (category) {
    conditions.push({
      category: { $regex: `^${escapeRegex(category)}$`, $options: "i" },
    });
  }

  const type = query.type?.trim();
  if (type) {
    const normalized = type;
    const pattern = normalized.toLowerCase().startsWith("fixed")
      ? "^fixed"
      : normalized.toLowerCase().startsWith("hourly")
        ? "^hourly"
        : `^${escapeRegex(normalized)}$`;
    conditions.push({ type: { $regex: pattern, $options: "i" } });
  }

  const search = query.query?.trim();
  if (search) {
    const tokens = search
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .slice(0, 10);

    for (const token of tokens) {
      const pattern = escapeRegex(token);
      conditions.push({
        $or: [
          { title: { $regex: pattern, $options: "i" } },
          { description: { $regex: pattern, $options: "i" } },
          { skills: { $regex: pattern, $options: "i" } },
          { client: { $regex: pattern, $options: "i" } },
          { category: { $regex: pattern, $options: "i" } },
        ],
      });
    }
  }

  const projects = await collections.projects();
  const docs = await projects
    .find({ $and: conditions })
    .sort({ createdAt: -1 })
    .limit(1000)
    .toArray();

  return docs.map((doc) => normalizeProject(doc as Record<string, unknown>));
}

/** Catégories présentes dans le catalogue publié et non attribué. */
export async function findCatalogCategories(): Promise<string[]> {
  const projects = await collections.projects();
  const docs = await projects
    .find({ status: "Open", assignedTo: null })
    .project({ category: 1 })
    .toArray();

  return docs
    .map((doc) => text((doc as Record<string, unknown>).category).trim())
    .filter((category) => category.length > 0);
}

export async function insertProject(project: ProjectDocument): Promise<void> {
  const projects = await collections.projects();
  await projects.insertOne(toProjectRecord(project));
}

/** Remplacement conditionnel (compare-and-swap) ; false si aucun document ne correspond. */
export async function replaceProject(
  project: ProjectDocument,
  filter: ProjectCasFilter,
): Promise<boolean> {
  const query: Record<string, unknown> = { _id: project._id };
  if (filter.ownerId !== undefined) query.ownerId = filter.ownerId;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.assignedTo !== undefined) query.assignedTo = filter.assignedTo;

  const projects = await collections.projects();
  const result = await projects.replaceOne(query, toProjectRecord(project));
  return result.matchedCount > 0;
}

export async function setProjectMilestones(
  projectId: ObjectId,
  milestones: ProjectMilestoneDocument[],
): Promise<void> {
  const projects = await collections.projects();
  await projects.updateOne(
    { _id: projectId },
    { $set: { milestones: milestones.map(milestoneRecord) } },
  );
}

export async function setProjectProposals(
  projectId: ObjectId,
  count: number,
  ownerId?: string,
): Promise<void> {
  const query: Record<string, unknown> = { _id: projectId };
  if (ownerId !== undefined) query.ownerId = ownerId;
  const projects = await collections.projects();
  await projects.updateOne(query, { $set: { proposals: count } });
}

export async function incrementProjectProposals(projectId: string, delta: number): Promise<void> {
  const objectId = toObjectId(projectId);
  if (!objectId) return;
  const projects = await collections.projects();
  await projects.updateOne({ _id: objectId }, { $inc: { proposals: delta } });
}

export async function deleteProject(projectId: string, ownerId: string): Promise<void> {
  const objectId = toObjectId(projectId);
  if (!objectId) return;
  const projects = await collections.projects();
  await projects.deleteOne({ _id: objectId, ownerId });
}

/**
 * Réclamation atomique : remplace le projet uniquement s'il est encore "Open"
 * et non attribué (ou déjà attribué au même freelance).
 */
export async function claimProjectAssignment(
  project: ProjectDocument,
  freelancerId: string,
): Promise<boolean> {
  const projects = await collections.projects();
  const result = await projects.replaceOne(
    {
      _id: project._id,
      ownerId: project.ownerId,
      status: "Open",
      $or: [{ assignedTo: null }, { assignedTo: freelancerId }],
    },
    toProjectRecord(project),
  );
  return result.matchedCount === 1;
}

export type FreelancerUserDocument = Record<string, unknown> & { _id: ObjectId };

/** Comptes freelances proposables comme assignés (identité publique uniquement). */
export async function listFreelancerUsers(): Promise<FreelancerUserDocument[]> {
  const users = await collections.users();
  const docs = await users.find({ role: "freelancer" }).sort({ firstName: 1 }).toArray();
  return docs as FreelancerUserDocument[];
}
