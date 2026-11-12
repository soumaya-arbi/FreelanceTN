// Règles métier du module Account Settings, portées depuis AccountService.cs.
//
// Seul le sous-ensemble migré est implémenté : profil client, avatar,
// facturation, préférences de notification, préférences d'affichage, historique,
// export et profil public. Sécurité, 2FA, sessions et équipe restent sur .NET.

import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import {
  ActionError,
  notFound,
  unauthorized,
  validationError,
} from "@/lib/server/errors";
import { text } from "@/lib/server/serialize";
import { recordAccountChange } from "@/lib/server/accountChanges";
import { findUserById } from "@/lib/server/repositories/users";
import {
  findBillingProfile,
  findNotificationPreferences,
  findUserPreferences,
  insertBillingProfile,
  insertNotificationPreferences,
  insertUserPreferences,
  listAccountChanges,
  listTeamMembers,
  replaceBillingProfile,
  replaceNotificationPreferences,
  replaceUserPreferences,
  updateUserFields,
  type BillingHistoryDocument,
  type BillingProfileDocument,
  type NotificationPreferencesDocument,
  type UserPreferencesDocument,
} from "@/lib/server/repositories/account";

const AVATAR_SOURCES = ["initials", "preset", "upload", "generated"] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVALID_REQUEST_MESSAGE = "La requête contient des données invalides.";

type ProfileField = { key: string; max: number };

const PROFILE_FIELDS: ProfileField[] = [
  { key: "firstName", max: 80 },
  { key: "lastName", max: 80 },
  { key: "phone", max: 40 },
  { key: "companyName", max: 160 },
  { key: "companyLogo", max: 500 },
  { key: "coverImage", max: 500 },
  { key: "industry", max: 120 },
  { key: "position", max: 120 },
  { key: "companyWebsite", max: 500 },
  { key: "companySize", max: 60 },
  { key: "companyDescription", max: 2000 },
  { key: "country", max: 120 },
  { key: "governorate", max: 120 },
  { key: "city", max: 120 },
  { key: "businessAddress", max: 300 },
  { key: "personalPresentation", max: 2000 },
  { key: "professionalEmail", max: 254 },
  { key: "professionalPhone", max: 40 },
  { key: "website", max: 500 },
];

const BILLING_FIELDS: { key: string; label: string; max: number }[] = [
  { key: "legalName", label: "Nom légal", max: 200 },
  { key: "billingAddress", label: "Adresse de facturation", max: 300 },
  { key: "country", label: "Pays", max: 120 },
  { key: "governorate", label: "Gouvernorat", max: 120 },
  { key: "city", label: "Ville", max: 120 },
  { key: "taxId", label: "Identifiant fiscal", max: 60 },
  { key: "contactName", label: "Nom du contact", max: 160 },
  { key: "contactEmail", label: "E-mail de contact", max: 254 },
  { key: "contactPhone", label: "Téléphone de contact", max: 40 },
];

