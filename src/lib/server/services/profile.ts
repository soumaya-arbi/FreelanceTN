// Règles métier du profil utilisateur.
//
// Portage fidèle de backend/src/FreelanceTn.Api/Services/AuthService.cs :
// UpdateProfileAsync, CanonicalizeLanguageLevel, CleanDate, CleanList et
// ToResponse (réutilisé via toAuthUserResponse). Un champ absent (undefined ou
// null) n'est jamais modifié ; un champ fourni remplace intégralement la valeur
// stockée, comme le fait le service C#.

import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { ActionError, validationError } from "@/lib/server/errors";
import { toAuthUserResponse, type UserDocument } from "@/lib/server/repositories/users";
import { toDecimal } from "@/lib/server/serialize";

// --- Types d'entrée (miroir de src/lib/api.ts) ----------------------------

export type AvatarSource = "initials" | "preset" | "upload" | "generated";

export type CvExperienceInput = {
  id?: string;
  role: string;
  company: string;
  location: string;
  period: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  technologies: string[];
  description: string;
};

export type CvEducationInput = {
  id?: string;
  degree: string;
  institution: string;
  specialty: string;
  location: string;
  period: string;
  startDate: string;
  endDate: string;
  description: string;
};

export type CvLanguageInput = {
  id?: string;
  name: string;
  level: string;
};

export type CvCertificationInput = {
  id?: string;
  name: string;
  issuer: string;
  year: string;
};

export type CvWorkPreferencesInput = {
  projectTypes: string[];
  workPreference: string;
  minimumBudget: string;
};

export type UpdateProfileInput = {
  firstName?: string;
  lastName?: string;
  title?: string;
  location?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  bio?: string;
  avatar?: string;
  avatarSource?: AvatarSource;
  avatarConfig?: string;
  coverImage?: string;
  skills?: string[];
  hourlyRate?: number;
  experiences?: CvExperienceInput[];
  education?: CvEducationInput[];
  languages?: CvLanguageInput[];
  certifications?: CvCertificationInput[];
  workPreferences?: CvWorkPreferencesInput;
};

// --- Helpers de normalisation (AuthService) ------------------------------

const AVATAR_SOURCES = new Set(["initials", "preset", "upload", "generated"]);

const LANGUAGE_LEVELS = ["Basic", "Intermediate", "Advanced", "Native"];

/** Équivalent Guid.NewGuid().ToString("N") : 32 caractères hexadécimaux. */
function newEntryId(): string {
  return randomUUID().replace(/-/g, "");
}

function isProvided(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** AuthService.CleanDate : trim puis 20 caractères maximum. */
function cleanDate(value: unknown): string {
  const text = trimmed(value);
  return text.length > 20 ? text.slice(0, 20) : text;
}

/**
 * AuthService.CleanList : trim, valeurs non vides de longueur <= maxLength,
 * doublons ignorés sans tenir compte de la casse, 50 éléments maximum.
 */
function cleanList(values: unknown, maxLength: number): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = trimmed(raw);
    if (value.length === 0 || value.length > maxLength) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= 50) break;
  }
  return result;
}

/** Distinct() C# : doublons exacts (sensible à la casse), ordre conservé. */
function distinct(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * AuthService.CanonicalizeLanguageLevel : Basic / Intermediate / Advanced /
 * Native. Une valeur vide reste vide, une valeur inconnue est renvoyée telle
 * quelle (trimée).
 */
export function canonicalizeLanguageLevel(value: unknown): string {
  const text = trimmed(value);
  if (text.length === 0) return "";

  const key = text
    .toLowerCase()
    .replace(/é/g, "e")
    .replace(/è/g, "e")
    .replace(/ê/g, "e");

  switch (key) {
    case "basic":
    case "beginner":
    case "debutant":
    case "notions":
    case "a1":
      return "Basic";
    case "intermediate":
    case "intermediaire":
    case "moyen":
    case "a2":
    case "b1":
      return "Intermediate";
    case "advanced":
    case "avance":
    case "courant":
    case "fluent":
    case "b2":
    case "c1":
      return "Advanced";
    case "native":
    case "natif":
    case "maternelle":
    case "bilingue":
    case "bilingual":
    case "c2":
      return "Native";
    default:
      return text;
  }
}

function mapExperiences(values: unknown): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  return values.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const id = trimmed(entry.id);
    return {
      id: id.length > 0 ? id : newEntryId(),
      role: trimmed(entry.role),
      company: trimmed(entry.company),
      location: trimmed(entry.location),
      period: trimmed(entry.period),
      startDate: cleanDate(entry.startDate),
      endDate: cleanDate(entry.endDate),
      isCurrent: entry.isCurrent === true,
      technologies: cleanList(entry.technologies, 40),
      description: trimmed(entry.description),
    };
  });
}

