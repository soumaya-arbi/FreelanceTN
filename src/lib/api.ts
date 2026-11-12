// Couche d'accès API centralisée pour le backend FreelanceTN (ASP.NET Core).
// Tous les appels utilisent credentials:"include" : le JWT vit dans le cookie
// httpOnly "freelancetn_auth", jamais dans localStorage ni dans le state JS.

import type {
  AssignmentHistoryEntry,
  FreelancerSummary,
  Project,
  ProjectAttachment,
  ProjectMilestone,
  MilestoneHistoryEntry,
  ProjectStatus,
  Proposal,
  ProposalStatus,
  Role,
  Feedback,
  FeedbackSummary,
  FeedbackStatus,
  Comment,
  PortfolioItem,
  PortfolioVisibility,
  Task,
  TaskComment,
  Notification,
} from "@/lib/types";
import type { ActionResult } from "@/lib/actions/types";

// --- Server Actions ------------------------------------------------------
// Les opérations CRUD passent désormais par des Server Actions qui accèdent
// directement à MongoDB côté serveur. Les signatures publiques de ce module
// restent inchangées : les composants continuent d'appeler `projectsApi`,
// `quotesApi`, etc. et reçoivent les mêmes formes qu'avant.
import {
  addProjectMilestone,
  createProject as createProjectAction,
  deleteProject as deleteProjectAction,
  getProject as getProjectAction,
  listAssignedProjects,
  listProjectAssignees,
  listProjectCatalog,
  listProjectCatalogCategories,
  listProjects,
  projectMilestoneAction,
  reopenProject,
  submitProjectForReview,
  updateProject as updateProjectAction,
} from "@/lib/actions/projects";
import {
  createProposal as createProposalAction,
  deleteProposal as deleteProposalAction,
  getProposal as getProposalAction,
  listMyProposals,
  listReceivedProposals,
  setProposalStatus,
} from "@/lib/actions/proposals";
import {
  createComment as createCommentAction,
  deleteComment as deleteCommentAction,
  listProjectComments,
  updateComment as updateCommentAction,
} from "@/lib/actions/comments";
import {
  createPortfolioItem as createPortfolioItemAction,
  deletePortfolioItem as deletePortfolioItemAction,
  getPortfolioItem as getPortfolioItemAction,
  listFreelancerPortfolio,
  listMyPortfolio,
  updatePortfolioItem as updatePortfolioItemAction,
} from "@/lib/actions/portfolio";
import { getFreelancer as getFreelancerAction, listFreelancers } from "@/lib/actions/freelancers";
import {
  convertQuoteToInvoice as convertQuoteToInvoiceAction,
  createQuote as createQuoteAction,
  deleteQuote as deleteQuoteAction,
  getQuote as getQuoteAction,
  listClientQuotes,
  listQuotes,
  updateQuote as updateQuoteAction,
  updateQuoteStatus as updateQuoteStatusAction,
} from "@/lib/actions/quotes";
import {
  createInvoice as createInvoiceAction,
  createInvoiceFromQuote as createInvoiceFromQuoteAction,
  deleteInvoice as deleteInvoiceAction,
  getInvoice as getInvoiceAction,
  listInvoices,
  updateInvoice as updateInvoiceAction,
  updateInvoiceStatus as updateInvoiceStatusAction,
} from "@/lib/actions/invoices";
import {
  addTaskComment,
  createTask as createTaskAction,
  deleteTask as deleteTaskAction,
  getTask as getTaskAction,
  listTaskComments,
  listTasks,
  updateTask as updateTaskAction,
} from "@/lib/actions/tasks";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "@/lib/actions/notifications";
import {
  acceptInvitation as acceptInvitationAction,
  createInvitation as createInvitationAction,
  declineInvitation as declineInvitationAction,
  listMyInvitations,
  listSentInvitations,
} from "@/lib/actions/invitations";
import {
  exportAccount,
  getAccountHistory,
  getBillingProfile,
  getClientProfile,
  getNotificationPreferencesAction,
  getPublicClientProfile as getPublicClientProfileAction,
  getUserPreferences,
  setAvatarStyle as setAvatarStyleAction,
  updateBillingProfile,
  updateClientProfile,
  updateNotificationPreferences,
  updateUserPreferences,
} from "@/lib/actions/account";
import { updateMyProfile } from "@/lib/actions/profile";
import {
  assistProjectDraftAction,
  assistProposalDraftAction,
  breakdownProjectAction,
  getAiStatusAction,
  matchFreelancersAction,
} from "@/lib/actions/ai";
import type {
  AiStatus,
  BreakdownTaskSuggestion,
  FreelancerMatchSuggestion,
  ProjectAssistSuggestion,
  ProjectBreakdownSuggestion,
  ProposalAssistSuggestion,
} from "@/lib/server/services/ai";

// URL de base de l'API. Par défaut, vide : les appels partent en relative
// ("/api/...") et sont relayés par le proxy same-origin de Next
// (rewrite /api/:path* -> backend, voir next.config.ts). Le navigateur
// n'appelle donc jamais le backend en cross-origin : plus de blocage CORS
// (localhost vs 127.0.0.1 vs aperçu Figma) et le cookie de session httpOnly
// est posé sur l'origine du front. NEXT_PUBLIC_API_URL reste supporté pour
// pointer directement l'API (ex. tests hors navigateur).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// Rôles gérés par la plateforme. Le rôle fait foi côté serveur (champ "role"
// du document utilisateur) : le frontend ne fait que le refléter.
export type UserRole = Role;

export const normalizeRole = (value: string | null | undefined): UserRole =>
  value?.trim().toLowerCase() === "client" ? "client" : "freelancer";

export type CvExperience = {
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

export type CvEducation = {
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

export type CvLanguage = {
  id?: string;
  name: string;
  level: string;
};

export type CvCertification = {
  id?: string;
  name: string;
  issuer: string;
  year: string;
};

export type CvWorkPreferences = {
  projectTypes: string[];
  workPreference: string;
  minimumBudget: string;
};

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  role: UserRole;
  firstName: string;
  lastName: string;
  title: string;
  location: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
  bio: string;
  avatar: string;
  avatarSource: "initials" | "preset" | "upload" | "generated";
  avatarPreset: string;
  avatarColor: string;
  avatarConfig: string;
  skills: string[];
  hourlyRate: number;
  companyName: string;
  companyLogo: string;
  coverImage: string;
  industry: string;
  position: string;
  companyWebsite: string;
  companySize: string;
  companyDescription: string;
  country: string;
  governorate: string;
  city: string;
  businessAddress: string;
  personalPresentation: string;
  professionalEmail: string;
  professionalPhone: string;
  experiences: CvExperience[];
  education: CvEducation[];
  languages: CvLanguage[];
  certifications: CvCertification[];
  workPreferences: CvWorkPreferences;
  createdAt: string;
  updatedAt: string;
};

export type RegisterInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  title?: string;
  location?: string;
  bio?: string;
  skills?: string[];
  hourlyRate?: number;
};

export type EmailDelivery = {
  sent: boolean;
  transport: "smtp" | "dev-outbox" | "none";
  devVerificationUrl?: string | null;
};

export type RegisterResult = {
  message: string;
  email: string;
  requiresEmailVerification: boolean;
  emailDelivery?: EmailDelivery;
};

export type ResendVerificationResult = {
  message: string;
  sent?: boolean;
  cooldownSeconds?: number | null;
  devVerificationUrl?: string | null;
};

export type AuthProviders = {
  google: boolean;
  emailTransport?: "smtp" | "dev-outbox" | "none";
  googleConfigurationHint?: string | null;
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
  avatarSource?: "initials" | "preset" | "upload" | "generated";
  avatarConfig?: string;
  coverImage?: string;
  skills?: string[];
  hourlyRate?: number;
  experiences?: CvExperience[];
  education?: CvEducation[];
  languages?: CvLanguage[];
  certifications?: CvCertification[];
  workPreferences?: CvWorkPreferences;
};

export class ApiError extends Error {
  readonly status: number;
  readonly errors: string[];

