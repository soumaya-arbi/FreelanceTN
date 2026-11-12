export type Page =
  | "home"
  | "login"
  | "register"
  | "freelancers"
  | "profile"
  | "projects"
  | "find-work"
  | "profile-edit"
  | "editor"
  | "project-detail"
  | "dashboard"
  | "portfolio"
  | "messages"
  | "orders"
  | "earnings"
  | "settings"
  | "client"
  | "invite"
  | "proposals"
  | "invitations"
  | "reviews"
  | "analytics"
  | "availability"
  | "verification"
  | "support"
  | "client-projects"
  | "client-proposals"
  | "client-contracts"
  | "client-talent"
  | "client-profile"
  | "client-post"
  | "client-process"
  | "payments"
  | "admin"
  | "tasks"
  | "quotes"
  | "invoices"
  | "client-tasks"
  | "client-quotes"
  | "client-invoices"
  | "feedback"
  | "client-feedback"
  | "ai";

export type IconName =
  | "arrow"
  | "bank"
  | "bell"
  | "bookmark"
  | "briefcase"
  | "card"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "dashboard"
  | "download"
  | "file"
  | "globe"
  | "heart"
  | "home"
  | "image"
  | "menu"
  | "message"
  | "moon"
  | "more"
  | "portfolio"
  | "refresh"
  | "search"
  | "settings"
  | "shield"
  | "star"
  | "sun"
  | "users"
  | "wallet";

export type EditorMode = "portfolio" | "review" | "report" | "withdrawal" | "order";
export type ClientProcessMode = "project" | "proposal" | "contract" | "workspace" | "review";
export type Role = "freelancer" | "client";

export type Freelancer = {
  id: string;
  name: string;
  role: string;
  rate: number;
  rating: number;
  jobs: number;
  location: string;
  avatar: string;
  avatarSource?: "initials" | "preset" | "upload" | "generated";
  avatarConfig?: string;
  coverImage?: string;
  skills: string[];
  bio?: string;
  experiences?: { id?: string; role: string; company: string; period: string; description: string }[];
  education?: { id?: string; degree: string; institution: string; period: string; description: string }[];
  languages?: { id?: string; name: string; level: string }[];
};

// Cycle de vie d'un projet, du brouillon à la clôture.
// "Open" = projet publié et visible dans le catalogue des opportunités.
export type ProjectStatus = "Open" | "In progress" | "Client review" | "Completed" | "Draft" | "Cancelled";

// Statuts proposés à l'utilisateur. La liste reproduit les transitions
// autorisées par le backend : une transition refusée par l'API n'est jamais
// proposée dans l'interface.
export const PROJECT_STATUSES: ProjectStatus[] = [
  "Open",
  "In progress",
  "Client review",
  "Completed",
  "Draft",
  "Cancelled",
];

export const projectStatusOptions = (from: ProjectStatus): ProjectStatus[] => {
  switch (from) {
    case "Draft":
      return ["Draft", "Open"];
    case "Open":
      return ["Open", "Draft", "In progress", "Completed"];
    case "In progress":
      return ["In progress", "Open", "Draft", "Client review", "Completed"];
    case "Client review":
      return ["Client review", "In progress", "Draft", "Completed"];
    case "Completed":
      // Un projet terminé peut reprendre son exécution (In progress), être
      // rouvert au catalogue (Open) ou dépublié (Draft).
      return ["Completed", "In progress", "Open", "Draft"];
    default:
      return [from];
  }
};

// Candidature déposée par un freelance sur un projet publié.
// Les champs du projet et du freelance sont dénormalisés par l'API afin
// d'afficher une ligne complète sans jointure côté client.
// "Cancelled" = l'acceptation de la candidature a été annulée par le
// client : la candidature reste conservée, mais elle n'est plus active.
export type ProposalStatus = "Pending" | "Accepted" | "Refused" | "Withdrawn" | "Cancelled";

export const PROPOSAL_STATUSES: ProposalStatus[] = ["Pending", "Accepted", "Refused", "Withdrawn", "Cancelled"];

