"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { SessionError, SessionLoading } from "@/components/layout/SessionError";

// La console d'administration est une zone privée : elle exige une session
// valide vérifiée auprès de GET /api/auth/me (cookie httpOnly).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { status } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading" || status === "error") return;
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") return <SessionLoading />;
  if (status === "error") return <SessionError />;
  if (status !== "authenticated") return null;
  return <>{children}</>;
}
