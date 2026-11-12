"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import type { Project, Comment } from "@/lib/types";
import { useUser } from "@/context/UserContext";
import { ApiError, commentsApi } from "@/lib/api";
import { formatReviewDate } from "@/lib/format";

export function ProjectDiscussion({
  project,
  notify,
}: {
  project: Project;
  notify?: (s: string) => void;
}) {
  const { status: authStatus, role, authUser } = useUser();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isFreelancer = authStatus === "authenticated" && role === "freelancer";
  const isOwner = authUser?.id === project.ownerId;
  const isOpen = project.status === "Open";
  const isInProgress = project.status === "In progress";
  const canComment =
    authStatus === "authenticated" &&
    (isOpen || isInProgress) &&
    (isOwner ||
      (isFreelancer &&
        (isOpen || (isInProgress && authUser?.id === project.assignedTo))));

  useEffect(() => {
    let cancelled = false;
    commentsApi
      .forProject(project.id)
      .then((rows) => {
        if (cancelled) return;
        setComments([...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Impossible de charger la discussion.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !text.trim()) return;
    setError("");
    setSaving(true);
    try {
      const created = await commentsApi.create(project.id, text.trim());
      setComments((prev) =>
        [...prev, created].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      );
      setText("");
      notify?.("Message publié");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Votre message n'a pas pu être publié.";
      setError(message);
      notify?.(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="detail-section">
      <h2>Discussion du projet</h2>
      {loading ? (
        <p className="task-empty">Chargement de la discussion…</p>
      ) : error && comments.length === 0 ? (
        <p className="task-empty">{error}</p>
      ) : comments.length === 0 ? (
        <p className="task-empty">Aucun message pour le moment. Démarrez la discussion.</p>
      ) : (
        <div className="comment-list">
          {comments.map((item) => (
            <div className="comment-bubble" key={item.id}>
              <div className="comment-avatar">
                {item.authorAvatar ? (
                  <img src={item.authorAvatar} alt={item.authorName} />
                ) : (
                  <span>{(item.authorName || "?").charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="comment-body">
                <div className="comment-head">
                  <b>{item.authorName || "Utilisateur"}</b>
                  <span className="comment-role">
                    {item.authorRole === "client" ? "Client" : "Freelance"}
                  </span>
                  <small>{formatReviewDate(item.createdAt)}</small>
                </div>
                <p>{item.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && comments.length > 0 && <p className="form-error" role="alert">{error}</p>}
      {canComment ? (
        <form className="comment-form" onSubmit={submit}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Écrire un message…"
            maxLength={2000}
            rows={3}
          />
          <Button type="submit" disabled={saving || !text.trim()}>
            {saving ? "Publication…" : "Publier"}
          </Button>
        </form>
      ) : authStatus !== "authenticated" ? (
        <p className="apply-note">
          <Icon name="shield" size={14} /> Connectez-vous pour participer à la discussion.
        </p>
      ) : !(isOpen || isInProgress) ? (
        <p className="apply-note">
          <Icon name="shield" size={14} /> La discussion est en lecture seule pour ce projet.
        </p>
      ) : (
        <p className="apply-note">
          <Icon name="shield" size={14} /> Vous n'êtes pas autorisé à participer à cette discussion.
        </p>
      )}
    </div>
  );
}

export default ProjectDiscussion;
