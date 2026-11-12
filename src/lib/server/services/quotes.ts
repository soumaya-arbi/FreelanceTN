// Règles métier du module devis : portage fidèle de QuoteService.cs.
//
// Les identités et le rôle viennent exclusivement de la session (SessionUser) ;
// aucun ownerId/clientId fourni par le client n'est utilisé pour décider des
// droits. Les réponses reproduisent exactement QuoteResponse (camelCase, dates
// ISO, montants numériques, champs calculés de ligne).

import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { conflict, forbidden, notFound, validationError } from "@/lib/server/errors";
import { createNotification } from "@/lib/server/notifications";
import { number, round3, text, toDecimal, toObjectId } from "@/lib/server/serialize";
import type { SessionUser } from "@/lib/server/session";
import { findUserById } from "@/lib/server/repositories/users";
import {
  deleteQuoteById,
  findProjectById,
  findQuoteById,
  findQuotesByClient,
  findQuotesByOwner,
  insertQuote,
  nextQuoteNumber,
  replaceQuote,
  replaceQuotes,
  setQuoteClientIdIfEmpty,
  type QuoteDocument,
  type QuoteHistoryDocument,
  type QuoteLineDocument,
} from "@/lib/server/repositories/quotes";

const QUOTE_STATUSES = ["draft", "sent", "accepted", "refused", "expired"] as const;
type QuoteStatus = (typeof QUOTE_STATUSES)[number];

