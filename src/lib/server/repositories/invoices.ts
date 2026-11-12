// Accès à la collection "invoices" et aux données lues par InvoiceService.
//
// Le moteur de paiement reste la seule source d'écriture de
// "paymentTransactions" : ce module ne fait que LIRE les transactions pour
// afficher l'historique des paiements d'une facture.

import { ObjectId, type Collection, type Decimal128 } from "mongodb";
import { collections } from "@/lib/server/db";
import type { QuoteLineDocument } from "@/lib/server/repositories/quotes";

export type InvoiceLineDocument = QuoteLineDocument;

export type InvoicePaymentDocument = {
  amount?: Decimal128 | number;
  date?: string;
  note?: string | null;
  reference?: string | null;
  status?: string;
  method?: string | null;
  transactionId?: string | null;
  idempotencyKey?: string | null;
  createdAt?: Date | string | null;
};

export type InvoiceDocument = {
  _id: ObjectId;
  number: string;
  ownerId: string;
  clientId?: string | null;
  client: string;
  projectId: string;
  project: string;
  quoteId?: string | null;
  issueDate: string;
  dueDate: string;
  status: string;
  lines?: InvoiceLineDocument[];
  notes?: string;
  subtotal: Decimal128 | number;
  discountTotal: Decimal128 | number;
  taxTotal: Decimal128 | number;
  total: Decimal128 | number;
  amountPaid: Decimal128 | number;
  balanceDue: Decimal128 | number;
  payments?: InvoicePaymentDocument[];
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type PaymentAttemptDocument = {
  attemptNumber?: number;
  status?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | string;
  completedAt?: Date | string | null;
};

export type PaymentTransactionDocument = {
  _id: ObjectId;
  reference?: string;
  invoiceId?: string;
  amount?: Decimal128 | number;
  method?: string | null;
  status?: string;
  note?: string | null;
  idempotencyKey?: string | null;
  receiptNumber?: string | null;
  attempts?: PaymentAttemptDocument[];
  createdAt?: Date | string;
  completedAt?: Date | string | null;
};

export type ProjectDocument = {
  _id: ObjectId;
  ownerId?: string;
  assignedTo?: string | null;
  title?: string;
};

async function invoiceCollection(): Promise<Collection<InvoiceDocument>> {
  return (await collections.invoices()) as unknown as Collection<InvoiceDocument>;
}

async function projectCollection(): Promise<Collection<ProjectDocument>> {
  return (await collections.projects()) as unknown as Collection<ProjectDocument>;
}

async function paymentCollection(): Promise<Collection<PaymentTransactionDocument>> {
  return (await collections.payments()) as unknown as Collection<PaymentTransactionDocument>;
}

async function quoteCollection(): Promise<Collection<Record<string, unknown>>> {
  return (await collections.quotes()) as unknown as Collection<Record<string, unknown>>;
}

export async function findInvoicesForUser(userId: string): Promise<InvoiceDocument[]> {
  const invoices = await invoiceCollection();
  return invoices
    .find({ $or: [{ ownerId: userId }, { clientId: userId }] })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function findInvoiceById(id: ObjectId): Promise<InvoiceDocument | null> {
  const invoices = await invoiceCollection();
  return invoices.findOne({ _id: id });
}

export async function insertInvoice(invoice: InvoiceDocument): Promise<void> {
  const invoices = await invoiceCollection();
  await invoices.insertOne(invoice);
}

export async function replaceInvoice(invoice: InvoiceDocument): Promise<void> {
  const invoices = await invoiceCollection();
  await invoices.replaceOne({ _id: invoice._id }, invoice);
}

export async function replaceInvoices(invoicesToSave: InvoiceDocument[]): Promise<void> {
  if (invoicesToSave.length === 0) return;
  const invoices = await invoiceCollection();
  await invoices.bulkWrite(
    invoicesToSave.map((invoice) => ({
      replaceOne: { filter: { _id: invoice._id }, replacement: invoice },
    })),
  );
}

export async function deleteInvoiceById(id: ObjectId): Promise<void> {
  const invoices = await invoiceCollection();
  await invoices.deleteOne({ _id: id });
}

/** Numéro FAC-YYYY-NNN depuis le compteur "invoice-YYYY". */
export async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counters = (await collections.counters()) as unknown as Collection<{
    _id: string;
    seq?: number;
  }>;
  const result = await counters.findOneAndUpdate(
    { _id: `invoice-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const seq = result ? Number(result.seq) : Number.NaN;
  if (!Number.isFinite(seq)) {
    throw new Error(`Unable to generate invoice number for year ${year}.`);
  }
  return `FAC-${year}-${String(seq).padStart(3, "0")}`;
}

/** Transactions du moteur de paiement, triées chronologiquement (lecture seule). */
export async function findPaymentTransactionsByInvoiceIds(
  invoiceIds: string[],
): Promise<PaymentTransactionDocument[]> {
  if (invoiceIds.length === 0) return [];
  const payments = await paymentCollection();
  return payments
    .find({ invoiceId: { $in: invoiceIds } })
    .sort({ createdAt: 1 })
    .toArray();
}

/**
 * Marque le devis comme converti de façon atomique. Retourne le nombre de
 * documents modifiés : 0 si un autre appel l'a déjà converti.
 */
export async function claimQuoteForInvoice(
  quoteId: ObjectId,
  invoiceId: string,
  clientId: string,
): Promise<number> {
  const quotes = await quoteCollection();
  const result = await quotes.updateOne(
    {
      _id: quoteId,
      status: "accepted",
      $or: [{ convertedTo: null }, { convertedTo: "" }, { convertedTo: { $exists: false } }],
    },
    { $set: { convertedTo: invoiceId, clientId, updatedAt: new Date() } },
  );
  return result.modifiedCount;
}

export async function markQuoteExpired(quoteId: ObjectId): Promise<void> {
  const quotes = await quoteCollection();
  await quotes.updateOne({ _id: quoteId }, { $set: { status: "expired", updatedAt: new Date() } });
}

export async function findProjectById(id: ObjectId): Promise<ProjectDocument | null> {
  const projects = await projectCollection();
  return projects.findOne({ _id: id });
}
