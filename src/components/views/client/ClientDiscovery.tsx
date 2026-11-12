"use client";

import { useRouter } from "next/navigation";
import { ClientShell } from "@/components/layout/ClientShell";
import { Directory } from "@/components/shared/Directory";
import type { Page, Project } from "@/lib/types";

function ClientDiscovery({
  go,
  notify,
  openProject,
}: {
  go: (p: Page) => void;
  notify: (x: string) => void;
  openProject: (project: Project) => void;
}) {
  const router = useRouter();
  return (
    <ClientShell page="client-talent" go={go} notify={notify}>
      <Directory
        kind="freelancers"
        go={go}
        notify={notify}
        openProject={openProject}
        openFreelancer={(f) => router.push(`/client/talent/${f.id}${typeof window !== "undefined" ? window.location.search : ""}`)}
      />
    </ClientShell>
  );
}

export { ClientDiscovery };