export const proposalStatusOptions = (status: ProposalStatus): ProposalStatus[] => {
  switch (status) {
    case "Pending":
      return ["Pending", "Accepted", "Refused"];
    case "Accepted":
      return ["Accepted"];
    case "Refused":
      return ["Refused"];
    case "Withdrawn":
      return ["Withdrawn"];
    case "Cancelled":
      return ["Cancelled"];
    default:
      return [status];
  }
};

export type Proposal = {
  id: string;
  projectId: string;
  projectTitle: string;
  projectBudget: string;
  projectType: string;
  projectStatus: string;
  projectOwnerId: string;
  freelancerId: string;
  freelancerName: string;
  freelancerTitle: string;
  coverLetter: string;
  price: string;
  delivery: string;
  portfolioId: string | null;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
};

// Projet : modèle aligné sur le DTO renvoyé par l'API Projects
// (GET/POST/PUT /api/projects). Le propriétaire est toujours celui de la session.
export type Project = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  budget: string;
  type: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  durationValue?: number | null;
  durationUnit?: string | null;
  proposals: number;
  time: string;
  skills: string[];
  client: string;
  status: ProjectStatus;
  category: string;
  deadline: string;
  // Freelance approuvé par le client pour ce projet (vide tant qu'aucune
  // approbation n'a été donnée).
  assignedTo: string | null;
  assignedToName: string | null;
  assignedAt: string | null;
  // Étapes du projet (Project Milestones), synchronisées avec le statut.
  milestones?: ProjectMilestone[];
  // Historique chronologique append-only des événements milestones.
  milestoneHistory?: MilestoneHistoryEntry[];
  // Historique des affectations libérées (annulation d'acceptation,
  // réouverture). Conservé même après le retrait de l'affectation active.
  assignmentHistory: AssignmentHistoryEntry[];
  attachments?: ProjectAttachment[];
  createdAt: string;
  updatedAt: string;
};

// Trace d'une affectation de freelance libérée.
export type ProjectAttachment = {
  fileName: string;
  url: string;
  size: number;
  uploadedAt: string;
};

export type AssignmentHistoryEntry = {
  freelancerId: string;
  freelancerName: string;
  assignedAt: string | null;
  releasedAt: string | null;
  reason: string;
};

