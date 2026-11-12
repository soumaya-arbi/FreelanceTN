"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Stars } from "@/components/ui/Stars";
import {
  averageOfCriteria,
  criteriaForRole,
  emptyCriteria,
  ratedCriteriaCount,
  validateFeedbackSubmission,
} from "@/lib/feedback";
import type { SubmitFeedbackInput } from "@/lib/api";
import type { Role } from "@/lib/types";

/**
 * Formulaire d'évaluation partagé par le module Feedback et le parcours de
 * clôture de projet. Le contenu est identique quel que soit le point d'entrée :
 * cinq critères, un commentaire obligatoire, deux champs facultatifs et, côté
 * client uniquement, une recommandation oui/non.
 */
export function FeedbackForm({
  role,
  onSubmit,
  submitLabel,
  disabled = false,
}: {
  role: Role;
  onSubmit: (input: SubmitFeedbackInput) => Promise<void>;
  submitLabel?: string;
  disabled?: boolean;
}) {
  const criteria = criteriaForRole(role);
  const [scores, setScores] = useState<Record<string, number>>(() => emptyCriteria(role));
  const [comment, setComment] = useState("");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const rated = ratedCriteriaCount(scores);
  const total = criteria.length;
  const progress = Math.round((rated / total) * 100);
  const average = averageOfCriteria(scores);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || submitting) return;

    const input: SubmitFeedbackInput = {
      criteria: Object.fromEntries(criteria.map((criterion) => [criterion.key, scores[criterion.key] ?? 0])),
      comment: comment.trim(),
      strengths: strengths.trim() || undefined,
      improvements: improvements.trim() || undefined,
      recommend: role === "client" ? recommend : undefined,
    };

    const validation = validateFeedbackSubmission(role, input);
    if (validation) {
      setError(validation);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(input);
      setScores(emptyCriteria(role));
      setComment("");
      setStrengths("");
      setImprovements("");
      setRecommend(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "This review could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="feedback-form" onSubmit={submit}>
      <div className="feedback-progress" aria-live="polite">
        <span>
          {rated}/{total} criteria rated
          {average > 0 ? ` · average ${average.toFixed(2)} / 5` : ""}
        </span>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="feedback-criteria">
        {criteria.map((criterion) => {
          const value = scores[criterion.key] ?? 0;
          return (
            <div className="feedback-criterion" key={criterion.key}>
              <div>
                <b>{criterion.label}</b>
                <small>{criterion.hint}</small>
              </div>
              <div className="feedback-criterion-input">
                <Stars
                  rating={value}
                  onChange={(next) => {
                    setScores((current) => ({ ...current, [criterion.key]: next }));
                    setError("");
                  }}
                />
                <span>{value > 0 ? `${value} / 5` : "Not rated"}</span>
              </div>
            </div>
          );
        })}
      </div>

      <label className="editor-field">
        General comment (required)
        <textarea
          value={comment}
          maxLength={1000}
          onChange={(event) => {
            setComment(event.target.value);
            setError("");
          }}
          placeholder={
            role === "client"
              ? "What went well, and what should future clients know?"
              : "How did the collaboration with this client go?"
          }
        />
      </label>

      <div className="feedback-optional-fields">
        <label className="editor-field">
          {role === "client" ? "Strengths (optional)" : "Positive points (optional)"}
          <textarea
            value={strengths}
            maxLength={1000}
            onChange={(event) => setStrengths(event.target.value)}
            placeholder="What stood out positively?"
          />
        </label>
        <label className="editor-field">
          {role === "client" ? "Areas to improve (optional)" : "Areas to improve (optional)"}
          <textarea
            value={improvements}
            maxLength={1000}
            onChange={(event) => setImprovements(event.target.value)}
            placeholder="What could be better next time?"
          />
        </label>
      </div>

      {role === "client" && (
        <fieldset className="feedback-recommend">
          <legend>Would you recommend this freelancer?</legend>
          <div>
            <button
              type="button"
              className={recommend === true ? "active" : ""}
              aria-pressed={recommend === true}
              onClick={() => {
                setRecommend(true);
                setError("");
              }}
            >
              Yes, I recommend
            </button>
            <button
              type="button"
              className={recommend === false ? "active" : ""}
              aria-pressed={recommend === false}
              onClick={() => {
                setRecommend(false);
                setError("");
              }}
            >
              No, I do not
            </button>
          </div>
        </fieldset>
      )}

      <p className="feedback-publication-note">
        Your review stays private until both participants have submitted, or 14 days after the project was
        completed. It can no longer be edited once submitted.
      </p>

      {error && <p className="form-error" role="alert">{error}</p>}

      <Button type="submit" icon="check" disabled={disabled || submitting}>
        {submitting ? "Saving…" : submitLabel ?? "Submit review"}
      </Button>
    </form>
  );
}
