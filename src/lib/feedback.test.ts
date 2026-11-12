import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbacksApi } from "@/lib/api";
import {
  CLIENT_FEEDBACK_CRITERIA,
  FREELANCER_FEEDBACK_CRITERIA,
  averageOfCriteria,
  criterionLabel,
  criteriaForRole,
  emptyCriteria,
  feedbackStatusLabel,
  feedbackStatusTone,
  isPublicReview,
  isSubmitted,
  publicationLabel,
  ratedCriteriaCount,
  validateFeedbackSubmission,
} from "@/lib/feedback";
import type { Feedback } from "@/lib/types";

const jsonResponse = (payload: unknown, status = 200, ok = true) =>
  ({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }) as unknown as Response;

const validInput = {
  criteria: Object.fromEntries(CLIENT_FEEDBACK_CRITERIA.map((criterion) => [criterion.key, 4])),
  comment: "Une collaboration claire et un livrable conforme.",
  recommend: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("critères du module Feedback", () => {
  it("expose exactement les cinq clés attendues par le backend pour chaque rôle", () => {
    expect(CLIENT_FEEDBACK_CRITERIA.map((item) => item.key)).toEqual([
      "quality",
      "deadlines",
      "communication",
      "professionalism",
      "specifications",
    ]);
    expect(FREELANCER_FEEDBACK_CRITERIA.map((item) => item.key)).toEqual([
      "requirementsClarity",
      "communication",
      "validationSpeed",
      "professionalism",
      "collaboration",
    ]);
    expect(criteriaForRole("client")).toBe(CLIENT_FEEDBACK_CRITERIA);
    expect(criteriaForRole("freelancer")).toBe(FREELANCER_FEEDBACK_CRITERIA);
  });

  it("traduit une clé stable en libellé lisible", () => {
    expect(criterionLabel("validationSpeed")).toBe("Speed of validations");
    expect(criterionLabel("inconnu")).toBe("inconnu");
  });
});

describe("validation locale d'une évaluation", () => {
  it("accepte une saisie complète", () => {
    expect(validateFeedbackSubmission("client", validInput)).toBeNull();
  });

  it("refuse un critère non noté", () => {
    const criteria = { ...validInput.criteria, quality: 0 };
    expect(validateFeedbackSubmission("client", { ...validInput, criteria })).toContain("five criteria");
  });

  it("refuse une note hors de l'intervalle 1-5", () => {
    const criteria = { ...validInput.criteria, deadlines: 6 };
    expect(validateFeedbackSubmission("client", { ...validInput, criteria })).toContain("five criteria");
  });

  it("refuse un commentaire vide ou trop long", () => {
    expect(validateFeedbackSubmission("client", { ...validInput, comment: "   " })).toContain("comment is required");
    expect(validateFeedbackSubmission("client", { ...validInput, comment: "a".repeat(1001) })).toContain("1000");
  });

  it("exige une recommandation côté client uniquement", () => {
    expect(validateFeedbackSubmission("client", { ...validInput, recommend: null })).toContain("recommend");
    expect(
      validateFeedbackSubmission("freelancer", {
        criteria: Object.fromEntries(FREELANCER_FEEDBACK_CRITERIA.map((criterion) => [criterion.key, 3])),
        comment: "Client réactif.",
      }),
    ).toBeNull();
  });

  it("refuse des critères inattendus", () => {
    const criteria = { ...validInput.criteria, bonus: 3 };
    expect(validateFeedbackSubmission("client", { ...validInput, criteria })).toContain("unexpected criteria");
  });
});

describe("progression et moyennes", () => {
  it("initialise cinq critères à zéro", () => {
    const criteria = emptyCriteria("client");
    expect(Object.keys(criteria)).toHaveLength(5);
    expect(ratedCriteriaCount(criteria)).toBe(0);
    expect(averageOfCriteria(criteria)).toBe(0);
  });

  it("calcule la moyenne réelle des critères renseignés", () => {
    const criteria = { quality: 5, deadlines: 4, communication: 3, professionalism: 2, specifications: 1 };
    expect(averageOfCriteria(criteria)).toBe(3);
    expect(ratedCriteriaCount(criteria)).toBe(5);
  });
});

describe("statuts d'un avis", () => {
  const base: Feedback = {
    id: "1",
    projectId: "p1",
    projectTitle: "Projet",
    author: "Client",
    authorRole: "client",
    recipient: "Freelance",
    rating: 0,
    comment: "",
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("libelle et colore chaque statut", () => {
    expect(feedbackStatusLabel("awaiting_review")).toContain("pending");
    expect(feedbackStatusLabel("submitted_hidden")).toContain("hidden");
    expect(feedbackStatusLabel("expired")).toContain("Deadline");
    expect(feedbackStatusTone("published")).toBe("published");
    expect(feedbackStatusTone("submitted_hidden")).toBe("hidden");
  });

  it("distingue un avis public d'un avis seulement soumis", () => {
    expect(isPublicReview({ ...base, status: "published" })).toBe(true);
    expect(isPublicReview({ ...base, status: "submitted_hidden" })).toBe(false);
    expect(isPublicReview({ ...base, status: "awaiting_review" })).toBe(false);
    expect(isSubmitted({ ...base, status: "submitted_hidden" })).toBe(true);
    expect(isSubmitted({ ...base, status: "expired" })).toBe(false);
  });

  it("annonce la date de publication sans inventer de contenu", () => {
    expect(publicationLabel({ ...base, status: "submitted_hidden", dueAt: "2026-02-01T00:00:00Z" })).toContain(
      "2026-02-01",
    );
    expect(publicationLabel({ ...base, status: "published" })).toBe("Published");
  });
});

describe("feedbacksApi", () => {
  it("envoie une évaluation structurée à l'API .NET", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        id: "f1",
        projectId: "p1",
        projectTitle: "Projet",
        authorId: "c1",
        authorName: "Client",
        authorRole: "client",
        recipientId: "f2",
        recipientName: "Freelance",
        recipientRole: "freelancer",
        direction: "client_to_freelancer",
        status: "submitted_hidden",
        rating: 4,
        averageRating: 4,
        criteria: validInput.criteria,
        comment: validInput.comment,
        recommend: true,
        submittedAt: "2026-01-02T00:00:00Z",
        createdAt: "2026-01-02T00:00:00Z",
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await feedbacksApi.submit("p1", validInput);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/api/feedbacks/p1/submit");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(validInput);
    expect(result.status).toBe("submitted_hidden");
    expect(result.authorRole).toBe("client");
    expect(result.criteria).toEqual(validInput.criteria);
  });

  it("ne renvoie jamais le contenu d'un avis masqué", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse([
          {
            id: "f1",
            projectId: "p1",
            status: "awaiting_review",
            authorId: "c1",
            authorRole: "client",
            recipientId: "f2",
            recipientRole: "freelancer",
            rating: 0,
            averageRating: 0,
            criteria: {},
            comment: "",
            createdAt: "2026-01-02T00:00:00Z",
          },
        ]),
      ),
    );

    const [request] = await feedbacksApi.mine();

    expect(request.status).toBe("awaiting_review");
    expect(request.comment).toBe("");
    expect(request.rating).toBe(0);
    expect(request.criteria).toEqual({});
  });

  it("lit le résumé de réputation (moyenne, répartition, recommandations)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({
          userId: "f2",
          count: 2,
          averageRating: 4.5,
          distribution: [
            { stars: 5, count: 1 },
            { stars: 4, count: 1 },
          ],
          criteriaAverages: { quality: 4.5, deadlines: 4 },
          criteriaReviewCount: 2,
          recommendationRate: 100,
          reviews: [],
        }),
      ),
    );

    const summary = await feedbacksApi.summary("f2");

    expect(summary.count).toBe(2);
    expect(summary.averageRating).toBe(4.5);
    expect(summary.distribution).toEqual([
      { stars: 5, count: 1 },
      { stars: 4, count: 1 },
    ]);
    expect(summary.criteriaAverages.quality).toBe(4.5);
    expect(summary.recommendationRate).toBe(100);
  });
});