function mapEducation(values: unknown): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  return values.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const id = trimmed(entry.id);
    return {
      id: id.length > 0 ? id : newEntryId(),
      degree: trimmed(entry.degree),
      institution: trimmed(entry.institution),
      specialty: trimmed(entry.specialty),
      location: trimmed(entry.location),
      period: trimmed(entry.period),
      startDate: cleanDate(entry.startDate),
      endDate: cleanDate(entry.endDate),
      description: trimmed(entry.description),
    };
  });
}

function mapCertifications(values: unknown): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((raw) => {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const id = trimmed(entry.id);
      return {
        id: id.length > 0 ? id : newEntryId(),
        name: trimmed(entry.name),
        issuer: trimmed(entry.issuer),
        year: trimmed(entry.year),
      };
    })
    .filter((entry) => (entry.name as string).length > 0);
}

function mapLanguages(values: unknown): Record<string, unknown>[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((raw) => {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const id = trimmed(entry.id);
      return {
        id: id.length > 0 ? id : newEntryId(),
        name: trimmed(entry.name),
        level: canonicalizeLanguageLevel(entry.level),
      };
    })
    .filter((entry) => (entry.name as string).length > 0);
}

function mapWorkPreferences(value: unknown): Record<string, unknown> {
  const entry = (value ?? {}) as Record<string, unknown>;
  const projectTypes = Array.isArray(entry.projectTypes)
    ? distinct(entry.projectTypes.map((item) => trimmed(item)).filter((item) => item.length > 0))
    : [];
  return {
    projectTypes,
    workPreference: trimmed(entry.workPreference),
    minimumBudget: trimmed(entry.minimumBudget),
  };
}

// --- Validation (UpdateProfileRequestValidator) ---------------------------

function checkLength(errors: string[], value: unknown, label: string, max: number): void {
  if (typeof value === "string" && value.length > max) {
    errors.push(`${label} ne doit pas dépasser ${max} caractères.`);
  }
}

function checkMaxItems(errors: string[], value: unknown, message: string, max: number): void {
  if (Array.isArray(value) && value.length > max) errors.push(message);
}

function entriesOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => (item ?? {}) as Record<string, unknown>) : [];
}

function validateUpdateProfile(input: UpdateProfileInput): void {
  const errors: string[] = [];

  checkLength(errors, input.firstName, "Le prénom", 80);
  checkLength(errors, input.lastName, "Le nom", 80);
  checkLength(errors, input.title, "Le titre", 160);
  checkLength(errors, input.location, "La localisation", 160);
  checkLength(errors, input.phone, "Le téléphone", 40);
  checkLength(errors, input.linkedin, "Le profil LinkedIn", 500);
  checkLength(errors, input.github, "Le profil GitHub", 500);
  checkLength(errors, input.website, "Le site web", 500);
  checkLength(errors, input.bio, "La biographie", 2000);
  checkLength(errors, input.avatar, "L'avatar", 500);

  checkMaxItems(errors, input.skills, "Trop de compétences (60 maximum).", 60);
  if (Array.isArray(input.skills)) {
    for (const skill of input.skills) checkLength(errors, skill, "Une compétence", 60);
  }

  if (typeof input.hourlyRate === "number" && input.hourlyRate < 0) {
    errors.push("Le tarif horaire ne peut pas être négatif.");
  }

  checkMaxItems(errors, input.experiences, "Trop d'expériences (30 maximum).", 30);
  for (const entry of entriesOf(input.experiences)) {
    checkLength(errors, entry.role, "L'intitulé du poste", 120);
    checkLength(errors, entry.company, "L'entreprise", 120);
    checkLength(errors, entry.location, "La localisation", 160);
    checkLength(errors, entry.period, "La période", 60);
    checkLength(errors, entry.startDate, "La date de début", 20);
    checkLength(errors, entry.endDate, "La date de fin", 20);
    checkMaxItems(errors, entry.technologies, "Trop de technologies (20 maximum).", 20);
    if (Array.isArray(entry.technologies)) {
      for (const technology of entry.technologies) {
        checkLength(errors, technology, "Une technologie", 40);
      }
    }
    checkLength(errors, entry.description, "La description", 1000);
  }

  checkMaxItems(errors, input.education, "Trop de formations (30 maximum).", 30);
  for (const entry of entriesOf(input.education)) {
    checkLength(errors, entry.degree, "Le diplôme", 120);
    checkLength(errors, entry.institution, "L'établissement", 120);
    checkLength(errors, entry.specialty, "La spécialité", 160);
    checkLength(errors, entry.location, "La localisation", 160);
    checkLength(errors, entry.period, "La période", 60);
    checkLength(errors, entry.startDate, "La date de début", 20);
    checkLength(errors, entry.endDate, "La date de fin", 20);
    checkLength(errors, entry.description, "La description", 1000);
  }

  checkMaxItems(errors, input.languages, "Trop de langues (20 maximum).", 20);
  for (const entry of entriesOf(input.languages)) {
    checkLength(errors, entry.name, "Le nom de la langue", 60);
    const level = canonicalizeLanguageLevel(entry.level);
    if (level.length > 0 && !LANGUAGE_LEVELS.includes(level)) {
      errors.push("Le niveau de langue doit être Basic, Intermediate, Advanced ou Native.");
    }
  }

  checkMaxItems(errors, input.certifications, "Trop de certifications (30 maximum).", 30);
  for (const entry of entriesOf(input.certifications)) {
    checkLength(errors, entry.name, "Le nom de la certification", 160);
    checkLength(errors, entry.issuer, "L'organisme", 160);
    checkLength(errors, entry.year, "L'année", 20);
  }

  if (isProvided(input.workPreferences)) {
    const preferences = (input.workPreferences ?? {}) as unknown as Record<string, unknown>;
    checkMaxItems(
      errors,
      preferences.projectTypes,
      "Trop de types de projets (10 maximum).",
      10,
    );
    if (Array.isArray(preferences.projectTypes)) {
      for (const projectType of preferences.projectTypes) {
        checkLength(errors, projectType, "Un type de projet", 80);
      }
    }
    checkLength(errors, preferences.workPreference, "La modalité de travail", 60);
    checkLength(errors, preferences.minimumBudget, "Le budget minimum", 60);
  }

  if (errors.length > 0) {
    throw validationError("Les données du profil sont invalides.", errors);
  }
}

