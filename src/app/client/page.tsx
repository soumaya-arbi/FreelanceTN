"use client";

import { useRouter } from "next/navigation";
import { ClientDashboard } from "@/components/views/client/ClientDashboard";
import { useApp } from "@/context/AppContext";

export default function ClientHomePage() {
  const { go, notify, setInvitee } = useApp();
  const router = useRouter();
  return (
    <ClientDashboard
      go={go}
      notify={notify}
      invite={(id, name) => {
        setInvitee(name);
        // L'identifiant réel est utilisé : le slug du nom ne correspond pas à
        // une clé d'API et ne peut pas être résolu de façon fiable.
        router.push(`/client/invite/${id}`);
      }}
    />
  );
}