  constructor(status: number, message: string, errors: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Convertit le résultat sérialisable d'une Server Action en valeur ou en
 * ApiError. Les composants conservent donc leurs `catch` et notifications
 * SweetAlert2 existants.
 */
async function unwrap<T>(result: Promise<ActionResult<T>>): Promise<T> {
  const outcome = await result;
  if (outcome.ok) return outcome.data;
  throw new ApiError(outcome.status, outcome.message, outcome.errors);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new ApiError(0, "Le service est injoignable. Vérifiez que le backend est démarré.");
  }

  const text = await response.text();
  // Le corps peut être vide (204) ou non JSON : une réponse illisible ne doit
  // pas masquer le code HTTP réel.
  let data: Record<string, unknown> | null = null;
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      typeof data?.message === "string" && data.message
        ? data.message
        : `Une erreur est survenue (${response.status}).`;
    const errors = Array.isArray(data?.errors) ? (data.errors as string[]) : [];
    throw new ApiError(response.status, message, errors);
  }

  return data as T;
}

const toAuthUser = (value: unknown): AuthUser => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asText(raw.id),
    email: asText(raw.email),
    emailVerified: asBoolean(raw.emailVerified, true),
    hasPassword: asBoolean(raw.hasPassword, true),
    role: normalizeRole(asText(raw.role)),
    firstName: asText(raw.firstName),
    lastName: asText(raw.lastName),
    title: asText(raw.title),
    location: asText(raw.location),
    phone: asText(raw.phone),
    linkedin: asText(raw.linkedin),
    github: asText(raw.github),
    website: asText(raw.website),
    bio: asText(raw.bio),
    avatar: asText(raw.avatar),
    avatarSource:
      raw.avatarSource === "preset" || raw.avatarSource === "upload" || raw.avatarSource === "generated" ? raw.avatarSource : "initials",
    avatarPreset: asText(raw.avatarPreset),
    avatarColor: asText(raw.avatarColor),
    avatarConfig: asText(raw.avatarConfig),
    skills: asStringList(raw.skills),
    hourlyRate: asNumber(raw.hourlyRate),
    companyName: asText(raw.companyName),
    companyLogo: asText(raw.companyLogo),
    coverImage: asText(raw.coverImage),
    industry: asText(raw.industry),
    position: asText(raw.position),
    companyWebsite: asText(raw.companyWebsite),
    companySize: asText(raw.companySize),
    companyDescription: asText(raw.companyDescription),
    country: asText(raw.country),
    governorate: asText(raw.governorate),
    city: asText(raw.city),
    businessAddress: asText(raw.businessAddress),
    personalPresentation: asText(raw.personalPresentation),
    professionalEmail: asText(raw.professionalEmail),
    professionalPhone: asText(raw.professionalPhone),
    experiences: toCvExperiences(raw.experiences),
    education: toCvEducation(raw.education),
    languages: toCvLanguages(raw.languages),
    certifications: toCvCertifications(raw.certifications),
    workPreferences: toCvWorkPreferences(raw.workPreferences),
    createdAt: asText(raw.createdAt),
    updatedAt: asText(raw.updatedAt),
  };
};

export const authApi = {
  register: (input: RegisterInput) =>
    request<RegisterResult>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),

  login: async (input: { email: string; password: string; rememberMe?: boolean }) => {
    const raw = await request<Record<string, unknown>>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (raw.requiresTwoFactor) {
      return {
        message: asText(raw.message),
        requiresTwoFactor: true,
        preAuthToken: asText(raw.preAuthToken),
      } as { message: string; requiresTwoFactor: true; preAuthToken: string };
    }
    return {
      message: asText(raw.message),
      user: toAuthUser(raw.user),
      persistent: asBoolean(raw.persistent),
      expiresAt: asText(raw.expiresAt),
      requiresTwoFactor: false,
    };
  },

  verifyTwoFactor: async (input: { preAuthToken: string; code: string }) => {
    const raw = await request<{ message: string; user: unknown; persistent?: boolean; expiresAt?: string }>(
      "/api/auth/2fa/verify",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    return {
      message: asText(raw.message),
      user: toAuthUser(raw.user),
      persistent: asBoolean(raw.persistent),
      expiresAt: asText(raw.expiresAt),
    };
  },

  logout: () => request<{ message: string }>("/api/auth/logout", { method: "POST" }),

  me: async () => toAuthUser(await request<unknown>("/api/auth/me")),

  updateMe: async (input: UpdateProfileInput) =>
    toAuthUser(await unwrap(updateMyProfile(input))),

  verifyEmail: (token: string) =>
    request<{ message: string; email: string }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  resendVerification: (email: string) =>
    request<ResendVerificationResult>("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (input: { token: string; password: string }) =>
    request<{ message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  providers: () => request<AuthProviders>("/api/auth/providers"),

  googleStartUrl: (role?: UserRole) => {
    const query = role ? `?role=${encodeURIComponent(role)}` : "";
    return `${API_URL}/api/auth/google/start${query}`;
  },

  uploadAvatar: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return toAuthUser(
      await request<unknown>("/api/uploads/avatar", {
        method: "POST",
        body: form,
        headers: {},
      }),
    );
  },
};

// --- Account Settings ----------------------------------------------------
// Profil client, équipe, facturation, sécurité, notifications et préférences.
// Toutes les routes sont protégées par le cookie httpOnly côté backend ; les
// contrôles de rôle sont refaits côté serveur.

export type ClientProfile = {
  id: string;
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  role: UserRole;
  firstName: string;
  lastName: string;
  phone: string;
  avatar: string;
  avatarSource: "initials" | "preset" | "upload" | "generated";
  avatarPreset: string;
  avatarColor: string;
  avatarConfig: string;
  companyName: string;
  companyLogo: string;
  coverImage: string;
  industry: string;
  position: string;
  companyWebsite: string;
  companySize: string;
  companyDescription: string;
  country: string;
  governorate: string;
  city: string;
  businessAddress: string;
  personalPresentation: string;
  professionalEmail: string;
  professionalPhone: string;
  website: string;
  bio: string;
  profileCompletion: number;
  missingFields: string[];
  createdAt: string;
  updatedAt: string;
};

export type ClientProfileInput = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarSource?: "initials" | "preset" | "upload" | "generated";
  avatarPreset?: string;
  avatarColor?: string;
  avatarConfig?: string;
  companyName?: string;
  companyLogo?: string;
  coverImage?: string;
  industry?: string;
  position?: string;
  companyWebsite?: string;
  companySize?: string;
  companyDescription?: string;
  country?: string;
  governorate?: string;
  city?: string;
  businessAddress?: string;
  personalPresentation?: string;
  professionalEmail?: string;
  professionalPhone?: string;
  website?: string;
};

export type TeamMember = {
  id: string;
  email: string;
  name: string;
  role: "Admin" | "Manager" | "Member" | "Viewer" | "Owner";
  status: "Pending" | "Active" | "Revoked" | "Declined";
  isOwner: boolean;
  canManage: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type TeamInviteResult = {
  member: TeamMember;
  sent: boolean;
  transport: "smtp" | "dev-outbox" | "none";
  message: string;
  devInviteUrl?: string | null;
};

export type BillingProfile = {
  legalName: string;
  billingAddress: string;
  country: string;
  governorate: string;
  city: string;
  taxId: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  history: { changedAt: string; fields: string[] }[];
  updatedAt: string | null;
};

export type BillingProfileInput = {
  legalName?: string;
  billingAddress?: string;
  country?: string;
  governorate?: string;
  city?: string;
  taxId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
};

export type SessionInfo = {
  id: string;
  current: boolean;
  rememberMe: boolean;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type SecurityOverview = {
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  twoFactorEnabledAt: string | null;
  recoveryCodesRemaining: number;
  twoFactorAvailable: boolean;
  twoFactorMessage: string;
  sessions: SessionInfo[];
};

export type NotificationPreferences = {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  invitationsEnabled: boolean;
  projectActivityEnabled: boolean;
  messagesEnabled: boolean;
  billingEnabled: boolean;
};

export type UserPreferences = {
  language: "fr" | "en";
  currency: "TND";
  theme: "light" | "dark";
  timezone: string;
  dateFormat: "DD/MM/YYYY" | "YYYY-MM-DD";
  thousandsSeparator: boolean;
};

export type AccountChange = {
  area: string;
  summary: string;
  createdAt: string;
};

export type PublicClientProfile = {
  displayName: string;
  companyName: string;
  companyLogo: string;
  coverImage: string;
  industry: string;
  position: string;
  companyWebsite: string;
  companySize: string;
  companyDescription: string;
  country: string;
  governorate: string;
  city: string;
  personalPresentation: string;
  avatar: string;
  avatarSource?: "initials" | "preset" | "upload" | "generated";
  avatarConfig?: string;
  verified: boolean;
  createdAt: string;
};

const toClientProfile = (value: unknown): ClientProfile => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asText(raw.id),
    email: asText(raw.email),
    emailVerified: asBoolean(raw.emailVerified, true),
    hasPassword: asBoolean(raw.hasPassword, true),
    role: normalizeRole(asText(raw.role)),
    firstName: asText(raw.firstName),
    lastName: asText(raw.lastName),
    phone: asText(raw.phone),
    avatar: asText(raw.avatar),
    avatarSource:
      raw.avatarSource === "preset" || raw.avatarSource === "upload" || raw.avatarSource === "generated" ? raw.avatarSource : "initials",
    avatarPreset: asText(raw.avatarPreset),
    avatarColor: asText(raw.avatarColor),
    avatarConfig: asText(raw.avatarConfig),
    companyName: asText(raw.companyName),
    companyLogo: asText(raw.companyLogo),
    coverImage: asText(raw.coverImage),
    industry: asText(raw.industry),
    position: asText(raw.position),
    companyWebsite: asText(raw.companyWebsite),
    companySize: asText(raw.companySize),
    companyDescription: asText(raw.companyDescription),
    country: asText(raw.country),
    governorate: asText(raw.governorate),
    city: asText(raw.city),
    businessAddress: asText(raw.businessAddress),
    personalPresentation: asText(raw.personalPresentation),
    professionalEmail: asText(raw.professionalEmail),
    professionalPhone: asText(raw.professionalPhone),
    website: asText(raw.website),
    bio: asText(raw.bio),
    profileCompletion: asNumber(raw.profileCompletion),
    missingFields: asStringList(raw.missingFields),
    createdAt: asText(raw.createdAt),
    updatedAt: asText(raw.updatedAt),
  };
};