// --- Mise à jour ----------------------------------------------------------

/**
 * Applique les champs fournis au profil de l'utilisateur authentifié et renvoie
 * la réponse complète UserResponse (AuthService.ToResponse).
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<Record<string, unknown>> {
  if (!ObjectId.isValid(userId)) throw new ActionError(401, "Session invalide.");

  validateUpdateProfile(input);

  const patch: Record<string, unknown> = {};

  if (isProvided(input.firstName)) patch.firstName = trimmed(input.firstName);
  if (isProvided(input.lastName)) patch.lastName = trimmed(input.lastName);
  if (isProvided(input.title)) patch.title = trimmed(input.title);
  if (isProvided(input.location)) patch.location = trimmed(input.location);
  if (isProvided(input.phone)) patch.phone = trimmed(input.phone);
  if (isProvided(input.linkedin)) patch.linkedin = trimmed(input.linkedin);
  if (isProvided(input.github)) patch.github = trimmed(input.github);
  if (isProvided(input.website)) patch.website = trimmed(input.website);
  if (isProvided(input.bio)) patch.bio = trimmed(input.bio);
  if (isProvided(input.avatar)) patch.avatar = trimmed(input.avatar);
  if (isProvided(input.coverImage)) patch.coverImage = trimmed(input.coverImage);

  // AvatarConfig n'est jamais trimé par le service C#.
  if (isProvided(input.avatarConfig) && typeof input.avatarConfig === "string") {
    patch.avatarConfig = input.avatarConfig;
  }

  if (isProvided(input.avatarSource) && typeof input.avatarSource === "string") {
    const source = input.avatarSource.trim().toLowerCase();
    if (AVATAR_SOURCES.has(source)) patch.avatarSource = source;
  }

  if (isProvided(input.skills)) {
    const skills = Array.isArray(input.skills)
      ? distinct(input.skills.map((skill) => trimmed(skill)).filter((skill) => skill.length > 0))
      : [];
    patch.skills = skills;
  }

  if (isProvided(input.hourlyRate)) patch.hourlyRate = toDecimal(input.hourlyRate);

  if (isProvided(input.experiences)) patch.experiences = mapExperiences(input.experiences);
  if (isProvided(input.education)) patch.education = mapEducation(input.education);
  if (isProvided(input.certifications)) {
    patch.certifications = mapCertifications(input.certifications);
  }
  if (isProvided(input.languages)) patch.languages = mapLanguages(input.languages);
  if (isProvided(input.workPreferences)) {
    patch.workPreferences = mapWorkPreferences(input.workPreferences);
  }

  patch.updatedAt = new Date();

  // Mise à jour atomique partielle : les champs non fournis (mot de passe,
  // jetons, portefeuille, profil client...) restent intacts.
  const users = await collections.users();
  const updated = await users.findOneAndUpdate(
    { _id: new ObjectId(userId) },
    { $set: patch },
    { returnDocument: "after" },
  );

  if (!updated) throw new ActionError(401, "Session invalide.");

  return toAuthUserResponse(updated as UserDocument);
}
