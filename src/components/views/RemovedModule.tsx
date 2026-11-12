"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { homePathForRole } from "@/lib/navigation";

/**
 * Modules retirés de l'interface car aucune opération serveur ne les prend en
 * charge (messages, contrats internes, support, analyses, disponibilité,
 * vérification, avis). Une visite directe de leur ancienne adresse renvoie
 * vers l'espace réel du compte plutôt que d'afficher une page factice.
 */
export function RemovedModule() {
  const { role, status } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace(homePathForRole(role));
    else if (status === "unauthenticated") router.replace("/login");
  }, [role, router, status]);

  return null;
}