const toTeamMember = (value: unknown): TeamMember => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const role = asText(raw.role);
  const status = asText(raw.status);
  return {
    id: asText(raw.id),
    email: asText(raw.email),
    name: asText(raw.name),
    role: (["Admin", "Manager", "Member", "Viewer", "Owner"].includes(role) ? role : "Member") as TeamMember["role"],
    status: (["Pending", "Active", "Revoked", "Declined"].includes(status) ? status : "Pending") as TeamMember["status"],
    isOwner: asBoolean(raw.isOwner),
    canManage: asBoolean(raw.canManage),
    invitedAt: asText(raw.invitedAt),
    acceptedAt: asOptionalText(raw.acceptedAt),
    revokedAt: asOptionalText(raw.revokedAt),
  };
};

const toBillingProfile = (value: unknown): BillingProfile => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const history = Array.isArray(raw.history)
    ? raw.history.map((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        return {
          changedAt: asText(item.changedAt),
          fields: asStringList(item.fields),
        };
      })
    : [];
  return {
    legalName: asText(raw.legalName),
    billingAddress: asText(raw.billingAddress),
    country: asText(raw.country),
    governorate: asText(raw.governorate),
    city: asText(raw.city),
    taxId: asText(raw.taxId),
    contactName: asText(raw.contactName),
    contactEmail: asText(raw.contactEmail),
    contactPhone: asText(raw.contactPhone),
    history,
    updatedAt: asOptionalText(raw.updatedAt),
  };
};

const toSession = (value: unknown): SessionInfo => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asText(raw.id),
    current: asBoolean(raw.current),
    rememberMe: asBoolean(raw.rememberMe),
    userAgent: asText(raw.userAgent),
    createdAt: asText(raw.createdAt),
    lastSeenAt: asText(raw.lastSeenAt),
    expiresAt: asText(raw.expiresAt),
  };
};

const toSecurityOverview = (value: unknown): SecurityOverview => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    email: asText(raw.email),
    emailVerified: asBoolean(raw.emailVerified, true),
    hasPassword: asBoolean(raw.hasPassword, true),
    twoFactorEnabled: asBoolean(raw.twoFactorEnabled),
    twoFactorEnabledAt: raw.twoFactorEnabledAt ? asText(raw.twoFactorEnabledAt) : null,
    recoveryCodesRemaining: asNumber(raw.recoveryCodesRemaining),
    twoFactorAvailable: asBoolean(raw.twoFactorAvailable),
    twoFactorMessage: asText(raw.twoFactorMessage),
    sessions: Array.isArray(raw.sessions) ? raw.sessions.map(toSession) : [],
  };
};

const toNotificationPreferences = (value: unknown): NotificationPreferences => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    emailEnabled: asBoolean(raw.emailEnabled, true),
    inAppEnabled: asBoolean(raw.inAppEnabled, true),
    invitationsEnabled: asBoolean(raw.invitationsEnabled, true),
    projectActivityEnabled: asBoolean(raw.projectActivityEnabled, true),
    messagesEnabled: asBoolean(raw.messagesEnabled, true),
    billingEnabled: asBoolean(raw.billingEnabled, true),
  };
};

const toUserPreferences = (value: unknown): UserPreferences => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    language: raw.language === "en" ? "en" : "fr",
    currency: "TND",
    theme: raw.theme === "dark" ? "dark" : "light",
    timezone: asText(raw.timezone, "Africa/Tunis"),
    dateFormat: raw.dateFormat === "YYYY-MM-DD" ? "YYYY-MM-DD" : "DD/MM/YYYY",
    thousandsSeparator: asBoolean(raw.thousandsSeparator, true),
  };
};

const toPublicClientProfile = (value: unknown): PublicClientProfile => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    displayName: asText(raw.displayName),
    companyName: asText(raw.companyName),
    companyLogo: asText(raw.companyLogo),
    coverImage: asText(raw.coverImage),
    industry: asText(raw.industry),
    position: asText(raw.position),
    companyWebsite: asText(raw.companyWebsite),
    companySize: asText(raw.companySize),
    companyDescription: asText(raw.companyDescription),
    country: asText(raw.country),
    governorate: asText(raw.governorate),
    city: asText(raw.city),
    personalPresentation: asText(raw.personalPresentation),
    avatar: asText(raw.avatar),
    avatarSource: raw.avatarSource === "preset" || raw.avatarSource === "upload" || raw.avatarSource === "generated" ? raw.avatarSource : "initials",
    avatarConfig: asText(raw.avatarConfig),
    verified: asBoolean(raw.verified),
    createdAt: asText(raw.createdAt),
  };
};

