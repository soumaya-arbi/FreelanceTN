"use client";

import { AppShell } from "@/components/layout/AppShell";
import { Directory } from "@/components/shared/Directory";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";

export default function FindWorkPage() {
  const { go, notify, openProject } = useApp();
  const router = useRouter();
  return (
    <AppShell page="find-work" go={go} notify={notify}>
      <Directory
        kind="projects"
        go={go}
        notify={notify}
        openProject={(project) => {
          openProject(project);
          router.prefetch(`/projects/${project.id}`);
        }}
      />
    </AppShell>
  );
}