function invalidRequest(errors: string[]): ActionError {
  return validationError(INVALID_REQUEST_MESSAGE, errors);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isoDate(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

function prefBoolean(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Source d'avatar normalisée (minuscules), validée comme AvatarStyleRequest. */
function normalizeAvatarSource(value: unknown, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.push("Source d'avatar invalide.");
    return null;
  }
  const source = value.trim().toLowerCase();
  if (!(AVATAR_SOURCES as readonly string[]).includes(source)) {
    errors.push("Source d'avatar invalide.");
    return null;
  }
  return source;
}

/** Couleur #RRGGBB validée (insensible à la casse), vide autorisée. */
function validateColor(value: unknown, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.push("La couleur doit être au format hexadécimal #RRGGBB.");
    return null;
  }
  const trimmed = value.trim();
  if (trimmed !== "" && !HEX_COLOR.test(trimmed)) {
    errors.push("La couleur doit être au format hexadécimal #RRGGBB.");
    return null;
  }
  return trimmed;
}

// ---------------------------------------------------------------- Profil client

type ClientProfileFields = Record<string, unknown>;

function toClientProfile(doc: Record<string, unknown>): ClientProfileFields {
  const avatarSource = text(doc.avatarSource).trim();
  const profile: ClientProfileFields = {
    id: doc._id instanceof ObjectId ? doc._id.toHexString() : text(doc._id),
    email: text(doc.email),
    emailVerified: doc.emailVerified !== false,
    hasPassword: text(doc.passwordHash).trim().length > 0,
    role: text(doc.role),
    firstName: text(doc.firstName),
    lastName: text(doc.lastName),
    phone: text(doc.phone),
    avatar: text(doc.avatar),
    avatarSource: avatarSource === "" ? "initials" : avatarSource,
    avatarPreset: text(doc.avatarPreset),
    avatarColor: text(doc.avatarColor),
    avatarConfig: typeof doc.avatarConfig === "string" ? doc.avatarConfig : null,
    companyName: text(doc.companyName),
    companyLogo: text(doc.companyLogo),
    coverImage: text(doc.coverImage),
    industry: text(doc.industry),
    position: text(doc.position),
    companyWebsite: text(doc.companyWebsite),
    companySize: text(doc.companySize),
    companyDescription: text(doc.companyDescription),
    country: text(doc.country),
    governorate: text(doc.governorate),
    city: text(doc.city),
    businessAddress: text(doc.businessAddress),
    personalPresentation: text(doc.personalPresentation),
    professionalEmail: text(doc.professionalEmail),
    professionalPhone: text(doc.professionalPhone),
    website: text(doc.website),
    bio: text(doc.bio),
    createdAt: isoDate(doc.createdAt),
    updatedAt: isoDate(doc.updatedAt),
  };

  const completionFields: { label: string; value: string }[] = [
    { label: "Prénom", value: text(profile.firstName) },
    { label: "Nom", value: text(profile.lastName) },
    { label: "Téléphone", value: text(profile.phone) },
    { label: "Nom de l'entreprise", value: text(profile.companyName) },
    { label: "Secteur d'activité", value: text(profile.industry) },
    { label: "Poste occupé", value: text(profile.position) },
    { label: "Site web", value: text(profile.companyWebsite) },
    { label: "Taille de l'entreprise", value: text(profile.companySize) },
    { label: "Description de l'entreprise", value: text(profile.companyDescription) },
    { label: "Pays", value: text(profile.country) },
    { label: "Gouvernorat", value: text(profile.governorate) },
    { label: "Ville", value: text(profile.city) },
    { label: "Adresse professionnelle", value: text(profile.businessAddress) },
    { label: "Présentation personnelle", value: text(profile.personalPresentation) },
  ];

  const missingFields = completionFields
    .filter((field) => field.value.trim() === "")
    .map((field) => field.label);
  profile.missingFields = missingFields;
  profile.profileCompletion = Math.round(
    ((completionFields.length - missingFields.length) * 100) / completionFields.length,
  );

  return profile;
}

async function requireUserDocument(userId: string): Promise<Record<string, unknown>> {
  const doc = await findUserById(userId);
  if (!doc) throw unauthorized("Session invalide.");
  return doc as Record<string, unknown>;
}

export async function getClientProfile(
  user: SessionUser,
): Promise<Record<string, unknown>> {
  const doc = await requireUserDocument(user.id);
  return toClientProfile(doc);
}

export async function updateClientProfile(
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await requireUserDocument(user.id);

  const errors: string[] = [];
  const values: Record<string, string | null> = {};

  for (const field of PROFILE_FIELDS) {
    const raw = input[field.key];
    if (raw === undefined || raw === null) {
      values[field.key] = null;
      continue;
    }
    if (typeof raw !== "string") {
      errors.push(`Le champ ${field.key} est invalide.`);
      values[field.key] = null;
      continue;
    }
    values[field.key] = raw;
    if (raw.length > field.max) {
      errors.push(`Le champ ${field.key} ne doit pas dépasser ${field.max} caractères.`);
    }
  }

  const companyWebsite = values.companyWebsite;
  if (typeof companyWebsite === "string" && companyWebsite.trim() !== "" && !isHttpUrl(companyWebsite)) {
    errors.push("Le site web de l'entreprise n'est pas une URL valide.");
  }
  const website = values.website;
  if (typeof website === "string" && website.trim() !== "" && !isHttpUrl(website)) {
    errors.push("Le site web personnel n'est pas une URL valide.");
  }
  const professionalEmail = values.professionalEmail;
  if (
    typeof professionalEmail === "string" &&
    professionalEmail.trim() !== "" &&
    !EMAIL_PATTERN.test(professionalEmail.trim())
  ) {
    errors.push("L'e-mail professionnel n'est pas valide.");
  }

  const avatarSource = normalizeAvatarSource(input.avatarSource, errors);
  const avatarColor = validateColor(input.avatarColor, errors);

  let avatarPreset: string | null = null;
  const rawPreset = input.avatarPreset;
  if (rawPreset !== undefined && rawPreset !== null) {
    if (typeof rawPreset !== "string") {
      errors.push("Le champ avatarPreset est invalide.");
    } else {
      avatarPreset = rawPreset;
      if (rawPreset.length > 60) {
        errors.push("Le champ avatarPreset ne doit pas dépasser 60 caractères.");
      }
    }
  }

  let avatarConfig: string | null = null;
  const rawConfig = input.avatarConfig;
  if (rawConfig !== undefined && rawConfig !== null) {
    if (typeof rawConfig !== "string") {
      errors.push("Le champ avatarConfig est invalide.");
    } else {
      avatarConfig = rawConfig;
    }
  }

  if (errors.length > 0) throw invalidRequest(errors);

  const fields: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    const value = values[field.key];
    if (value !== null) fields[field.key] = value.trim();
  }
  if (avatarSource !== null) fields.avatarSource = avatarSource;
  if (avatarPreset !== null) fields.avatarPreset = avatarPreset.trim();
  if (avatarColor !== null) fields.avatarColor = avatarColor;
  if (avatarConfig !== null) fields.avatarConfig = avatarConfig;
  fields.updatedAt = new Date();

  await updateUserFields(user.id, fields);
  await recordAccountChange(user.id, "Profil", "Mise à jour du profil professionnel");

  const doc = await requireUserDocument(user.id);
  return toClientProfile(doc);
}