export const accountApi = {
  getProfile: async () => toClientProfile(await unwrap(getClientProfile())),

  updateProfile: async (input: ClientProfileInput) =>
    toClientProfile(await unwrap(updateClientProfile(input))),

  setAvatarStyle: async (input: { source?: "initials" | "preset" | "upload" | "generated"; preset?: string; color?: string; config?: string }) =>
    toClientProfile(await unwrap(setAvatarStyleAction(input))),

  uploadCover: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ url: string }>("/api/uploads/cover", { method: "POST", body: form, headers: {} });
  },

  uploadLogo: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ url: string }>("/api/uploads/logo", { method: "POST", body: form, headers: {} });
  },

  deleteCover: () => request<unknown>("/api/uploads/cover", { method: "DELETE" }),
  deleteLogo: () => request<unknown>("/api/uploads/logo", { method: "DELETE" }),
  deleteAvatar: async () => toAuthUser(await request<unknown>("/api/uploads/avatar", { method: "DELETE" })),

  listTeam: async () => {
    const raw = await request<unknown>("/api/account/team");
    return Array.isArray(raw) ? raw.map(toTeamMember) : [];
  },

  inviteTeamMember: async (input: { email: string; name: string; role: string }) => {
    const raw = await request<Record<string, unknown>>("/api/account/team/invite", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return {
      member: toTeamMember(raw.member),
      sent: asBoolean(raw.sent),
      transport: (asText(raw.transport, "none") as TeamInviteResult["transport"]) ?? "none",
      message: asText(raw.message),
      devInviteUrl: asOptionalText(raw.devInviteUrl),
    } satisfies TeamInviteResult;
  },

  updateTeamRole: async (id: string, role: string) =>
    toTeamMember(
      await request<unknown>(`/api/account/team/${encodeURIComponent(id)}/role`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      }),
    ),

  revokeTeamMember: async (id: string) =>
    toTeamMember(
      await request<unknown>(`/api/account/team/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
    ),

  acceptInvitation: async (token: string) =>
    toTeamMember(
      await request<unknown>("/api/account/team/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    ),

  declineInvitation: async (token: string) =>
    toTeamMember(
      await request<unknown>("/api/account/team/decline", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    ),

  activateInvitation: async (token: string, password: string) =>
    toTeamMember(
      await request<unknown>("/api/account/team/activate", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
    ),

  getBilling: async () => toBillingProfile(await unwrap(getBillingProfile())),

  updateBilling: async (input: BillingProfileInput) =>
    toBillingProfile(await unwrap(updateBillingProfile(input))),

  getNotifications: async () =>
    toNotificationPreferences(await unwrap(getNotificationPreferencesAction())),

  updateNotifications: async (input: NotificationPreferences) =>
    toNotificationPreferences(await unwrap(updateNotificationPreferences(input))),

  getPreferences: async () => toUserPreferences(await unwrap(getUserPreferences())),

  updatePreferences: async (input: UserPreferences) =>
    toUserPreferences(await unwrap(updateUserPreferences(input))),

  getSecurity: async () => toSecurityOverview(await request<unknown>("/api/account/security")),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<{ message: string }>("/api/account/security/change-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  setupTwoFactor: () =>
    request<{ secret: string; otpAuthUri: string }>("/api/account/security/2fa/setup", {
      method: "POST",
    }),

  enableTwoFactor: (code: string) =>
    request<{ recoveryCodes: string[] }>("/api/account/security/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  disableTwoFactor: (password: string) =>
    request<{ message: string }>("/api/account/security/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  regenerateRecoveryCodes: (password: string) =>
    request<{ recoveryCodes: string[] }>("/api/account/security/2fa/recovery-codes/regenerate", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  revokeSession: (id: string) =>
    request<unknown>(`/api/account/security/sessions/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
    }),

  revokeOtherSessions: () =>
    request<{ message: string; count: number }>("/api/account/security/sessions/revoke-others", {
      method: "POST",
    }),

  getHistory: async () => {
    const raw = await unwrap(getAccountHistory());
    return Array.isArray(raw)
      ? raw.map((entry) => {
          const item = (entry ?? {}) as Record<string, unknown>;
          return {
            area: asText(item.area),
            summary: asText(item.summary),
            createdAt: asText(item.createdAt),
          } satisfies AccountChange;
        })
      : [];
  },

  exportAccount: () => unwrap(exportAccount()),

  getPublicProfile: async (id: string) =>
    toPublicClientProfile(await unwrap(getPublicClientProfileAction(id))),
};

// --- Projets -------------------------------------------------------------
// Le propriétaire du projet n'est jamais envoyé par le client : le backend le
// déduit de la session authentifiée (claim "sub") et filtre les projets en
// conséquence. Un projet publié (statut « Open ») est en revanche visible par
// tous : c'est le catalogue des opportunités.

// Lecture défensive des champs : le backend peut renvoyer "null" pour un champ
// absent (ex. « assignedTo » sur un projet qui n'a pas encore été approuvé).
const asText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asOptionalText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

// Forme brute renvoyée par l'API pour un projet.
type RawProject = {
  id?: unknown;
  ownerId?: unknown;
  title?: unknown;
  description?: unknown;
  budget?: unknown;
  budgetMin?: unknown;
  budgetMax?: unknown;
  durationValue?: unknown;
  durationUnit?: unknown;
  type?: unknown;
  proposals?: unknown;
  skills?: unknown;
  client?: unknown;
  status?: unknown;
  category?: unknown;
  deadline?: unknown;
  assignedTo?: unknown;
  assignedToName?: unknown;
  assignedAt?: unknown;
  assignmentHistory?: unknown;
  milestones?: unknown;
  milestoneHistory?: unknown;
  attachments?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const projectStatuses: ProjectStatus[] = ["Open", "In progress", "Client review", "Completed", "Draft"];

const asProjectStatus = (value: unknown): ProjectStatus => {
  const raw = asText(value);
  return projectStatuses.find((status) => status.toLowerCase() === raw.toLowerCase()) ?? "Draft";
};

// Ancienneté d'un projet calculée à partir de sa date de création réelle.
const relativeTime = (createdAt: string) => {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - created) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.round(months / 12)} y ago`;
};

const toProject = (value: unknown): Project => {
  const raw = (value ?? {}) as RawProject;
  const createdAt = asText(raw.createdAt);
  return {
    id: asText(raw.id),
    ownerId: asText(raw.ownerId),
    title: asText(raw.title),
    description: asText(raw.description),
    budget: asText(raw.budget),
    budgetMin: raw.budgetMin == null ? null : asNumber(raw.budgetMin),
    budgetMax: raw.budgetMax == null ? null : asNumber(raw.budgetMax),
    durationValue: raw.durationValue == null ? null : asNumber(raw.durationValue),
    durationUnit: asOptionalText(raw.durationUnit),
    type: asText(raw.type),
    proposals: asNumber(raw.proposals),
    time: relativeTime(createdAt),
    skills: asStringList(raw.skills),
    client: asText(raw.client),
    status: asProjectStatus(raw.status),
    category: asText(raw.category),
    deadline: asText(raw.deadline),
    assignedTo: asOptionalText(raw.assignedTo),
    assignedToName: asOptionalText(raw.assignedToName),
    assignedAt: asOptionalText(raw.assignedAt),
    assignmentHistory: toAssignmentHistory(raw.assignmentHistory),
    milestones: toMilestones(raw.milestones),
    milestoneHistory: toMilestoneHistory(raw.milestoneHistory),
    attachments: toAttachments(raw.attachments),
    createdAt,
    updatedAt: asText(raw.updatedAt),
  };
};

// Historique des affectations libérées renvoyé par l'API Projects.
const toAttachments = (value: unknown): ProjectAttachment[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    return {
      fileName: String(raw.fileName ?? ""),
      url: String(raw.url ?? ""),
      size: Number(raw.size) || 0,
      uploadedAt: String(raw.uploadedAt ?? ""),
    };
  });
};

const toAssignmentHistory = (value: unknown): AssignmentHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = (entry ?? {}) as Record<string, unknown>;
      return {
        freelancerId: asText(raw.freelancerId),
        freelancerName: asText(raw.freelancerName),
        assignedAt: asOptionalText(raw.assignedAt),
        releasedAt: asOptionalText(raw.releasedAt),
        reason: asText(raw.reason),
      };
    })
    .filter((entry) => entry.freelancerId.length > 0);
};

const toMilestones = (value: unknown): ProjectMilestone[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    return {
      id: asText(raw.id),
      key: asText(raw.key),
      title: asText(raw.title),
      status: asText(raw.status, "Pending"),
      progress: asNumber(raw.progress),
      date: asOptionalText(raw.date),
      createdAt: asText(raw.createdAt),
      updatedAt: asText(raw.updatedAt),
    };
  });
};

const toMilestoneHistory = (value: unknown): MilestoneHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    return {
      id: asText(raw.id),
      milestoneId: asOptionalText(raw.milestoneId),
      milestoneTitle: asText(raw.milestoneTitle),
      type: asText(raw.type),
      message: asText(raw.message),
      authorId: asText(raw.authorId),
      authorName: asText(raw.authorName),
      authorRole: asText(raw.authorRole),
      createdAt: asText(raw.createdAt),
    };
  });
};

const toProjectList = (value: unknown): Project[] =>
  Array.isArray(value) ? value.map(toProject) : [];

const toFreelancerSummary = (value: unknown): FreelancerSummary => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asText(raw.id),
    name: asText(raw.name),
    title: asText(raw.title),
    avatar: asText(raw.avatar),
  };
};

const toFreelancerSummaryList = (value: unknown): FreelancerSummary[] =>
  Array.isArray(value) ? value.map(toFreelancerSummary) : [];

export type CreateProjectInput = {
  title: string;
  description: string;
  budget: string;
  type: string;
  skills: string[];
  client: string;
  status: ProjectStatus;
  category?: string;
  deadline?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  durationValue?: number | null;
  durationUnit?: string | null;
};

export type UpdateProjectInput = {
  title?: string;
  description?: string;
  budget?: string;
  type?: string;
  skills?: string[];
  client?: string;
  status?: ProjectStatus;
  category?: string;
  deadline?: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  durationValue?: number | null;
  durationUnit?: string | null;
  // Identifiant du freelance approuvé. Une chaîne vide retire l'approbation.
  // Absent, l'approbation reste inchangée.
  assignedTo?: string;
  attachments?: ProjectAttachment[];
  // Message optionnel accompagnant un changement de statut.
  message?: string;
};

export type ProjectCatalogParams = {
  category?: string;
  q?: string;
  type?: string;
  minBudget?: number;
  maxBudget?: number;
  durationValue?: number;
  durationUnit?: string;
  limit?: number;
};

export const projectsApi = {
  // Projets du compte connecté, tous statuts confondus.
  list: async (): Promise<Project[]> => toProjectList(await unwrap(listProjects())),

  // Catalogue public : uniquement les projets publiés (statut « Open »).
  catalog: async (params?: ProjectCatalogParams): Promise<Project[]> =>
    toProjectList(await unwrap(listProjectCatalog(params ?? {}))),

  // Projets approuvés par un client pour le freelance connecté.
  assigned: async (): Promise<Project[]> => toProjectList(await unwrap(listAssignedProjects())),

  // Comptes freelances qu'un client peut approuver sur un projet.
  assignees: async (): Promise<FreelancerSummary[]> =>
    toFreelancerSummaryList(await unwrap(listProjectAssignees())),

  get: async (id: string): Promise<Project> => toProject(await unwrap(getProjectAction(id))),

  create: async (input: CreateProjectInput): Promise<Project> =>
    toProject(await unwrap(createProjectAction(input))),

  update: async (id: string, input: UpdateProjectInput): Promise<Project> =>
    toProject(await unwrap(updateProjectAction(id, input))),

  uploadAttachment: async (projectId: string, file: File): Promise<{ fileName: string; url: string; size: number }> => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/uploads/project/${projectId}`, { method: "POST", body: formData, credentials: "include" });
    if (!response.ok) throw new Error("Upload failed");
    return response.json();
  },

  submitForReview: async (id: string, message?: string): Promise<Project> =>
    toProject(await unwrap(submitProjectForReview(id, message))),

  remove: (id: string) => unwrap(deleteProjectAction(id)),

  reopen: async (id: string, message?: string): Promise<Project> =>
    toProject(await unwrap(reopenProject(id, message))),

  milestoneAction: async (
    projectId: string,
    milestoneId: string,
    input: { action: string; message?: string; progress?: number },
  ): Promise<Project> =>
    toProject(await unwrap(projectMilestoneAction(projectId, milestoneId, input))),

  addMilestone: async (projectId: string, input: { title: string; date?: string | null }): Promise<Project> =>
    toProject(await unwrap(addProjectMilestone(projectId, input))),

  catalogCategories: async (): Promise<string[]> =>
    (await unwrap(listProjectCatalogCategories())) as string[],
};

