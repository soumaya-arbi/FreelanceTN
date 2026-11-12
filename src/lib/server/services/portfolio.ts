// Règles métier du portfolio (PortfolioService.cs + PortfolioValidators.cs).
// Le propriétaire vient de la session, jamais du corps de la requête.

import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import { forbidden, notFound, validationError } from "@/lib/server/errors";
import { text } from "@/lib/server/serialize";
import { findUserById } from "@/lib/server/repositories/users";
import {
  deletePortfolio as deletePortfolioRecord,
  findPortfolioById,
  findPortfolioOwnedById,
  insertPortfolio,
  listPortfolioByOwner,
  listPublicPortfolioByOwner,
  replacePortfolio,
  type PortfolioDocument,
} from "@/lib/server/repositories/portfolio";

export type PortfolioItemResponse = {
  id: string;
  ownerId: string;
  title: string;
  summary: string;
  category: string;
  role: string | null;
  duration: string | null;
  challenge: string | null;
  solution: string | null;
  outcome: string | null;
  skills: string[];
  link: string | null;
  image: string | null;
  visibility: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
};

const PUBLIC_VISIBILITY = "Public";
const REGISTERED_CLIENTS_VISIBILITY = "Registered clients only";
const VISIBILITIES = [PUBLIC_VISIBILITY, REGISTERED_CLIENTS_VISIBILITY, "Private"];

type StringRead = {
  present: boolean;
  value: string | null;
  typeError: boolean;
};

type CreatePayload = {
  title: string;
  summary: string;
  category: string;
  role: string | null;
  duration: string | null;
  challenge: string | null;
  solution: string | null;
  outcome: string | null;
  skills: string[];
  link: string | null;
  image: string | null;
  visibility: string;
  published: boolean;
};

type UpdatePayload = {
  title?: string;
  summary?: string;
  category?: string;
  role?: string | null;
  duration?: string | null;
  challenge?: string | null;
  solution?: string | null;
  outcome?: string | null;
  skills?: string[];
  link?: string | null;
  image?: string | null;
  visibility?: string;
  published?: boolean;
};

function idOf(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function invalid(errors: string[]) {
  return validationError("La requête contient des données invalides.", errors);
}

function readString(input: Record<string, unknown>, key: string): StringRead {
  const raw = input[key];
  if (raw === undefined || raw === null) {
    return { present: false, value: null, typeError: false };
  }
  if (typeof raw !== "string") {
    return { present: true, value: null, typeError: true };
  }
  return { present: true, value: raw, typeError: false };
}

function requiredTextValue(
  errors: string[],
  read: StringRead,
  requiredMessage: string,
  minimum: number,
  minimumMessage: string,
  maximum: number,
  maximumMessage: string,
): string | null {
  if (!read.present) {
    errors.push(requiredMessage);
    return null;
  }
  if (read.typeError || read.value === null) {
    errors.push(requiredMessage);
    return null;
  }

  const value = read.value;
  if (value.trim().length === 0) errors.push(requiredMessage);
  if (minimum > 0 && value.length < minimum) errors.push(minimumMessage);
  if (value.length > maximum) errors.push(maximumMessage);
  return value.trim();
}

function validateOptionalString(
  errors: string[],
  read: StringRead,
  maximum: number,
  label: string,
): void {
  if (read.typeError) {
    errors.push(`Le champ « ${label} » est invalide.`);
    return;
  }
  if (read.value !== null && read.value.length > maximum) {
    errors.push(`Le champ « ${label} » ne peut pas dépasser ${maximum} caractères.`);
  }
}

function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateOptionalUrl(
  errors: string[],
  read: StringRead,
  maximumMessage: string,
  invalidMessage: string,
): void {
  if (read.typeError) {
    errors.push(invalidMessage);
    return;
  }
  if (read.value === null) return;
  if (read.value.length > 2048) errors.push(maximumMessage);
  if (!isValidHttpUrl(read.value)) errors.push(invalidMessage);
}

function isValidVisibility(value: string): boolean {
  const trimmed = value.trim();
  return VISIBILITIES.some((known) => known.toLowerCase() === trimmed.toLowerCase());
}

function normalizeVisibility(value: string | null): string {
  const trimmed = value?.trim() ?? "";
  return (
    VISIBILITIES.find((known) => known.toLowerCase() === trimmed.toLowerCase()) ??
    PUBLIC_VISIBILITY
  );
}

function normalizeOptional(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const skill = entry.trim();
    if (skill.length === 0) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(skill);
  }
  return result;
}

