// Historique des changements de compte (collection "accountChanges").

import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";

export async function recordAccountChange(
  userId: string,
  area: string,
  summary: string,
): Promise<void> {
  if (!ObjectId.isValid(userId)) return;
  try {
    const changes = await collections.accountChanges();
    await changes.insertOne({
      _id: new ObjectId(),
      userId: new ObjectId(userId),
      area,
      summary,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("[account] historique non enregistré", error);
  }
}
