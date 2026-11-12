// Règles métier du module notifications.
// Port fidèle de backend/src/FreelanceTn.Api/Services/NotificationService.cs :
// les préférences du compte filtrent la lecture et le comptage des non-lues ;
// le marquage comme lu reste limité au destinataire.

import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import {
  filterNotifications,
  getNotificationPreferences,
} from "@/lib/server/notifications";
import { text } from "@/lib/server/serialize";
import {
  findNotificationsByRecipient,
  findUnreadNotificationsByRecipient,
  markAllNotificationsReadByRecipient,
  markNotificationReadById,
  type NotificationDocument,
} from "@/lib/server/repositories/notifications";

export type NotificationDto = {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  message: string;
  taskId: string;
  projectId: string;
  taskTitle: string;
  projectTitle: string;
  actorName: string;
  isRead: boolean;
  createdAt: string;
};

function idOf(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

/** Notification renvoyée par le contrôleur .NET (camelCase, dates ISO). */
export function toNotificationDto(doc: NotificationDocument): NotificationDto {
  return {
    id: idOf(doc._id),
    recipientId: idOf(doc.RecipientId),
    type: text(doc.Type),
    title: text(doc.Title),
    message: text(doc.Message),
    taskId: text(doc.TaskId),
    projectId: text(doc.ProjectId),
    taskTitle: text(doc.TaskTitle),
    projectTitle: text(doc.ProjectTitle),
    actorName: text(doc.ActorName),
    isRead: doc.IsRead === true,
    createdAt: iso(doc.CreatedAt),
  };
}

export async function listNotifications(user: SessionUser): Promise<NotificationDto[]> {
  const preferences = await getNotificationPreferences(user.id);
  const items = await findNotificationsByRecipient(user.id);
  return filterNotifications(items, preferences).map(toNotificationDto);
}

export async function unreadNotificationCount(user: SessionUser): Promise<number> {
  const preferences = await getNotificationPreferences(user.id);
  const items = await findUnreadNotificationsByRecipient(user.id);
  return filterNotifications(items, preferences).length;
}

export async function markNotificationRead(user: SessionUser, id: string): Promise<void> {
  await markNotificationReadById(id, user.id);
}

export async function markAllNotificationsRead(user: SessionUser): Promise<void> {
  await markAllNotificationsReadByRecipient(user.id);
}
