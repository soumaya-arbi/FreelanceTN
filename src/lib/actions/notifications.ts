"use server";

// Server Actions du module notifications.
// Le destinataire est toujours l'utilisateur de la session : aucun identifiant
// fourni par le client n'est utilisé pour choisir les données renvoyées.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { serialize } from "@/lib/server/serialize";
import { requireUser } from "@/lib/server/session";
import * as notificationsService from "@/lib/server/services/notifications";
import type { NotificationDto } from "@/lib/server/services/notifications";

export async function listNotifications(): Promise<ActionResult<NotificationDto[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await notificationsService.listNotifications(user)) as NotificationDto[];
  });
}

export async function unreadNotificationCount(): Promise<ActionResult<number>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await notificationsService.unreadNotificationCount(user)) as number;
  });
}

export async function markNotificationRead(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await notificationsService.markNotificationRead(user, id);
    revalidateApp();
    return serialize(null) as null;
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await notificationsService.markAllNotificationsRead(user);
    revalidateApp();
    return serialize(null) as null;
  });
}
