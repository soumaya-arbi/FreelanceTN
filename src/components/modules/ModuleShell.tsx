"use client";

import { AppShell } from "@/components/layout/AppShell";
import { ClientShell } from "@/components/layout/ClientShell";
import { useApp } from "@/context/AppContext";
import type { Page, Role } from "@/lib/types";

export function ModuleShell({ role, page, children }: { role: Role; page: Page; children: React.ReactNode }) {
  const { go, notify } = useApp();
  if (role === "client") {
    const clientPageMap: Partial<Record<Page, Page>> = {
      feedback: "client-feedback",
      quotes: "client-quotes",
      invoices: "client-invoices",
      tasks: "client-tasks",
    };
    return (
      <ClientShell page={clientPageMap[page] ?? page} go={go} notify={notify}>
        {children}
      </ClientShell>
    );
  }
  return (
    <AppShell page={page} go={go} notify={notify}>
      {children}
    </AppShell>
  );
}
