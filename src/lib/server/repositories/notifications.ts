// Accès MongoDB du module notifications.
//
// La collection "notifications" stocke des champs PascalCase (modèle C#
// Notification). RecipientId est un ObjectId ; TaskId / ProjectId restent des
// chaînes. Aucune règle métier ici.

import { ObjectId } from "mongodb";
import { COLLECTIONS, getCollection } from "@/lib/server/db";
import { toObjectId } from "@/lib/server/serialize";

export type NotificationDocument = {
  _id: ObjectId;
  RecipientId?: ObjectId;
  Type?: string;
  Title?: string;
  Message?: string;
  TaskId?: string;
  ProjectId?: string;
  TaskTitle?: string;
  ProjectTitle?: string;
  ActorName?: string;
  IsRead?: boolean;
  CreatedAt?: Date;
};

export async function findNotificationsByRecipient(
  recipientId: string,
): Promise<NotificationDocument[]> {
  const objectId = toObjectId(recipientId);
  if (!objectId) return [];
  const notifications = await getCollection<NotificationDocument>(COLLECTIONS.notifications);
  return await notifications.find({ RecipientId: objectId }).sort({ CreatedAt: -1 }).toArray();
}

export async function findUnreadNotificationsByRecipient(
  recipientId: string,
): Promise<NotificationDocument[]> {
  const objectId = toObjectId(recipientId);
  if (!objectId) return [];
  const notifications = await getCollection<NotificationDocument>(COLLECTIONS.notifications);
  return await notifications
    .find({ RecipientId: objectId, IsRead: { $ne: true } })
    .sort({ CreatedAt: -1 })
    .toArray();
}

export async function markNotificationReadById(id: string, recipientId: string): Promise<void> {
  const notificationId = toObjectId(id);
  const recipientObjectId = toObjectId(recipientId);
  if (!notificationId || !recipientObjectId) return;
  const notifications = await getCollection<NotificationDocument>(COLLECTIONS.notifications);
  await notifications.updateOne(
    { _id: notificationId, RecipientId: recipientObjectId },
    { $set: { IsRead: true } },
  );
}

export async function markAllNotificationsReadByRecipient(recipientId: string): Promise<void> {
  const objectId = toObjectId(recipientId);
  if (!objectId) return;
  const notifications = await getCollection<NotificationDocument>(COLLECTIONS.notifications);
  await notifications.updateMany({ RecipientId: objectId }, { $set: { IsRead: true } });
}
