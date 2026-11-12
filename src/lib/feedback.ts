// Règles d'affichage et de validation du module Feedback bidirectionnel.
//
// Le backend .NET reste la source de vérité : ces helpers ne font que
// préparer le formulaire, calculer une progression locale et traduire les
// statuts. Aucune donnée d'avis n'est inventée ici.

import type { SubmitFeedbackInput } from "@/lib/api";
import type { Feedback, FeedbackStatus, Role } from "@/lib/types";

export type FeedbackCriterion = {
  key: string;
  label: string;
  hint: string;
};

// Client -> freelancer. Les clés correspondent à FeedbackCriteria.ClientToFreelancer.
export const CLIENT_FEEDBACK_CRITERIA: FeedbackCriterion[] = [
  { key: "quality", label: "Quality of work", hint: "Delivered work meets the expected standard." },
  { key: "deadlines", label: "Deadlines", hint: "Milestones and delivery dates were respected." },
  { key: "communication", label: "Communication", hint: "Updates, questions and feedback were clear." },
  { key: "professionalism", label: "Professionalism", hint: "Reliability, attitude and conduct." },
  { key: "specifications", label: "Adherence to the brief", hint: "The agreed requirements were followed." },
];

// Freelancer -> client. Les clés correspondent à FeedbackCriteria.FreelancerToClient.
export const FREELANCER_FEEDBACK_CRITERIA: FeedbackCriterion[] = [
  { key: "requirementsClarity", label: "Clarity of requirements", hint: "The brief was precise and actionable." },
  { key: "communication", label: "Communication", hint: "Exchanges were clear and responsive." },
  { key: "validationSpeed", label: "Speed of validations", hint: "Deliverables were reviewed promptly." },
  { key: "professionalism", label: "Professionalism", hint: "Reliability and respect during the project." },
  { key: "collaboration", label: "Collaboration quality", hint: "Working together felt constructive." },
];

export const FEEDBACK_COMMENT_MAX = 1000;
export const FEEDBACK_OPTIONAL_MAX = 1000;

export function criteriaForRole(role: Role): FeedbackCriterion[] {
  return role === "client" ? CLIENT_FEEDBACK_CRITERIA : FREELANCER_FEEDBACK_CRITERIA;
}

/** Libellé d'un critère à partir de sa clé stable (les deux directions). */
export function criterionLabel(key: string): string {
  const criterion =
    CLIENT_FEEDBACK_CRITERIA.find((item) => item.key === key) ??
    FREELANCER_FEEDBACK_CRITERIA.find((item) => item.key === key);
  return criterion?.label ?? key;
}

export function emptyCriteria(role: Role): Record<string, number> {
  return Object.fromEntries(criteriaForRole(role).map((criterion) => [criterion.key, 0]));
}

/** Moyenne des critères renseignés, arrondie à deux décimales. */
export function averageOfCriteria(criteria: Record<string, number>): number {
  const values = Object.values(criteria).filter((value) => value >= 1 && value <= 5);
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

/** Nombre de critères notés, utilisé pour l'indicateur de progression. */
export function ratedCriteriaCount(criteria: Record<string, number>): number {
  return Object.values(criteria).filter((value) => value >= 1 && value <= 5).length;
}

export function feedbackStatusLabel(status?: FeedbackStatus): string {
  switch (status) {
    case "awaiting_review":
      return "Review pending";
    case "submitted_hidden":
      return "Submitted — hidden until publication";
    case "expired":
      return "Deadline passed";
    case "published":
      return "Published";
    default:
      return "Published";
  }
}

export function feedbackStatusTone(status?: FeedbackStatus): "pending" | "hidden" | "published" | "expired" {
  switch (status) {
    case "awaiting_review":
      return "pending";
    case "submitted_hidden":
      return "hidden";
    case "expired":
      return "expired";
    default:
      return "published";
  }
}

/** Date de publication prévue : échéance de 14 jours ou publication mutuelle. */
export function publicationLabel(item: Feedback): string {
  if (item.status === "published") return "Published";
  if (item.status === "expired") return "Deadline passed";
  if (item.dueAt) return `Publishable after ${item.dueAt.slice(0, 10)} at the latest`;
  return "Publication date pending";
}

/** Un avis masqué n'est jamais présenté comme visible sur un profil. */
export function isPublicReview(item: Feedback): boolean {
  return (item.status ?? "published") === "published";
}

/** Un avis déjà soumis (masqué ou publié) ne peut plus être modifié. */
export function isSubmitted(item: Feedback): boolean {
  return item.status === "submitted_hidden" || item.status === "published";
}

/**
 * Validation locale du formulaire. Le backend revalide tout : cette fonction
 * évite simplement un aller-retour réseau inutile et guide l'utilisateur.
 */
export function validateFeedbackSubmission(
  role: Role,
  input: SubmitFeedbackInput,
): string | null {
  const expected = criteriaForRole(role);
  const missing = expected.filter((criterion) => {
    const value = input.criteria[criterion.key];
    return !Number.isInteger(value) || value < 1 || value > 5;
  });

  if (missing.length > 0) {
    return `Rate all five criteria before submitting (${missing.length} remaining).`;
  }

  if (Object.keys(input.criteria).some((key) => !expected.some((criterion) => criterion.key === key))) {
    return "The rating form contains unexpected criteria.";
  }

  const comment = (input.comment ?? "").trim();
  if (comment.length === 0) return "A general comment is required.";
  if (comment.length > FEEDBACK_COMMENT_MAX) {
    return `Your comment cannot exceed ${FEEDBACK_COMMENT_MAX} characters.`;
  }

  if ((input.strengths ?? "").length > FEEDBACK_OPTIONAL_MAX) {
    return `Strengths cannot exceed ${FEEDBACK_OPTIONAL_MAX} characters.`;
  }

  if ((input.improvements ?? "").length > FEEDBACK_OPTIONAL_MAX) {
    return `Improvements cannot exceed ${FEEDBACK_OPTIONAL_MAX} characters.`;
  }

  if (role === "client" && typeof input.recommend !== "boolean") {
    return "Indicate whether you recommend this freelancer.";
  }

  return null;
}

/** Libellé court du destinataire d'un avis (jamais un identifiant technique). */
export function feedbackCounterpart(item: Feedback): string {
  return item.recipientName?.trim() || item.recipient?.trim() || "the other participant";
}

/** Libellé court de l'auteur d'un avis publié. */
export function feedbackAuthor(item: Feedback): string {
  return item.authorName?.trim() || item.author?.trim() || "Participant";
}