export async function setAvatarStyle(
  user: SessionUser,
  input: {
    source?: "initials" | "preset" | "upload" | "generated";
    preset?: string;
    color?: string;
    config?: string;
  },
): Promise<Record<string, unknown>> {
  await requireUserDocument(user.id);

  const errors: string[] = [];
  const source = normalizeAvatarSource(input.source, errors);
  if (typeof input.preset === "string" && input.preset.length > 60) {
    errors.push("Le champ avatarPreset ne doit pas dépasser 60 caractères.");
  }

  let color: string | null = null;
  if (input.color !== undefined && input.color !== null) {
    if (typeof input.color !== "string") {
      errors.push("La couleur doit être au format hexadécimal #RRGGBB.");
    } else {
      const trimmed = input.color.trim();
      if (trimmed !== "" && !HEX_COLOR.test(trimmed)) {
        throw new ActionError(400, "La couleur doit être au format hexadécimal #RRGGBB.");
      }
      color = trimmed.toLowerCase();
    }
  }

  if (errors.length > 0) throw invalidRequest(errors);

  const fields: Record<string, unknown> = {};
  if (source !== null) fields.avatarSource = source;
  if (input.preset !== undefined && input.preset !== null) fields.avatarPreset = input.preset.trim();
  if (color !== null) fields.avatarColor = color;
  if (input.config !== undefined && input.config !== null) fields.avatarConfig = input.config;
  fields.updatedAt = new Date();

  await updateUserFields(user.id, fields);
  await recordAccountChange(user.id, "Profil", "Personnalisation de l'avatar");

  const doc = await requireUserDocument(user.id);
  return toClientProfile(doc);
}