export type ProjectMilestone = {
  id: string;
  key: string;
  title: string;
  status: string;
  progress: number;
  date: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MilestoneHistoryEntry = {
  id: string;
  milestoneId: string | null;
  milestoneTitle: string;
  type: string;
  message: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
};

// Freelance qu'un client peut approuver sur un projet.
// Seules les informations publiques sont exposées (ni email, ni jeton).
export type FreelancerSummary = {
  id: string;
  name: string;
  title: string;
  avatar: string;
};

export type TaskStatus = "todo" | "in-progress" | "in-review" | "done";
export type TaskPriority = "low" | "medium" | "high";

export type Notification = {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  message: string;
  taskId: string;
  projectId: string;
  taskTitle: string;
  projectTitle: string;
  actorName: string;
  isRead: boolean;
  createdAt: string;
};
export type TaskComment = {
  id: string;
  taskId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
export type Task = {
  id: string;
  title: string;
  description: string;
  projectId: string;
  assignee: string;
  assigneeUserId?: string;
  assigneeRole?: string;
  status: TaskStatus;
  priority: TaskPriority;
  storyPoints?: number;
  startDate: string;
  dueDate: string;
  statusHistory?: { status: string; changedBy: string; changedAt: string; note?: string }[];
  comment?: string;
};

export type DocumentLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discount: number;
};

export type QuoteStatus = "draft" | "sent" | "accepted" | "refused" | "expired";
export type InvoiceStatus = "draft" | "emise" | "unpaid" | "partially_paid" | "paid" | "overdue";

export type PaymentMethod =
  | "card"
  | "metamask"
  | "wallet"
  | "bank_transfer"
  | "other"
  | "card_simulated"
  | "wallet_simulated"
  | "bank_transfer_simulated"
  | "cash_simulated";

export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";

export type PaymentAttempt = {
  attemptNumber: number;
  status: PaymentStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
};

export type PaymentTransaction = {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  freelancerId: string;
  freelancerName: string;
  projectId: string;
  projectTitle: string;
  amount: number;
  currency: string;
  method: PaymentMethod | string;
  methodLabel: string;
  status: PaymentStatus;
  note?: string | null;
  invoiceTotal: number;
  balanceBefore: number;
  balanceAfter?: number | null;
  receiptNumber?: string | null;
  receiptAvailable: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  idempotencyKey?: string | null;
  provider?: "internal" | "konnect" | "blockchain" | string;
  providerPaymentRef?: string | null;
  providerPayUrl?: string | null;
  providerStatus?: string | null;
  providerLastCheckedAt?: string | null;
  // --- Blockchain Ethereum Sepolia (MetaMask) ---
  blockchainTxHash?: string | null;
  walletAddress?: string | null;
  blockchainChainId?: number | null;
  blockchainReceiver?: string | null;
  blockchainAmountWei?: string | null;
  blockchainAmountEth?: number | null;
  blockchainTndPerEth?: number | null;
  blockchainExplorerUrl?: string | null;
  blockchainConfirmations?: number | null;
  blockchainGenesisHash?: string | null;
  blockchainGenesisTimestamp?: number | null;
  blockchainCrossGenesis?: boolean;
  blockchainReplayOfPaymentId?: string | null;
  gatewayRedirect?: boolean;
  legacy?: boolean;
  attempts: PaymentAttempt[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type InvoicePayment = {
  id?: string;
  amount: number;
  date: string;
  note?: string;
  reference?: string;
  status?: PaymentStatus | "completed" | "failed";
  method?: string;
  transactionId?: string;
  idempotencyKey?: string;
  receiptNumber?: string | null;
  receiptAvailable?: boolean;
  legacy?: boolean;
  attempts?: PaymentAttempt[];
  createdAt?: string;
};

export type QuoteHistoryEntry = {
  id: string;
  action: string;
  note?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  createdAt: string;
};

export type Quote = {
  id: string;
  number: string;
  clientId?: string;
  client: string;
  projectId?: string;
  project: string;
  issueDate: string;
  validUntil: string;
  status: QuoteStatus;
  convertedTo?: string;
  correctionNote?: string | null;
  correctionRequested?: boolean;
  abandoned?: boolean;
  history?: QuoteHistoryEntry[];
  lines: DocumentLine[];
  notes: string;
};

export type Invoice = {
  id: string;
  number: string;
  clientId?: string;
  client: string;
  projectId?: string;
  project: string;
  quoteId?: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  lines: DocumentLine[];
  notes: string;
  amountPaid?: number;
  balanceDue?: number;
  payments?: InvoicePayment[];
};

export type FeedbackStatus =
  | "awaiting_review"
  | "submitted_hidden"
  | "published"
  | "expired";

export type FeedbackDirection = "client_to_freelancer" | "freelancer_to_client";

export type Feedback = {
  id: string;
  projectId: string;
  projectTitle: string;
  clientId?: string;
  clientName?: string;
  freelancerId?: string;
  freelancerName?: string;
  authorId?: string;
  authorName?: string;
  author: string;
  authorRole: Role;
  recipientId?: string;
  recipientName?: string;
  recipientRole?: Role;
  recipient: string;
  direction?: FeedbackDirection;
  status?: FeedbackStatus;
  rating: number;
  averageRating?: number;
  criteria?: Record<string, number>;
  comment: string;
  strengths?: string;
  improvements?: string;
  recommend?: boolean | null;
  submittedAt?: string;
  publishedAt?: string;
  dueAt?: string;
  createdAt: string;
  updatedAt?: string;
};

export type FeedbackDistributionItem = {
  stars: number;
  count: number;
};

export type FeedbackSummary = {
  userId: string;
  count: number;
  averageRating: number;
  distribution: FeedbackDistributionItem[];
  criteriaAverages: Record<string, number>;
  criteriaReviewCount: number;
  recommendationRate: number | null;
  reviews: Feedback[];
};

export type Comment = {
  id: string;
  projectId: string;
  projectTitle: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: Role;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioVisibility = "Public" | "Registered clients only" | "Private";

export type PortfolioItem = {
  id: string;
  title: string;
  summary: string;
  category: string;
  role: string;
  duration: string;
  challenge: string;
  solution: string;
  outcome: string;
  skills: string[];
  link: string;
  image: string;
  visibility: PortfolioVisibility;
  published: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type UploadedFile = {
  name: string;
  size: number;
  type: string;
  url: string;
};
