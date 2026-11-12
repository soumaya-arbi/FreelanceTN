"use server";

// Server Action du profil (PUT /api/auth/me).
//
// L'identité vient exclusivement de la session (requireUser) : aucun identifiant
// fourni par le client n'est accepté.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { updateProfile, type UpdateProfileInput } from "@/lib/server/services/profile";
import { requireUser } from "@/lib/server/session";

export async function updateMyProfile(
  input: UpdateProfileInput,
): Promise<ActionResult<Record<string, unknown>>> {
  return runAction(async () => {
    const user = await requireUser();
    const updated = await updateProfile(user.id, input);
    revalidateApp();
    return updated;
  });
}