function validateSkills(errors: string[], input: Record<string, unknown>): void {
  const raw = input.skills;
  if (raw === undefined || raw === null) return;

  if (!Array.isArray(raw)) {
    errors.push("La liste des compétences est invalide.");
    return;
  }

  if (raw.length > 20) errors.push("20 compétences maximum.");
  for (const skill of raw) {
    if (typeof skill !== "string") {
      errors.push("Une compétence ne peut pas être vide.");
      continue;
    }
    if (skill.trim().length === 0) errors.push("Une compétence ne peut pas être vide.");
    if (skill.length > 40) {
      errors.push("Une compétence ne peut pas dépasser 40 caractères.");
    }
  }
}

function validatePublished(errors: string[], input: Record<string, unknown>): void {
  const raw = input.published;
  if (raw === undefined || raw === null) return;
  if (typeof raw !== "boolean") {
    errors.push("Le statut de publication est invalide.");
  }
}

function buildCreatePayload(input: Record<string, unknown>): CreatePayload {
  const errors: string[] = [];

  const title = requiredTextValue(
    errors,
    readString(input, "title"),
    "Le titre est obligatoire.",
    5,
    "Le titre doit contenir au moins 5 caractères.",
    160,
    "Le titre ne peut pas dépasser 160 caractères.",
  );

  const summary = requiredTextValue(
    errors,
    readString(input, "summary"),
    "Le résumé est obligatoire.",
    10,
    "Le résumé doit contenir au moins 10 caractères.",
    1000,
    "Le résumé ne peut pas dépasser 1000 caractères.",
  );

  const category = requiredTextValue(
    errors,
    readString(input, "category"),
    "La catégorie est obligatoire.",
    0,
    "",
    120,
    "La catégorie ne peut pas dépasser 120 caractères.",
  );

  const role = readString(input, "role");
  const duration = readString(input, "duration");
  const challenge = readString(input, "challenge");
  const solution = readString(input, "solution");
  const outcome = readString(input, "outcome");
  const link = readString(input, "link");
  const image = readString(input, "image");
  const visibility = readString(input, "visibility");

  validateOptionalString(errors, role, 120, "rôle");
  validateOptionalString(errors, duration, 60, "durée");
  validateOptionalString(errors, challenge, 2000, "défi");
  validateOptionalString(errors, solution, 2000, "solution");
  validateOptionalString(errors, outcome, 2000, "résultat");
  validateOptionalUrl(
    errors,
    link,
    "L'URL du projet ne peut pas dépasser 2048 caractères.",
    "L'URL du projet doit être une URL http(s) valide.",
  );
  validateOptionalUrl(
    errors,
    image,
    "L'URL de l'image ne peut pas dépasser 2048 caractères.",
    "L'URL de l'image doit être une URL http(s) valide.",
  );

  if (visibility.typeError) {
    errors.push("La visibilité est invalide.");
  } else if (
    visibility.value !== null &&
    visibility.value.trim().length > 0 &&
    !isValidVisibility(visibility.value)
  ) {
    errors.push("La visibilité est invalide.");
  }

  validateSkills(errors, input);
  validatePublished(errors, input);

  if (errors.length > 0) throw invalid(errors);

  return {
    title: title ?? "",
    summary: summary ?? "",
    category: category ?? "",
    role: normalizeOptional(role.value),
    duration: normalizeOptional(duration.value),
    challenge: normalizeOptional(challenge.value),
    solution: normalizeOptional(solution.value),
    outcome: normalizeOptional(outcome.value),
    skills: normalizeSkills(input.skills),
    link: normalizeOptional(link.value),
    image: normalizeOptional(image.value),
    visibility: normalizeVisibility(visibility.value),
    published: input.published === true,
  };
}

