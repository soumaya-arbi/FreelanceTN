// Assistant IA FreelanceTN — suggestions uniquement, aucune action métier.
// Les données transmises au fournisseur sont limitées au strict nécessaire
// et les feedbacks non publiés ne sont jamais envoyés.

import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { ActionError, forbidden, validationError } from "@/lib/server/errors";
import { completeJson } from "@/lib/server/ai/provider";
import { getAiConfig, isAiConfigured } from "@/lib/server/ai/config";
import {
  asNumber,
  asObjectArray,
  asString,
  asStringArray,
  parseJsonObject,
} from "@/lib/server/ai/parse";
import type { SessionUser } from "@/lib/server/session";
import { text } from "@/lib/server/serialize";
import * as freelancersService from "@/lib/server/services/freelancers";
import * as portfolioService from "@/lib/server/services/portfolio";
import * as projectService from "@/lib/server/services/projects";
import * as proposalService from "@/lib/server/services/proposals";

const IDEA_MIN = 20;
const IDEA_MAX = 4000;
const MATCH_CANDIDATE_LIMIT = 18;
const MATCH_RESULT_LIMIT = 3;
const MATCH_MINIMUM_SCORE = 60;
const MATCH_MINIMUM_SKILL_COVERAGE = 0.5;

export type AiStatus = {
  configured: boolean;
  provider: "cloudflare-workers-ai";
  model: string | null;
  message: string | null;
};

export type ProjectAssistSuggestion = {
  title: string;
  description: string;
  objectives: string[];
  skills: string[];
  technologies: string[];
  deliverables: string[];
  durationValue: number | null;
  durationUnit: "Days" | "Weeks" | "Months" | null;
  budgetMin: number | null;
  budgetMax: number | null;
  category: string | null;
  contractType: "Fixed price" | "Hourly" | null;
};

export type FreelancerMatchSuggestion = {
  freelancerId: string;
  name: string;
  title: string;
  avatar: string;
  avatarSource: string;
  avatarConfig: string;
  hourlyRate: number;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  explanation: string;
  score: number;
  publishedFeedbackCount: number;
  averagePublishedRating: number | null;
  publishedPortfolioCount: number;
};

export type ProposalAssistSuggestion = {
  coverLetter: string;
  introduction: string;
  understanding: string;
  approach: string;
  steps: string[];
  relevantSkills: string[];
  relevantTechnologies: string[];
  indicativeTimeline: string;
  questions: string[];
  conclusion: string;
  suggestedPrice: string | null;
  suggestedDelivery: string | null;
};

export type BreakdownTaskSuggestion = {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  phase: string;
  dependsOn: string[];
  indicativeDays: number | null;
  deliverable: string;
  selected: boolean;
};

export type ProjectBreakdownSuggestion = {
  summary: string;
  phases: Array<{ name: string; description: string; indicativeDays: number | null }>;
  tasks: BreakdownTaskSuggestion[];
};

function ensureConfigured(): void {
  if (!isAiConfigured()) {
    throw new ActionError(
      503,
      "Le microservice IA n'est pas configuré. Définissez AI_SERVICE_URL et AI_SERVICE_TOKEN côté serveur Next.js.",
    );
  }
}

function normalizeSkill(value: string): string {
  return value.trim().toLowerCase();
}

function skillOverlap(required: string[], owned: string[]): { matched: string[]; missing: string[] } {
  const ownedNorm = new Map(owned.map((s) => [normalizeSkill(s), s]));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of required) {
    const key = normalizeSkill(skill);
    const hit = ownedNorm.get(key);
    if (hit) matched.push(hit);
    else missing.push(skill);
  }
  return { matched, missing };
}

