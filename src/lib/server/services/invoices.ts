// Règles métier du module factures : portage fidèle de InvoiceService.cs.
//
// Les paiements sont uniquement LUS depuis "paymentTransactions" (jamais
// écrits ici). Le statut « payée » est toujours recalculé à partir des
// montants enregistrés par le moteur de paiement.

import { randomUUID } from "node:crypto";
import { Decimal128, ObjectId } from "mongodb";
import { conflict, forbidden, notFound, validationError } from "@/lib/server/errors";
import { createNotification } from "@/lib/server/notifications";
import { number, round3, text, toDecimal, toObjectId } from "@/lib/server/serialize";
import type { SessionUser } from "@/lib/server/session";
import {
  findQuoteById,
  setQuoteClientIdIfEmpty,
  type QuoteDocument,
  type QuoteLineDocument,
} from "@/lib/server/repositories/quotes";
import {
  claimQuoteForInvoice,
  deleteInvoiceById,
  findInvoiceById,
  findInvoicesForUser,
  findPaymentTransactionsByInvoiceIds,
  findProjectById,
  insertInvoice,
  markQuoteExpired,
  nextInvoiceNumber,
  replaceInvoice,
  replaceInvoices,
  type InvoiceDocument,
  type InvoiceLineDocument,
  type PaymentAttemptDocument,
  type PaymentTransactionDocument,
} from "@/lib/server/repositories/invoices";

const INVOICE_STATUSES = ["draft", "emise", "unpaid", "partially_paid", "paid", "overdue"] as const;
type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

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

function invoiceStatusValue(invoice: InvoiceDocument): string {
  return text(invoice.status, "draft").trim().toLowerCase();
}

/** Conserve le Decimal128 d'origine (copie devis -> facture sans perte). */
function asDecimal(value: unknown): Decimal128 {
  return value instanceof Decimal128 ? value : toDecimal(value);
}

/** InvoiceService.ResolveStatus (400 si vide ou inconnu). */
function resolveInvoiceStatus(status: string): InvoiceStatus {
  if (status.trim() === "") throw validationError("Statut de facture invalide.");
  let value = status.trim().toLowerCase();
  if (value === "issued" || value === "sent") value = "emise";
  if (!(INVOICE_STATUSES as readonly string[]).includes(value)) {
    throw validationError("Statut de facture invalide.");
  }
  return value as InvoiceStatus;
}

/** QuoteStatus values used by InvoiceService.CreateFromQuoteAsync. */
function quoteStatusValue(status: string): string {
  return status.trim().toLowerCase();
}

/** PaymentTransactionStatus.Normalize. */
function normalizeTransactionStatus(status: string): string {
  const value = status.trim().toLowerCase();
  return ["pending", "processing", "succeeded", "failed", "cancelled"].includes(value) ? value : "pending";
}

/** InvoicePaymentStatus.Normalize. */
function normalizeLegacyStatus(status: string): "completed" | "failed" {
  return status.trim().toLowerCase() === "failed" ? "failed" : "completed";
}

