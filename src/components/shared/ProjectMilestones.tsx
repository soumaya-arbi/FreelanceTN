"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/Form";
import type { Project } from "@/lib/types";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { ApiError } from "@/lib/api";
import { formatReviewDate } from "@/lib/format";

type FormMode = "progress" | "approve" | "changes" | "comment";

export function ProjectMilestones({
  project,
  notify,
}: {
  project: Project;
  notify?: (message: string) => void;
}) {
  const { milestoneAction, reopenProject } = useMarketplace();
  const { status: authStatus, authUser } = useUser();
  const isOwner = authStatus === "authenticated" && authUser?.id === project.ownerId;
  const isAssigned =
    authStatus === "authenticated" && authUser?.id === project.assignedTo;

  const milestones = project.milestones ?? [];
  const history = (project.milestoneHistory ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const [active, setActive] = useState<{ milestoneId: string; mode: FormMode } | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [draftProgress, setDraftProgress] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMessage, setReopenMessage] = useState("");
  if (!isOwner && !isAssigned) return null;

  const start = (milestoneId: string, mode: FormMode) => {
    const milestone = milestones.find((item) => item.id === milestoneId);
    setActive({ milestoneId, mode });
    setDraftMessage("");
    setDraftProgress(String(milestone?.progress ?? 0));
    setError("");
  };

  const submit = async () => {
    if (!active) return;
    const milestone = milestones.find((item) => item.id === active.milestoneId);
    if (!milestone) return;
    const message = draftMessage.trim();
    if (active.mode === "changes" && message.length < 5) {
      setError("Explain what needs to change (at least 5 characters).");
      return;
    }
    if (active.mode === "comment" && message.length === 0) {
      setError("A message is required.");
      return;
    }
    const action =
      active.mode === "progress"
        ? "progress"
        : active.mode === "approve"
          ? "approve"
          : active.mode === "changes"
            ? "request-changes"
            : "comment";
    setBusy(true);
    setError("");
    try {
      await milestoneAction(project.id, milestone.id, {
        action,
        message: message || undefined,
        progress: active.mode === "progress" ? Number(draftProgress) : undefined,
      });
      notify?.("Milestone updated");
      setActive(null);
      setDraftMessage("");
    } catch (err) {
      const text = err instanceof ApiError ? err.message : "The milestone could not be updated.";
      setError(text);
      notify?.(text);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!window.confirm("Reopen this completed project? The freelancer will be notified.")) return;
    setBusy(true);
    setError("");
    try {
      await reopenProject(project.id, reopenMessage.trim() || undefined);
      notify?.("Project reopened");
      setReopenOpen(false);
      setReopenMessage("");
    } catch (err) {
      const text = err instanceof ApiError ? err.message : "The project could not be reopened.";
      setError(text);
      notify?.(text);
    } finally {
      setBusy(false);
    }
  };

  const statusTone = (status: string) => {
    const value = status.toLowerCase();
    if (value.includes("approved") || value.includes("completed")) return "done";
    if (value.includes("changes")) return "reviewing";
    if (value.includes("submitted")) return "reviewing";
    return "";
  };

  return (
    <div className="detail-section">
      <h2>Project milestones</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {milestones.length === 0 ? (
        <p className="task-empty">No milestones have been created for this project yet.</p>
      ) : (
        <div className="milestone-list">
          {milestones.map((milestone) => (
            <article className="milestone-card" key={milestone.id}>
              <div className="milestone-head">
                <b>{milestone.title}</b>
                <em className={`milestone-status ${statusTone(milestone.status)}`}>{milestone.status}</em>
              </div>
              <div className="milestone-progress">
                <i style={{ width: `${Math.max(0, Math.min(100, milestone.progress))}%` }} />
              </div>
              <small className="milestone-meta">
                {milestone.progress}% complete
                {milestone.date ? ` · ${milestone.date.slice(0, 10)}` : ""}
              </small>
              <div className="milestone-actions">
                {isAssigned && !["Approved", "Completed"].includes(milestone.status) && (
                  <button type="button" onClick={() => start(milestone.id, "progress")}>
                    Update progress
                  </button>
                )}
                {isOwner && !["Approved", "Completed"].includes(milestone.status) && (
                  <>
                    <button type="button" onClick={() => start(milestone.id, "approve")}>
                      Approve
                    </button>
                    <button type="button" onClick={() => start(milestone.id, "changes")}>
                      Request changes
                    </button>
                  </>
                )}
                <button type="button" onClick={() => start(milestone.id, "comment")}>
                  Comment
                </button>
              </div>
              {active?.milestoneId === milestone.id && (
                <div className="milestone-form">
                  {active.mode === "progress" && (
                    <FormField label="Progress (%)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={draftProgress}
                        onChange={(e) => setDraftProgress(e.target.value)}
                      />
                    </FormField>
                  )}
                  <FormField
                    label={
                      active.mode === "approve"
                        ? "Approval message (optional)"
                        : active.mode === "changes"
                          ? "What needs to change?"
                          : "Message"
                    }
                  >
                    <textarea
                      rows={3}
                      value={draftMessage}
                      onChange={(e) => setDraftMessage(e.target.value)}
                      placeholder={
                        active.mode === "changes"
                          ? "Describe the corrections the freelancer should make…"
                          : "Write a message…"
                      }
                    />
                  </FormField>
                  <div className="delivery-review-actions">
                    <Button onClick={submit} disabled={busy}>
                      {busy ? "Saving…" : "Send"}
                    </Button>
                    <Button variant="secondary" onClick={() => setActive(null)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="milestone-history">
          <h3>Chronological history</h3>
          {history.map((entry) => (
            <div className="milestone-history-item" key={entry.id}>
              <div className="milestone-history-head">
                <b>{entry.authorName || "User"}</b>
                <span className="comment-role">
                  {entry.authorRole === "client" ? "Client" : "Freelance"}
                </span>
                <small>{formatReviewDate(entry.createdAt)}</small>
              </div>
              {entry.milestoneTitle && (
                <small className="milestone-history-title">{entry.milestoneTitle}</small>
              )}
              <p>{entry.message}</p>
            </div>
          ))}
        </div>
      )}

      {isOwner && project.status === "Completed" && (
        <div className="milestone-reopen">
          {!reopenOpen ? (
            <Button variant="secondary" onClick={() => setReopenOpen(true)}>
              Reopen project
            </Button>
          ) : (
            <div className="revision-box">
              <FormField label="Why are you reopening this project? (optional)">
                <textarea
                  rows={3}
                  value={reopenMessage}
                  onChange={(e) => setReopenMessage(e.target.value)}
                  placeholder="Explain what needs to be done…"
                />
              </FormField>
              <div className="delivery-review-actions">
                <Button onClick={reopen} disabled={busy}>
                  {busy ? "Saving…" : "Confirm reopen"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setReopenOpen(false);
                    setReopenMessage("");
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ProjectMilestones;