type Totals = {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureRole(user: SessionUser, role: "client" | "freelancer", message: string): void {
  if (user.role !== role) throw forbidden(message);
}

function statusOf(quote: QuoteDocument): QuoteStatus {
  return normalizeQuoteStatus(text(quote.status, "draft"));
}

function normalizeQuoteStatus(status: string): QuoteStatus {
  const value = status.trim().toLowerCase();
  return (QUOTE_STATUSES as readonly string[]).includes(value) ? (value as QuoteStatus) : "draft";
}

function resolveQuoteStatus(status: string): QuoteStatus {
  const value = status.trim().toLowerCase();
  if (value === "" || !(QUOTE_STATUSES as readonly string[]).includes(value)) {
    throw validationError("Statut de devis invalide.");
  }
  return value as QuoteStatus;
}

/** DateTime.TryParse approximé : ISO, date seule ou jj/mm/aaaa. */
function parseDateValue(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (french) {
    const [, day, month, year] = french;
    const fallback = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }
  return null;
}

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** QuoteStatus.IsExpired : due.Date < utcNow.Date. */
function isQuoteExpired(validUntil: string, now: Date): boolean {
  const due = parseDateValue(validUntil);
  if (!due) return false;
  return utcDay(due) < utcDay(now);
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return "";
}

function timeValue(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function newHistoryEntry(input: {
  action: string;
  note?: string | null;
  actorId: string;
  actorRole: "client" | "freelancer";
  fromStatus: string;
  toStatus: string;
}): QuoteHistoryDocument {
  return {
    id: randomUUID().replace(/-/g, ""),
    action: input.action,
    note: input.note ?? null,
    actorId: input.actorId,
    actorRole: input.actorRole,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    createdAt: new Date(),
  };
}

async function notify(
  recipientId: string | null | undefined,
  type: string,
  title: string,
  message: string,
  projectId = "",
  projectTitle = "",
): Promise<void> {
  const recipient = text(recipientId);
  if (recipient.trim() === "" || !ObjectId.isValid(recipient)) return;
  await createNotification({ recipientId: recipient, type, title, message, projectId, projectTitle });
}

/** ApplyExpiry : un devis envoyé dont la validité est passée devient expiré. */
function applyExpiry(quote: QuoteDocument, now: Date): boolean {
  if (text(quote.convertedTo).length > 0) return false;
  const status = statusOf(quote);
  if (status === "accepted" || status === "refused" || status === "draft" || status === "expired") {
    return false;
  }
  if (isQuoteExpired(text(quote.validUntil), now)) {
    quote.status = "expired";
    quote.updatedAt = now;
    return true;
  }
  return false;
}

/** ResolveClientIdAsync : déduit le client du projet si clientId est vide. */
async function resolveClientId(quote: QuoteDocument): Promise<string | null> {
  const existing = text(quote.clientId);
  if (existing.trim() !== "") return existing;
  const projectId = toObjectId(text(quote.projectId));
  if (!projectId) return null;
  const project = await findProjectById(projectId);
  if (!project) return null;
  const ownerId = text(project.ownerId);
  const inferred = ownerId.trim() !== "" && ownerId !== text(quote.ownerId) ? ownerId : null;
  if (inferred) {
    await setQuoteClientIdIfEmpty(quote._id, inferred);
    quote.clientId = inferred;
  }
  return inferred;
}

async function findQuoteOrThrow(quoteId: string): Promise<QuoteDocument> {
  const id = toObjectId(quoteId);
  if (!id) throw notFound("Devis introuvable.");
  const quote = await findQuoteById(id);
  if (!quote) throw notFound("Devis introuvable.");
  return quote;
}

// ---------------------------------------------------------------------------
// Lignes et totaux
// ---------------------------------------------------------------------------

function lineValidationErrors(rawLines: unknown[]): string[] {
  const errors: string[] = [];
  for (const raw of rawLines) {
    const line = (raw ?? {}) as Record<string, unknown>;
    if (text(line.description).trim() === "") errors.push("La description de la ligne est obligatoire.");
    if (number(line.quantity, 1) <= 0) errors.push("La quantité doit être supérieure à 0.");
    if (number(line.unitPrice) < 0) errors.push("Le prix unitaire ne peut pas être négatif.");
    if (number(line.taxRate) < 0) errors.push("Le taux de TVA ne peut pas être négatif.");
    const discount = number(line.discount);
    if (discount < 0 || discount > 100) errors.push("La remise doit être comprise entre 0 et 100.");
  }
  return errors;
}

/** NormalizeLines (contrôles de service, 409 comme ConflictException). */
function normalizeLines(rawLines: unknown[]): QuoteLineDocument[] {
  if (rawLines.length === 0) throw conflict("Au moins une ligne est obligatoire.");
  return rawLines.map((raw) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    const description = text(line.description);
    const quantity = number(line.quantity, 1);
    const unitPrice = number(line.unitPrice);
    const taxRate = number(line.taxRate);
    const discount = number(line.discount);
    if (description.trim() === "") throw conflict("La description de la ligne est obligatoire.");
    if (quantity <= 0) throw conflict("La quantité doit être supérieure à 0.");
    if (unitPrice < 0) throw conflict("Le prix unitaire ne peut pas être négatif.");
    if (taxRate < 0) throw conflict("Le taux de TVA ne peut pas être négatif.");
    if (discount < 0 || discount > 100) throw conflict("La remise doit être comprise entre 0 et 100.");
    return {
      id: text(line.id).trim() || randomUUID().replace(/-/g, ""),
      description: description.trim(),
      quantity: toDecimal(quantity),
      unitPrice: toDecimal(unitPrice),
      taxRate: toDecimal(taxRate),
      discount: toDecimal(discount),
    };
  });
}

/** Calculate (QuoteService.Calculate). */
function calculate(lines: QuoteLineDocument[]): Totals {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const line of lines) {
    const quantity = number(line.quantity);
    const unitPrice = number(line.unitPrice);
    const discount = number(line.discount);
    const taxRate = number(line.taxRate);
    const lineGross = quantity * unitPrice;
    const lineDiscount = lineGross * (discount / 100);
    const lineNet = lineGross - lineDiscount;
    const lineTax = lineNet * (taxRate / 100);
    subtotal += lineGross;
    discountTotal += lineDiscount;
    taxTotal += lineTax;
  }
  let total = subtotal - discountTotal + taxTotal;
  if (total < 0) total = 0;
  return {
    subtotal: round3(subtotal),
    discountTotal: round3(discountTotal),
    taxTotal: round3(taxTotal),
    total: round3(total),
  };
}

