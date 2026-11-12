import { vi } from "vitest";

// Les tests unitaires du front ne doivent jamais charger le code serveur
// (mongodb, next/headers). On remplace donc chaque module de Server Actions
// par des fonctions simulées ; les tests configurent ensuite les réponses
// attendues via `vi.mocked(...)`.
vi.mock("@/lib/actions/projects", () => ({
  addProjectMilestone: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  listAssignedProjects: vi.fn(),
  listProjectAssignees: vi.fn(),
  listProjectCatalog: vi.fn(),
  listProjectCatalogCategories: vi.fn(),
  listProjects: vi.fn(),
  projectMilestoneAction: vi.fn(),
  reopenProject: vi.fn(),
  submitProjectForReview: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("@/lib/actions/proposals", () => ({
  createProposal: vi.fn(),
  deleteProposal: vi.fn(),
  getProposal: vi.fn(),
  listMyProposals: vi.fn(),
  listReceivedProposals: vi.fn(),
  setProposalStatus: vi.fn(),
}));

vi.mock("@/lib/actions/comments", () => ({
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  listProjectComments: vi.fn(),
  updateComment: vi.fn(),
}));

vi.mock("@/lib/actions/portfolio", () => ({
  createPortfolioItem: vi.fn(),
  deletePortfolioItem: vi.fn(),
  getPortfolioItem: vi.fn(),
  listFreelancerPortfolio: vi.fn(),
  listMyPortfolio: vi.fn(),
  updatePortfolioItem: vi.fn(),
}));

vi.mock("@/lib/actions/freelancers", () => ({
  getFreelancer: vi.fn(),
  listFreelancers: vi.fn(),
}));

vi.mock("@/lib/actions/quotes", () => ({
  convertQuoteToInvoice: vi.fn(),
  createQuote: vi.fn(),
  deleteQuote: vi.fn(),
  getQuote: vi.fn(),
  listClientQuotes: vi.fn(),
  listQuotes: vi.fn(),
  updateQuote: vi.fn(),
  updateQuoteStatus: vi.fn(),
}));

vi.mock("@/lib/actions/invoices", () => ({
  createInvoice: vi.fn(),
  createInvoiceFromQuote: vi.fn(),
  deleteInvoice: vi.fn(),
  getInvoice: vi.fn(),
  listInvoices: vi.fn(),
  updateInvoice: vi.fn(),
  updateInvoiceStatus: vi.fn(),
}));

vi.mock("@/lib/actions/tasks", () => ({
  addTaskComment: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  getTask: vi.fn(),
  listTaskComments: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/lib/actions/notifications", () => ({
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  unreadNotificationCount: vi.fn(),
}));

vi.mock("@/lib/actions/invitations", () => ({
  acceptInvitation: vi.fn(),
  createInvitation: vi.fn(),
  declineInvitation: vi.fn(),
  listMyInvitations: vi.fn(),
  listSentInvitations: vi.fn(),
}));

vi.mock("@/lib/actions/account", () => ({
  exportAccount: vi.fn(),
  getAccountHistory: vi.fn(),
  getBillingProfile: vi.fn(),
  getClientProfile: vi.fn(),
  getNotificationPreferencesAction: vi.fn(),
  getPublicClientProfile: vi.fn(),
  getUserPreferences: vi.fn(),
  setAvatarStyle: vi.fn(),
  updateBillingProfile: vi.fn(),
  updateClientProfile: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}));

vi.mock("@/lib/actions/profile", () => ({
  updateMyProfile: vi.fn(),
}));