// --- Candidatures --------------------------------------------------------
// Une candidature appartient au freelance connecté (dérivé de la session) et
// au projet qu'il a choisi. Le client propriétaire est le seul à pouvoir
// accepter ou refuser ; le freelance ne peut retirer que les siennes.

const proposalStatuses: ProposalStatus[] = ["Pending", "Accepted", "Refused", "Withdrawn", "Cancelled"];

const asProposalStatus = (value: unknown): ProposalStatus => {
  const raw = asText(value);
  return proposalStatuses.find((status) => status.toLowerCase() === raw.toLowerCase()) ?? "Pending";
};

// Forme brute renvoyée par l'API pour une candidature.
type RawProposal = {
  id?: unknown;
  projectId?: unknown;
  projectTitle?: unknown;
  projectBudget?: unknown;
  projectType?: unknown;
  projectStatus?: unknown;
  projectOwnerId?: unknown;
  freelancerId?: unknown;
  freelancerName?: unknown;
  freelancerTitle?: unknown;
  coverLetter?: unknown;
  price?: unknown;
  delivery?: unknown;
  portfolioId?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const toProposal = (value: unknown): Proposal => {
  const raw = (value ?? {}) as RawProposal;
  return {
    id: asText(raw.id),
    projectId: asText(raw.projectId),
    projectTitle: asText(raw.projectTitle),
    projectBudget: asText(raw.projectBudget),
    projectType: asText(raw.projectType),
    projectStatus: asText(raw.projectStatus),
    projectOwnerId: asText(raw.projectOwnerId),
    freelancerId: asText(raw.freelancerId),
    freelancerName: asText(raw.freelancerName),
    freelancerTitle: asText(raw.freelancerTitle),
    coverLetter: asText(raw.coverLetter),
    price: asText(raw.price),
    delivery: asText(raw.delivery),
    portfolioId: asOptionalText(raw.portfolioId),
    status: asProposalStatus(raw.status),
    createdAt: asText(raw.createdAt),
    updatedAt: asText(raw.updatedAt),
  };
};

const toProposalList = (value: unknown): Proposal[] =>
  Array.isArray(value) ? value.map(toProposal) : [];

export type CreateProposalInput = {
  projectId: string;
  coverLetter: string;
  price: string;
  delivery: string;
  portfolioId?: string | null;
};

export const proposalsApi = {
  // Dépôt d'une candidature sur un projet publié (freelance uniquement).
  create: async (input: CreateProposalInput): Promise<Proposal> =>
    toProposal(await unwrap(createProposalAction(input))),

  // Candidatures déposées par le freelance connecté.
  mine: async (): Promise<Proposal[]> => toProposalList(await unwrap(listMyProposals())),

  // Candidatures reçues par le client connecté (ses projets uniquement).
  // Un `projectId` optionnel restreint la requête au projet demandé.
  received: async (projectId?: string): Promise<Proposal[]> =>
    toProposalList(await unwrap(listReceivedProposals(projectId))),

  get: async (id: string): Promise<Proposal> => toProposal(await unwrap(getProposalAction(id))),

  // Décision du client : "Accepted" affecte le freelance au projet.
  setStatus: async (id: string, status: "Accepted" | "Refused"): Promise<Proposal> =>
    toProposal(await unwrap(setProposalStatus(id, status))),

  // Retrait d'une propre candidature (204, corps vide).
  remove: (id: string) => unwrap(deleteProposalAction(id)),
};

export type SubmitFeedbackInput = {
  criteria: Record<string, number>;
  comment: string;
  strengths?: string;
  improvements?: string;
  recommend?: boolean | null;
};

function normalizeFeedbackStatus(value: unknown): FeedbackStatus {
  return value === "awaiting_review" ||
    value === "submitted_hidden" ||
    value === "published" ||
    value === "expired"
    ? value
    : "published";
}

function asCriteria(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [key, asNumber(raw, 0)] as const)
    .filter(([, note]) => note >= 1 && note <= 5);
  return Object.fromEntries(entries);
}

function toFeedback(raw: unknown): Feedback {
  const r = (raw ?? {}) as Record<string, unknown>;
  const authorRole: Role = asText(r.authorRole) === "freelancer" ? "freelancer" : "client";
  const recipientRole: Role = asText(r.recipientRole) === "client" ? "client" : "freelancer";
  const authorName = asText(r.authorName || (authorRole === "client" ? r.clientName : r.freelancerName) || r.author);
  const recipientName = asText(
    r.recipientName || (recipientRole === "client" ? r.clientName : r.freelancerName) || r.recipient,
  );
  return {
    id: asText(r.id),
    projectId: asText(r.projectId),
    projectTitle: asText(r.projectTitle),
    clientId: asOptionalText(r.clientId) ?? undefined,
    clientName: asOptionalText(r.clientName) ?? undefined,
    freelancerId: asOptionalText(r.freelancerId) ?? undefined,
    freelancerName: asOptionalText(r.freelancerName) ?? undefined,
    authorId: asOptionalText(r.authorId) ?? undefined,
    authorName,
    author: authorName,
    authorRole,
    recipientId: asOptionalText(r.recipientId) ?? undefined,
    recipientName,
    recipientRole,
    recipient: recipientName,
    direction:
      asText(r.direction) === "freelancer_to_client" ? "freelancer_to_client" : "client_to_freelancer",
    status: normalizeFeedbackStatus(r.status),
    rating: asNumber(r.rating),
    averageRating: asNumber(r.averageRating, asNumber(r.rating)),
    criteria: asCriteria(r.criteria),
    comment: asText(r.comment),
    strengths: asText(r.strengths),
    improvements: asText(r.improvements),
    recommend: typeof r.recommend === "boolean" ? r.recommend : null,
    submittedAt: asOptionalText(r.submittedAt) ?? undefined,
    publishedAt: asOptionalText(r.publishedAt) ?? undefined,
    dueAt: asOptionalText(r.dueAt) ?? undefined,
    createdAt: asText(r.createdAt),
    updatedAt: asOptionalText(r.updatedAt) ?? undefined,
  };
}

