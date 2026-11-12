"use client";

import React, { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { useUser } from "@/context/UserContext";
import { feedbacksApi } from "@/lib/api";
import { formatReviewDate } from "@/lib/format";

const STEPS = ["Open", "In Progress", "Pending Approval", "Completed", "Feedback"];

function stepIndex(status: string, hasFeedback: boolean): number {
  const normalized = status?.trim().toLowerCase() ?? "open";
  if (normalized === "draft" || normalized === "cancelled") return -1;
  if (normalized === "open") return 0;
  if (normalized === "in progress") return 1;
  if (normalized === "client review") return 2;
  if (normalized === "completed") return hasFeedback ? 4 : 3;
  return 0;
}

export function ProjectPipeline({ project }: { project: Project }) {
  const { status: authStatus, authUser } = useUser();
  const [hasFeedback, setHasFeedback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (authStatus !== "authenticated" || !authUser?.id) return;
        // `mine` renvoie les demandes et évaluations du participant connecté :
        // l'étape Feedback n'est validée que si l'avis a réellement été soumis
        // (masqué ou publié), jamais sur une simple demande en attente.
        const rows = await feedbacksApi.mine();
        if (cancelled) return;
        setHasFeedback(
          rows.some(
            (item) =>
              item.projectId === project.id &&
              (item.status === "submitted_hidden" || item.status === "published"),
          ),
        );
      } catch {
        if (!cancelled) setHasFeedback(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authStatus, project.id, authUser?.id]);

  const current = stepIndex(project.status, hasFeedback);
  const progressPercent = current < 0 ? 0 : (current / (STEPS.length - 1)) * 100;

  return (
    <div className="project-pipeline">
      <div className="project-pipeline-track">
        <div className="project-pipeline-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="project-pipeline-steps">
        {STEPS.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <div
              key={step}
              className={`project-pipeline-step${done ? " is-done" : ""}${active ? " is-active" : ""}`}
            >
              <span className="project-pipeline-dot" />
              <span className="project-pipeline-label">{step}</span>
              {active && project.updatedAt && (
                <small className="project-pipeline-date">{formatReviewDate(project.updatedAt)}</small>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ProjectPipeline;