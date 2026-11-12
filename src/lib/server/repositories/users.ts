// Accès et projections du document "users".
// Partagé par les modules profil, compte, freelancers, projets et candidatures.

import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { number, text } from "@/lib/server/serialize";

export type UserDocument = Record<string, unknown> & {
  _id: ObjectId;
};

export async function findUserById(id: string): Promise<UserDocument | null> {
  if (!ObjectId.isValid(id)) return null;
  const users = await collections.users();
  return (await users.findOne({ _id: new ObjectId(id) })) as UserDocument | null;
}

export async function findUsersByIds(ids: string[]): Promise<UserDocument[]> {
  const objectIds = ids
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (objectIds.length === 0) return [];
  const users = await collections.users();
  return (await users.find({ _id: { $in: objectIds } }).toArray()) as UserDocument[];
}

export async function findUserByEmail(email: string): Promise<UserDocument | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const users = await collections.users();
  return (await users.findOne({ emailNormalized: normalized })) as UserDocument | null;
}

export function userDisplayName(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return "";
  const name = `${text(doc.firstName)} ${text(doc.lastName)}`.trim();
  return name || text(doc.email);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function mapExperiences(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      id: text(item.id),
      role: text(item.role),
      company: text(item.company),
      location: text(item.location),
      period: text(item.period),
      startDate: text(item.startDate),
      endDate: text(item.endDate),
      isCurrent: item.isCurrent === true,
      technologies: stringList(item.technologies),
      description: text(item.description),
    };
  });
}

function mapEducation(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      id: text(item.id),
      degree: text(item.degree),
      institution: text(item.institution),
      specialty: text(item.specialty),
      location: text(item.location),
      period: text(item.period),
      startDate: text(item.startDate),
      endDate: text(item.endDate),
      description: text(item.description),
    };
  });
}

function mapLanguages(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return { id: text(item.id), name: text(item.name), level: text(item.level) };
  });
}

function mapCertifications(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      id: text(item.id),
      name: text(item.name),
      issuer: text(item.issuer),
      year: text(item.year),
    };
  });
}

function mapWorkPreferences(value: unknown): Record<string, unknown> {
  const item = (value ?? {}) as Record<string, unknown>;
  return {
    projectTypes: stringList(item.projectTypes),
    workPreference: text(item.workPreference),
    minimumBudget: text(item.minimumBudget),
  };
}

/** Projection complète UserResponse (AuthService.ToResponse). */
export function toAuthUserResponse(doc: UserDocument | Record<string, unknown>): Record<string, unknown> {
  const user = doc as Record<string, unknown>;
  return {
    id: user._id instanceof ObjectId ? user._id.toHexString() : text(user.id),
    email: text(user.email),
    emailVerified: user.emailVerified !== false,
    hasPassword: text(user.passwordHash).length > 0,
    requirePasswordChange: user.requirePasswordChange === true,
    role: text(user.role, "freelancer"),
    firstName: text(user.firstName),
    lastName: text(user.lastName),
    title: text(user.title),
    location: text(user.location),
    phone: text(user.phone),
    linkedin: text(user.linkedin),
    github: text(user.github),
    website: text(user.website),
    bio: text(user.bio),
    avatar: text(user.avatar),
    avatarSource: text(user.avatarSource, "initials"),
    avatarPreset: text(user.avatarPreset),
    avatarColor: text(user.avatarColor),
    avatarConfig: text(user.avatarConfig),
    companyName: text(user.companyName),
    companyLogo: text(user.companyLogo),
    coverImage: text(user.coverImage),
    industry: text(user.industry),
    position: text(user.position),
    companyWebsite: text(user.companyWebsite),
    companySize: text(user.companySize),
    companyDescription: text(user.companyDescription),
    country: text(user.country),
    governorate: text(user.governorate),
    city: text(user.city),
    businessAddress: text(user.businessAddress),
    personalPresentation: text(user.personalPresentation),
    professionalEmail: text(user.professionalEmail),
    professionalPhone: text(user.professionalPhone),
    skills: stringList(user.skills),
    hourlyRate: number(user.hourlyRate),
    experiences: mapExperiences(user.experiences),
    education: mapEducation(user.education),
    languages: mapLanguages(user.languages),
    certifications: mapCertifications(user.certifications),
    workPreferences: mapWorkPreferences(user.workPreferences),
    createdAt: iso(user.createdAt),
    updatedAt: iso(user.updatedAt),
  };
}

/** Résumé public d'un freelance (annuaire / assignation projet). */
export function toFreelancerSummary(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    id: doc._id instanceof ObjectId ? doc._id.toHexString() : text(doc.id),
    name: userDisplayName(doc),
    title: text(doc.title),
    avatar: text(doc.avatar),
  };
}

/** Profil public complet d'un freelance (FreelancersController). */
export function toPublicFreelancer(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    id: doc._id instanceof ObjectId ? doc._id.toHexString() : text(doc.id),
    name: userDisplayName(doc),
    title: text(doc.title),
    location: text(doc.location),
    bio: text(doc.bio),
    avatar: text(doc.avatar),
    coverImage: text(doc.coverImage),
    avatarSource: text(doc.avatarSource, "initials"),
    avatarConfig: text(doc.avatarConfig),
    skills: stringList(doc.skills),
    hourlyRate: number(doc.hourlyRate),
    experiences: mapExperiences(doc.experiences),
    education: mapEducation(doc.education),
    languages: mapLanguages(doc.languages),
    certifications: mapCertifications(doc.certifications),
    workPreferences: mapWorkPreferences(doc.workPreferences),
    createdAt: iso(doc.createdAt),
  };
}
