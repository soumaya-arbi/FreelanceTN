"use server";

// Server Actions du module Account Settings.
//
// Le profil client et la facturation sont réservés aux comptes client (même
// contrôle que AccountController.RequireClient) ; l'avatar, les préférences,
// l'historique et l'export sont accessibles à tout compte authentifié. Le
// profil public est anonyme, comme la route /api/account/public/{id}.

import type { ActionResult } from "@/lib/actions/types";
import { forbidden, runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { serialize } from "@/lib/server/serialize";
import { requireUser, type SessionUser } from "@/lib/server/session";
import {
  exportAccount as exportAccountService,
  getAccountHistory as getAccountHistoryService,
  getBillingProfile as getBillingProfileService,
  getClientProfile as getClientProfileService,
  getNotificationPreferences as getNotificationPreferencesService,
  getPublicClientProfile as getPublicClientProfileService,
  getUserPreferences as getUserPreferencesService,
  setAvatarStyle as setAvatarStyleService,
  updateBillingProfile as updateBillingProfileService,
  updateClientProfile as updateClientProfileService,
  updateNotificationPreferences as updateNotificationPreferencesService,
  updateUserPreferences as updateUserPreferencesService,
} from "@/lib/server/services/account";

async function requireClientAccount(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "client") {
    throw forbidden("Cette fonctionnalité est réservée aux comptes client.");
  }
  return user;
}

export async function getClientProfile(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireClientAccount();
    const profile = await getClientProfileService(user);
    return serialize(profile);
  });
}

export async function updateClientProfile(
  input: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireClientAccount();
    const profile = await updateClientProfileService(user, input);
    revalidateApp();
    return serialize(profile);
  });
}

export async function setAvatarStyle(input: {
  source?: "initials" | "preset" | "upload" | "generated";
  preset?: string;
  color?: string;
  config?: string;
}): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const profile = await setAvatarStyleService(user, input);
    revalidateApp();
    return serialize(profile);
  });
}

export async function getBillingProfile(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireClientAccount();
    const billing = await getBillingProfileService(user);
    return serialize(billing);
  });
}

export async function updateBillingProfile(
  input: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireClientAccount();
    const billing = await updateBillingProfileService(user, input);
    revalidateApp();
    return serialize(billing);
  });
}

export async function getNotificationPreferencesAction(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const preferences = await getNotificationPreferencesService(user);
    return serialize(preferences);
  });
}

export async function updateNotificationPreferences(
  input: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const preferences = await updateNotificationPreferencesService(user, input);
    revalidateApp();
    return serialize(preferences);
  });
}

export async function getUserPreferences(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const preferences = await getUserPreferencesService(user);
    return serialize(preferences);
  });
}

export async function updateUserPreferences(
  input: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const preferences = await updateUserPreferencesService(user, input);
    revalidateApp();
    return serialize(preferences);
  });
}

export async function getAccountHistory(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const history = await getAccountHistoryService(user);
    return serialize(history);
  });
}

export async function exportAccount(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const payload = await exportAccountService(user);
    return serialize(payload);
  });
}

export async function getPublicClientProfile(id: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const profile = await getPublicClientProfileService(id);
    return serialize(profile);
  });
}
