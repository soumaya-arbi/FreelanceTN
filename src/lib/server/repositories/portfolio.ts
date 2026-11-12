// Accès à la collection "portfolio". Le propriétaire est un identifiant
// string (comme projects.ownerId), jamais un ObjectId.

import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { toObjectId } from "@/lib/server/serialize";

export type PortfolioDocument = {
  _id: ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
};

export async function listPortfolioByOwner(ownerId: string): Promise<PortfolioDocument[]> {
  const portfolio = await collections.portfolio();
  return (await portfolio
    .find({ ownerId })
    .sort({ updatedAt: -1 })
    .toArray()) as PortfolioDocument[];
}

export async function listPublicPortfolioByOwner(
  ownerId: string,
  allowedVisibilities: string[],
): Promise<PortfolioDocument[]> {
  const portfolio = await collections.portfolio();
  return (await portfolio
    .find({
      ownerId,
      published: true,
      visibility: { $in: allowedVisibilities },
    })
    .sort({ updatedAt: -1 })
    .toArray()) as PortfolioDocument[];
}

export async function findPortfolioById(id: string): Promise<PortfolioDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const portfolio = await collections.portfolio();
  return (await portfolio.findOne({ _id: objectId })) as PortfolioDocument | null;
}

export async function findPortfolioOwnedById(
  id: string,
  ownerId: string,
): Promise<PortfolioDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const portfolio = await collections.portfolio();
  return (await portfolio.findOne({
    _id: objectId,
    ownerId,
  })) as PortfolioDocument | null;
}

export async function insertPortfolio(doc: PortfolioDocument): Promise<void> {
  const portfolio = await collections.portfolio();
  await portfolio.insertOne(doc);
}

export async function replacePortfolio(doc: PortfolioDocument): Promise<void> {
  const portfolio = await collections.portfolio();
  await portfolio.replaceOne({ _id: doc._id, ownerId: doc.ownerId }, doc);
}

export async function deletePortfolio(id: string, ownerId: string): Promise<void> {
  const objectId = toObjectId(id);
  if (!objectId) return;
  const portfolio = await collections.portfolio();
  await portfolio.deleteOne({ _id: objectId, ownerId });
}
