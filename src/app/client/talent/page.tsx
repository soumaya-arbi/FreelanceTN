"use client";

import { ClientDiscovery } from "@/components/views/client/ClientDiscovery";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";

export default function ClientTalentPage() {
  const { go, notify } = useApp();
  const router = useRouter();
  return (
    <ClientDiscovery
      go={go}
      notify={notify}
      openProject={(project) => router.push(`/projects/${project.id}`)}
    />
  );
}