function textMatchesSkill(source: string, skill: string): boolean {
  const normalizedSource = normalizeSkill(source).replace(/[^\p{L}\p{N}+#.]+/gu, " ");
  const normalizedSkill = normalizeSkill(skill).replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim();
  if (!normalizedSkill) return false;
  if (normalizedSkill.length < 3) return false;
  return ` ${normalizedSource} `.includes(` ${normalizedSkill} `);
}

function verifiedSkillMatches(required: string[], exactSkills: string[], textEvidence: string[]): string[] {
  const exact = new Set(exactSkills.map(normalizeSkill));
  const searchable = textEvidence.filter(Boolean).join(" ");
  return required.filter((skill) => exact.has(normalizeSkill(skill)) || textMatchesSkill(searchable, skill));
}

function verifiedMatchScore(input: {
  requiredSkills: string[];
  matchedSkills: string[];
  experienceSkills: string[];
  portfolioSkills: string[];
  completedProjectSkills: string[];
  feedbackCount: number;
  averageRating: number | null;
}): { score: number; explanation: string; strengths: string[] } {
  const denominator = input.requiredSkills.length;
  const ratio = (skills: string[]) => denominator ? skills.length / denominator : 0;
  const points = {
    profile: Math.round(ratio(input.matchedSkills) * 45),
    experience: Math.round(ratio(input.experienceSkills) * 20),
    portfolio: Math.round(ratio(input.portfolioSkills) * 15),
    completedProjects: Math.round(ratio(input.completedProjectSkills) * 15),
    feedback: input.averageRating === null || input.feedbackCount === 0
      ? 0
      : Math.round((input.averageRating / 5) * (Math.min(input.feedbackCount, 5) / 5) * 5),
  };
  const score = Object.values(points).reduce((sum, value) => sum + value, 0);
  const strengths = [
    ...(input.matchedSkills.length ? [`Compétences déclarées : ${input.matchedSkills.join(", ")}`] : []),
    ...(input.experienceSkills.length ? [`Expérience déclarée sur : ${input.experienceSkills.join(", ")}`] : []),
    ...(input.portfolioSkills.length ? [`Portfolio publié correspondant : ${input.portfolioSkills.join(", ")}`] : []),
    ...(input.completedProjectSkills.length ? [`Projets terminés vérifiés : ${input.completedProjectSkills.join(", ")}`] : []),
    ...(input.averageRating !== null && input.feedbackCount
      ? [`Avis publiés : ${input.averageRating}/5 (${input.feedbackCount})`]
      : []),
  ];
  const explanation = `Score indicatif fondé sur des éléments vérifiés : compétences ${points.profile}/45, expérience ${points.experience}/20, portfolio publié ${points.portfolio}/15, projets terminés ${points.completedProjects}/15, avis publiés ${points.feedback}/5.`;
  return { score, explanation, strengths };
}

function durationUnit(value: unknown): "Days" | "Weeks" | "Months" | null {
  const raw = asString(value).toLowerCase();
  if (raw.startsWith("day")) return "Days";
  if (raw.startsWith("week")) return "Weeks";
  if (raw.startsWith("month")) return "Months";
  return null;
}

function contractType(value: unknown): "Fixed price" | "Hourly" | null {
  const raw = asString(value).toLowerCase();
  if (raw.includes("hour")) return "Hourly";
  if (raw.includes("fixed") || raw.includes("forfait")) return "Fixed price";
  return null;
}

function priorityOf(value: unknown): "low" | "medium" | "high" {
  const raw = asString(value).toLowerCase();
  if (raw === "low" || raw === "basse" || raw === "bas") return "low";
  if (raw === "high" || raw === "haute" || raw === "élevée" || raw === "elevee") return "high";
  return "medium";
}

function publicName(doc: { firstName?: string; lastName?: string; name?: string }): string {
  const composed = `${doc.firstName ?? ""} ${doc.lastName ?? ""}`.trim();
  return composed || doc.name || "Freelancer";
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

async function loadPublishedFeedbackSummary(freelancerIds: string[]): Promise<
  Map<string, { count: number; average: number | null; snippets: string[] }>
> {
  const map = new Map<string, { count: number; average: number | null; snippets: string[] }>();
  if (freelancerIds.length === 0) return map;

  const feedback = await collections.feedback();
  // L'API .NET stocke recipientId en ObjectId ; certaines écritures peuvent
  // aussi laisser une chaîne. On interroge les deux formes sans élargir le statut.
  const recipientFilter = freelancerIds.flatMap((id) =>
    ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id],
  );
  const docs = await feedback
    .find({
      recipientId: { $in: recipientFilter },
      status: "published",
    })
    .project({
      recipientId: 1,
      averageRating: 1,
      rating: 1,
      strengths: 1,
      comment: 1,
    })
    .limit(400)
    .toArray();

  const buckets = new Map<string, { ratings: number[]; snippets: string[] }>();
  for (const doc of docs) {
    const id = text((doc as Record<string, unknown>).recipientId);
    if (!id) continue;
    const bucket = buckets.get(id) ?? { ratings: [], snippets: [] };
    const avg = Number((doc as Record<string, unknown>).averageRating);
    const rating = Number((doc as Record<string, unknown>).rating);
    const score = Number.isFinite(avg) && avg > 0 ? avg : Number.isFinite(rating) ? rating : null;
    if (score !== null) bucket.ratings.push(score);
    const strength = text((doc as Record<string, unknown>).strengths);
    const comment = text((doc as Record<string, unknown>).comment);
    const snippet = truncate(strength || comment, 160);
    if (snippet && bucket.snippets.length < 3) bucket.snippets.push(snippet);
    buckets.set(id, bucket);
  }

  for (const [id, bucket] of buckets) {
    const average =
      bucket.ratings.length > 0
        ? Math.round((bucket.ratings.reduce((a, b) => a + b, 0) / bucket.ratings.length) * 10) / 10
        : null;
    map.set(id, { count: bucket.ratings.length, average, snippets: bucket.snippets });
  }
  return map;
}

/** Vérifie le microservice et ses variables fournisseur sans exposer de secret. */
export async function getAiStatus(): Promise<AiStatus> {
  const config = getAiConfig();
  if (!config.configured || !isAiConfigured()) {
    return {
      configured: false,
      provider: "cloudflare-workers-ai",
      model: null,
      message: "Configurez l'URL privée FastAPI et son jeton interne côté serveur Next.js.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 5000));
  try {
    const response = await fetch(`${config.serviceUrl}/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${config.serviceToken}` },
    });
    if (!response.ok) {
      return {
        configured: false,
        provider: "cloudflare-workers-ai",
        model: null,
        message: "Le microservice IA est inaccessible ou son jeton interne est refusé.",
      };
    }
    const status = (await response.json()) as { configured?: unknown; provider?: unknown; model?: unknown };
    const configured = status.configured === true && status.provider === "cloudflare-workers-ai";
    return {
      configured,
      provider: "cloudflare-workers-ai",
      model: typeof status.model === "string" ? status.model : null,
      message: configured
        ? "Le microservice est joignable et les variables Workers AI sont présentes. L'accès au modèle sera vérifié lors d'une génération."
        : "Le microservice FastAPI est joignable, mais ses identifiants Workers AI ne sont pas configurés.",
    };
  } catch {
    return {
      configured: false,
      provider: "cloudflare-workers-ai",
      model: null,
      message: "Le microservice FastAPI est temporairement indisponible.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** A — Assistant de rédaction de projet (client). */
export async function assistProjectDraft(
  user: SessionUser,
  input: { idea: string; category?: string; language?: string },
): Promise<ProjectAssistSuggestion> {
  if (user.role !== "client") {
    throw forbidden("Cette action est réservée aux comptes client.");
  }
  ensureConfigured();

  const idea = (input.idea ?? "").trim();
  if (idea.length < IDEA_MIN) {
    throw validationError(`Décrivez votre idée en au moins ${IDEA_MIN} caractères.`);
  }
  if (idea.length > IDEA_MAX) {
    throw validationError(`La description ne peut pas dépasser ${IDEA_MAX} caractères.`);
  }

  const categoryHint = (input.category ?? "").trim();
  const language = (input.language ?? "fr").trim() === "en" ? "en" : "fr";

  const raw = await completeJson([
    {
      role: "system",
      content:
        "Tu es l'assistant de rédaction de projets FreelanceTN. " +
        "Tu transforms une idée client en brief professionnel pour un marketplace freelance en Tunisie (budget en TND). " +
        "Réponds uniquement en JSON valide. N'invente pas d'informations personnelles. " +
        "Si l'idée est vague, reste prudent sur budget/durée et reste générique mais professionnel.",
    },
    {
      role: "user",
      content: JSON.stringify({
        language,
        categoryHint: categoryHint || null,
        idea,
        schema: {
          title: "string",
          description: "string (2-4 paragraphs)",
          objectives: ["string"],
          skills: ["string"],
          technologies: ["string"],
          deliverables: ["string"],
          durationValue: "number|null",
          durationUnit: "Days|Weeks|Months|null",
          budgetMin: "number|null",
          budgetMax: "number|null",
          category: "string|null",
          contractType: "Fixed price|Hourly|null",
        },
      }),
    },
  ]);

  const parsed = parseJsonObject(raw);
  const title = asString(parsed.title);
  const description = asString(parsed.description);
  if (!title || !description) {
    throw new ActionError(502, "La réponse de l'assistant IA est invalide ou incomplete. Régénérez pour réessayer.");
  }

  const budgetMin = asNumber(parsed.budgetMin);
  const budgetMax = asNumber(parsed.budgetMax);
  const durationValue = asNumber(parsed.durationValue);

  return {
    title: truncate(title, 120),
    description: truncate(description, 5000),
    objectives: asStringArray(parsed.objectives, 8),
    skills: asStringArray(parsed.skills, 12),
    technologies: asStringArray(parsed.technologies, 12),
    deliverables: asStringArray(parsed.deliverables, 10),
    durationValue: durationValue !== null && durationValue > 0 ? Math.round(durationValue) : null,
    durationUnit: durationUnit(parsed.durationUnit),
    budgetMin: budgetMin !== null && budgetMin > 0 ? Math.round(budgetMin) : null,
    budgetMax: budgetMax !== null && budgetMax > 0 ? Math.round(budgetMax) : null,
    category: asString(parsed.category) || categoryHint || null,
    contractType: contractType(parsed.contractType),
  };
}

/** B — Matching freelances réels (client, projet possédé). */
export async function matchFreelancersForProject(
  user: SessionUser,
  projectId: string,
): Promise<{ projectId: string; matches: FreelancerMatchSuggestion[] }> {
  if (user.role !== "client") {
    throw forbidden("Cette action est réservée aux comptes client.");
  }
  ensureConfigured();

  const project = await projectService.getProject(user.id, projectId);
  if (project.ownerId !== user.id) {
    throw forbidden("Vous ne pouvez recommander des freelances que pour vos propres projets.");
  }

  const freelancers = await freelancersService.listFreelancers();
  if (freelancers.length === 0) {
    return { projectId, matches: [] };
  }

  const requiredSkills = Array.isArray(project.skills)
    ? [...new Map(project.skills.filter(Boolean).map((skill) => [normalizeSkill(skill), skill])).values()]
    : [];
  if (requiredSkills.length === 0) return { projectId, matches: [] };

  const scored = freelancers
    .map((freelancer) => {
      const { matched, missing } = skillOverlap(requiredSkills, freelancer.skills);
      return { freelancer, matched, missing };
    })
    .filter((row) => row.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length || a.freelancer.name.localeCompare(b.freelancer.name))
    .slice(0, MATCH_CANDIDATE_LIMIT);

  if (scored.length === 0) return { projectId, matches: [] };

  const candidateIds = scored.map((row) => row.freelancer.id);
  const feedbackMap = await loadPublishedFeedbackSummary(candidateIds);
  const projectCollection = await collections.projects();
  const completedProjectDocs = await projectCollection
    .find({ assignedTo: { $in: candidateIds }, status: "Completed" })
    .project({ assignedTo: 1, title: 1, description: 1, skills: 1, category: 1 })
    .limit(candidateIds.length * 20)
    .toArray();
  const completedProjectsByFreelancer = new Map<string, Record<string, unknown>[]>();
  for (const doc of completedProjectDocs) {
    const raw = doc as Record<string, unknown>;
    const id = text(raw.assignedTo);
    if (!id) continue;
    const rows = completedProjectsByFreelancer.get(id) ?? [];
    rows.push(raw);
    completedProjectsByFreelancer.set(id, rows);
  }

  const enriched = await Promise.all(
    scored.map(async (row) => {
      const portfolio = await portfolioService.listFreelancerPortfolio(row.freelancer.id, true);
      const published = portfolio.filter((item) => item.published === true);
      const detail = await freelancersService.getFreelancer(row.freelancer.id);
      const feedback = feedbackMap.get(row.freelancer.id) ?? {
        count: 0,
        average: null,
        snippets: [],
      };
      const experienceExactSkills = detail.experiences.flatMap((experience) =>
        Array.isArray(experience.technologies)
          ? (experience.technologies as unknown[]).filter((value): value is string => typeof value === "string")
          : [],
      );
      const experienceText = detail.experiences.flatMap((experience) => [
        text(experience.role), text(experience.description), text(experience.company),
      ]);
      const portfolioExactSkills = published.flatMap((item) => item.skills);
      const portfolioText = published.flatMap((item) => [item.title, item.summary, item.outcome || ""]);
      const completedProjects = completedProjectsByFreelancer.get(row.freelancer.id) ?? [];
      const completedExactSkills = completedProjects.flatMap((item) =>
        Array.isArray(item.skills) ? item.skills.filter((value): value is string => typeof value === "string") : [],
      );
      const completedText = completedProjects.flatMap((item) => [
        text(item.title), text(item.description), text(item.category),
      ]);
      const experienceSkills = verifiedSkillMatches(requiredSkills, experienceExactSkills, experienceText);
      const portfolioSkills = verifiedSkillMatches(requiredSkills, portfolioExactSkills, portfolioText);
      const completedProjectSkills = verifiedSkillMatches(requiredSkills, completedExactSkills, completedText);
      const relevance = verifiedMatchScore({
        requiredSkills,
        matchedSkills: row.matched,
        experienceSkills,
        portfolioSkills,
        completedProjectSkills,
        feedbackCount: feedback.count,
        averageRating: feedback.average,
      });
      return {
        ...row,
        detail,
        publishedPortfolio: published.slice(0, 4).map((item) => ({
          title: item.title,
          summary: truncate(item.summary || "", 180),
          skills: item.skills.slice(0, 8),
        })),
        feedback,
        experienceSkills,
        portfolioSkills,
        completedProjectSkills,
        completedProjectCount: completedProjects.length,
        relevance,
      };
    }),
  );

  const eligible = enriched
    .filter((row) => row.relevance.score >= MATCH_MINIMUM_SCORE && row.matched.length / requiredSkills.length >= MATCH_MINIMUM_SKILL_COVERAGE)
    .sort((a, b) => b.relevance.score - a.relevance.score || a.freelancer.name.localeCompare(b.freelancer.name));
  if (eligible.length === 0) return { projectId, matches: [] };

  const raw = await completeJson([
    {
      role: "system",
      content:
        "Tu es l'assistant de matching FreelanceTN. " +
        "Classe uniquement les IDs fournis, qui ont déjà franchi les critères de pertinence vérifiés côté serveur. " +
        "N'invente aucun profil, compétence, expérience, diplôme, avis ou portfolio et ne produis aucun score. " +
        "Réponds uniquement en JSON: {\"matches\":[{\"freelancerId\"}]}. " +
        "Retourne au maximum 3 IDs, du plus pertinent au moins pertinent.",
    },
    {
      role: "user",
      content: JSON.stringify({
        project: {
          id: project.id,
          title: project.title,
          description: truncate(project.description || "", 1200),
          skills: requiredSkills,
          category: project.category,
          type: project.type,
          budget: project.budget,
          budgetMin: project.budgetMin,
          budgetMax: project.budgetMax,
        },
        candidates: eligible.slice(0, MATCH_CANDIDATE_LIMIT).map((row) => ({
          freelancerId: row.freelancer.id,
          name: row.freelancer.name,
          title: row.freelancer.title,
          skills: row.freelancer.skills,
          matchedSkills: row.matched,
          missingSkills: row.missing,
          hourlyRate: row.freelancer.hourlyRate,
          bio: truncate(row.detail.bio || "", 400),
          experiences: row.detail.experiences.slice(0, 3).map((exp) => ({
            role: text(exp.role),
            company: text(exp.company),
            technologies: Array.isArray(exp.technologies)
              ? (exp.technologies as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 8)
              : [],
            description: truncate(text(exp.description), 220),
          })),
          portfolio: row.publishedPortfolio,
          publishedFeedbackCount: row.feedback.count,
          averagePublishedRating: row.feedback.average,
          publishedFeedbackSnippets: row.feedback.snippets,
          verifiedScore: row.relevance.score,
          verifiedEvidence: {
            matchedSkills: row.matched,
            experienceSkills: row.experienceSkills,
            portfolioSkills: row.portfolioSkills,
            completedProjectSkills: row.completedProjectSkills,
            publishedFeedbackCount: row.feedback.count,
            averagePublishedRating: row.feedback.average,
          },
        })),
      }),
    },
  ]);

  const parsed = parseJsonObject(raw);
  const aiMatches = asObjectArray(parsed.matches, MATCH_RESULT_LIMIT);
  const byId = new Map(eligible.slice(0, MATCH_CANDIDATE_LIMIT).map((row) => [row.freelancer.id, row]));
  const used = new Set<string>();
  const matches: FreelancerMatchSuggestion[] = [];

  for (const item of aiMatches) {
    const id = asString(item.freelancerId);
    const row = byId.get(id);
    if (!row || used.has(id)) continue;
    used.add(id);
    matches.push({
      freelancerId: row.freelancer.id,
      name: row.freelancer.name,
      title: row.freelancer.title,
      avatar: row.freelancer.avatar,
      avatarSource: row.freelancer.avatarSource,
      avatarConfig: row.freelancer.avatarConfig,
      hourlyRate: row.freelancer.hourlyRate,
      matchedSkills: row.matched,
      missingSkills: row.missing,
      strengths: row.relevance.strengths,
      explanation: row.relevance.explanation,
      score: row.relevance.score,
      publishedFeedbackCount: row.feedback.count,
      averagePublishedRating: row.feedback.average,
      publishedPortfolioCount: row.publishedPortfolio.length,
    });
  }

  return { projectId, matches };
}

/** C — Assistant de proposition (freelance). */
export async function assistProposalDraft(
  user: SessionUser,
  projectId: string,
): Promise<ProposalAssistSuggestion> {
  if (user.role !== "freelancer") {
    throw forbidden("Cette action est réservée aux freelances.");
  }
  ensureConfigured();

  const project = await projectService.getProject(user.id, projectId);
  if (project.status !== "Open" || project.assignedTo) {
    throw validationError("Ce projet n'accepte plus de propositions.");
  }

  const profile = await freelancersService.getFreelancer(user.id);
  const portfolio = await portfolioService.listMyPortfolio(user);
  const publishedPortfolio = portfolio
    .filter((item) => item.published === true && item.visibility !== "Private")
    .slice(0, 5)
    .map((item) => ({
      title: item.title,
      summary: truncate(item.summary || "", 200),
      skills: item.skills.slice(0, 8),
      outcome: truncate(item.outcome || "", 160),
    }));

  const ownedSkills = new Set(profile.skills.map(normalizeSkill));
  const projectSkills = Array.isArray(project.skills) ? project.skills.filter(Boolean) : [];
  const relevantSkills = projectSkills.filter((skill) => ownedSkills.has(normalizeSkill(skill)));

  const raw = await completeJson([
    {
      role: "system",
      content:
        "Tu rédiges des propositions freelance pour FreelanceTN. " +
        "Tu t'appuies UNIQUEMENT sur le projet et le profil fournis. " +
        "Interdiction d'inventer expérience, diplôme, client, compétence ou portfolio. " +
        "Si une compétence projet manque au profil, ne prétends pas la maîtriser ; " +
        "tu peux proposer une question ou une approche prudente. " +
        "Réponds uniquement en JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        project: {
          title: project.title,
          description: truncate(project.description || "", 1600),
          skills: projectSkills,
          category: project.category,
          type: project.type,
          budget: project.budget,
          budgetMin: project.budgetMin,
          budgetMax: project.budgetMax,
          durationValue: project.durationValue,
          durationUnit: project.durationUnit,
        },
        freelancer: {
          name: publicName(profile),
          title: profile.title,
          bio: truncate(profile.bio || "", 500),
          skills: profile.skills,
          relevantSkills,
          hourlyRate: profile.hourlyRate,
          experiences: profile.experiences.slice(0, 4).map((exp) => ({
            role: text(exp.role),
            company: text(exp.company),
            technologies: Array.isArray(exp.technologies)
              ? (exp.technologies as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 8)
              : [],
            description: truncate(text(exp.description), 220),
          })),
          portfolio: publishedPortfolio,
        },
        schema: {
          introduction: "string",
          understanding: "string",
          approach: "string",
          steps: ["string"],
          relevantSkills: ["string"],
          relevantTechnologies: ["string"],
          indicativeTimeline: "string",
          questions: ["string"],
          conclusion: "string",
          coverLetter: "string (full letter combining the sections)",
          suggestedPrice: "string|null (TND, optional)",
          suggestedDelivery: "string|null",
        },
      }),
    },
  ]);

  const parsed = parseJsonObject(raw);
  const coverLetter = asString(parsed.coverLetter);
  const introduction = asString(parsed.introduction);
  const understanding = asString(parsed.understanding);
  const approach = asString(parsed.approach);
  const conclusion = asString(parsed.conclusion);

  if (!coverLetter && !(introduction && understanding && approach && conclusion)) {
    throw new ActionError(502, "La réponse de l'assistant IA est invalide ou incomplete. Régénérez pour réessayer.");
  }

  const assembled =
    coverLetter ||
    [introduction, understanding, approach, conclusion].filter(Boolean).join("\n\n");

  // Ne jamais laisser passer des compétences inventées : intersection avec le profil réel.
  const claimedSkills = asStringArray(parsed.relevantSkills, 12);
  const safeSkills = claimedSkills.filter((skill) => ownedSkills.has(normalizeSkill(skill)));
  const techPool = new Set(
    profile.experiences
      .flatMap((exp) =>
        Array.isArray(exp.technologies)
          ? (exp.technologies as unknown[]).filter((t): t is string => typeof t === "string")
          : [],
      )
      .map(normalizeSkill),
  );
  for (const skill of profile.skills) techPool.add(normalizeSkill(skill));
  const claimedTech = asStringArray(parsed.relevantTechnologies, 12);
  const safeTech = claimedTech.filter((tech) => techPool.has(normalizeSkill(tech)));

  return {
    coverLetter: truncate(assembled, 5000),
    introduction: truncate(introduction, 1200),
    understanding: truncate(understanding, 1200),
    approach: truncate(approach, 1600),
    steps: asStringArray(parsed.steps, 8),
    relevantSkills: safeSkills.length > 0 ? safeSkills : relevantSkills,
    relevantTechnologies: safeTech,
    indicativeTimeline: asString(parsed.indicativeTimeline),
    questions: asStringArray(parsed.questions, 6),
    conclusion: truncate(conclusion, 800),
    suggestedPrice: asString(parsed.suggestedPrice) || null,
    suggestedDelivery: asString(parsed.suggestedDelivery) || null,
  };
}

/** D — Découpage projet après acceptation (client ou freelance assigné). */
export async function breakdownProject(
  user: SessionUser,
  projectId: string,
): Promise<ProjectBreakdownSuggestion> {
  ensureConfigured();

  const project = await projectService.getProject(user.id, projectId);
  const isOwner = project.ownerId === user.id;
  const isAssignee = project.assignedTo === user.id;
  if (!isOwner && !isAssignee) {
    throw forbidden("Seuls le client propriétaire et le freelance assigné peuvent générer un découpage.");
  }
  if (!project.assignedTo) {
    throw validationError("Le découpage IA est disponible après l'acceptation d'une proposition (projet assigné).");
  }
  if (project.status !== "In progress") {
    throw validationError("Le découpage IA est disponible uniquement pour un projet accepté et en cours.");
  }

  let acceptedProposal: Awaited<ReturnType<typeof proposalService.listReceivedProposals>>[number] | null = null;
  if (isOwner) {
    const received = await proposalService.listReceivedProposals(user, projectId);
    acceptedProposal = received.find((item) => item.status === "Accepted") ?? null;
  } else {
    const mine = await proposalService.listMyProposals(user);
    acceptedProposal = mine.find((item) => item.projectId === projectId && item.status === "Accepted") ?? null;
  }
  const acceptedInvitation = acceptedProposal
    ? null
    : await (await collections.invitations()).findOne({
        projectId,
        freelancerId: project.assignedTo,
        status: "Accepted",
      });
  if (!acceptedProposal && !acceptedInvitation) {
    throw validationError("Une proposition ou une invitation doit être acceptée avant de générer le découpage IA.");
  }

  const raw = await completeJson([
    {
      role: "system",
      content:
        "Tu es l'assistant de planification FreelanceTN. " +
        "Tu proposes un découpage en phases et tâches pour un projet déjà assigné. " +
        "Les suggestions sont indicatives : aucune tâche ne sera créée automatiquement. " +
        "Réponds uniquement en JSON. N'invente pas d'équipe ni d'outils non mentionnés.",
    },
    {
      role: "user",
      content: JSON.stringify({
        project: {
          title: project.title,
          description: truncate(project.description || "", 1600),
          skills: project.skills,
          category: project.category,
          type: project.type,
          budget: project.budget,
          durationValue: project.durationValue,
          durationUnit: project.durationUnit,
        },
        acceptedProposal: acceptedProposal
          ? {
              price: acceptedProposal.price,
              delivery: acceptedProposal.delivery,
              coverLetter: truncate(acceptedProposal.coverLetter || "", 800),
            }
          : null,
        schema: {
          summary: "string",
          phases: [{ name: "string", description: "string", indicativeDays: "number|null" }],
          tasks: [
            {
              id: "t1",
              title: "string",
              description: "string",
              priority: "low|medium|high",
              phase: "string",
              dependsOn: ["t1"],
              indicativeDays: "number|null",
              deliverable: "string",
            },
          ],
        },
      }),
    },
  ]);

  const parsed = parseJsonObject(raw);
  const phases = asObjectArray(parsed.phases, 8)
    .map((phase) => ({
      name: asString(phase.name),
      description: asString(phase.description),
      indicativeDays: asNumber(phase.indicativeDays),
    }))
    .filter((phase) => phase.name);

  const taskRows = asObjectArray(parsed.tasks, 20);
  const idSet = new Set<string>();
  const tasks: BreakdownTaskSuggestion[] = [];
  let auto = 1;
  for (const row of taskRows) {
    const title = asString(row.title);
    if (!title) continue;
    let id = asString(row.id) || `t${auto}`;
    while (idSet.has(id)) {
      auto += 1;
      id = `t${auto}`;
    }
    idSet.add(id);
    auto += 1;
    const dependsOn = asStringArray(row.dependsOn, 6).filter((dep) => dep !== id);
    tasks.push({
      id,
      title: truncate(title, 140),
      description: truncate(asString(row.description), 800),
      priority: priorityOf(row.priority),
      phase: asString(row.phase) || phases[0]?.name || "Exécution",
      dependsOn,
      indicativeDays:
        asNumber(row.indicativeDays) !== null && (asNumber(row.indicativeDays) as number) > 0
          ? Math.round(asNumber(row.indicativeDays) as number)
          : null,
      deliverable: truncate(asString(row.deliverable), 200),
      selected: true,
    });
  }

  // Nettoyage des dépendances vers des IDs inexistants.
  for (const task of tasks) {
    task.dependsOn = task.dependsOn.filter((dep) => idSet.has(dep));
  }

  if (tasks.length === 0) {
    throw new ActionError(502, "La réponse de l'assistant IA est invalide ou incomplete. Régénérez pour réessayer.");
  }

  return {
    summary: asString(parsed.summary) || "Découpage indicatif prêt à être revu avant création des tâches.",
    phases,
    tasks,
  };
}