// ---------------------------------------------------------------- Facturation

function toBillingResponse(
  billing: BillingProfileDocument | null,
): Record<string, unknown> {
  if (!billing) {
    return {
      legalName: "",
      billingAddress: "",
      country: "",
      governorate: "",
      city: "",
      taxId: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      history: [],
      updatedAt: null,
    };
  }

  const history = Array.isArray(billing.history)
    ? [...billing.history].sort((left, right) => {
        const leftTime = left.changedAt instanceof Date ? left.changedAt.getTime() : 0;
        const rightTime = right.changedAt instanceof Date ? right.changedAt.getTime() : 0;
        return rightTime - leftTime;
      })
    : [];

  return {
    legalName: text(billing.legalName),
    billingAddress: text(billing.billingAddress),
    country: text(billing.country),
    governorate: text(billing.governorate),
    city: text(billing.city),
    taxId: text(billing.taxId),
    contactName: text(billing.contactName),
    contactEmail: text(billing.contactEmail),
    contactPhone: text(billing.contactPhone),
    history: history.map((entry) => ({
      changedAt: isoDate(entry.changedAt),
      fields: stringList(entry.fields),
    })),
    updatedAt: isoDate(billing.updatedAt),
  };
}

export async function getBillingProfile(
  user: SessionUser,
): Promise<Record<string, unknown>> {
  const billing = await findBillingProfile(user.id);
  return toBillingResponse(billing);
}

export async function updateBillingProfile(
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  const values: Record<string, string | null> = {};

  for (const field of BILLING_FIELDS) {
    const raw = input[field.key];
    if (raw === undefined || raw === null) {
      values[field.key] = null;
      continue;
    }
    if (typeof raw !== "string") {
      errors.push(`Le champ ${field.key} est invalide.`);
      values[field.key] = null;
      continue;
    }
    values[field.key] = raw;
    if (raw.length > field.max) {
      errors.push(`Le champ ${field.key} ne doit pas dépasser ${field.max} caractères.`);
    }
  }

  const contactEmail = values.contactEmail;
  if (
    typeof contactEmail === "string" &&
    contactEmail.trim() !== "" &&
    !EMAIL_PATTERN.test(contactEmail.trim())
  ) {
    errors.push("L'e-mail de contact n'est pas valide.");
  }

  if (errors.length > 0) throw invalidRequest(errors);

  const existing = await findBillingProfile(user.id);
  const isNew = existing === null;
  const now = new Date();

  const profile: BillingProfileDocument = isNew
    ? {
        _id: new ObjectId(),
        userId: new ObjectId(user.id),
        legalName: "",
        billingAddress: "",
        country: "",
        governorate: "",
        city: "",
        taxId: "",
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        history: [],
        createdAt: now,
        updatedAt: now,
      }
    : { ...(existing as BillingProfileDocument) };

  const changed: string[] = [];
  for (const field of BILLING_FIELDS) {
    const value = values[field.key];
    if (value === null) continue;
    const trimmed = value.trim();
    const previous = typeof profile[field.key] === "string" ? (profile[field.key] as string) : "";
    if (previous !== trimmed) changed.push(field.label);
    profile[field.key] = trimmed;
  }

  const history: BillingHistoryDocument[] = Array.isArray(profile.history)
    ? [...profile.history]
    : [];
  history.push({ changedAt: now, changedByUserId: user.id, fields: changed });
  profile.history = history;
  profile.updatedAt = now;

  if (isNew) {
    profile.createdAt = now;
    await insertBillingProfile(profile);
  } else {
    await replaceBillingProfile(profile);
  }

  await recordAccountChange(
    user.id,
    "Facturation",
    "Mise à jour des informations de facturation",
  );

  return toBillingResponse(profile);
}

// ---------------------------------------------------------------- Notifications

