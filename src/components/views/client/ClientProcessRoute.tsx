"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ClientProcess } from "@/components/views/client/ClientProcess";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { ApiError, projectsApi } from "@/lib/api";
import type { ClientProcessMode, Project } from "@/lib/types";

type LoadedProject = { id: string; project?: Project; error: string };

// Étapes qui reposent sur un projet client.
const projectModes: ClientProcessMode[] = ["project", "proposal", "contract", "workspace", "review"];

export function ClientProcessRoute({ mode }: { mode: ClientProcessMode }) {
  const { go, notify } = useApp();
  const { projects } = useMarketplace();
  const params = useParams<{ id?: string }>();
  const projectId = projectModes.includes(mode) ? (params?.id ?? "") : "";
  const [loadedProject, setLoadedProject] = useState<LoadedProject | null>(null);

  // Le projet affiché est celui du client connecté : il est repris de la liste
  // des projets du compte (mise à jour immédiate après une action) et, à
  // défaut, chargé par son identifiant.
  const knownProject = useMemo(
    () => projects.find((item) => item.id === projectId),
    [projectId, projects],
  );

  useEffect(() => {
    if (!projectId || knownProject) return;
    let cancelled = false;
    projectsApi
      .get(projectId)
      .then((row) => {
        if (cancelled) return;
        setLoadedProject({ id: projectId, project: row, error: "" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadedProject({
          id: projectId,
          error: err instanceof ApiError ? err.message : "This project is no longer available.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [knownProject, projectId]);

  const currentProject = knownProject
    ? { id: projectId, project: knownProject, error: "" }
    : loadedProject && loadedProject.id === projectId
      ? loadedProject
      : null;
  const projectLoading = Boolean(projectId) && !currentProject;

  return (
    <ClientProcess
      initialMode={mode}
      go={go}
      notify={notify}
      project={currentProject?.project}
      projectLoading={projectLoading}
      projectError={currentProject?.error ?? ""}
    />
  );
}
