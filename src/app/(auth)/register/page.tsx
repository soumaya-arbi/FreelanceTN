"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthModal } from "@/components/auth/AuthModal";
import { useUser } from "@/context/UserContext";
import { normalizeRole } from "@/lib/api";
import { homePathForRole } from "@/lib/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const { status, role } = useUser();

  // Un compte déjà connecté n'a pas besoin de repasser par l'inscription.
  useEffect(() => {
    if (status === "authenticated") router.replace(homePathForRole(role));
  }, [status, role, router]);

  if (status === "authenticated") return null;

  return (
    <AuthModal
      initialSignup={true}
      close={() => router.push("/")}
      complete={(user) => router.push(homePathForRole(normalizeRole(user.role)))}
    />
  );
}
