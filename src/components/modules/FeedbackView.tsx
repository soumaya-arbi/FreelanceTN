"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { ModuleShell } from "@/components/modules/ModuleShell";
import { FeedbackForm } from "@/components/shared/FeedbackForm";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { ApiError, feedbacksApi } from "@/lib/api";
import {
  criterionLabel,
  feedbackAuthor,
  feedbackCounterpart,
  feedbackStatusLabel,
  feedbackStatusTone,
  publicationLabel,
} from "@/lib/feedback";
import { formatReviewDate } from "@/lib/format";
import type { SubmitFeedbackInput } from "@/lib/api";
import type { Feedback, FeedbackSummary, Role } from "@/lib/types";

function StatusBadge({ item }: { item: Feedback }) {
  return (
    <span className={`feedback-status ${feedbackStatusTone(item.status)}`}>
      {feedbackStatusLabel(item.status)}
    </span>
  );
}

function CriteriaSummary({ item }: { item: Feedback }) {
  const entries = Object.entries(item.criteria ?? {}).filter(([, value]) => value >= 1);
  if (entries.length === 0) return null;
  return (
    <div className="feedback-criteria-summary">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{criterionLabel(key)}</span>
          <b>{value} / 5</b>
        </div>
      ))}
    </div>
  );
}

function ReviewCard({ item, received }: { item: Feedback; received: boolean }) {
  return (
    <article className="dash-card feedback-card">
      <header>
        <div>
          <b>{received ? feedbackAuthor(item) : feedbackCounterpart(item)}</b>
          <small>
            {received ? "Review received" : "Review given"} ·{" "}
            {formatReviewDate(item.publishedAt || item.submittedAt || item.createdAt)}
          </small>
        </div>
        <Stars rating={item.rating || Math.round(item.averageRating ?? 0)} />
      </header>
      <div className="feedback-tags">
        <span className={received ? "positive" : ""}>{item.projectTitle || "Completed project"}</span>
        {item.recommend === true && <span className="positive">Recommended</span>}
        {item.recommend === false && <span className="negative">Not recommended</span>}
      </div>
      {item.comment && <p>{item.comment}</p>}
      {item.strengths && <p><b>Strengths:</b> {item.strengths}</p>}
      {item.improvements && <p><b>To improve:</b> {item.improvements}</p>}
      <CriteriaSummary item={item} />
      <footer>
        <span><Icon name="briefcase" size={13} /> {item.projectTitle || "Completed project"}</span>
        <span>{item.averageRating ? `${item.averageRating.toFixed(2)} / 5` : `${item.rating} / 5`}</span>
      </footer>
    </article>
  );
}

