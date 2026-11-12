// Annuaire public des freelances (AuthService.ListFreelancersAsync et
// FreelancersController). Seuls les champs publics sont projetés.

import { collections } from "@/lib/server/db";
import { notFound } from "@/lib/server/errors";
import { number, text } from "@/lib/server/serialize";
import { findUserById, toPublicFreelancer } from "@/lib/server/repositories/users";

export type PublicFreelancerSummary = {
  id: string;
  name: string;
  title: string;
  location: string;
  avatar: string;
  coverImage: string;
  avatarSource: string;
  avatarConfig: string;
  hourlyRate: number;
  skills: string[];
};

export type PublicFreelancer = {
  id: string;
  name: string;
  title: string;
  location: string;
  bio: string;
  avatar: string;
  coverImage: string;
  avatarSource: string;
  avatarConfig: string;
  skills: string[];
  hourlyRate: number;
  experiences: Record<string, unknown>[];
  education: Record<string, unknown>[];
  languages: Record<string, unknown>[];
  certifications: Record<string, unknown>[];
  workPreferences: Record<string, unknown>;
  createdAt: string;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (entry ?? {}) as Record<string, unknown>);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Nom public : jamais l'e-mail du compte (FreelancersController). */
function publicName(doc: Record<string, unknown>): string {
  const name = `${text(doc.firstName)} ${text(doc.lastName)}`.trim();
  return name.length > 0 ? name : "Freelancer";
}

function toSummary(doc: Record<string, unknown>): PublicFreelancerSummary {
  const base = toPublicFreelancer(doc);
  return {
    id: text(base.id),
    name: publicName(doc),
    title: text(base.title),
    location: text(base.location),
    avatar: text(base.avatar),
    coverImage: text(base.coverImage),
    avatarSource: text(base.avatarSource).trim() || "initials",
    avatarConfig: text(base.avatarConfig),
    hourlyRate: number(base.hourlyRate),
    skills: stringList(base.skills),
  };
}

function toDetail(doc: Record<string, unknown>): PublicFreelancer {
  const base = toPublicFreelancer(doc);
  return {
    id: text(base.id),
    name: publicName(doc),
    title: text(base.title),
    location: text(base.location),
    bio: text(base.bio),
    avatar: text(base.avatar),
    coverImage: text(base.coverImage),
    avatarSource: text(base.avatarSource).trim() || "initials",
    avatarConfig: text(base.avatarConfig),
    skills: stringList(base.skills),
    hourlyRate: number(base.hourlyRate),
    experiences: recordList(base.experiences),
    education: recordList(base.education),
    languages: recordList(base.languages),
    certifications: recordList(base.certifications),
    workPreferences: record(base.workPreferences),
    createdAt: text(base.createdAt),
  };
}

export async function listFreelancers(): Promise<PublicFreelancerSummary[]> {
  const users = await collections.users();
  const docs = await users
    .find({ role: "freelancer" })
    .sort({ firstName: 1 })
    .toArray();
  return docs.map((doc) => toSummary(doc as Record<string, unknown>));
}

export async function getFreelancer(id: string): Promise<PublicFreelancer> {
  const user = await findUserById(id);
  if (!user || text(user.role).toLowerCase() !== "freelancer") {
    throw notFound("Freelance introuvable.");
  }
  return toDetail(user);
}