function buildUpdatePayload(input: Record<string, unknown>): UpdatePayload {
  const errors: string[] = [];
  const payload: UpdatePayload = {};

  const title = readString(input, "title");
  if (title.present) {
    const value = requiredTextValue(
      errors,
      title,
      "Le titre est obligatoire.",
      5,
      "Le titre doit contenir au moins 5 caractères.",
      160,
      "Le titre ne peut pas dépasser 160 caractères.",
    );
    if (value !== null) payload.title = value;
  }

  const summary = readString(input, "summary");
  if (summary.present) {
    const value = requiredTextValue(
      errors,
      summary,
      "Le résumé est obligatoire.",
      10,
      "Le résumé doit contenir au moins 10 caractères.",
      1000,
      "Le résumé ne peut pas dépasser 1000 caractères.",
    );
    if (value !== null) payload.summary = value;
  }

  const category = readString(input, "category");
  if (category.present) {
    const value = requiredTextValue(
      errors,
      category,
      "La catégorie est obligatoire.",
      0,
      "",
      120,
      "La catégorie ne peut pas dépasser 120 caractères.",
    );
    if (value !== null) payload.category = value;
  }

  const role = readString(input, "role");
  if (role.present) {
    validateOptionalString(errors, role, 120, "rôle");
    payload.role = normalizeOptional(role.value);
  }

  const duration = readString(input, "duration");
  if (duration.present) {
    validateOptionalString(errors, duration, 60, "durée");
    payload.duration = normalizeOptional(duration.value);
  }

  const challenge = readString(input, "challenge");
  if (challenge.present) {
    validateOptionalString(errors, challenge, 2000, "défi");
    payload.challenge = normalizeOptional(challenge.value);
  }

  const solution = readString(input, "solution");
  if (solution.present) {
    validateOptionalString(errors, solution, 2000, "solution");
    payload.solution = normalizeOptional(solution.value);
  }

  const outcome = readString(input, "outcome");
  if (outcome.present) {
    validateOptionalString(errors, outcome, 2000, "résultat");
    payload.outcome = normalizeOptional(outcome.value);
  }

  const link = readString(input, "link");
  if (link.present) {
    validateOptionalUrl(
      errors,
      link,
      "L'URL du projet ne peut pas dépasser 2048 caractères.",
      "L'URL du projet doit être une URL http(s) valide.",
    );
    payload.link = normalizeOptional(link.value);
  }

  const image = readString(input, "image");
  if (image.present) {
    validateOptionalUrl(
      errors,
      image,
      "L'URL de l'image ne peut pas dépasser 2048 caractères.",
      "L'URL de l'image doit être une URL http(s) valide.",
    );
    payload.image = normalizeOptional(image.value);
  }

  const visibility = readString(input, "visibility");
  if (visibility.present) {
    if (
      visibility.typeError ||
      visibility.value === null ||
      !isValidVisibility(visibility.value)
    ) {
      errors.push("La visibilité est invalide.");
    } else {
      payload.visibility = normalizeVisibility(visibility.value);
    }
  }

  if (input.skills !== undefined && input.skills !== null) {
    validateSkills(errors, input);
    payload.skills = normalizeSkills(input.skills);
  }

  validatePublished(errors, input);
  if (typeof input.published === "boolean") {
    payload.published = input.published;
  }

  if (errors.length > 0) throw invalid(errors);
  return payload;
}

