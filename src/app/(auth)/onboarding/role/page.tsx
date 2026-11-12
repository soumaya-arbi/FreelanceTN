"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { homePathForRole } from "@/lib/navigation";

// Le rôle est choisi à l'inscription et stocké en base : cette ancienne étape
// d'onboarding ne demande plus rien à l'utilisateur, elle renvoie simplement
// vers l'espace correspondant au rôle du compte authentifié.
export default function RolePage() {
  const router = useRouter();
  const { status, role } = useUser();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    router.replace(homePathForRole(role));
  }, [status, role, router]);

  return null;
}
