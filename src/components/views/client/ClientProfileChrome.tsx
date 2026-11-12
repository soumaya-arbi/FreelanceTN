"use client";

import { ClientShell } from "@/components/layout/ClientShell";
import { useApp } from "@/context/AppContext";

export function ClientProfileChrome({ children }: { children: React.ReactNode }) {
  const { go, notify } = useApp();
  return (
    <ClientShell page="client-talent" go={go} notify={notify}>
      {children}
    </ClientShell>
  );
}