function toFeedbackList(raw: unknown): Feedback[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => toFeedback(item));
}

function toFeedbackSummary(raw: unknown): FeedbackSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  const distribution = Array.isArray(r.distribution)
    ? r.distribution.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        return { stars: asNumber(row.stars), count: asNumber(row.count) };
      })
    : [];
  const criteriaAverages =
    r.criteriaAverages && typeof r.criteriaAverages === "object" && !Array.isArray(r.criteriaAverages)
      ? Object.fromEntries(
          Object.entries(r.criteriaAverages as Record<string, unknown>).map(([key, value]) => [
            key,
            asNumber(value),
          ]),
        )
      : {};
  return {
    userId: asText(r.userId),
    count: asNumber(r.count),
    averageRating: asNumber(r.averageRating),
    distribution,
    criteriaAverages,
    criteriaReviewCount: asNumber(r.criteriaReviewCount),
    recommendationRate: typeof r.recommendationRate === "number" ? r.recommendationRate : null,
    reviews: toFeedbackList(r.reviews),
  };
}

export const feedbacksApi = {
  // Avis publiés reçus (profil public) : jamais les avis masqués.
  forFreelancer: async (freelancerId: string): Promise<Feedback[]> =>
    toFeedbackList(await request(`/api/feedbacks/freelancer/${encodeURIComponent(freelancerId)}`)),

  // Demandes et évaluations de l'utilisateur connecté (y compris masquées).
  mine: async (): Promise<Feedback[]> => toFeedbackList(await request("/api/feedbacks/mine")),

  // Réputation publique calculée côté API à partir des seuls avis publiés.
  summary: async (userId: string): Promise<FeedbackSummary> =>
    toFeedbackSummary(await request(`/api/feedbacks/summary/${encodeURIComponent(userId)}`)),

  // Soumission structurée : cinq critères, commentaire obligatoire.
  submit: async (projectId: string, input: SubmitFeedbackInput): Promise<Feedback> =>
    toFeedback(
      await request(`/api/feedbacks/${encodeURIComponent(projectId)}/submit`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),

  // Création idempotente des demandes (déclencheur / filet de sécurité).
  ensureRequests: async (projectId: string): Promise<Feedback[]> =>
    toFeedbackList(
      await request(`/api/feedbacks/requests/${encodeURIComponent(projectId)}`, { method: "POST" }),
    ),
};

// --- Commentaires -------------------------------------------------------
function toComment(raw: unknown): Comment {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: asText(r.id),
    projectId: asText(r.projectId),
    projectTitle: asText(r.projectTitle),
    authorId: asText(r.authorId),
    authorName: asText(r.authorName),
    authorAvatar: asText(r.authorAvatar),
    authorRole: (asText(r.authorRole) === "client" ? "client" : "freelancer") as Role,
    content: asText(r.content),
    createdAt: asText(r.createdAt),
    updatedAt: asText(r.updatedAt),
  };
}

function toCommentList(raw: unknown): Comment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => toComment(item));
}

export const commentsApi = {
  forProject: async (projectId: string): Promise<Comment[]> =>
    toCommentList(await unwrap(listProjectComments(projectId))),

  create: async (projectId: string, content: string): Promise<Comment> =>
    toComment(await unwrap(createCommentAction(projectId, content))),

  update: async (id: string, content: string): Promise<Comment> =>
    toComment(await unwrap(updateCommentAction(id, content))),

  remove: async (id: string): Promise<void> => {
    await unwrap(deleteCommentAction(id));
  },
};

// --- Profil public freelance ---------------------------------------------
// Endpoint anonyme dédié : il ne renvoie que les champs publics du compte.

export type PublicFreelancer = {
  id: string;
  name: string;
  title: string;
  location: string;
  bio: string;
  avatar: string;
  coverImage: string;
  avatarSource?: "initials" | "preset" | "upload" | "generated";
  avatarConfig?: string;
  skills: string[];
  hourlyRate: number;
  experiences: CvExperience[];
  education: CvEducation[];
  languages: CvLanguage[];
  certifications: CvCertification[];
  workPreferences: CvWorkPreferences;
  createdAt: string;
};

const toCvExperiences = (raw: unknown): CvExperience[] =>
  Array.isArray(raw)
    ? raw.map((item) => {
        const r = (item ?? {}) as Record<string, unknown>;
        return {
          id: asOptionalText(r.id) ?? undefined,
          role: asText(r.role),
          company: asText(r.company),
          location: asText(r.location),
          period: asText(r.period),
          startDate: asText(r.startDate),
          endDate: asText(r.endDate),
          isCurrent: asBoolean(r.isCurrent),
          technologies: asStringList(r.technologies),
          description: asText(r.description),
        };
      })
    : [];

const toCvEducation = (raw: unknown): CvEducation[] =>
  Array.isArray(raw)
    ? raw.map((item) => {
        const r = (item ?? {}) as Record<string, unknown>;
        return {
          id: asOptionalText(r.id) ?? undefined,
          degree: asText(r.degree),
          institution: asText(r.institution),
          specialty: asText(r.specialty),
          location: asText(r.location),
          period: asText(r.period),
          startDate: asText(r.startDate),
          endDate: asText(r.endDate),
          description: asText(r.description),
        };
      })
    : [];

const toCvCertifications = (raw: unknown): CvCertification[] =>
  Array.isArray(raw)
    ? raw.map((item) => {
        const r = (item ?? {}) as Record<string, unknown>;
        return {
          id: asOptionalText(r.id) ?? undefined,
          name: asText(r.name),
          issuer: asText(r.issuer),
          year: asText(r.year),
        };
      })
    : [];

const toCvLanguages = (raw: unknown): CvLanguage[] =>
  Array.isArray(raw)
    ? raw.map((item) => {
        const r = (item ?? {}) as Record<string, unknown>;
        return {
          id: asOptionalText(r.id) ?? undefined,
          name: asText(r.name),
          level: asText(r.level),
        };
      })
    : [];

const toCvWorkPreferences = (raw: unknown): CvWorkPreferences => {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    projectTypes: asStringList(r.projectTypes),
    workPreference: asText(r.workPreference),
    minimumBudget: asText(r.minimumBudget),
  };
};

export type PublicFreelancerSummary = {
  id: string;
  name: string;
  title: string;
  location: string;
  avatar: string;
  coverImage?: string;
  avatarSource?: "initials" | "preset" | "upload" | "generated";
  avatarConfig?: string;
  hourlyRate: number;
  skills: string[];
};

const toPublicFreelancerSummary = (value: unknown): PublicFreelancerSummary => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asText(raw.id),
    name: asText(raw.name),
    title: asText(raw.title),
    location: asText(raw.location),
    avatar: asText(raw.avatar),
    coverImage: asText(raw.coverImage),
    avatarSource: raw.avatarSource === "preset" || raw.avatarSource === "upload" || raw.avatarSource === "generated" ? raw.avatarSource : "initials",
    avatarConfig: asText(raw.avatarConfig),
    hourlyRate: asNumber(raw.hourlyRate),
    skills: asStringList(raw.skills),
  };
};

const toPublicFreelancer = (value: unknown): PublicFreelancer => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asText(raw.id),
    name: asText(raw.name),
    title: asText(raw.title),
    location: asText(raw.location),
    bio: asText(raw.bio),
    avatar: asText(raw.avatar),
    coverImage: asText(raw.coverImage),
    avatarSource:
      raw.avatarSource === "preset" || raw.avatarSource === "upload" || raw.avatarSource === "generated"
        ? raw.avatarSource
        : "initials",
    avatarConfig: asText(raw.avatarConfig),
    skills: asStringList(raw.skills),
    hourlyRate: asNumber(raw.hourlyRate),
    experiences: toCvExperiences(raw.experiences),
    education: toCvEducation(raw.education),
    languages: toCvLanguages(raw.languages),
    certifications: toCvCertifications(raw.certifications),
    workPreferences: toCvWorkPreferences(raw.workPreferences),
    createdAt: asText(raw.createdAt),
  };
};