export function FeedbackView({ role }: { role: Role }) {
  const { notify } = useApp();
  const { authUser, status } = useUser();
  const { feedback, refreshFeedback, submitFeedback, feedbackLoading, feedbackError } = useMarketplace();

  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [actionError, setActionError] = useState("");

  // Les demandes et les avis de l'utilisateur viennent de GET /api/feedbacks/mine.
  // La réputation publique vient de GET /api/feedbacks/summary : seuls les avis
  // publiés y sont comptés, jamais les avis masqués ni les demandes en attente.
  useEffect(() => {
    if (status === "authenticated") void refreshFeedback();
  }, [refreshFeedback, status]);

  useEffect(() => {
    if (status !== "authenticated" || !authUser?.id) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError("");
    feedbacksApi
      .summary(authUser.id)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSummary(null);
          setSummaryError(error instanceof ApiError ? error.message : "Reviews could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, status]);

  const requests = useMemo(
    () => feedback.filter((item) => (item.status ?? "published") === "awaiting_review"),
    [feedback],
  );
  const hidden = useMemo(() => feedback.filter((item) => item.status === "submitted_hidden"), [feedback]);
  const given = useMemo(
    () => feedback.filter((item) => (item.status ?? "published") === "published"),
    [feedback],
  );
  const expired = useMemo(() => feedback.filter((item) => item.status === "expired"), [feedback]);
  const received = useMemo(() => summary?.reviews ?? [], [summary]);

  const completed = hidden.length + given.length;
  const totalRequests = requests.length + completed + expired.length;

  const submit = async (projectId: string, input: SubmitFeedbackInput) => {
    setActionError("");
    try {
      await submitFeedback(projectId, input);
      await refreshFeedback();
      if (authUser?.id) {
        feedbacksApi.summary(authUser.id).then(setSummary).catch(() => undefined);
      }
      notify("Review saved. It stays private until it is published.");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "This review could not be submitted.";
      setActionError(message);
      notify(message);
      throw error;
    }
  };

  const averageRating = summary?.averageRating ?? 0;
  const distribution = summary?.distribution ?? [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0 }));

  return (
    <ModuleShell role={role} page="feedback">
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>{role === "client" ? "CLIENT WORKSPACE" : "FREELANCER WORKSPACE"}</p>
            <h1>Feedback</h1>
            <span>
              Double-blind reviews: each side answers separately, and both reviews are published at the same time.
            </span>
          </div>
        </div>

        <div className="feedback-layout">
          <section className="dash-card feedback-score">
            <div className="rating-large"><Icon name="star" /><b>{summaryLoading ? "—" : averageRating.toFixed(1)}</b></div>
            <small>
              {summaryLoading
                ? "Loading reviews…"
                : summary && summary.count > 0
                  ? `Average across ${summary.count} published review${summary.count > 1 ? "s" : ""}`
                  : "No published review yet"}
            </small>
            {distribution.map(({ stars, count }) => (
              <div className="rating-bar" key={stars}>
                <span>{stars} star</span>
                <div><i style={{ width: `${summary && summary.count > 0 ? (count / summary.count) * 100 : 0}%` }} /></div>
                <b>{count}</b>
              </div>
            ))}
            {summary && summary.criteriaReviewCount > 0 && (
              <div className="feedback-criteria-summary">
                {Object.entries(summary.criteriaAverages).map(([key, value]) => (
                  <div key={key}><span>{criterionLabel(key)}</span><b>{value.toFixed(2)} / 5</b></div>
                ))}
              </div>
            )}
            {summary?.recommendationRate !== null && summary?.recommendationRate !== undefined && (
              <small>{summary.recommendationRate}% of clients recommend this profile</small>
            )}
          </section>

          <section className="dash-card">
            <div className="editor-heading">
              <h2>Your review activity</h2>
              <p>Every completed project gives one review request to each participant.</p>
            </div>
            <div className="feedback-criteria-summary">
              <div><span>Requests to complete</span><b>{requests.length}</b></div>
              <div><span>Submitted, awaiting publication</span><b>{hidden.length}</b></div>
              <div><span>Published</span><b>{given.length}</b></div>
              <div><span>Deadline passed</span><b>{expired.length}</b></div>
            </div>
            <div className="feedback-progress">
              <span>
                {totalRequests > 0
                  ? `${completed} of ${totalRequests} review${totalRequests > 1 ? "s" : ""} submitted`
                  : "No review request yet"}
              </span>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={totalRequests > 0 ? Math.round((completed / totalRequests) * 100) : 0}
              >
                <i style={{ width: `${totalRequests > 0 ? (completed / totalRequests) * 100 : 0}%` }} />
              </div>
            </div>
            {(summaryError || feedbackError) && <p className="task-empty">{summaryError || feedbackError}</p>}
          </section>
        </div>

        {actionError && <p className="form-error" role="alert">{actionError}</p>}

        <section className="feedback-section">
          <header>
            <div>
              <h2>Reviews to complete</h2>
              <p>Only projects marked as Completed appear here. Each review can be submitted once.</p>
            </div>
          </header>
          {feedbackLoading ? (
            <p className="task-empty">Loading feedback…</p>
          ) : requests.length === 0 ? (
            <p className="task-empty">No review is currently expected from you.</p>
          ) : (
            <div className="feedback-request">
              {requests.map((item) => (
                <article className="dash-card" key={item.id}>
                  <div className="feedback-request-meta">
                    <div>
                      <h3>{item.projectTitle || "Completed project"}</h3>
                      <small>
                        Review for {feedbackCounterpart(item)} · {publicationLabel(item)}
                      </small>
                    </div>
                    <StatusBadge item={item} />
                  </div>
                  <FeedbackForm
                    role={role}
                    submitLabel="Submit review"
                    onSubmit={(input) => submit(item.projectId, input)}
                  />
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="feedback-section">
          <header>
            <div>
              <h2>Submitted — awaiting publication</h2>
              <p>
                Your review is saved but hidden from {role === "client" ? "the freelancer" : "the client"} until the
                other review is submitted or the 14-day window closes. It cannot be edited.
              </p>
            </div>
          </header>
          {hidden.length === 0 ? (
            <p className="task-empty">No review is currently awaiting publication.</p>
          ) : (
            <div className="feedback-list">
              {hidden.map((item) => (
                <article className="dash-card feedback-card" key={item.id}>
                  <header>
                    <div>
                      <b>{feedbackCounterpart(item)}</b>
                      <small>{item.projectTitle || "Completed project"}</small>
                    </div>
                    <StatusBadge item={item} />
                  </header>
                  <div className="feedback-tags">
                    <span>Visible to you only</span>
                    {item.recommend === true && <span className="positive">Recommended</span>}
                    {item.recommend === false && <span className="negative">Not recommended</span>}
                  </div>
                  <p>{item.comment || "No comment provided."}</p>
                  <CriteriaSummary item={item} />
                  <footer>
                    <span><Icon name="clock" size={13} /> {publicationLabel(item)}</span>
                    <span>{item.averageRating ? `${item.averageRating.toFixed(2)} / 5` : `${item.rating} / 5`}</span>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="feedback-section">
          <header>
            <div>
              <h2>Published reviews</h2>
              <p>Reviews given and received, visible on profiles.</p>
            </div>
          </header>
          {given.length === 0 && received.length === 0 ? (
            <p className="task-empty">No published review yet.</p>
          ) : (
            <div className="feedback-list">
              {given.map((item) => <ReviewCard item={item} received={false} key={item.id} />)}
              {received.map((item) => <ReviewCard item={item} received key={item.id} />)}
            </div>
          )}
        </section>

        {expired.length > 0 && (
          <section className="feedback-section">
            <header>
              <div>
                <h2>Deadline passed</h2>
                <p>No review was submitted within the 14-day window. No review is created automatically.</p>
              </div>
            </header>
            <div className="feedback-list">
              {expired.map((item) => (
                <article className="dash-card feedback-card" key={item.id}>
                  <header>
                    <div>
                      <b>{item.projectTitle || "Completed project"}</b>
                      <small>{publicationLabel(item)}</small>
                    </div>
                    <StatusBadge item={item} />
                  </header>
                  <p>This review request expired without a submission.</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </ModuleShell>
  );
}
