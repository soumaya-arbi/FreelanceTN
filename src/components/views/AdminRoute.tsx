"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { homePathForRole } from "@/lib/navigation";

/**
 * L'ancienne console d'administration n'était reliée à aucune source de
 * données. Son entrée de navigation a été retirée : une visite directe de
 * /admin renvoie vers l'espace réel du compte au lieu d'afficher une page vide.
 */
export function AdminRoute(_props: { section?: string }) {
  const { role, status } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace(homePathForRole(role));
  }, [status, role, router]);

  return null;
}
