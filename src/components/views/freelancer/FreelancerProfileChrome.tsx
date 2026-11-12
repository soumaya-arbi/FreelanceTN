"use client";

import { AppShell } from "@/components/layout/AppShell";
import { useApp } from "@/context/AppContext";
import type { Page } from "@/lib/types";

export function FreelancerProfileChrome({
  children,
  page = "invitations",
}: {
  children: React.ReactNode;
  page?: Page;
}) {
  const { go, notify } = useApp();
  return (
    <AppShell page={page} go={go} notify={notify}>
      {children}
    </AppShell>
  );
}
