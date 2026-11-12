"use client";

import { useEffect, useMemo, useState } from "react";
import { notFound } from "next/navigation";
import { ProjectDetail } from "@/components/shared/ProjectDetail";
import { AppShell } from "@/components/layout/AppShell";
import { ClientShell } from "@/components/layout/ClientShell";
import { useApp } from "@/context/AppContext";
import { useUser } from "@/context/UserContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { ApiError, projectsApi } from "@/lib/api";
import type { Project } from "@/lib/types";

type FetchedProject = { id: string; project?: Project; error: string; missing?: boolean };

export function ProjectDetailRoute({ projectId, backPage = "projects" }: { projectId: string; backPage?: "projects" | "find-work" }) {
  const { projects, catalogProjects, assignedProjects } = useMarketplace();
  const { go, notify, openProject } = useApp();
  const { role, status } = useUser();
  const [fetched, setFetched] = useState<FetchedProject | null>(null);

  const known = useMemo(
    () => [...projects, ...catalogProjects, ...assignedProjects].find((item) => item.id === projectId),
    [assignedProjects, catalogProjects, projectId, projects],
  );

  useEffect(() => {
    if (!projectId || known) return;
    let cancelled = false;
    projectsApi
      .get(projectId)
      .then((row) => {
        if (cancelled) return;
        setFetched({ id: projectId, project: row, error: "" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetched({
          missing: err instanceof ApiError && err.status === 404,
          error: err instanceof ApiError ? err.message : "Impossible de charger ce projet.",
          id: projectId,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [known, projectId]);

  const result = known ? { id: projectId, project: known, error: "" } : fetched?.id === projectId ? fetched : null;
  const project = result?.project;
  const loading = Boolean(projectId) && !result;

  if (loading) {
    return <main className="project-detail-page"><div className="container"><p className="task-empty">Loading this project…</p></div></main>;
  }

  if (!project) {
    if (result?.missing) notFound();
    return <main className="project-detail-page"><div className="container"><div className="empty-state"><span>!</span><b>This project is not available</b><p>{result?.error}</p></div></div></main>;
  }

  const content = (
    <ProjectDetail
      project={project}
      go={go}
      notify={notify}
      backPage={backPage}
      openProject={openProject}
    />
  );

  if (status === "authenticated" && role === "freelancer") {
    return <AppShell page="orders" go={go} notify={notify} hideSidebarLogo>{content}</AppShell>;
  }
  if (status === "authenticated" && role === "client") {
    return <ClientShell page="client-projects" go={go} notify={notify} hideSidebarLogo>{content}</ClientShell>;
  }
  return content;
}