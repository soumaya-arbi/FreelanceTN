"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthModal } from "@/components/auth/AuthModal";
import { useUser } from "@/context/UserContext";
import { normalizeRole } from "@/lib/api";
import { homePathForRole } from "@/lib/navigation";

export default function LoginPage() {
  const router = useRouter();
  const { status, role } = useUser();

  // Une session valide ne doit jamais demander une nouvelle connexion :
  // l'utilisateur est renvoyé directement dans son espace.
  useEffect(() => {
    if (status === "authenticated") router.replace(homePathForRole(role));
  }, [status, role, router]);

  if (status === "authenticated") return null;

  return (
    <AuthModal
      initialSignup={false}
      close={() => router.push("/")}
      complete={(user) => router.push(homePathForRole(normalizeRole(user.role)))}
    />
  );
}