export const freelancersApi = {
  // Annuaire public des freelances, alimenté par les comptes réels.
  list: async (): Promise<PublicFreelancerSummary[]> => {
    const raw = await unwrap(listFreelancers());
    return Array.isArray(raw) ? raw.map(toPublicFreelancerSummary) : [];
  },
  get: async (id: string): Promise<PublicFreelancer> =>
    toPublicFreelancer(await unwrap(getFreelancerAction(id))),
};

// --- Portfolio -----------------------------------------------------------
// Le propriétaire d'une réalisation n'est jamais envoyé par le client : le
// backend le déduit de la session et filtre les éléments non publiés.

export type CreatePortfolioItemInput = Omit<PortfolioItem, "id" | "createdAt" | "updatedAt">;
export type UpdatePortfolioItemInput = Partial<CreatePortfolioItemInput>;

const portfolioVisibilities: PortfolioVisibility[] = ["Public", "Registered clients only", "Private"];

const asPortfolioVisibility = (value: unknown): PortfolioVisibility => {
  const raw = asText(value);
  return portfolioVisibilities.find((visibility) => visibility.toLowerCase() === raw.toLowerCase()) ?? "Public";
};

const toPortfolioItem = (value: unknown): PortfolioItem => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    id: asText(raw.id),
    title: asText(raw.title),
    summary: asText(raw.summary),
    category: asText(raw.category),
    role: asText(raw.role),
    duration: asText(raw.duration),
    challenge: asText(raw.challenge),
    solution: asText(raw.solution),
    outcome: asText(raw.outcome),
    skills: asStringList(raw.skills),
    link: asText(raw.link),
    image: asText(raw.image),
    visibility: asPortfolioVisibility(raw.visibility),
    published: asBoolean(raw.published),
    createdAt: asOptionalText(raw.createdAt) ?? undefined,
    updatedAt: asOptionalText(raw.updatedAt) ?? undefined,
  };
};

const toPortfolioList = (value: unknown): PortfolioItem[] =>
  Array.isArray(value) ? value.map(toPortfolioItem) : [];

export type CvImportResult = {
  firstName: string;
  lastName: string;
  title: string;
  summary: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
  skills: string[];
  experiences: CvExperience[];
  education: CvEducation[];
  certifications: CvCertification[];
  languages: CvLanguage[];
  links: string[];
  uncertain: string[];
  warnings: string[];
  pageCount: number;
  pagesWithText: number;
  extractedCharacters: number;
};

const toCvImportResult = (value: unknown): CvImportResult => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    firstName: asText(raw.firstName),
    lastName: asText(raw.lastName),
    title: asText(raw.title),
    summary: asText(raw.summary),
    email: asText(raw.email),
    phone: asText(raw.phone),
    location: asText(raw.location),
    linkedin: asText(raw.linkedin),
    github: asText(raw.github),
    website: asText(raw.website),
    skills: asStringList(raw.skills),
    experiences: toCvExperiences(raw.experiences),
    education: toCvEducation(raw.education),
    certifications: toCvCertifications(raw.certifications),
    languages: toCvLanguages(raw.languages),
    links: asStringList(raw.links),
    uncertain: asStringList(raw.uncertain),
    warnings: asStringList(raw.warnings),
    pageCount: asNumber(raw.pageCount),
    pagesWithText: asNumber(raw.pagesWithText),
    extractedCharacters: asNumber(raw.extractedCharacters),
  };
};

