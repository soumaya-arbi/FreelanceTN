"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { homePathForRole } from "@/lib/navigation";
import { SessionError, SessionLoading } from "@/components/layout/SessionError";

// Garde de session pour l'espace freelance : la session est vérifiée auprès
// de GET /api/auth/me (cookie httpOnly), jamais déduite d'une valeur locale.
// Un compte client n'accède pas à l'espace freelance : il est renvoyé vers
// l'espace correspondant à son rôle.
export default function FreelancerLayout({ children }: { children: React.ReactNode }) {
  const { status, role } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading" || status === "error") return;
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (role !== "freelancer") {
      router.replace(homePathForRole(role));
    }
  }, [status, role, router]);

  if (status === "loading") return <SessionLoading />;
  if (status === "error") return <SessionError />;
  if (status !== "authenticated" || role !== "freelancer") return null;
  return <>{children}</>;
}