function toResponse(doc: PortfolioDocument): PortfolioItemResponse {
  return {
    id: idOf(doc._id),
    ownerId: text(doc.ownerId),
    title: text(doc.title),
    summary: text(doc.summary),
    category: text(doc.category),
    role: nullableText(doc.role),
    duration: nullableText(doc.duration),
    challenge: nullableText(doc.challenge),
    solution: nullableText(doc.solution),
    outcome: nullableText(doc.outcome),
    skills: stringList(doc.skills),
    link: nullableText(doc.link),
    image: nullableText(doc.image),
    visibility: normalizeVisibility(text(doc.visibility)),
    published: doc.published === true,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function canView(item: PortfolioDocument, requesterId: string | null, isClient: boolean): boolean {
  if (requesterId !== null && text(item.ownerId) === requesterId) return true;
  if (item.published !== true) return false;

  const visibility = normalizeVisibility(text(item.visibility));
  if (visibility === PUBLIC_VISIBILITY) return true;
  if (visibility === REGISTERED_CLIENTS_VISIBILITY) return isClient;
  return false;
}

function ensureFreelancer(owner: SessionUser): void {
  if (owner.role !== "freelancer") {
    throw forbidden("Seuls les freelancers peuvent gérer leur portfolio.");
  }
}

async function ensureFreelancerExists(freelancerId: string): Promise<void> {
  const user = await findUserById(freelancerId);
  if (!user || text(user.role).toLowerCase() !== "freelancer") {
    throw notFound("Freelance introuvable.");
  }
}

export async function createPortfolioItem(
  owner: SessionUser,
  input: Record<string, unknown>,
): Promise<PortfolioItemResponse> {
  const payload = buildCreatePayload(input);
  ensureFreelancer(owner);

  const now = new Date();
  const item: PortfolioDocument = {
    _id: new ObjectId(),
    ownerId: owner.id,
    title: payload.title,
    summary: payload.summary,
    category: payload.category,
    role: payload.role,
    duration: payload.duration,
    challenge: payload.challenge,
    solution: payload.solution,
    outcome: payload.outcome,
    skills: payload.skills,
    link: payload.link,
    image: payload.image,
    visibility: payload.visibility,
    published: payload.published,
    createdAt: now,
    updatedAt: now,
  };

  await insertPortfolio(item);
  return toResponse(item);
}

export async function listMyPortfolio(owner: SessionUser): Promise<PortfolioItemResponse[]> {
  ensureFreelancer(owner);
  const items = await listPortfolioByOwner(owner.id);
  return items.map(toResponse);
}

export async function listFreelancerPortfolio(
  freelancerId: string,
  isClient: boolean,
): Promise<PortfolioItemResponse[]> {
  await ensureFreelancerExists(freelancerId);

  const allowedVisibilities = isClient
    ? [PUBLIC_VISIBILITY, REGISTERED_CLIENTS_VISIBILITY]
    : [PUBLIC_VISIBILITY];

  const items = await listPublicPortfolioByOwner(freelancerId, allowedVisibilities);
  return items.map(toResponse);
}

export async function getPortfolioItem(
  requester: SessionUser | null,
  id: string,
): Promise<PortfolioItemResponse> {
  const item = await findPortfolioById(id);
  if (!item) throw notFound("Réalisation introuvable.");

  const requesterId = requester?.id ?? null;
  const isClient = requester?.role === "client";

  if (!canView(item, requesterId, isClient)) {
    throw notFound("Réalisation introuvable.");
  }

  return toResponse(item);
}

export async function updatePortfolioItem(
  owner: SessionUser,
  id: string,
  input: Record<string, unknown>,
): Promise<PortfolioItemResponse> {
  const payload = buildUpdatePayload(input);
  ensureFreelancer(owner);

  const item = await findPortfolioOwnedById(id, owner.id);
  if (!item) throw notFound("Réalisation introuvable.");

  const updated: PortfolioDocument = {
    ...item,
    title: payload.title ?? item.title,
    summary: payload.summary ?? item.summary,
    category: payload.category ?? item.category,
    role: payload.role !== undefined ? payload.role : item.role,
    duration: payload.duration !== undefined ? payload.duration : item.duration,
    challenge: payload.challenge !== undefined ? payload.challenge : item.challenge,
    solution: payload.solution !== undefined ? payload.solution : item.solution,
    outcome: payload.outcome !== undefined ? payload.outcome : item.outcome,
    skills: payload.skills ?? item.skills,
    link: payload.link !== undefined ? payload.link : item.link,
    image: payload.image !== undefined ? payload.image : item.image,
    visibility: payload.visibility ?? item.visibility,
    published: payload.published !== undefined ? payload.published : item.published,
    updatedAt: new Date(),
  };

  await replacePortfolio(updated);
  return toResponse(updated);
}

export async function deletePortfolioItem(owner: SessionUser, id: string): Promise<void> {
  ensureFreelancer(owner);

  const item = await findPortfolioOwnedById(id, owner.id);
  if (!item) throw notFound("Réalisation introuvable.");

  await deletePortfolioRecord(id, owner.id);
}