/** PaymentMethod.Normalize. */
function normalizePaymentMethod(method: string): string {
  const value = (method.trim() === "" ? "card" : method).trim().toLowerCase();
  switch (value) {
    case "card":
    case "card_simulated":
    case "carte":
      return "card";
    case "metamask":
    case "metamask_sepolia":
    case "sepolia":
      return "metamask";
    case "wallet":
    case "wallet_simulated":
    case "portefeuille":
      return "wallet";
    case "bank_transfer":
    case "bank_transfer_simulated":
    case "virement":
      return "bank_transfer";
    case "other":
    case "cash":
    case "cash_simulated":
    case "autre":
      return "other";
    default:
      return "card";
  }
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
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

/** DateTime.ToString("yyyy-MM-dd") en heure locale du serveur (ToLocalTime). */
function localDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPaymentDate(value: unknown): string {
  const date = dateValue(value);
  return date ? localDateString(date) : "";
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysUtc(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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

function isQuoteExpired(validUntil: string, now: Date): boolean {
  const due = parseDateValue(validUntil);
  if (!due) return false;
  return utcDay(due) < utcDay(now);
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

async function findInvoiceOrThrow(invoiceId: string): Promise<InvoiceDocument> {
  const id = toObjectId(invoiceId);
  if (!id) throw notFound("Facture introuvable.");
  const invoice = await findInvoiceById(id);
  if (!invoice) throw notFound("Facture introuvable.");
  return invoice;
}

/** ResolveQuoteClientIdAsync (même règle que QuoteService). */
async function resolveQuoteClientId(quote: QuoteDocument): Promise<string | null> {
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

// ---------------------------------------------------------------------------
// Lignes, totaux et statuts calculés
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

function normalizeLines(rawLines: unknown[]): InvoiceLineDocument[] {
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

function calculate(lines: InvoiceLineDocument[]): Totals {
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

/** ApplyOverdueIfNeeded : en retard si la date d'échéance est passée et le solde > 0. */
function applyOverdueIfNeeded(invoice: InvoiceDocument): boolean {
  const status = invoiceStatusValue(invoice);
  if (status === "paid" || status === "draft") return false;
  const due = parseDateValue(text(invoice.dueDate));
  if (due && utcDay(due) < utcDay(new Date()) && number(invoice.balanceDue) > 0) {
    if (status !== "overdue") {
      invoice.status = "overdue";
      return true;
    }
  }
  return false;
}

/**
 * RefreshStatusFromAmounts : seuls les montants écrits par le moteur de
 * paiement font foi ; on ne recalcule ici que le statut visible.
 */
function refreshStatusFromAmounts(invoice: InvoiceDocument): void {
  const amountPaid = number(invoice.amountPaid);
  const total = number(invoice.total);
  const balanceDue = number(invoice.balanceDue);
  if (amountPaid >= total - 0.0001 && total >= 0) {
    invoice.amountPaid = asDecimal(invoice.total);
    invoice.balanceDue = toDecimal(0);
    invoice.status = "paid";
  } else if (amountPaid > 0.0001 && balanceDue > 0.0001) {
    invoice.status = "partially_paid";
  } else if (amountPaid <= 0.0001) {
    if (invoiceStatusValue(invoice) === "paid" || invoiceStatusValue(invoice) === "partially_paid") {
      invoice.status = "unpaid";
    }
  }
}

// ---------------------------------------------------------------------------
// Validation (équivalent des FluentValidation appliqués avant l'action)
// ---------------------------------------------------------------------------

function validateUpdateRequest(input: Record<string, unknown>): unknown[] | null {
  const errors: string[] = [];
  const rawStatus = input.status;
  if (rawStatus !== null && rawStatus !== undefined) {
    const value = text(rawStatus).trim().toLowerCase();
    if (!(INVOICE_STATUSES as readonly string[]).includes(value)) errors.push("Statut de facture invalide.");
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

function toInvoiceLineResponse(line: InvoiceLineDocument): Record<string, unknown> {
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

function toAttemptResponse(attempt: PaymentAttemptDocument): Record<string, unknown> {
  return {
    attemptNumber: typeof attempt.attemptNumber === "number" ? attempt.attemptNumber : 0,
    status: text(attempt.status),
    errorCode: attempt.errorCode ?? null,
    errorMessage: attempt.errorMessage ?? null,
    startedAt: isoDate(attempt.startedAt),
    completedAt: attempt.completedAt === null || attempt.completedAt === undefined
      ? null
      : isoDate(attempt.completedAt),
  };
}

/** InvoiceService.ToResponse (transactions réelles + historique embarqué dédupliqué). */
function toInvoiceResponse(
  invoice: InvoiceDocument,
  transactions: PaymentTransactionDocument[],
): Record<string, unknown> {
  const lines = (invoice.lines ?? []).map(toInvoiceLineResponse);

  const payments: Record<string, unknown>[] = [];
  const knownReferences = new Set<string>();
  // Un paiement crédité est enregistré dans invoice.payments avec
  // transactionId = identifiant interne de la transaction, alors que la
  // réponse expose reference (PAY-...). Les deux identités doivent être
  // reconnues pour ne jamais afficher deux fois le même paiement.
  const knownTransactionIds = new Set<string>();
  const orderedTransactions = transactions
    .slice()
    .sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt));

  for (const transaction of orderedTransactions) {
    const reference = text(transaction.reference);
    knownReferences.add(reference);
    knownTransactionIds.add(transaction._id.toHexString());
    const completedAt = dateValue(transaction.completedAt);
    const createdAt = dateValue(transaction.createdAt);
    payments.push({
      id: transaction._id.toHexString(),
      amount: number(transaction.amount),
      date: formatPaymentDate(completedAt ?? createdAt),
      note: transaction.note ?? null,
      reference,
      status: normalizeTransactionStatus(text(transaction.status)),
      method: normalizePaymentMethod(text(transaction.method)),
      transactionId: reference,
      idempotencyKey: transaction.idempotencyKey ?? null,
      createdAt: isoDate(transaction.createdAt),
      receiptNumber: transaction.receiptNumber ?? null,
      receiptAvailable: text(transaction.status) === "succeeded",
      legacy: false,
      attempts: (transaction.attempts ?? []).map(toAttemptResponse),
    });
  }

  const legacyPayments = invoice.payments ?? [];
  for (let index = 0; index < legacyPayments.length; index += 1) {
    const legacy = legacyPayments[index];
    const rawReference =
      legacy.transactionId !== null && legacy.transactionId !== undefined
        ? legacy.transactionId
        : (legacy.reference ?? null);
    const reference = rawReference === null ? null : text(rawReference);
    if (reference !== null && reference.trim() !== ""
      && (knownReferences.has(reference) || knownTransactionIds.has(reference))) continue;
    const legacyReference = text(legacy.reference ?? "");
    if (legacyReference.trim() !== "" && knownReferences.has(legacyReference)) continue;
    payments.push({
      id: `legacy-${invoice._id.toHexString()}-${index}`,
      amount: number(legacy.amount),
      date: text(legacy.date),
      note: legacy.note ?? null,
      reference,
      status: normalizeLegacyStatus(text(legacy.status)) === "failed" ? "failed" : "succeeded",
      method: normalizePaymentMethod(text(legacy.method)),
      transactionId: reference,
      idempotencyKey: legacy.idempotencyKey ?? null,
      createdAt: isoDate(legacy.createdAt),
      receiptNumber: null,
      receiptAvailable: false,
      legacy: true,
      attempts: [],
    });
  }

  payments.sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt));

  return {
    id: invoice._id.toHexString(),
    number: text(invoice.number),
    ownerId: text(invoice.ownerId),
    clientId: invoice.clientId ?? null,
    client: text(invoice.client),
    projectId: text(invoice.projectId),
    project: text(invoice.project),
    quoteId: invoice.quoteId ?? null,
    issueDate: text(invoice.issueDate),
    dueDate: text(invoice.dueDate),
    status: text(invoice.status, "draft"),
    lines,
    notes: text(invoice.notes),
    subtotal: number(invoice.subtotal),
    discountTotal: number(invoice.discountTotal),
    taxTotal: number(invoice.taxTotal),
    total: number(invoice.total),
    amountPaid: number(invoice.amountPaid),
    balanceDue: number(invoice.balanceDue),
    payments,
    createdAt: isoDate(invoice.createdAt),
    updatedAt: isoDate(invoice.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function listInvoices(user: SessionUser): Promise<Record<string, unknown>[]> {
  const invoices = await findInvoicesForUser(user.id);
  const changed = invoices.filter((invoice) => applyOverdueIfNeeded(invoice));
  if (changed.length > 0) await replaceInvoices(changed);

  const transactions = await findPaymentTransactionsByInvoiceIds(
    invoices.map((invoice) => invoice._id.toHexString()),
  );
  const byInvoice = new Map<string, PaymentTransactionDocument[]>();
  for (const transaction of transactions) {
    const key = text(transaction.invoiceId);
    const list = byInvoice.get(key) ?? [];
    list.push(transaction);
    byInvoice.set(key, list);
  }

  return invoices.map((invoice) =>
    toInvoiceResponse(invoice, byInvoice.get(invoice._id.toHexString()) ?? []),
  );
}

export async function getInvoice(user: SessionUser, invoiceId: string): Promise<Record<string, unknown>> {
  const invoice = await findInvoiceOrThrow(invoiceId);
  if (text(invoice.ownerId) !== user.id && text(invoice.clientId) !== user.id) {
    throw forbidden("Accès refusé.");
  }
  if (applyOverdueIfNeeded(invoice)) await replaceInvoice(invoice);
  const transactions = await findPaymentTransactionsByInvoiceIds([invoice._id.toHexString()]);
  return toInvoiceResponse(invoice, transactions);
}

// ---------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------

/** Règle métier stricte : la création manuelle est toujours refusée. */
export async function createInvoice(
  _user: SessionUser,
  _input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  throw forbidden(
    "La création manuelle de facture n'est pas autorisée. Seul le client peut créer une facture à partir d'un devis accepté.",
  );
}

export async function createInvoiceFromQuote(
  user: SessionUser,
  quoteId: string,
  input: { dueDate?: string; notes?: string } = {},
): Promise<Record<string, unknown>> {
  ensureRole(user, "client", "Seul le client peut créer une facture à partir d'un devis accepté.");

  const quoteObjectId = toObjectId(quoteId);
  if (!quoteObjectId) throw notFound("Devis introuvable.");
  const quote = await findQuoteById(quoteObjectId);
  if (!quote) throw notFound("Devis introuvable.");

  const resolvedClientId = await resolveQuoteClientId(quote);
  if (resolvedClientId !== user.id) {
    throw forbidden("Vous ne pouvez créer une facture qu'à partir de vos devis acceptés.");
  }
  if (text(quote.convertedTo).length > 0) {
    throw conflict("Ce devis a déjà été converti en facture.");
  }
  const quoteStatus = quoteStatusValue(text(quote.status));
  if (quoteStatus === "refused" || quoteStatus === "draft") {
    throw conflict("Un devis en attente, refusé ou expiré ne peut pas générer de facture.");
  }
  const now = new Date();
  if (isQuoteExpired(text(quote.validUntil), now) || quoteStatus === "expired") {
    if (quoteStatus !== "expired" && text(quote.convertedTo).length === 0) {
      await markQuoteExpired(quote._id);
    }
    throw conflict("Un devis expiré ne peut pas générer de facture.");
  }
  if (quoteStatus !== "accepted") {
    throw conflict("Seul un devis accepté peut être utilisé pour créer une facture.");
  }

  const projectObjectId = toObjectId(text(quote.projectId));
  if (!projectObjectId) throw notFound("Projet introuvable.");
  const project = await findProjectById(projectObjectId);
  if (!project) throw notFound("Projet introuvable.");
  if (text(project.ownerId) !== user.id && resolvedClientId !== user.id) {
    throw forbidden("Accès refusé au projet.");
  }

  const issueDate = todayUtc();
  const requestedDueDate = text(input.dueDate).trim();
  const dueDate = requestedDueDate === "" ? addDaysUtc(30) : requestedDueDate;
  if (!parseDateValue(dueDate)) throw validationError("Date d'échéance invalide.");

  const lines: InvoiceLineDocument[] = (quote.lines ?? []).map((line: QuoteLineDocument) => {
    const lineId = text(line.id);
    return {
      id: lineId.trim() === "" ? randomUUID().replace(/-/g, "") : lineId,
      description: text(line.description),
      quantity: asDecimal(line.quantity),
      unitPrice: asDecimal(line.unitPrice),
      taxRate: asDecimal(line.taxRate),
      discount: asDecimal(line.discount),
    };
  });
  const totals = calculate(lines);
  const requestedNotes = text(input.notes).trim();

  const invoice: InvoiceDocument = {
    _id: new ObjectId(),
    number: await nextInvoiceNumber(),
    ownerId: text(quote.ownerId),
    clientId: user.id,
    client: text(quote.client),
    projectId: text(quote.projectId),
    project: text(quote.project).trim() === "" ? text(project.title) : text(quote.project),
    quoteId: quote._id.toHexString(),
    issueDate,
    dueDate,
    status: "unpaid",
    lines,
    notes: requestedNotes === "" ? text(quote.notes) : requestedNotes,
    subtotal: toDecimal(totals.subtotal),
    discountTotal: toDecimal(totals.discountTotal),
    taxTotal: toDecimal(totals.taxTotal),
    total: toDecimal(totals.total),
    amountPaid: toDecimal(0),
    balanceDue: toDecimal(totals.total),
    payments: [],
    createdAt: now,
    updatedAt: now,
  };

  applyOverdueIfNeeded(invoice);
  await insertInvoice(invoice);

  const claimed = await claimQuoteForInvoice(quote._id, invoice._id.toHexString(), user.id);
  if (claimed === 0) {
    await deleteInvoiceById(invoice._id);
    throw conflict("Ce devis ne peut plus être converti en facture (déjà utilisé, expiré ou statut invalide).");
  }

  await notify(
    quote.ownerId,
    "invoice_billing",
    "Facture créée par le client",
    `Le client a créé la facture ${invoice.number} à partir du devis ${text(quote.number)}.`,
    invoice.projectId,
    invoice.project,
  );

  return toInvoiceResponse(invoice, []);
}

export async function updateInvoice(
  user: SessionUser,
  invoiceId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // FluentValidation s'exécute avant l'action dans le backend.
  const rawLines = validateUpdateRequest(input);

  const invoice = await findInvoiceOrThrow(invoiceId);
  if (text(invoice.ownerId) !== user.id) {
    throw forbidden("Seul le propriétaire peut modifier cette facture.");
  }
  if (invoiceStatusValue(invoice) === "paid") {
    throw conflict("Impossible de modifier une facture déjà payée.");
  }

  if (input.clientId !== null && input.clientId !== undefined) {
    const value = text(input.clientId).trim();
    invoice.clientId = value === "" ? null : value;
  }
  if (input.client !== null && input.client !== undefined) invoice.client = text(input.client).trim();
  if (input.projectId !== null && input.projectId !== undefined) {
    const projectIdText = text(input.projectId).trim();
    const projectId = toObjectId(projectIdText);
    if (!projectId) throw validationError("Identifiant de projet invalide.");
    const project = await findProjectById(projectId);
    if (!project) throw notFound("Projet introuvable.");
    if (text(project.assignedTo) !== user.id && text(project.ownerId) !== user.id) {
      throw forbidden("Accès refusé au projet.");
    }
    invoice.projectId = projectIdText;
  }
  if (input.project !== null && input.project !== undefined) invoice.project = text(input.project).trim();
  if (input.issueDate !== null && input.issueDate !== undefined) {
    invoice.issueDate = text(input.issueDate).trim();
  }
  if (input.dueDate !== null && input.dueDate !== undefined) invoice.dueDate = text(input.dueDate).trim();
  if (input.notes !== null && input.notes !== undefined) invoice.notes = text(input.notes);

  if (input.status !== null && input.status !== undefined) {
    const requested = resolveInvoiceStatus(text(input.status));
    if (requested === "paid") {
      throw conflict("Le statut « payée » est calculé automatiquement à partir des paiements enregistrés.");
    }
    invoice.status = requested;
  }

  if (rawLines) {
    const lines = normalizeLines(rawLines);
    const totals = calculate(lines);
    if (number(invoice.amountPaid) > totals.total + 0.0001) {
      throw conflict("Le total ne peut pas être inférieur aux paiements déjà enregistrés.");
    }
    invoice.lines = lines;
    invoice.subtotal = toDecimal(totals.subtotal);
    invoice.discountTotal = toDecimal(totals.discountTotal);
    invoice.taxTotal = toDecimal(totals.taxTotal);
    invoice.total = toDecimal(totals.total);
    invoice.balanceDue = toDecimal(Math.max(0, totals.total - number(invoice.amountPaid)));
  }
  refreshStatusFromAmounts(invoice);

  applyOverdueIfNeeded(invoice);
  invoice.updatedAt = new Date();
  await replaceInvoice(invoice);

  const transactions = await findPaymentTransactionsByInvoiceIds([invoice._id.toHexString()]);
  return toInvoiceResponse(invoice, transactions);
}

export async function deleteInvoice(user: SessionUser, invoiceId: string): Promise<void> {
  const invoice = await findInvoiceOrThrow(invoiceId);
  if (text(invoice.ownerId) !== user.id) {
    throw forbidden("Seul le propriétaire peut supprimer cette facture.");
  }
  if (invoiceStatusValue(invoice) === "paid" || number(invoice.amountPaid) > 0) {
    throw conflict("Impossible de supprimer une facture payée ou partiellement payée.");
  }
  await deleteInvoiceById(invoice._id);
}

export async function updateInvoiceStatus(
  user: SessionUser,
  invoiceId: string,
  status: string,
): Promise<Record<string, unknown>> {
  const invoice = await findInvoiceOrThrow(invoiceId);
  const isOwner = text(invoice.ownerId) === user.id;
  const isClient = text(invoice.clientId) === user.id;
  if (!isOwner && !isClient) throw forbidden("Accès refusé.");

  const normalized = resolveInvoiceStatus(status);
  if (normalized === "paid") {
    throw conflict("Le statut « payée » est calculé automatiquement à partir des paiements enregistrés.");
  }
  if (invoiceStatusValue(invoice) === "paid") {
    throw conflict("Une facture payée ne peut pas être rouverte.");
  }

  invoice.status = normalized;
  refreshStatusFromAmounts(invoice);
  applyOverdueIfNeeded(invoice);
  invoice.updatedAt = new Date();
  await replaceInvoice(invoice);

  const transactions = await findPaymentTransactionsByInvoiceIds([invoice._id.toHexString()]);
  return toInvoiceResponse(invoice, transactions);
}
