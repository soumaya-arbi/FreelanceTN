// Notifications in-app : insertion et filtrage par préférences.
// Reproduit NotificationService.cs : le filtrage n'est appliqué qu'à la
// lecture ; l'écriture reste indépendante du flux métier principal.

import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";

export type NotificationInput = {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  taskId?: string;
  projectId?: string;
  taskTitle?: string;
  projectTitle?: string;
  actorName?: string;
};

/** Insère une notification. Une erreur d'écriture ne doit jamais bloquer le flux. */
export async function createNotification(input: NotificationInput): Promise<void> {
  if (!input.recipientId || !ObjectId.isValid(input.recipientId)) return;
  try {
    const notifications = await collections.notifications();
    await notifications.insertOne({
      _id: new ObjectId(),
      RecipientId: new ObjectId(input.recipientId),
      Type: input.type ?? "",
      Title: input.title ?? "",
      Message: input.message ?? "",
      TaskId: input.taskId ?? "",
      ProjectId: input.projectId ?? "",
      TaskTitle: input.taskTitle ?? "",
      ProjectTitle: input.projectTitle ?? "",
      ActorName: input.actorName ?? "",
      IsRead: false,
      CreatedAt: new Date(),
    });
  } catch (error) {
    console.error("[notifications] insertion impossible", error);
  }
}

export type NotificationPreferencesDoc = {
  inAppEnabled?: boolean;
  invitationsEnabled?: boolean;
  projectActivityEnabled?: boolean;
  messagesEnabled?: boolean;
  billingEnabled?: boolean;
};

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferencesDoc | null> {
  if (!ObjectId.isValid(userId)) return null;
  const prefs = await collections.notificationPreferences();
  const doc = await prefs.findOne({ userId: new ObjectId(userId) });
  return (doc as NotificationPreferencesDoc | null) ?? null;
}

/** Applique réellement les préférences (identique au backend .NET). */
export function filterNotifications<T extends { Type?: unknown; type?: unknown }>(
  items: T[],
  preferences: NotificationPreferencesDoc | null,
): T[] {
  if (!preferences) return items;
  if (!preferences.inAppEnabled) return [];

  return items.filter((item) => {
    const raw = item.Type ?? item.type;
    const type = typeof raw === "string" ? raw.toLowerCase() : "";

    if (type.includes("invit")) return preferences.invitationsEnabled !== false;
    if (type.includes("invoice") || type.includes("quote") || type.includes("billing")) {
      return preferences.billingEnabled !== false;
    }
    if (type.includes("comment") || type.includes("message")) {
      return preferences.messagesEnabled !== false;
    }
    return preferences.projectActivityEnabled !== false;
  });
}