// ---------------------------------------------------------------------------
// Validation des requêtes (équivalent des FluentValidation appliqués avant
// l'action : 400 + message générique et erreurs détaillées).
// ---------------------------------------------------------------------------

function validateCreateRequest(input: Record<string, unknown>, rawLines: unknown[] | null): void {
  const errors: string[] = [];
  if (text(input.client).length > 200) errors.push("Le nom du client est trop long.");
  if (text(input.projectId).trim() === "") errors.push("Le projet est obligatoire.");
  if (text(input.issueDate).trim() === "") errors.push("La date d'émission est obligatoire.");
  if (text(input.validUntil).trim() === "") errors.push("La date de validité est obligatoire.");
  if (!rawLines || rawLines.length === 0) {
    errors.push("Au moins une ligne est obligatoire.");
  } else {
    errors.push(...lineValidationErrors(rawLines));
  }
  if (errors.length > 0) throw validationError("La requête contient des données invalides.", errors);
}

function validateUpdateRequest(input: Record<string, unknown>): unknown[] | null {
  const errors: string[] = [];
  const rawStatus = input.status;
  if (rawStatus !== null && rawStatus !== undefined) {
    const value = text(rawStatus).trim().toLowerCase();
    if (!(QUOTE_STATUSES as readonly string[]).includes(value)) errors.push("Statut de devis invalide.");
  }
  let rawLines: unknown[] | null = null;
  if (input.lines !== null && input.lines !== undefined) {
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      errors.push("Au moins une ligne est obligatoire.");
    } else {
      rawLines = input.lines;
      errors.push(...lineValidationErrors(input.lines));
    }
  }
  if (errors.length > 0) throw validationError("La requête contient des données invalides.", errors);
  return rawLines;
}

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

function toQuoteLineResponse(line: QuoteLineDocument): Record<string, unknown> {
  const quantity = number(line.quantity);
  const unitPrice = number(line.unitPrice);
  const taxRate = number(line.taxRate);
  const discount = number(line.discount);
  const lineGross = quantity * unitPrice;
  const lineDiscount = lineGross * (discount / 100);
  const lineNet = lineGross - lineDiscount;
  const lineTax = lineNet * (taxRate / 100);
  return {
    id: text(line.id),
    description: text(line.description),
    quantity,
    unitPrice,
    taxRate,
    discount,
    lineSubtotal: round3(lineGross),
    lineDiscount: round3(lineDiscount),
    lineTax: round3(lineTax),
    lineTotal: round3(lineNet + lineTax),
  };
}

function toQuoteHistoryResponse(entry: QuoteHistoryDocument): Record<string, unknown> {
  return {
    id: text(entry.id),
    action: text(entry.action),
    note: entry.note ?? null,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    createdAt: isoDate(entry.createdAt),
  };
}