export const portfolioApi = {
  // Portfolio du freelance connecté, brouillons compris.
  mine: async (): Promise<PortfolioItem[]> =>
    toPortfolioList(await unwrap(listMyPortfolio())),

  // Portfolio public d'un freelance : uniquement les éléments publiés.
  forFreelancer: async (freelancerId: string): Promise<PortfolioItem[]> =>
    toPortfolioList(await unwrap(listFreelancerPortfolio(freelancerId))),

  get: async (id: string): Promise<PortfolioItem> =>
    toPortfolioItem(await unwrap(getPortfolioItemAction(id))),

  create: async (input: CreatePortfolioItemInput): Promise<PortfolioItem> =>
    toPortfolioItem(await unwrap(createPortfolioItemAction(input))),

  update: async (id: string, input: UpdatePortfolioItemInput): Promise<PortfolioItem> =>
    toPortfolioItem(await unwrap(updatePortfolioItemAction(id, input))),

  remove: (id: string) => unwrap(deletePortfolioItemAction(id)),

  importCv: async (file: File): Promise<CvImportResult> => {
    const form = new FormData();
    form.append("file", file);
    return toCvImportResult(
      await request<unknown>("/api/portfolio/cv/import", {
        method: "POST",
        body: form,
        headers: {},
      }),
    );
  },

  downloadCv: async (): Promise<void> => {
    const response = await fetch(`${API_URL}/api/portfolio/cv.pdf`, {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      let message = "Le CV PDF n'a pas pu être généré.";
      try {
        const data = (await response.json()) as { message?: string };
        if (data?.message) message = data.message;
      } catch {
        // ignore
      }
      throw new ApiError(response.status, message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "CV-FreelanceTN.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
// --- Devis & Factures ---------------------------------------------------
export type DocumentLineInput = { id?: string; description: string; quantity: number; unitPrice: number; taxRate: number; discount: number };
export type QuoteApiLine = DocumentLineInput & { lineSubtotal?: number; lineDiscount?: number; lineTax?: number; lineTotal?: number };
export type InvoiceApiLine = QuoteApiLine;
export type QuoteHistoryApi = { id: string; action: string; note?: string | null; actorId?: string | null; actorRole?: string | null; fromStatus?: string | null; toStatus?: string | null; createdAt: string };
export type QuoteApi = { id: string; number: string; ownerId: string; clientId?: string | null; client: string; projectId: string; project: string; issueDate: string; validUntil: string; status: 'draft' | 'sent' | 'accepted' | 'refused' | 'expired'; convertedTo?: string | null; correctionNote?: string | null; correctionRequested?: boolean; abandoned?: boolean; history?: QuoteHistoryApi[]; lines: QuoteApiLine[]; notes: string; subtotal: number; discountTotal: number; taxTotal: number; total: number; createdAt: string; updatedAt: string };
export type PaymentAttemptApi = { attemptNumber: number; status: string; errorCode?: string | null; errorMessage?: string | null; startedAt: string; completedAt?: string | null };
export type PaymentTransactionApi = { id: string; reference: string; invoiceId: string; invoiceNumber: string; clientId: string; clientName: string; freelancerId: string; freelancerName: string; projectId: string; projectTitle: string; amount: number; currency: string; method: string; methodLabel: string; status: string; note?: string | null; invoiceTotal: number; balanceBefore: number; balanceAfter?: number | null; receiptNumber?: string | null; receiptAvailable: boolean; errorCode?: string | null; errorMessage?: string | null; idempotencyKey?: string | null; provider?: string; providerPaymentRef?: string | null; providerPayUrl?: string | null; providerStatus?: string | null; providerLastCheckedAt?: string | null; blockchainTxHash?: string | null; walletAddress?: string | null; blockchainChainId?: number | null; blockchainReceiver?: string | null; blockchainAmountWei?: string | null; blockchainAmountEth?: number | null; blockchainTndPerEth?: number | null; blockchainExplorerUrl?: string | null; blockchainConfirmations?: number | null; blockchainGenesisHash?: string | null; blockchainGenesisTimestamp?: number | null; blockchainCrossGenesis?: boolean; blockchainReplayOfPaymentId?: string | null; gatewayRedirect?: boolean; legacy?: boolean; attempts: PaymentAttemptApi[]; createdAt: string; updatedAt: string; completedAt?: string | null };
export type PaymentResultApi = { transaction: PaymentTransactionApi; invoice: InvoiceApi };
export type BlockchainConfigApi = { enabled: boolean; network: string; networkKey: string; chainId: number; chainIdHex: string; rpcUrl: string; receiver: string; tndPerEth: number; minConfirmations: number; explorerBaseUrl: string };

export type BlockchainBalanceApi = { network: string; networkKey: string; chainId: number; address: string; balanceWei: string; balanceEth: number; blockNumber: number; checkedAt: string };
export type InvoicePaymentApi = { id?: string | null; amount: number; date: string; note?: string | null; reference?: string | null; status?: string | null; method?: string | null; transactionId?: string | null; idempotencyKey?: string | null; receiptNumber?: string | null; receiptAvailable?: boolean; legacy?: boolean; attempts?: PaymentAttemptApi[]; createdAt?: string | null };
export type InvoiceApi = { id: string; number: string; ownerId: string; clientId?: string | null; client: string; projectId: string; project: string; quoteId?: string | null; issueDate: string; dueDate: string; status: 'draft' | 'unpaid' | 'paid' | 'overdue' | 'emise' | 'partially_paid'; lines: InvoiceApiLine[]; notes: string; subtotal: number; discountTotal: number; taxTotal: number; total: number; amountPaid: number; balanceDue: number; payments: InvoicePaymentApi[]; createdAt: string; updatedAt: string };
export const quotesApi = {
  list: async () => (await unwrap(listQuotes())) as QuoteApi[],
  listForClient: async () => (await unwrap(listClientQuotes())) as QuoteApi[],
  get: async (id: string) => (await unwrap(getQuoteAction(id))) as QuoteApi,
  create: async (input: any) => (await unwrap(createQuoteAction(input))) as QuoteApi,
  update: async (id: string, input: any) => (await unwrap(updateQuoteAction(id, input))) as QuoteApi,
  remove: async (id: string): Promise<void> => { await unwrap(deleteQuoteAction(id)); },
  updateStatus: async (id: string, status: string, note?: string, abandon?: boolean) =>
    (await unwrap(updateQuoteStatusAction(id, status, note, abandon))) as QuoteApi,
  convertToInvoice: async (id: string) =>
    (await unwrap(convertQuoteToInvoiceAction(id))) as InvoiceApi,
};
export const invoicesApi = {
  list: async () => (await unwrap(listInvoices())) as InvoiceApi[],
  get: async (id: string) => (await unwrap(getInvoiceAction(id))) as InvoiceApi,
  create: async (input: any) => (await unwrap(createInvoiceAction(input))) as InvoiceApi,
  createFromQuote: async (quoteId: string, input?: { dueDate?: string; notes?: string }) =>
    (await unwrap(createInvoiceFromQuoteAction(quoteId, input))) as InvoiceApi,
  update: async (id: string, input: any) => (await unwrap(updateInvoiceAction(id, input))) as InvoiceApi,
  remove: async (id: string): Promise<void> => { await unwrap(deleteInvoiceAction(id)); },
  updateStatus: async (id: string, status: string) =>
    (await unwrap(updateInvoiceStatusAction(id, status))) as InvoiceApi,
  recordPayment: (id: string, input: { amount: number; date?: string; note?: string; reference?: string; method?: string; simulateOutcome?: 'success' | 'failed'; idempotencyKey?: string }) => request<InvoiceApi>('/api/invoices/' + id + '/payments', { method: 'POST', body: JSON.stringify(input) }),
};

const triggerDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const paymentsApi = {
  list: (invoiceId?: string) => request<PaymentTransactionApi[]>('/api/payments' + (invoiceId ? '?invoiceId=' + encodeURIComponent(invoiceId) : '')),
  get: (id: string) => request<PaymentTransactionApi>('/api/payments/' + id),
  create: (input: { invoiceId: string; amount: number; method?: string; note?: string; idempotencyKey?: string; simulateOutcome?: 'success' | 'failed'; deferProcessing?: boolean; provider?: 'internal' | 'konnect' | 'blockchain' }) =>
    request<PaymentResultApi>('/api/payments', { method: 'POST', body: JSON.stringify(input) }),
  process: (id: string, simulateOutcome?: 'success' | 'failed') =>
    request<PaymentResultApi>('/api/payments/' + id + '/process', { method: 'POST', body: JSON.stringify({ simulateOutcome }) }),
  verify: (id: string) =>
    request<PaymentResultApi>('/api/payments/' + id + '/verify', { method: 'POST', body: JSON.stringify({}) }),
  verifyBlockchain: (id: string, txHash: string) =>
    request<PaymentResultApi>('/api/payments/' + id + '/verify-blockchain', { method: 'POST', body: JSON.stringify({ txHash }) }),
  blockchainConfig: () =>
    request<BlockchainConfigApi>('/api/payments/blockchain/config', { cache: 'no-store' }),
  blockchainBalance: (address?: string) =>
    request<BlockchainBalanceApi>('/api/payments/blockchain/balance' + (address ? '?address=' + encodeURIComponent(address) : ''), { cache: 'no-store' }),
  retry: (id: string, simulateOutcome?: 'success' | 'failed') =>
    request<PaymentResultApi>('/api/payments/' + id + '/retry', { method: 'POST', body: JSON.stringify({ simulateOutcome }) }),
  cancel: (id: string, reason?: string) =>
    request<PaymentResultApi>('/api/payments/' + id + '/cancel', { method: 'POST', body: JSON.stringify({ reason }) }),
  downloadReceipt: async (id: string, reference?: string | null) => {
    const response = await fetch(`${API_URL}/api/payments/${encodeURIComponent(id)}/receipt`, {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      let message = "Le reçu PDF n'a pas pu être téléchargé.";
      try {
        const data = (await response.json()) as { message?: string };
        if (data?.message) message = data.message;
      } catch {
        // ignore
      }
      throw new ApiError(response.status, message);
    }
    const fileName = `Recu-${(reference || "FreelanceTN").replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf`;
    triggerDownload(await response.blob(), fileName);
  },
};

// Tasks API
export const tasksApi = {
  list: async (): Promise<Task[]> => (await unwrap(listTasks())) as Task[],
  get: async (id: string): Promise<Task> => (await unwrap(getTaskAction(id))) as Task,
  create: async (input: Partial<Task>): Promise<Task> =>
    (await unwrap(createTaskAction(input as Record<string, unknown>))) as Task,
  update: async (id: string, input: Partial<Task>): Promise<Task> =>
    (await unwrap(updateTaskAction(id, input as Record<string, unknown>))) as Task,
  remove: async (id: string): Promise<void> => { await unwrap(deleteTaskAction(id)); },
  comments: async (id: string): Promise<TaskComment[]> =>
    (await unwrap(listTaskComments(id))) as TaskComment[],
  addComment: async (id: string, content: string): Promise<TaskComment> =>
    (await unwrap(addTaskComment(id, content))) as TaskComment,
};



export const notificationsApi = {
  list: async (): Promise<Notification[]> => (await unwrap(listNotifications())) as Notification[],
  unreadCount: async (): Promise<number> => (await unwrap(unreadNotificationCount())) as number,
  markRead: async (id: string): Promise<void> => { await unwrap(markNotificationRead(id)); },
  markAllRead: async (): Promise<void> => { await unwrap(markAllNotificationsRead()); },
};

export const invitationsApi = {
  create: async (input: { projectId: string; freelancerId: string; message: string; offeredPrice?: string; offeredDelivery?: string }) =>
    unwrap(createInvitationAction(input)),
  mine: async () => unwrap(listMyInvitations()),
  sent: async () => unwrap(listSentInvitations()),
  accept: async (id: string) => unwrap(acceptInvitationAction(id)),
  decline: async (id: string, reason?: string) => unwrap(declineInvitationAction(id, reason)),
};

export type {
  AiStatus,
  BreakdownTaskSuggestion,
  FreelancerMatchSuggestion,
  ProjectAssistSuggestion,
  ProjectBreakdownSuggestion,
  ProposalAssistSuggestion,
};

/** Assistant IA : suggestions uniquement, aucune mutation métier. */
export const aiApi = {
  status: async (): Promise<AiStatus> => unwrap(getAiStatusAction()),
  assistProject: async (input: {
    idea: string;
    category?: string;
    language?: string;
  }): Promise<ProjectAssistSuggestion> => unwrap(assistProjectDraftAction(input)),
  matchFreelancers: async (
    projectId: string,
  ): Promise<{ projectId: string; matches: FreelancerMatchSuggestion[] }> =>
    unwrap(matchFreelancersAction(projectId)),
  assistProposal: async (projectId: string): Promise<ProposalAssistSuggestion> =>
    unwrap(assistProposalDraftAction(projectId)),
  breakdownProject: async (projectId: string): Promise<ProjectBreakdownSuggestion> =>
    unwrap(breakdownProjectAction(projectId)),
};

