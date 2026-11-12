import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackView } from "@/components/modules/FeedbackView";
import { feedbacksApi } from "@/lib/api";
import type { Feedback, FeedbackSummary } from "@/lib/types";

// L'espace Feedback est rendu hors navigateur : les coquilles de mise en page
// (navigation Next) sont remplacées par un simple conteneur, et les contextes
// fournissent un utilisateur authentifié ainsi que l'état Feedback attendu.
vi.mock("@/components/modules/ModuleShell", () => ({
  ModuleShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({ go: vi.fn(), notify: vi.fn() }),
}));

vi.mock("@/context/UserContext", () => ({
  useUser: () => ({ authUser: { id: "u-1", role: "client" }, status: "authenticated" }),
}));

const state = vi.hoisted(() => ({
  marketplace: {} as Record<string, unknown>,
}));

vi.mock("@/context/MarketplaceContext", () => ({
  useMarketplace: () => state.marketplace,
}));

const summaryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    feedbacksApi: { ...actual.feedbacksApi, summary: summaryMock },
  };
});

const emptySummary: FeedbackSummary = {
  userId: "u-1",
  count: 0,
  averageRating: 0,
  distribution: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0 })),
  criteriaAverages: {},
  criteriaReviewCount: 0,
  recommendationRate: null,
  reviews: [],
};

const request: Feedback = {
  id: "req-1",
  projectId: "project-1",
  projectTitle: "Boutique en ligne",
  author: "Client Test",
  authorRole: "client",
  recipient: "Freelance Test",
  rating: 0,
  comment: "",
  status: "awaiting_review",
  criteria: {},
  createdAt: "2026-01-01T00:00:00Z",
  dueAt: "2026-01-15T00:00:00Z",
};

const hiddenReview: Feedback = {
  ...request,
  id: "hidden-1",
  status: "submitted_hidden",
  rating: 4,
  averageRating: 4,
  comment: "Livraison conforme et communication régulière.",
  criteria: { quality: 4, deadlines: 4, communication: 4, professionalism: 4, specifications: 4 },
  submittedAt: "2026-01-02T00:00:00Z",
};

function setMarketplace(feedback: Feedback[]) {
  state.marketplace = {
    feedback,
    feedbackLoading: false,
    feedbackError: "",
    refreshFeedback: vi.fn(async () => undefined),
    submitFeedback: vi.fn(async () => hiddenReview),
  };
}

function renderView(role: "client" | "freelancer") {
  return renderToStaticMarkup(React.createElement(FeedbackView, { role }));
}

// ---------------------------------------------------------------------------
// Contrat du MarketplaceProvider : aucune trace de l'ancien module Feedback.
// ---------------------------------------------------------------------------

const providerPath = path.join(process.cwd(), "src", "context", "MarketplaceContext.tsx");
const providerSource = readFileSync(providerPath, "utf8");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return listSourceFiles(full);
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) {
      return [];
    }
    return [full];
  });
}

describe("MarketplaceProvider — contrat Feedback", () => {
  it("ne référence plus updateFeedback ni removeFeedback, ni dans le Provider ni ailleurs", () => {
    expect(providerSource).not.toMatch(/updateFeedback|removeFeedback/);

    const offenders = listSourceFiles(path.join(process.cwd(), "src")).filter((file) =>
      /updateFeedback|removeFeedback/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("déclare refreshFeedback et submitFeedback et les expose dans la valeur du contexte", () => {
    expect(providerSource).toMatch(/const refreshFeedback = useCallback\(/);
    expect(providerSource).toMatch(/const submitFeedback = useCallback\(/);
    expect(providerSource).toContain("refreshFeedback: () => Promise<void>;");
    expect(providerSource).toContain("submitFeedback: (projectId: string, input: SubmitFeedbackInput) => Promise<Feedback>;");

    // Présents à la fois dans l'objet mémoïsé et dans son tableau de dépendances.
    expect(providerSource.match(/\n\s{6}refreshFeedback,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(providerSource.match(/\n\s{6}submitFeedback,/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("passe uniquement par les endpoints Feedback du backend .NET", () => {
    expect(providerSource).toContain("await feedbacksApi.mine()");
    expect(providerSource).toContain("await feedbacksApi.submit(projectId, input)");
    expect(providerSource).not.toContain("/api/feedbacks");
  });

  it("n'expose aucune opération de modification ou de suppression d'un avis", () => {
    expect(Object.keys(feedbacksApi).sort()).toEqual(["ensureRequests", "forFreelancer", "mine", "submit", "summary"]);
  });
});

// ---------------------------------------------------------------------------
// Espace Feedback : le même écran sert le client et le freelancer.
// ---------------------------------------------------------------------------

describe("Espace Feedback — client et freelancer", () => {
  beforeEach(() => {
    summaryMock.mockReset();
    summaryMock.mockResolvedValue(emptySummary);
    setMarketplace([request]);
  });

  it("affiche une demande à compléter côté client, avec le formulaire client", () => {
    const markup = renderView("client");

    expect(markup).toContain("Reviews to complete");
    expect(markup).toContain("Boutique en ligne");
    expect(markup).toContain("Submit review");
    expect(markup).toContain("Would you recommend this freelancer?");
    expect(markup).toContain("Quality of work");
  });

  it("affiche une demande à compléter côté freelancer, avec les critères freelancer", () => {
    const markup = renderView("freelancer");

    expect(markup).toContain("Reviews to complete");
    expect(markup).toContain("Submit review");
    expect(markup).toContain("Clarity of requirements");
    expect(markup).not.toContain("Would you recommend this freelancer?");
  });

  it("garde un avis soumis privé et annonce sa publication différée", () => {
    setMarketplace([hiddenReview]);
    const markup = renderView("client");

    expect(markup).toContain("Submitted — awaiting publication");
    expect(markup).toContain("Visible to you only");
    expect(markup).toContain("Livraison conforme");
    // Aucun avis reçu n'est inventé tant que la publication n'a pas eu lieu.
    expect(markup).toContain("No published review yet.");
  });
});
