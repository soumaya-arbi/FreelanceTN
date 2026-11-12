"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { homePathForRole } from "@/lib/navigation";
import { SessionError, SessionLoading } from "@/components/layout/SessionError";

// Garde de session pour l'espace client : la session est vérifiée auprès de
// GET /api/auth/me (cookie httpOnly), jamais déduite d'une valeur locale.
// Un compte freelance n'accède pas à l'espace client : il est renvoyé vers
// l'espace correspondant à son rôle.
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { status, role } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading" || status === "error") return;
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (role !== "client") {
      router.replace(homePathForRole(role));
    }
  }, [status, role, router]);

  if (status === "loading") return <SessionLoading />;
  if (status === "error") return <SessionError />;
  if (status !== "authenticated" || role !== "client") return null;
  return <>{children}</>;
}