function toNotificationPreferences(
  preferences: NotificationPreferencesDocument | null,
): Record<string, unknown> {
  return {
    emailEnabled: prefBoolean(preferences?.emailEnabled),
    inAppEnabled: prefBoolean(preferences?.inAppEnabled),
    invitationsEnabled: prefBoolean(preferences?.invitationsEnabled),
    projectActivityEnabled: prefBoolean(preferences?.projectActivityEnabled),
    messagesEnabled: prefBoolean(preferences?.messagesEnabled),
    billingEnabled: prefBoolean(preferences?.billingEnabled),
  };
}

export async function getNotificationPreferences(
  user: SessionUser,
): Promise<Record<string, unknown>> {
  const preferences = await findNotificationPreferences(user.id);
  return toNotificationPreferences(preferences);
}

export async function updateNotificationPreferences(
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existing = await findNotificationPreferences(user.id);
  const isNew = existing === null;
  const now = new Date();

  const values = {
    emailEnabled: prefBoolean(input.emailEnabled),
    inAppEnabled: prefBoolean(input.inAppEnabled),
    invitationsEnabled: prefBoolean(input.invitationsEnabled),
    projectActivityEnabled: prefBoolean(input.projectActivityEnabled),
    messagesEnabled: prefBoolean(input.messagesEnabled),
    billingEnabled: prefBoolean(input.billingEnabled),
  };

  const preferences: NotificationPreferencesDocument = isNew
    ? {
        _id: new ObjectId(),
        userId: new ObjectId(user.id),
        ...values,
        createdAt: now,
        updatedAt: now,
      }
    : { ...(existing as NotificationPreferencesDocument), ...values, updatedAt: now };

  if (isNew) {
    await insertNotificationPreferences(preferences);
  } else {
    await replaceNotificationPreferences(preferences);
  }

  await recordAccountChange(
    user.id,
    "Notifications",
    "Mise à jour des préférences de notification",
  );

  return toNotificationPreferences(preferences);
}

// ---------------------------------------------------------------- Préférences

function toUserPreferences(
  preferences: UserPreferencesDocument | null,
): Record<string, unknown> {
  return {
    language: text(preferences?.language, "fr"),
    currency: text(preferences?.currency, "TND"),
    theme: text(preferences?.theme, "light"),
    timezone: text(preferences?.timezone, "Africa/Tunis"),
    dateFormat: text(preferences?.dateFormat, "DD/MM/YYYY"),
    thousandsSeparator: prefBoolean(preferences?.thousandsSeparator),
  };
}

export async function getUserPreferences(
  user: SessionUser,
): Promise<Record<string, unknown>> {
  const preferences = await findUserPreferences(user.id);
  return toUserPreferences(preferences);
}

function readPreferenceText(
  input: Record<string, unknown>,
  key: string,
  fallback: string,
  errors: string[],
): string {
  const raw = input[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "string") {
    errors.push(`Le champ ${key} est invalide.`);
    return fallback;
  }
  return raw;
}