/** QuoteService.ToResponse. */
export function toQuoteResponse(quote: QuoteDocument): Record<string, unknown> {
  const lines = (quote.lines ?? []).map(toQuoteLineResponse);
  const history = (quote.history ?? [])
    .slice()
    .sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt))
    .map(toQuoteHistoryResponse);

  return {
    id: quote._id.toHexString(),
    number: text(quote.number),
    ownerId: text(quote.ownerId),
    clientId: quote.clientId ?? null,
    client: text(quote.client),
    projectId: text(quote.projectId),
    project: text(quote.project),
    issueDate: text(quote.issueDate),
    validUntil: text(quote.validUntil),
    status: text(quote.status, "draft"),
    convertedTo: quote.convertedTo ?? null,
    correctionNote: quote.correctionNote ?? null,
    correctionRequested: quote.correctionRequested === true,
    abandoned: quote.abandoned === true,
    history,
    lines,
    notes: text(quote.notes),
    subtotal: number(quote.subtotal),
    discountTotal: number(quote.discountTotal),
    taxTotal: number(quote.taxTotal),
    total: number(quote.total),
    createdAt: isoDate(quote.createdAt),
    updatedAt: isoDate(quote.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function listQuotes(user: SessionUser): Promise<Record<string, unknown>[]> {
  const quotes = await findQuotesByOwner(user.id);
  const now = new Date();
  const changed: QuoteDocument[] = [];
  for (const quote of quotes) {
    if (applyExpiry(quote, now)) changed.push(quote);
  }
  if (changed.length > 0) await replaceQuotes(changed);
  return quotes.map(toQuoteResponse);
}

export async function listClientQuotes(user: SessionUser): Promise<Record<string, unknown>[]> {
  const quotes = await findQuotesByClient(user.id);
  const now = new Date();
  const changed: QuoteDocument[] = [];
  for (const quote of quotes) {
    if (applyExpiry(quote, now)) changed.push(quote);
  }
  if (changed.length > 0) await replaceQuotes(changed);
  return quotes.map(toQuoteResponse);
}

export async function getQuote(user: SessionUser, quoteId: string): Promise<Record<string, unknown>> {
  const quote = await findQuoteOrThrow(quoteId);
  await resolveClientId(quote);
  if (text(quote.ownerId) !== user.id && text(quote.clientId) !== user.id) {
    throw forbidden("Accès refusé.");
  }
  const now = new Date();
  if (applyExpiry(quote, now)) await replaceQuote(quote);
  return toQuoteResponse(quote);
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

export async function createQuote(
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Comme le backend, la validation du corps intervient avant les contrôles
  // de rôle et de propriété.
  const rawLines = Array.isArray(input.lines) ? input.lines : null;
  validateCreateRequest(input, rawLines);

  ensureRole(user, "freelancer", "Seul un freelancer peut créer un devis.");

  const projectIdText = text(input.projectId).trim();
  const projectId = toObjectId(projectIdText);
  if (!projectId) throw validationError("Identifiant de projet invalide.");
  const project = await findProjectById(projectId);
  if (!project) throw notFound("Projet introuvable.");
  if (text(project.assignedTo) !== user.id) {
    throw forbidden("Seul le freelancer assigné au projet peut créer un devis pour ce projet.");
  }

  const requestedClientId = text(input.clientId).trim();
  const clientId = requestedClientId === "" ? text(project.ownerId) : requestedClientId;
  if (clientId.trim() === "" || !toObjectId(clientId)) {
    throw conflict("Le devis doit être associé à un client réel.");
  }
  const clientUser = await findUserById(clientId);
  const clientRole = clientUser ? text(clientUser.role).trim().toLowerCase() : "";
  if (!clientUser || clientRole !== "client") {
    throw conflict("Le destinataire du devis doit être un compte client réel associé au projet.");
  }

  const nameParts = [text(clientUser.firstName), text(clientUser.lastName)].filter(
    (part) => part.trim() !== "",
  );
  let resolvedName = nameParts.join(" ").trim();
  if (resolvedName === "") resolvedName = text(clientUser.companyName).trim();
  if (resolvedName === "") resolvedName = text(clientUser.email).trim() || "Client";
  const clientDisplayName = text(input.client).trim() !== "" ? text(input.client).trim() : resolvedName;

  const lines = normalizeLines(rawLines ?? []);
  const totals = calculate(lines);
  const status =
    input.status === null || input.status === undefined ? "draft" : resolveQuoteStatus(text(input.status));
  if (status !== "draft" && status !== "sent") {
    throw conflict("Un nouveau devis ne peut être créé qu'en brouillon ou envoyé.");
  }

  const issueDate = text(input.issueDate).trim();
  const validUntil = text(input.validUntil).trim();
  const now = new Date();
  if (status === "sent" && isQuoteExpired(validUntil, now)) {
    throw conflict("Un devis expiré ne peut pas être envoyé.");
  }

  const quote: QuoteDocument = {
    _id: new ObjectId(),
    number: await nextQuoteNumber(),
    ownerId: user.id,
    clientId,
    client: clientDisplayName,
    projectId: projectIdText,
    project: text(input.project).trim() !== "" ? text(input.project).trim() : text(project.title),
    issueDate,
    validUntil,
    status,
    convertedTo: null,
    correctionNote: null,
    correctionRequested: false,
    abandoned: false,
    history: [],
    lines,
    notes: text(input.notes),
    subtotal: toDecimal(totals.subtotal),
    discountTotal: toDecimal(totals.discountTotal),
    taxTotal: toDecimal(totals.taxTotal),
    total: toDecimal(totals.total),
    createdAt: now,
    updatedAt: now,
  };

  await insertQuote(quote);
  if (status === "sent") {
    await notify(
      quote.clientId,
      "quote_billing",
      "Nouveau devis reçu",
      `Vous avez reçu le devis ${quote.number} pour le projet ${quote.project}.`,
      quote.projectId,
      quote.project,
    );
  }
  return toQuoteResponse(quote);
}

export async function updateQuote(
  user: SessionUser,
  quoteId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // FluentValidation s'exécute avant l'action dans le backend : un corps
  // invalide renvoie 400 avant même le contrôle de propriété.
  const rawLines = validateUpdateRequest(input);

  const quote = await findQuoteOrThrow(quoteId);
  if (text(quote.ownerId) !== user.id) {
    throw forbidden("Seul le propriétaire peut modifier ce devis.");
  }
  if (text(quote.convertedTo).length > 0) {
    throw conflict("Impossible de modifier un devis déjà converti en facture.");
  }
  if (quote.abandoned === true) {
    throw conflict("Un devis définitivement abandonné ne peut pas être modifié.");
  }

  if (input.clientId !== null && input.clientId !== undefined) {
    const value = text(input.clientId).trim();
    quote.clientId = value === "" ? null : value;
  }
  if (input.client !== null && input.client !== undefined) quote.client = text(input.client).trim();
  if (input.projectId !== null && input.projectId !== undefined) {
    const projectIdText = text(input.projectId).trim();
    const projectId = toObjectId(projectIdText);
    if (!projectId) throw validationError("Identifiant de projet invalide.");
    const project = await findProjectById(projectId);
    if (!project) throw notFound("Projet introuvable.");
    if (text(project.assignedTo) !== user.id && text(project.ownerId) !== user.id) {
      throw forbidden("Accès refusé au projet.");
    }
    quote.projectId = projectIdText;
  }
  if (input.project !== null && input.project !== undefined) quote.project = text(input.project).trim();
  if (input.issueDate !== null && input.issueDate !== undefined) {
    quote.issueDate = text(input.issueDate).trim();
  }
  if (input.validUntil !== null && input.validUntil !== undefined) {
    quote.validUntil = text(input.validUntil).trim();
  }
  if (input.notes !== null && input.notes !== undefined) quote.notes = text(input.notes);

  if (input.status !== null && input.status !== undefined) {
    const next = resolveQuoteStatus(text(input.status));
    const previous = statusOf(quote);
    if (next === "sent") {
      const canResendCorrection = previous === "refused" && quote.correctionRequested === true && !quote.abandoned;
      if (previous !== "draft" && previous !== "sent" && !canResendCorrection) {
        throw conflict("Seul un devis brouillon ou un devis en attente de correction peut être envoyé.");
      }
      const now = new Date();
      if (isQuoteExpired(text(quote.validUntil), now)) {
        quote.status = "expired";
        quote.updatedAt = now;
        await replaceQuote(quote);
        throw conflict(
          "Un devis expiré ne peut pas être envoyé. Mettez à jour la date de validité avant de renvoyer.",
        );
      }
      const history = quote.history ?? [];
      quote.history = history;
      if (canResendCorrection) {
        quote.correctionRequested = false;
        quote.abandoned = false;
        history.push(
          newHistoryEntry({
            action: "resent_after_correction",
            actorId: user.id,
            actorRole: "freelancer",
            fromStatus: previous,
            toStatus: next,
          }),
        );
      } else if (previous !== "sent") {
        history.push(
          newHistoryEntry({
            action: "sent",
            actorId: user.id,
            actorRole: "freelancer",
            fromStatus: previous,
            toStatus: next,
          }),
        );
      }
      quote.status = next;
      if (previous !== "sent") {
        await resolveClientId(quote);
        const resend = previous === "refused";
        const message = resend
          ? `Le freelancer a corrigé et renvoyé le devis ${quote.number} pour le projet ${quote.project}. Veuillez l'examiner.`
          : `Vous avez reçu le devis ${quote.number} pour le projet ${quote.project}.`;
        await notify(
          quote.clientId,
          "quote_billing",
          resend ? "Devis corrigé renvoyé" : "Nouveau devis reçu",
          message,
          quote.projectId,
          quote.project,
        );
      }
    } else if (next === "draft") {
      if (previous !== "draft") {
        throw conflict("Le statut du devis ne peut pas revenir en brouillon après envoi.");
      }
      quote.status = next;
    } else {
      throw forbidden("Le statut demandé n'est pas autorisé pour le freelancer.");
    }
  }

  if (rawLines) {
    const lines = normalizeLines(rawLines);
    const totals = calculate(lines);
    quote.lines = lines;
    quote.subtotal = toDecimal(totals.subtotal);
    quote.discountTotal = toDecimal(totals.discountTotal);
    quote.taxTotal = toDecimal(totals.taxTotal);
    quote.total = toDecimal(totals.total);
  }

  quote.updatedAt = new Date();
  await replaceQuote(quote);
  return toQuoteResponse(quote);
}

export async function deleteQuote(user: SessionUser, quoteId: string): Promise<void> {
  const quote = await findQuoteOrThrow(quoteId);
  if (text(quote.ownerId) !== user.id) {
    throw forbidden("Seul le propriétaire peut supprimer ce devis.");
  }
  if (text(quote.convertedTo).length > 0) {
    throw conflict("Impossible de supprimer un devis déjà converti en facture.");
  }
  await deleteQuoteById(quote._id);
}

export async function updateQuoteStatus(
  user: SessionUser,
  quoteId: string,
  status: string,
  note?: string,
  abandon?: boolean,
): Promise<Record<string, unknown>> {
  const quote = await findQuoteOrThrow(quoteId);
  await resolveClientId(quote);
  const now = new Date();
  applyExpiry(quote, now);
  const isOwner = text(quote.ownerId) === user.id;
  const isClient = text(quote.clientId) === user.id;
  if (!isOwner && !isClient) throw forbidden("Accès refusé.");
  if (text(quote.convertedTo).length > 0) {
    throw conflict("Impossible de modifier le statut d'un devis déjà converti en facture.");
  }
  const normalized = resolveQuoteStatus(status);
  const noteText = note === null || note === undefined || note.trim() === "" ? null : note.trim();
  const abandonRequested = abandon === true;

  if (isClient) {
    ensureRole(user, "client", "Seul le client peut répondre au devis.");
    if (normalized !== "accepted" && normalized !== "refused") {
      throw forbidden("Le client ne peut qu'accepter ou refuser un devis.");
    }
    if (statusOf(quote) === "expired" || isQuoteExpired(text(quote.validUntil), now)) {
      quote.status = "expired";
      quote.updatedAt = now;
      await replaceQuote(quote);
      throw conflict("Un devis expiré ne peut pas être accepté ou refusé.");
    }
    if (statusOf(quote) !== "sent") {
      throw conflict("Seul un devis envoyé peut être accepté ou refusé.");
    }
    if (normalized === "refused" && (noteText === null || noteText === "")) {
      throw conflict("Veuillez indiquer les modifications souhaitées avant de refuser le devis.");
    }
  }

  if (isOwner) {
    ensureRole(user, "freelancer", "Seul le freelancer peut gérer l'envoi du devis.");
    if (normalized === "sent") {
      const previousStatus = statusOf(quote);
      const canResendCorrection =
        previousStatus === "refused" && quote.correctionRequested === true && quote.abandoned !== true;
      if (previousStatus !== "draft" && previousStatus !== "sent" && !canResendCorrection) {
        throw conflict("Seul un devis brouillon ou un devis en attente de correction peut être envoyé.");
      }
      if (isQuoteExpired(text(quote.validUntil), now)) {
        quote.status = "expired";
        quote.updatedAt = now;
        await replaceQuote(quote);
        throw conflict(
          "Un devis expiré ne peut pas être envoyé. Mettez à jour la date de validité avant de renvoyer.",
        );
      }
    } else if (normalized === "draft") {
      if (statusOf(quote) !== "draft") {
        throw conflict("Le statut du devis ne peut pas revenir en brouillon après envoi.");
      }
    } else {
      throw forbidden("Le freelancer ne peut pas modifier ce statut de devis.");
    }
  }

  const previous = statusOf(quote);
  quote.status = normalized;
  quote.updatedAt = now;

  const history = quote.history ?? [];
  quote.history = history;

  if (isClient && normalized === "refused") {
    quote.correctionNote = noteText;
    quote.correctionRequested = !abandonRequested;
    quote.abandoned = abandonRequested;
    history.push(
      newHistoryEntry({
        action: abandonRequested ? "abandoned" : "refused_correction_requested",
        note: noteText,
        actorId: user.id,
        actorRole: "client",
        fromStatus: previous,
        toStatus: normalized,
      }),
    );
  } else if (isClient && normalized === "accepted") {
    quote.correctionRequested = false;
    quote.abandoned = false;
    history.push(
      newHistoryEntry({
        action: "accepted",
        note: noteText,
        actorId: user.id,
        actorRole: "client",
        fromStatus: previous,
        toStatus: normalized,
      }),
    );
  } else if (isOwner && normalized === "sent") {
    if (previous === "refused") {
      quote.correctionRequested = false;
      quote.abandoned = false;
      history.push(
        newHistoryEntry({
          action: "resent_after_correction",
          note: noteText,
          actorId: user.id,
          actorRole: "freelancer",
          fromStatus: previous,
          toStatus: normalized,
        }),
      );
    } else if (previous !== "sent") {
      history.push(
        newHistoryEntry({
          action: "sent",
          note: noteText,
          actorId: user.id,
          actorRole: "freelancer",
          fromStatus: previous,
          toStatus: normalized,
        }),
      );
    }
  }

  await replaceQuote(quote);

  if (isOwner && previous !== "sent" && normalized === "sent") {
    const resend = previous === "refused";
    const message = resend
      ? `Le freelancer a corrigé et renvoyé le devis ${quote.number} pour le projet ${quote.project}. Veuillez l'examiner.`
      : `Vous avez reçu le devis ${quote.number} pour le projet ${quote.project}.`;
    await notify(
      quote.clientId,
      "quote_billing",
      resend ? "Devis corrigé renvoyé" : "Nouveau devis reçu",
      message,
      quote.projectId,
      quote.project,
    );
  }
  if (isClient && normalized === "accepted") {
    await notify(
      quote.ownerId,
      "quote_billing",
      "Devis accepté",
      `Votre devis ${quote.number} a été accepté par le client.`,
      quote.projectId,
      quote.project,
    );
  }
  if (isClient && normalized === "refused") {
    const title = abandonRequested ? "Devis refusé (abandonné)" : "Demande de correction sur un devis";
    const message = abandonRequested
      ? `Votre devis ${quote.number} a été refusé par le client.`
      : `Le client a demandé des modifications sur le devis ${quote.number}. Motif : ${noteText ?? ""}`;
    await notify(
      quote.ownerId,
      "quote_billing",
      title,
      message,
      quote.projectId,
      quote.project,
    );
  }

  return toQuoteResponse(quote);
}
