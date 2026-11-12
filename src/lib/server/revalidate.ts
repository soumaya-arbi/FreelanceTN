// Invalidation du cache Next après mutation.
//
// Les écrans chargent leurs données via src/lib/api.ts (Server Actions). On
// invalide l'ensemble du layout applicatif pour que les Server Components qui
// lisent les mêmes collections repartent d'un état frais après chaque écriture.

import { revalidatePath } from "next/cache";

export function revalidateApp(): void {
  try {
    revalidatePath("/", "layout");
  } catch {
    // Appel hors requête (test unitaire) : sans effet, jamais bloquant.
  }
}