export async function updateUserPreferences(
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  const language = readPreferenceText(input, "language", "fr", errors);
  const currency = readPreferenceText(input, "currency", "TND", errors);
  const theme = readPreferenceText(input, "theme", "light", errors);
  const timezone = readPreferenceText(input, "timezone", "Africa/Tunis", errors);
  const dateFormat = readPreferenceText(input, "dateFormat", "DD/MM/YYYY", errors);
  const thousandsSeparator = prefBoolean(input.thousandsSeparator);

  if (language !== "fr" && language !== "en") {
    errors.push("La langue doit être 'fr' ou 'en'.");
  }
  if (theme !== "light" && theme !== "dark") {
    errors.push("Le thème doit être 'light' ou 'dark'.");
  }
  if (currency.trim().toUpperCase() !== "TND") {
    errors.push("La devise par défaut de la plateforme est TND.");
  }
  if (timezone.trim() === "") {
    errors.push("Le fuseau horaire est obligatoire.");
  } else if (timezone.length > 80) {
    errors.push("Le fuseau horaire ne doit pas dépasser 80 caractères.");
  }
  if (dateFormat !== "DD/MM/YYYY" && dateFormat !== "YYYY-MM-DD") {
    errors.push("Le format de date doit être DD/MM/YYYY ou YYYY-MM-DD.");
  }

  if (errors.length > 0) throw invalidRequest(errors);

  const existing = await findUserPreferences(user.id);
  const isNew = existing === null;
  const now = new Date();

  const values = {
    language,
    currency: "TND",
    theme,
    timezone: timezone.trim(),
    dateFormat: dateFormat === "YYYY-MM-DD" ? "YYYY-MM-DD" : "DD/MM/YYYY",
    thousandsSeparator,
  };

  const preferences: UserPreferencesDocument = isNew
    ? {
        _id: new ObjectId(),
        userId: new ObjectId(user.id),
        ...values,
        createdAt: now,
        updatedAt: now,
      }
    : { ...(existing as UserPreferencesDocument), ...values, updatedAt: now };

  if (isNew) {
    await insertUserPreferences(preferences);
  } else {
    await replaceUserPreferences(preferences);
  }

  await recordAccountChange(user.id, "Préférences", "Mise à jour des préférences");

  return toUserPreferences(preferences);
}

// ---------------------------------------------------------------- Historique / export / public

export async function getAccountHistory(
  user: SessionUser,
): Promise<Record<string, unknown>[]> {
  const changes = await listAccountChanges(user.id, 50);
  return changes.map((change) => ({
    area: text(change.area),
    summary: text(change.summary),
    createdAt: isoDate(change.createdAt),
  }));
}

function toTeamResponse(member: Record<string, unknown>): Record<string, unknown> {
  return {
    id: member._id instanceof ObjectId ? member._id.toHexString() : text(member._id),
    email: text(member.email),
    name: text(member.name),
    role: text(member.role),
    status: text(member.status),
    isOwner: false,
    canManage: true,
    invitedAt: isoDate(member.invitedAt),
    acceptedAt: isoDate(member.acceptedAt),
    revokedAt: isoDate(member.revokedAt),
  };
}

export async function exportAccount(
  user: SessionUser,
): Promise<Record<string, unknown>> {
  const profile = await getClientProfile(user);
  const billing = await getBillingProfile(user);
  const preferences = await getUserPreferences(user);
  const notifications = await getNotificationPreferences(user);
  const team = (await listTeamMembers(user.id)).map(toTeamResponse);

  return {
    generatedAt: new Date().toISOString(),
    profile,
    billing,
    preferences,
    notifications,
    team,
  };
}

export async function getPublicClientProfile(
  id: string,
): Promise<Record<string, unknown>> {
  if (!ObjectId.isValid(id)) throw notFound("Profil introuvable.");

  const doc = await findUserById(id);
  if (!doc || text(doc.role) !== "client") throw notFound("Profil introuvable.");

  const displayName = [text(doc.firstName), text(doc.lastName)]
    .filter((part) => part.trim() !== "")
    .join(" ");
  const avatarSource = text(doc.avatarSource).trim();

  return {
    displayName,
    companyName: text(doc.companyName),
    companyLogo: text(doc.companyLogo),
    coverImage: text(doc.coverImage),
    industry: text(doc.industry),
    position: text(doc.position),
    companyWebsite: text(doc.companyWebsite),
    companySize: text(doc.companySize),
    companyDescription: text(doc.companyDescription),
    country: text(doc.country),
    governorate: text(doc.governorate),
    city: text(doc.city),
    personalPresentation: text(doc.personalPresentation),
    avatar: text(doc.avatar),
    avatarSource: avatarSource === "" ? "initials" : avatarSource,
    avatarConfig: typeof doc.avatarConfig === "string" ? doc.avatarConfig : null,
    verified: doc.emailVerified !== false,
    // Date réelle d'inscription, utile pour l'ancienneté publique. Le reste du
    // document (email, téléphone, adresse, facturation) n'est jamais exposé.
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : text(doc.createdAt),
  };
}
