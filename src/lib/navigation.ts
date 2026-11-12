import type { ClientProcessMode, EditorMode, IconName, Page, Role } from "@/lib/types";

// Navigation réduite aux modules réellement reliés à une action serveur ou à
// une API opérationnelle. Les entrées sans backend (messages, contrats
// internes, analyses, disponibilité, vérification, support) ne sont plus
// exposées : elles ne doivent pas laisser croire à une fonctionnalité active.
export const sideItems: { label: string; icon: IconName; page: Page }[] = [
  { label: "Overview", icon: "dashboard", page: "dashboard" },
  { label: "Browse client projects", icon: "search", page: "find-work" },
  { label: "Edit profile", icon: "users", page: "profile-edit" },
  { label: "Portfolio & CV", icon: "portfolio", page: "portfolio" },
  { label: "Client invitations", icon: "bell", page: "invitations" },
  { label: "Projects", icon: "briefcase", page: "orders" },
  { label: "Tasks", icon: "check", page: "tasks" },
  { label: "Assistant IA", icon: "star", page: "ai" },
  { label: "Devis & Factures", icon: "file", page: "quotes" },
  { label: "Feedback", icon: "star", page: "feedback" },
];

export const clientNav: { label: string; icon: IconName; page?: Page }[] = [
  { label: "Overview", icon: "dashboard", page: "client" },
  { label: "Find freelancers", icon: "users", page: "client-talent" },
  { label: "Projects", icon: "file", page: "client-projects" },
  { label: "Tasks", icon: "check", page: "client-tasks" },
  { label: "Assistant IA", icon: "star", page: "ai" },
  { label: "Feedback", icon: "star", page: "client-feedback" },
  { label: "Devis & Factures", icon: "file", page: "client-quotes" },
];

export const moduleInfo: Partial<Record<Page, [string, string, string]>> = {
  proposals: ["My Proposals", "Track every opportunity from first pitch to accepted contract.", "View invitations"],
  invitations: ["Project Invitations", "Review opportunities selected for you by clients.", "Set preferences"],
  feedback: ["Feedback", "Share verified feedback and follow the reviews you receive.", ""],
};

export const adminSections = ["overview", "users", "verifications", "projects", "orders", "transactions", "disputes", "reports", "analytics", "platform-settings", "audit-logs"];

export const adminSectionLabel = (slug: string) =>
  slug === "overview" ? "Overview" : slug.split("-").map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(" ");

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const editorPath = (mode: EditorMode) => `/freelancer/editor/${mode}`;

// Profil public d'un client consulté par un freelance. La clé de routage est
// toujours l'identifiant réel du compte, jamais le nom affiché.
export const freelancerClientProfilePath = (clientId: string) =>
  `/freelancer/clients/${encodeURIComponent(clientId)}`;

// Page d'accueil d'un compte : elle découle du rôle stocké en base.
export const homePathForRole = (role: Role) => (role === "client" ? "/client" : "/freelancer/dashboard");

export const clientProcessPath = (mode: ClientProcessMode) => {
  switch (mode) {
    case "proposal":
      return "/client/proposals";
    case "contract":
      return "/client/contracts";
    case "workspace":
      return "/client/contracts/workspace";
    case "review":
      return "/client/contracts/review";
    default:
      return "/client/projects";
  }
};

export const pathFor = (page: Page, role: Role = "freelancer", invitee = ""): string => {
  const client = role === "client";
  switch (page) {
    case "home": return "/";
    case "login": return "/login";
    case "register": return "/register";
    case "freelancers": return "/freelancers";
    case "profile": return "/freelancers";
    case "project-detail": return "/projects";
    case "dashboard": return "/freelancer/dashboard";
    case "client": return "/client";
    case "client-profile": return client ? "/client/talent" : "/freelancers";
    case "invite": return invitee ? `/client/invite/${slugify(invitee)}` : "/client/talent";
    case "admin": return "/admin";
    case "ai": return "/assistant";
    case "find-work": return "/freelancer/find-work";
    case "profile-edit": return "/freelancer/profile/edit";
    case "portfolio": return "/freelancer/portfolio";
    case "invitations": return "/freelancer/invitations";
    case "proposals": return client ? "/client/proposals" : "/freelancer/proposals";
    case "orders": return "/freelancer/projects";
    case "tasks": return client ? "/client/tasks" : "/freelancer/tasks";
    case "quotes": return client ? "/client/quotes" : "/freelancer/quotes";
    case "invoices": return client ? "/client/quotes?tab=invoices" : "/freelancer/quotes?tab=invoices";
    case "feedback": return client ? "/client/feedback" : "/freelancer/feedback";
    case "reviews": return "/freelancer/reviews";
    case "earnings": return "/freelancer/earnings";
    case "analytics": return "/freelancer/analytics";
    case "availability": return "/freelancer/availability";
    case "verification": return "/freelancer/verification";
    case "client-talent": return "/client/talent";
    case "client-post": return "/client/post";
    case "client-projects": return "/client/projects";
    case "client-contracts": return "/client/contracts";
    case "client-tasks": return "/client/tasks";
    case "client-quotes": return "/client/quotes";
    case "client-invoices": return "/client/quotes?tab=invoices";
    case "client-feedback": return "/client/feedback";
    case "payments": return "/client/quotes?tab=payments";
    case "messages": return client ? "/client/messages" : "/freelancer/messages";
    case "settings": return client ? "/client/settings" : "/freelancer/settings";
    case "support": return client ? "/client/support" : "/freelancer/support";
    default: return "/";
  }
};

export const isPublicPath = (pathname: string) =>
  pathname === "/" ||
  pathname === "/offline" ||
  pathname === "/freelancers" ||
  pathname.startsWith("/freelancers/") ||
  pathname === "/projects" ||
  pathname.startsWith("/projects/");
