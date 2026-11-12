// Accès à la collection "quotes" et aux documents lus par QuoteService.
//
// Types des documents réellement stockés (mêmes noms de champs que Quote.cs) :
// l'identifiant est un ObjectId, ownerId/clientId sont des strings, les dates
// métier (issueDate/validUntil) sont des chaînes, les montants sont des
// Decimal128. Aucune règle métier ici.

import { ObjectId, type Collection, type Decimal128 } from "mongodb";
import { collections } from "@/lib/server/db";

export type QuoteLineDocument = {
  id: string;
  description: string;
  quantity: Decimal128 | number;
  unitPrice: Decimal128 | number;
  taxRate: Decimal128 | number;
  discount: Decimal128 | number;
};

export type QuoteHistoryDocument = {
  id?: string;
  action?: string;
  note?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  createdAt?: Date | string;
};

export type QuoteDocument = {
  _id: ObjectId;
  number: string;
  ownerId: string;
  clientId?: string | null;
  client: string;
  projectId: string;
  project: string;
  issueDate: string;
  validUntil: string;
  status: string;
  convertedTo?: string | null;
  correctionNote?: string | null;
  correctionRequested?: boolean;
  abandoned?: boolean;
  history?: QuoteHistoryDocument[];
  lines?: QuoteLineDocument[];
  notes?: string;
  subtotal: Decimal128 | number;
  discountTotal: Decimal128 | number;
  taxTotal: Decimal128 | number;
  total: Decimal128 | number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ProjectDocument = {
  _id: ObjectId;
  ownerId?: string;
  assignedTo?: string | null;
  title?: string;
};

async function quoteCollection(): Promise<Collection<QuoteDocument>> {
  return (await collections.quotes()) as unknown as Collection<QuoteDocument>;
}

async function projectCollection(): Promise<Collection<ProjectDocument>> {
  return (await collections.projects()) as unknown as Collection<ProjectDocument>;
}

export async function findQuoteById(id: ObjectId): Promise<QuoteDocument | null> {
  const quotes = await quoteCollection();
  return quotes.findOne({ _id: id });
}

export async function findQuotesByOwner(ownerId: string): Promise<QuoteDocument[]> {
  const quotes = await quoteCollection();
  return quotes.find({ ownerId }).sort({ createdAt: -1 }).toArray();
}

export async function findQuotesByClient(clientId: string): Promise<QuoteDocument[]> {
  const quotes = await quoteCollection();
  return quotes.find({ clientId }).sort({ createdAt: -1 }).toArray();
}

export async function insertQuote(quote: QuoteDocument): Promise<void> {
  const quotes = await quoteCollection();
  await quotes.insertOne(quote);
}

export async function replaceQuote(quote: QuoteDocument): Promise<void> {
  const quotes = await quoteCollection();
  await quotes.replaceOne({ _id: quote._id }, quote);
}

export async function replaceQuotes(quotesToSave: QuoteDocument[]): Promise<void> {
  if (quotesToSave.length === 0) return;
  const quotes = await quoteCollection();
  await quotes.bulkWrite(
    quotesToSave.map((quote) => ({
      replaceOne: { filter: { _id: quote._id }, replacement: quote },
    })),
  );
}

export async function deleteQuoteById(id: ObjectId): Promise<void> {
  const quotes = await quoteCollection();
  await quotes.deleteOne({ _id: id });
}

/** Renseigne clientId uniquement s'il est encore vide (ResolveClientIdAsync). */
export async function setQuoteClientIdIfEmpty(id: ObjectId, clientId: string): Promise<void> {
  const quotes = await quoteCollection();
  await quotes.updateOne(
    { _id: id, $or: [{ clientId: null }, { clientId: "" }, { clientId: { $exists: false } }] },
    { $set: { clientId, updatedAt: new Date() } },
  );
}

/** Numéro DEV-YYYY-NNN depuis le compteur "quote-YYYY". */
export async function nextQuoteNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counters = (await collections.counters()) as unknown as Collection<{
    _id: string;
    seq?: number;
  }>;
  const result = await counters.findOneAndUpdate(
    { _id: `quote-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  const seq = result ? Number(result.seq) : Number.NaN;
  if (!Number.isFinite(seq)) {
    throw new Error(`Unable to generate quote number for year ${year}.`);
  }
  return `DEV-${year}-${String(seq).padStart(3, "0")}`;
}

export async function findProjectById(id: ObjectId): Promise<ProjectDocument | null> {
  const projects = await projectCollection();
  return projects.findOne({ _id: id });
}
