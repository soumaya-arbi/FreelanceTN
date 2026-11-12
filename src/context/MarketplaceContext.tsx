"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  projectsApi,
  proposalsApi,
  feedbacksApi,
  portfolioApi,
  quotesApi,
  invoicesApi,
  paymentsApi,
  tasksApi,
  type CreatePortfolioItemInput,
  type CreateProposalInput,
  type ProjectCatalogParams,
  type UpdatePortfolioItemInput,
  type UpdateProjectInput,
  type QuoteApi,
  type InvoiceApi,
  type PaymentTransactionApi,
  type PaymentResultApi,
  type BlockchainConfigApi,
  type SubmitFeedbackInput,
} from "@/lib/api";
import { useUser } from "@/context/UserContext";
import type {
  Feedback,
  FreelancerSummary,
  Invoice,
  InvoiceStatus,
  PortfolioItem,
  Project,
  PaymentStatus,
  PaymentTransaction,
  ProjectStatus,
  Proposal,
  Quote,
  QuoteStatus,
  Task,
} from "@/lib/types";

type MarketplaceContextValue = {
  projects: Project[];
  projectsLoading: boolean;
  projectsError: string;
  catalogProjects: Project[];
  catalogLoading: boolean;
  catalogError: string;
  assignedProjects: Project[];
  assignedLoading: boolean;
  assignedError: string;
  assignees: FreelancerSummary[];
  assigneesLoading: boolean;
  assigneesError: string;
  // Candidatures dǸposǸes par le freelance connectǸ.
  myProposals: Proposal[];
  myProposalsLoading: boolean;
  myProposalsError: string;
  // Candidatures re��ues par le client connectǸ.
  receivedProposals: Proposal[];
  receivedProposalsLoading: boolean;
  receivedProposalsError: string;
  tasks: Task[];
  quotes: Quote[];
  invoices: Invoice[];
  documentsLoading: boolean;
  documentsError: string;
  feedback: Feedback[];
  feedbackLoading?: boolean;
  feedbackError?: string;
  portfolio: PortfolioItem[];
  portfolioLoading: boolean;
  portfolioError: string;
  refreshProjects: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  refreshAssigned: () => Promise<void>;
  refreshAssignees: () => Promise<void>;
  // Filtres du catalogue projet envoyés aux paramètres API déjà disponibles.
  catalogSearch: ProjectCatalogParams;
  setCatalogSearch: (patch: Partial<ProjectCatalogParams>) => void;
  refreshMyProposals: () => Promise<void>;
  refreshReceivedProposals: () => Promise<void>;
  submitProposal: (input: CreateProposalInput) => Promise<Proposal>;
  withdrawProposal: (id: string) => Promise<void>;
  reviewProposal: (id: string, status: "Accepted" | "Refused") => Promise<Proposal>;
  addProject: (project: Omit<Project, "id" | "ownerId" | "time" | "proposals" | "createdAt" | "updatedAt" | "assignedTo" | "assignedToName" | "assignedAt" | "assignmentHistory">) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Project> & { message?: string }) => Promise<Project>;
  reopenProject: (id: string, message?: string) => Promise<Project>;
  milestoneAction: (projectId: string, milestoneId: string, input: { action: string; message?: string; progress?: number }) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  assignProject: (id: string, freelancerId: string, nextStatus?: ProjectStatus) => Promise<Project>;
  submitProjectForReview: (id: string, message?: string) => Promise<Project>;
  addTask: (task: Omit<Task, "id">) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addQuote: (quote: Omit<Quote, "id" | "number">) => Promise<Quote>;
  updateQuote: (id: string, patch: Partial<Quote>) => Promise<Quote>;
  deleteQuote: (id: string) => Promise<void>;
  setQuoteStatus: (id: string, status: QuoteStatus, note?: string, abandon?: boolean) => Promise<Quote>;
  addInvoice: (invoice: Omit<Invoice, "id" | "number">) => Promise<Invoice>;
  updateInvoice: (id: string, patch: Partial<Invoice>) => Promise<Invoice>;
  deleteInvoice: (id: string) => Promise<void>;
  setInvoiceStatus: (id: string, status: InvoiceStatus) => Promise<Invoice>;
  convertQuoteToInvoice: (quoteId: string) => Promise<Invoice | null>;
  createInvoiceFromQuote: (quoteId: string, input?: { dueDate?: string; notes?: string }) => Promise<Invoice>;
  recordPayment: (id: string, input: { amount: number; date?: string; note?: string; reference?: string; method?: string; simulateOutcome?: "success" | "failed"; idempotencyKey?: string }) => Promise<Invoice>;
  // Moteur de transactions interne (source de vérité des paiements).
  payments: PaymentTransaction[];
  paymentsLoading: boolean;
  paymentsError: string;
  refreshPayments: () => Promise<void>;
  payInvoice: (input: { invoiceId: string; amount: number; method?: string; note?: string; idempotencyKey?: string; simulateOutcome?: "success" | "failed"; provider?: "internal" | "konnect" | "blockchain" }) => Promise<{ transaction: PaymentTransaction; invoice: Invoice }>;
  verifyInvoicePayment: (transactionId: string) => Promise<{ transaction: PaymentTransaction; invoice: Invoice }>;
  verifyBlockchainPayment: (transactionId: string, txHash: string) => Promise<{ transaction: PaymentTransaction; invoice: Invoice }>;
  blockchainConfig: () => Promise<BlockchainConfigApi>;
  retryInvoicePayment: (transactionId: string) => Promise<{ transaction: PaymentTransaction; invoice: Invoice }>;
  cancelInvoicePayment: (transactionId: string, reason?: string) => Promise<{ transaction: PaymentTransaction; invoice: Invoice }>;
  downloadPaymentReceipt: (transactionId: string, reference?: string | null) => Promise<void>;
  refreshFeedback: () => Promise<void>;
  // Soumission d'une évaluation structurée (cinq critères, commentaire
  // obligatoire). Le rôle et le destinataire sont déduits côté API.
  submitFeedback: (projectId: string, input: SubmitFeedbackInput) => Promise<Feedback>;
  refreshPortfolio: () => Promise<void>;
  addPortfolioItem: (item: CreatePortfolioItemInput) => Promise<PortfolioItem>;
  updatePortfolioItem: (id: string, patch: UpdatePortfolioItemInput) => Promise<PortfolioItem>;
  deletePortfolioItem: (id: string) => Promise<void>;
};

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

const mapQuoteApi = (q: QuoteApi): Quote => ({
  id: q.id,
  number: q.number,
  clientId: q.clientId || undefined,
  client: q.client,
  projectId: q.projectId || undefined,
  project: q.projectId || q.project,
  issueDate: q.issueDate,
  validUntil: q.validUntil,
  status: q.status,
  convertedTo: q.convertedTo || undefined,
  correctionNote: q.correctionNote ?? undefined,
  correctionRequested: !!q.correctionRequested,
  abandoned: !!q.abandoned,
  history: (q.history || []).map((h) => ({
    id: h.id || "",
    action: h.action || "",
    note: h.note ?? undefined,
    actorId: h.actorId ?? undefined,
    actorRole: h.actorRole ?? undefined,
    fromStatus: h.fromStatus ?? undefined,
    toStatus: h.toStatus ?? undefined,
    createdAt: h.createdAt || "",
  })),
  lines: (q.lines || []).map((line, index) => ({
    id: line.id || `line-${index}`,
    description: line.description || '',
    quantity: Number(line.quantity) || 0,
    unitPrice: Number(line.unitPrice) || 0,
    taxRate: Number(line.taxRate) || 0,
    discount: Number(line.discount) || 0,
  })),
  notes: q.notes || '',
});

const mapInvoiceApi = (inv: InvoiceApi): Invoice => ({
  id: inv.id,
  number: inv.number,
  clientId: inv.clientId || undefined,
  client: inv.client,
  projectId: inv.projectId || undefined,
  project: inv.projectId || inv.project,
  quoteId: inv.quoteId || undefined,
  issueDate: inv.issueDate,
  dueDate: inv.dueDate,
  status: inv.status,
  lines: (inv.lines || []).map((line, index) => ({
    id: line.id || `line-${index}`,
    description: line.description || '',
    quantity: Number(line.quantity) || 0,
    unitPrice: Number(line.unitPrice) || 0,
    taxRate: Number(line.taxRate) || 0,
    discount: Number(line.discount) || 0,
  })),
  notes: inv.notes || '',
  amountPaid: Number(inv.amountPaid) || 0,
  balanceDue: Number(inv.balanceDue) || 0,
  payments: (inv.payments || []).map((payment) => ({
    id: payment.id || undefined,
    amount: Number(payment.amount) || 0,
    date: payment.date || '',
    note: payment.note || undefined,
    reference: payment.reference || undefined,
    status: (payment.status as PaymentStatus | "completed" | "failed" | undefined) || "completed",
    method: payment.method || undefined,
    transactionId: payment.transactionId || undefined,
    idempotencyKey: payment.idempotencyKey || undefined,
    receiptNumber: payment.receiptNumber || null,
    receiptAvailable: Boolean(payment.receiptAvailable),
    legacy: Boolean(payment.legacy),
    attempts: (payment.attempts || []).map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status as PaymentTransaction["status"],
      errorCode: attempt.errorCode ?? null,
      errorMessage: attempt.errorMessage ?? null,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt ?? null,
    })),
    createdAt: payment.createdAt || undefined,
  })),
});

const mapPaymentApi = (payment: PaymentTransactionApi): PaymentTransaction => ({
  id: payment.id,
  reference: payment.reference,
  invoiceId: payment.invoiceId,
  invoiceNumber: payment.invoiceNumber,
  clientId: payment.clientId,
  clientName: payment.clientName,
  freelancerId: payment.freelancerId,
  freelancerName: payment.freelancerName,
  projectId: payment.projectId || "",
  projectTitle: payment.projectTitle || "",
  amount: Number(payment.amount) || 0,
  currency: payment.currency || "TND",
  method: payment.method || "card",
  methodLabel: payment.methodLabel || "",
  status: (payment.status as PaymentTransaction["status"]) || "pending",
  note: payment.note ?? null,
  invoiceTotal: Number(payment.invoiceTotal) || 0,
  balanceBefore: Number(payment.balanceBefore) || 0,
  balanceAfter: payment.balanceAfter == null ? null : Number(payment.balanceAfter),
  receiptNumber: payment.receiptNumber ?? null,
  receiptAvailable: Boolean(payment.receiptAvailable),
  errorCode: payment.errorCode ?? null,
  errorMessage: payment.errorMessage ?? null,
  idempotencyKey: payment.idempotencyKey ?? null,
  provider: payment.provider || "internal",
  providerPaymentRef: payment.providerPaymentRef ?? null,
  providerPayUrl: payment.providerPayUrl ?? null,
  providerStatus: payment.providerStatus ?? null,
  providerLastCheckedAt: payment.providerLastCheckedAt ?? null,
  blockchainTxHash: payment.blockchainTxHash ?? null,
  walletAddress: payment.walletAddress ?? null,
  blockchainChainId: payment.blockchainChainId ?? null,
  blockchainReceiver: payment.blockchainReceiver ?? null,
  blockchainAmountWei: payment.blockchainAmountWei ?? null,
  blockchainAmountEth: payment.blockchainAmountEth == null ? null : Number(payment.blockchainAmountEth),
  blockchainTndPerEth: payment.blockchainTndPerEth == null ? null : Number(payment.blockchainTndPerEth),
  blockchainExplorerUrl: payment.blockchainExplorerUrl ?? null,
  blockchainConfirmations: payment.blockchainConfirmations ?? null,
  blockchainGenesisHash: payment.blockchainGenesisHash ?? null,
  blockchainGenesisTimestamp: payment.blockchainGenesisTimestamp ?? null,
  blockchainCrossGenesis: Boolean(payment.blockchainCrossGenesis),
  blockchainReplayOfPaymentId: payment.blockchainReplayOfPaymentId ?? null,
  gatewayRedirect: Boolean(payment.gatewayRedirect),
  legacy: Boolean(payment.legacy),
  attempts: (payment.attempts || []).map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    status: (attempt.status as PaymentTransaction["status"]) || "pending",
    errorCode: attempt.errorCode ?? null,
    errorMessage: attempt.errorMessage ?? null,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt ?? null,
  })),
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
  completedAt: payment.completedAt ?? null,
});

const quotePayload = (patch: Partial<Quote>) => {
  const payload: Record<string, unknown> = {};
  if (patch.clientId !== undefined) payload.clientId = patch.clientId;
  if (patch.client !== undefined) payload.client = patch.client;
  if (patch.projectId !== undefined || patch.project !== undefined) {
    payload.projectId = patch.projectId || patch.project;
    payload.project = patch.project;
  }
  if (patch.issueDate !== undefined) payload.issueDate = patch.issueDate;
  if (patch.validUntil !== undefined) payload.validUntil = patch.validUntil;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.lines !== undefined) {
    payload.lines = patch.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      discount: line.discount,
    }));
  }
  return payload;
};

const invoicePayload = (patch: Partial<Invoice>) => {
  const payload: Record<string, unknown> = {};
  if (patch.clientId !== undefined) payload.clientId = patch.clientId;
  if (patch.client !== undefined) payload.client = patch.client;
  if (patch.projectId !== undefined || patch.project !== undefined) {
    payload.projectId = patch.projectId || patch.project;
    payload.project = patch.project;
  }
  if (patch.issueDate !== undefined) payload.issueDate = patch.issueDate;
  if (patch.dueDate !== undefined) payload.dueDate = patch.dueDate;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.lines !== undefined) {
    payload.lines = patch.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      discount: line.discount,
    }));
  }
  return payload;
};

type DocumentState = {
  key: string;
  quotes: Quote[];
  invoices: Invoice[];
  loading: boolean;
  error: string;
};

const emptyDocumentState: DocumentState = { key: "", quotes: [], invoices: [], loading: false, error: "" };

type PaymentState = {
  key: string;
  payments: PaymentTransaction[];
  loading: boolean;
  error: string;
};

const emptyPaymentState: PaymentState = { key: "", payments: [], loading: false, error: "" };

type ProjectState = {
  key: string;
  projects: Project[];
  loading: boolean;
  error: string;
};

type AssigneeState = {
  key: string;
  assignees: FreelancerSummary[];
  loading: boolean;
  error: string;
};

type ProposalState = {
  key: string;
  proposals: Proposal[];
  loading: boolean;
  error: string;
};

const emptyProjectState: ProjectState = { key: "", projects: [], loading: false, error: "" };
const emptyAssigneeState: AssigneeState = { key: "", assignees: [], loading: false, error: "" };
const emptyProposalState: ProposalState = { key: "", proposals: [], loading: false, error: "" };


type PortfolioState = {
  key: string;
  items: PortfolioItem[];
  loading: boolean;
  error: string;
};

const emptyPortfolioState: PortfolioState = { key: "", items: [], loading: false, error: "" };

export function MarketplaceProvider({ children }: { children: React.ReactNode }) {
  const { status, authUser, role } = useUser();
  // Les projets du compte connecté proviennent exclusivement de l'API (MongoDB)
  // et sont filtrés côté backend par propriétaire. Sans session authentifiée, la
  // liste est vide. L'état est indexé par session afin qu'aucune donnée d'un
  // compte précédent ne puisse être affichée à un autre compte.
    const sessionKey = status === "authenticated" ? `auth:${authUser?.email ?? "session"}` : "anonymous";


  const [projectState, setProjectState] = useState<ProjectState>(emptyProjectState);
  const [catalogState, setCatalogState] = useState<ProjectState>(emptyProjectState);
  const [assignedState, setAssignedState] = useState<ProjectState>(emptyProjectState);
  const [assigneeState, setAssigneeState] = useState<AssigneeState>(emptyAssigneeState);
  const [myProposalState, setMyProposalState] = useState<ProposalState>(emptyProposalState);
  const [receivedProposalState, setReceivedProposalState] = useState<ProposalState>(emptyProposalState);
  // Filtres du catalogue projet (recherche + catégorie) transmis à l'API.
  const [catalogSearch, setCatalogSearchState] = useState<ProjectCatalogParams>({});
  const [taskState, setTaskState] = useState<{ key: string; tasks: Task[] }>({ key: "", tasks: [] });
  const [documentState, setDocumentState] = useState<DocumentState>(emptyDocumentState);
  const [paymentState, setPaymentState] = useState<PaymentState>(emptyPaymentState);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [portfolioState, setPortfolioState] = useState<PortfolioState>(emptyPortfolioState);
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const loadDocs = async () => {
      try {
        // Trois appels indépendants lancés ensemble : la facturation s'ouvre
        // sans attendre les transactions, et inversement.
        const paymentsPromise = paymentsApi.list().catch(() => null);
        const [quotesRes, invoicesRes] = await Promise.all([
          role === "client" ? quotesApi.listForClient() : quotesApi.list(),
          invoicesApi.list(),
        ]);
        if (cancelled) return;
        setDocumentState({
          key: sessionKey,
          quotes: quotesRes.map(mapQuoteApi),
          invoices: invoicesRes.map(mapInvoiceApi),
          loading: false,
          error: "",
        });

        // Les transactions sont chargées en parallèle du reste, mais leur
        // échec éventuel ne doit jamais masquer les devis/factures.
        const paymentsRes = await paymentsPromise;
        if (cancelled) return;
        setPaymentState({
          key: sessionKey,
          payments: paymentsRes ? paymentsRes.map(mapPaymentApi) : [],
          loading: false,
          error: "",
        });
      } catch (error) {
        if (cancelled) return;
        setDocumentState({
          key: sessionKey,
          quotes: [],
          invoices: [],
          loading: false,
          error: error instanceof Error ? error.message : "Impossible de charger les devis et factures.",
        });
        setPaymentState({ key: sessionKey, payments: [], loading: false, error: "" });
      }
    };
    loadDocs();
    return () => { cancelled = true; };
  }, [status, sessionKey, role]);

  const quotes = useMemo(
    () => (documentState.key === sessionKey ? documentState.quotes : []),
    [documentState.key, documentState.quotes, sessionKey],
  );
  const invoices = useMemo(
    () => (documentState.key === sessionKey ? documentState.invoices : []),
    [documentState.key, documentState.invoices, sessionKey],
  );
  const documentsLoading = status === "authenticated" && (documentState.key !== sessionKey || documentState.loading);
  const documentsError = documentState.key === sessionKey ? documentState.error : "";

  const payments = useMemo(
    () => (paymentState.key === sessionKey ? paymentState.payments : []),
    [paymentState.key, paymentState.payments, sessionKey],
  );
  const paymentsLoading = status === "authenticated" && (paymentState.key !== sessionKey || paymentState.loading);
  const paymentsError = paymentState.key === sessionKey ? paymentState.error : "";

  const projects = useMemo(
    () => (projectState.key === sessionKey ? projectState.projects : []),
    [projectState.key, projectState.projects, sessionKey],
  );
  const projectsLoading = status === "authenticated" && (projectState.key !== sessionKey || projectState.loading);
  const projectsError = projectState.key === sessionKey ? projectState.error : "";

  // Le catalogue public ne contient que les projets publiés : il est chargé
  // pour tout le monde (lectures anonymes autorisées par l'API).
  const catalogProjects = useMemo(
    () => (catalogState.key === "catalogue" ? catalogState.projects : []),
    [catalogState.key, catalogState.projects],
  );
  const catalogLoading = catalogState.key !== "catalogue" || catalogState.loading;
  const catalogError = catalogState.key === "catalogue" ? catalogState.error : "";

  // Les projets qu'un client a approuvés pour ce freelance.
  const assignedProjects = useMemo(
    () => (status === "authenticated" && assignedState.key === sessionKey ? assignedState.projects : []),
    [assignedState.key, assignedState.projects, sessionKey, status],
  );
  const assignedLoading = status === "authenticated" && role === "freelancer" && (assignedState.key !== sessionKey || assignedState.loading);
  const assignedError = assignedState.key === sessionKey ? assignedState.error : "";

  // Les freelances qu'un client peut approuver sur un projet.
  const assignees = useMemo(
    () => (role === "client" && assigneeState.key === sessionKey ? assigneeState.assignees : []),
    [assigneeState.assignees, assigneeState.key, role, sessionKey],
  );
  const assigneesLoading = role === "client" && (assigneeState.key !== sessionKey || assigneeState.loading);
  const assigneesError = assigneeState.key === sessionKey ? assigneeState.error : "";

  // Candidatures du freelance connecté.
  const myProposals = useMemo(
    () => (role === "freelancer" && status === "authenticated" && myProposalState.key === sessionKey ? myProposalState.proposals : []),
    [myProposalState.key, myProposalState.proposals, role, sessionKey, status],
  );
  const myProposalsLoading = status === "authenticated" && role === "freelancer" && (myProposalState.key !== sessionKey || myProposalState.loading);
  const myProposalsError = myProposalState.key === sessionKey ? myProposalState.error : "";

  // Candidatures reçues par le client connecté.
  const receivedProposals = useMemo(
    () => (role === "client" && status === "authenticated" && receivedProposalState.key === sessionKey ? receivedProposalState.proposals : []),
    [receivedProposalState.key, receivedProposalState.proposals, role, sessionKey, status],
  );
  const receivedProposalsLoading = status === "authenticated" && role === "client" && (receivedProposalState.key !== sessionKey || receivedProposalState.loading);
  const receivedProposalsError = receivedProposalState.key === sessionKey ? receivedProposalState.error : "";

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    projectsApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        setProjectState({ key: sessionKey, projects: rows, loading: false, error: "" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProjectState({
          key: sessionKey,
          projects: [],
          loading: false,
          error: err instanceof ApiError ? err.message : "Impossible de charger vos projets.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [status, sessionKey]);

  // Catalogue public des projets publiés. Les filtres de recherche et de
  // catégorie sont transmis aux paramètres déjà supportés par l'API
  // (/api/projects/catalog?q=&category=) : la requête est différée de 300 ms
  // pour ne pas appeler le serveur à chaque frappe.
  useEffect(() => {
    let cancelled = false;
    const query = catalogSearch.q?.trim() ?? "";
    const category = catalogSearch.category?.trim() ?? "";
    const type = catalogSearch.type?.trim() ?? "";
    const minBudget = catalogSearch.minBudget;
    const maxBudget = catalogSearch.maxBudget;
    const durationValue = catalogSearch.durationValue;
    const durationUnit = catalogSearch.durationUnit?.trim() ?? "";

    const timer = window.setTimeout(() => {
      setCatalogState((current) => ({ ...current, key: "catalogue", loading: true }));
      projectsApi
        .catalog({ limit: 200, q: query || undefined, category: category || undefined, type: type || undefined, minBudget, maxBudget, durationValue, durationUnit: durationUnit || undefined })
        .then((rows) => {
          if (cancelled) return;
          setCatalogState({ key: "catalogue", projects: rows, loading: false, error: "" });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setCatalogState({
            key: "catalogue",
            projects: [],
            loading: false,
            error: err instanceof ApiError ? err.message : "Impossible de charger le catalogue des projets.",
          });
        });
    }, query || category ? 300 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogSearch.category, catalogSearch.q, catalogSearch.type, catalogSearch.minBudget, catalogSearch.maxBudget, catalogSearch.durationValue, catalogSearch.durationUnit]);

  useEffect(() => {
    if (status !== "authenticated" || role !== "freelancer") return;
    let cancelled = false;
    projectsApi
      .assigned()
      .then((rows) => {
        if (cancelled) return;
        setAssignedState({ key: sessionKey, projects: rows, loading: false, error: "" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAssignedState({
          key: sessionKey,
          projects: [],
          loading: false,
          error: err instanceof ApiError ? err.message : "Impossible de charger les projets qui vous sont confiés.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [role, status, sessionKey]);

  // Candidatures du freelance connecté.
  useEffect(() => {
    if (status !== "authenticated" || role !== "freelancer") return;
    let cancelled = false;
    proposalsApi
      .mine()
      .then((rows) => {
        if (cancelled) return;
        setMyProposalState({ key: sessionKey, proposals: rows, loading: false, error: "" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMyProposalState({
          key: sessionKey,
          proposals: [],
          loading: false,
          error: err instanceof ApiError ? err.message : "Impossible de charger vos candidatures.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [role, sessionKey, status]);

  // Candidatures reçues par le client connecté.
  useEffect(() => {
    if (status !== "authenticated" || role !== "client") return;
    let cancelled = false;
    proposalsApi
      .received()
      .then((rows) => {
        if (cancelled) return;
        setReceivedProposalState({ key: sessionKey, proposals: rows, loading: false, error: "" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReceivedProposalState({
          key: sessionKey,
          proposals: [],
          loading: false,
          error: err instanceof ApiError ? err.message : "Impossible de charger les candidatures reçues.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [role, sessionKey, status]);

  useEffect(() => {
    if (status !== "authenticated" || role !== "client") return;
    let cancelled = false;
    projectsApi
      .assignees()
      .then((rows) => {
        if (cancelled) return;
        setAssigneeState({ key: sessionKey, assignees: rows, loading: false, error: "" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAssigneeState({
          key: sessionKey,
          assignees: [],
          loading: false,
          error: err instanceof ApiError ? err.message : "Impossible de charger la liste des freelances.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [role, sessionKey, status]);

  const applyProjects = useCallback(
    (updater: (current: Project[]) => Project[]) => {
      setProjectState((current) => ({
        ...current,
        key: sessionKey,
        projects: updater(current.key === sessionKey ? current.projects : []),
      }));
    },
    [sessionKey],
  );

  // Load tasks for the authenticated user on mount and when the auth status changes.
  // The list is indexed by session so tasks from a previous account are never shown.
  const tasks = useMemo(
    () => (status === "authenticated" && taskState.key === sessionKey ? taskState.tasks : []),
    [sessionKey, status, taskState],
  );

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    tasksApi
      .list()
      .then((rows) => {
        if (!cancelled) setTaskState({ key: sessionKey, tasks: rows });
      })
      .catch(() => {
        if (!cancelled) setTaskState({ key: sessionKey, tasks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionKey, status]);

  const refreshProjects = useCallback(async () => {
    if (status !== "authenticated") return;
    setProjectState((current) => ({ ...current, key: sessionKey, loading: true }));
    try {
      const rows = await projectsApi.list();
      setProjectState({ key: sessionKey, projects: rows, loading: false, error: "" });
    } catch (err: unknown) {
      setProjectState({
        key: sessionKey,
        projects: [],
        loading: false,
        error: err instanceof ApiError ? err.message : "Impossible de charger vos projets.",
      });
    }
  }, [sessionKey, status]);

  const refreshCatalog = useCallback(async () => {
    setCatalogState((current) => ({ ...current, key: "catalogue", loading: true }));
    try {
      const query = catalogSearch.q?.trim() ?? "";
      const category = catalogSearch.category?.trim() ?? "";
      const type = catalogSearch.type?.trim() ?? "";
      const minBudget = catalogSearch.minBudget;
      const maxBudget = catalogSearch.maxBudget;
      const durationValue = catalogSearch.durationValue;
      const durationUnit = catalogSearch.durationUnit?.trim() ?? "";
      const rows = await projectsApi.catalog({
        limit: 200,
        q: query || undefined,
        category: category || undefined,
        type: type || undefined,
        minBudget,
        maxBudget,
        durationValue,
        durationUnit: durationUnit || undefined,
      });
      setCatalogState({ key: "catalogue", projects: rows, loading: false, error: "" });
    } catch (err: unknown) {
      setCatalogState({
        key: "catalogue",
        projects: [],
        loading: false,
        error: err instanceof ApiError ? err.message : "Impossible de charger le catalogue des projets.",
      });
    }
  }, [catalogSearch.category, catalogSearch.q, catalogSearch.type, catalogSearch.minBudget, catalogSearch.maxBudget, catalogSearch.durationValue, catalogSearch.durationUnit]);

  // Mise à jour paresseuse des filtres du catalogue : seuls les champs non vides
  // sont conservés. Une valeur effacée supprime le paramètre, ce qui garantit
  // que l'état « aucun filtre » reste identique et ne redéclenche pas la requête.
  const setCatalogSearch = useCallback((patch: Partial<ProjectCatalogParams>) => {
    setCatalogSearchState((current) => {
      const next: ProjectCatalogParams = { ...current };
      (Object.keys(patch) as (keyof ProjectCatalogParams)[]).forEach((key) => {
        const raw = patch[key];
        // La recherche est conservée telle que saisie (les espaces internes et
        // finaux sont nécessaires pendant la frappe) ; le trim est appliqué au
        // moment de construire la requête API.
        const value = typeof raw === "number" ? raw : raw ?? "";
        if (value !== "" && value !== undefined) next[key] = value as never;
        else delete next[key];
      });
      return next;
    });
  }, []);

  const refreshAssigned = useCallback(async () => {
    if (status !== "authenticated" || role !== "freelancer") return;
    setAssignedState((current) => ({ ...current, key: sessionKey, loading: true }));
    try {
      const rows = await projectsApi.assigned();
      setAssignedState({ key: sessionKey, projects: rows, loading: false, error: "" });
    } catch (err: unknown) {
      setAssignedState({
        key: sessionKey,
        projects: [],
        loading: false,
        error: err instanceof ApiError ? err.message : "Impossible de charger les projets qui vous sont confiés.",
      });
    }
  }, [role, sessionKey, status]);

  const refreshAssignees = useCallback(async () => {
    if (status !== "authenticated" || role !== "client") return;
    setAssigneeState((current) => ({ ...current, key: sessionKey, loading: true }));
    try {
      const rows = await projectsApi.assignees();
      setAssigneeState({ key: sessionKey, assignees: rows, loading: false, error: "" });
    } catch (err: unknown) {
      setAssigneeState({
        key: sessionKey,
        assignees: [],
        loading: false,
        error: err instanceof ApiError ? err.message : "Impossible de charger la liste des freelances.",
      });
    }
  }, [role, sessionKey, status]);

  const refreshMyProposals = useCallback(async () => {
    if (status !== "authenticated" || role !== "freelancer") return;
    setMyProposalState((current) => ({ ...current, key: sessionKey, loading: true }));
    try {
      const rows = await proposalsApi.mine();
      setMyProposalState({ key: sessionKey, proposals: rows, loading: false, error: "" });
    } catch (err: unknown) {
      setMyProposalState({
        key: sessionKey,
        proposals: [],
        loading: false,
        error: err instanceof ApiError ? err.message : "Impossible de charger vos candidatures.",
      });
    }
  }, [role, sessionKey, status]);

  const refreshReceivedProposals = useCallback(async () => {
    if (status !== "authenticated" || role !== "client") return;
    setReceivedProposalState((current) => ({ ...current, key: sessionKey, loading: true }));
    try {
      const rows = await proposalsApi.received();
      setReceivedProposalState({ key: sessionKey, proposals: rows, loading: false, error: "" });
    } catch (err: unknown) {
      setReceivedProposalState({
        key: sessionKey,
        proposals: [],
        loading: false,
        error: err instanceof ApiError ? err.message : "Impossible de charger les candidatures reçues.",
      });
    }
  }, [role, sessionKey, status]);

  // Dépôt d'une candidature. L'identité du freelance et du propriétaire du
  // projet sont déduites par le backend : seul l'identifiant du projet est
  // transmis. Le compteur de propositions et le catalogue sont actualisés.
  const submitProposal = useCallback(
    async (input: CreateProposalInput) => {
      const created = await proposalsApi.create(input);
      setMyProposalState((current) => ({
        ...current,
        key: sessionKey,
        proposals: [created, ...(current.key === sessionKey ? current.proposals : [])],
      }));
      await refreshCatalog();
      await refreshProjects();
      return created;
    },
    [refreshCatalog, refreshProjects, sessionKey],
  );

  // Retrait d'une propre candidature par le freelance.
  const withdrawProposal = useCallback(
    async (id: string) => {
      await proposalsApi.remove(id);
      setMyProposalState((current) => ({
        ...current,
        key: sessionKey,
        proposals: (current.key === sessionKey ? current.proposals : []).filter((item) => item.id !== id),
      }));
      await refreshCatalog();
      await refreshProjects();
    },
    [refreshCatalog, refreshProjects, sessionKey],
  );

  // Décision du client. L'acceptation affecte le freelance au projet : le
  // tableau de bord du freelance, le catalogue et le projet du client sont
  // rafraîchis pour que les trois vues convergent immédiatement.
  const reviewProposal = useCallback(
    async (id: string, status: "Accepted" | "Refused") => {
      const updated = await proposalsApi.setStatus(id, status);
      setReceivedProposalState((current) => ({
        ...current,
        key: sessionKey,
        proposals: (current.key === sessionKey ? current.proposals : []).map((item) => (item.id === id ? updated : item)),
      }));
      await refreshProjects();
      await refreshCatalog();
      await refreshMyProposals();
      await refreshReceivedProposals();
      return updated;
    },
    [refreshCatalog, refreshMyProposals, refreshProjects, refreshReceivedProposals, sessionKey],
  );

  const refreshPortfolio = useCallback(async () => {
    if (status !== "authenticated" || role !== "freelancer") return;
    setPortfolioState((current) => ({ ...current, key: sessionKey, loading: true }));
    try {
      const items = await portfolioApi.mine();
      setPortfolioState({ key: sessionKey, items, loading: false, error: "" });
    } catch (err: unknown) {
      setPortfolioState({
        key: sessionKey,
        items: [],
        loading: false,
        error: err instanceof ApiError ? err.message : "Impossible de charger votre portfolio.",
      });
    }
  }, [role, sessionKey, status]);

  const addPortfolioItem = useCallback(
    async (item: CreatePortfolioItemInput) => {
      const created = await portfolioApi.create(item);
      setPortfolioState((current) => ({
        ...current,
        key: sessionKey,
        items: [created, ...(current.key === sessionKey ? current.items : [])],
      }));
      return created;
    },
    [sessionKey],
  );

  const updatePortfolioItem = useCallback(
    async (id: string, patch: UpdatePortfolioItemInput) => {
      const updated = await portfolioApi.update(id, patch);
      setPortfolioState((current) => ({
        ...current,
        key: sessionKey,
        items: (current.key === sessionKey ? current.items : []).map((item) =>
          item.id === id ? updated : item,
        ),
      }));
      return updated;
    },
    [sessionKey],
  );

  const deletePortfolioItem = useCallback(
    async (id: string) => {
      await portfolioApi.remove(id);
      setPortfolioState((current) => ({
        ...current,
        key: sessionKey,
        items: (current.key === sessionKey ? current.items : []).filter((item) => item.id !== id),
      }));
    },
    [sessionKey],
  );

  const addProject = useCallback(
    async (project: Omit<Project, "id" | "ownerId" | "time" | "proposals" | "createdAt" | "updatedAt" | "assignedTo" | "assignedToName" | "assignedAt" | "assignmentHistory">) => {
      const created = await projectsApi.create({
        title: project.title,
        description: project.description,
        budget: project.budget,
        type: project.type,
        skills: project.skills,
        client: project.client,
        status: project.status,
        category: project.category ?? "",
        deadline: project.deadline ?? "",
        budgetMin: project.budgetMin ?? null,
        budgetMax: project.budgetMax ?? null,
        durationValue: project.durationValue ?? null,
        durationUnit: project.durationUnit ?? null,
      });
      applyProjects((current) => [created, ...current]);
      // Un projet publié entre immédiatement dans le catalogue public.
      await refreshCatalog();
      return created;
    },
    [applyProjects, refreshCatalog],
  );

  // Mise à jour partielle : seuls les champs réellement modifiés sont envoyés.
  // Le backend applique le contrôle de propriété (404 si le projet n'appartient
  // pas au compte connecté).
  const updateProject = useCallback(
    async (id: string, patch: Partial<Project>) => {
      const input: UpdateProjectInput = {};
      if (patch.title !== undefined) input.title = patch.title;
      if (patch.description !== undefined) input.description = patch.description;
      if (patch.budget !== undefined) input.budget = patch.budget;
      if (patch.type !== undefined) input.type = patch.type;
      if (patch.skills !== undefined) input.skills = patch.skills;
      if (patch.client !== undefined) input.client = patch.client;
      if (patch.status !== undefined) input.status = patch.status;
      if (patch.category !== undefined) input.category = patch.category;
      if (patch.deadline !== undefined) input.deadline = patch.deadline;
      if (patch.budgetMin !== undefined) input.budgetMin = patch.budgetMin;
      if (patch.budgetMax !== undefined) input.budgetMax = patch.budgetMax;
      if (patch.durationValue !== undefined) input.durationValue = patch.durationValue;
      if (patch.durationUnit !== undefined) input.durationUnit = patch.durationUnit;
      if (patch.assignedTo !== undefined) input.assignedTo = patch.assignedTo ?? "";
      if (patch.attachments !== undefined) input.attachments = patch.attachments;
      if ((patch as { message?: string }).message !== undefined) input.message = (patch as { message?: string }).message;

      const updated = await projectsApi.update(id, input);
      applyProjects((current) => current.map((project) => (project.id === id ? updated : project)));
      // Le catalogue public ne contient que les projets publiés : un projet
      // retiré ou republié change immédiatement de visibilité.
      await refreshCatalog();
      // Une transition de statut peut annuler une acceptation : la
      // candidature concernée change alors de statut côté API.
      await refreshReceivedProposals();
      await refreshMyProposals();
      return updated;
    },
    [applyProjects, refreshCatalog, refreshMyProposals, refreshReceivedProposals],
  );

  const reopenProject = useCallback(
    async (id: string, message?: string) => {
      const updated = await projectsApi.reopen(id, message);
      applyProjects((current) => current.map((project) => (project.id === id ? updated : project)));
      await refreshCatalog();
      await refreshAssigned();
      return updated;
    },
    [applyProjects, refreshCatalog, refreshAssigned],
  );

  const milestoneAction = useCallback(
    async (projectId: string, milestoneId: string, input: { action: string; message?: string; progress?: number }) => {
      const updated = await projectsApi.milestoneAction(projectId, milestoneId, input);
      applyProjects((current) => current.map((project) => (project.id === projectId ? updated : project)));
      await refreshCatalog();
      await refreshAssigned();
      return updated;
    },
    [applyProjects, refreshCatalog, refreshAssigned],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await projectsApi.remove(id);
      applyProjects((current) => current.filter((project) => project.id !== id));
      setTaskState((current) => ({
        ...current,
        key: sessionKey,
        tasks: (current.key === sessionKey ? current.tasks : []).filter((task) => task.projectId !== id),
      }));
      await refreshCatalog();
    },
    [applyProjects, refreshCatalog, sessionKey],
  );

  // Approbation d'un freelance par le client : le projet apparaît alors dans
  // le tableau de bord et l'onglet Projets du freelance retenu.
  // `nextStatus` permet de démarrer réellement le contrat (passage à
  // « In progress ») sans créer de workflow parallèle : c'est la même
  // transition de statut que celle utilisée pour l'acceptation d'une
  // proposition. Le catalogue est rafraîchi car un projet attribué sort des
  // opportunités ouvertes.
  const assignProject = useCallback(
    async (id: string, freelancerId: string, nextStatus?: ProjectStatus) => {
      const input: UpdateProjectInput = { assignedTo: freelancerId };
      if (nextStatus) input.status = nextStatus;
      const updated = await projectsApi.update(id, input);
      applyProjects((current) => current.map((project) => (project.id === id ? updated : project)));
      await refreshCatalog();
      await refreshAssigned();
      return updated;
    },
    [applyProjects, refreshAssigned, refreshCatalog],
  );
  const submitProjectForReview = useCallback(
    async (id: string, message?: string) => {
      const updated = await projectsApi.submitForReview(id, message);
      applyProjects((current) => current.map((project) => (project.id === id ? updated : project)));
      await refreshAssigned();
      return updated;
    },
    [applyProjects, refreshAssigned],
  );

  // Create task via API and update state with the server‑generated task (including proper ID and dates)
  const addTask = useCallback(async (task: Omit<Task, "id">) => {
    const created = await tasksApi.create(task);
    setTaskState((current) => ({
      key: sessionKey,
      tasks: [created, ...(current.key === sessionKey ? current.tasks : [])],
    }));
    return created;
  }, [sessionKey]);

  // Update task via API and sync state with the updated task returned from the backend
  const updateTask = useCallback(async (id: string, patch: Partial<Task>) => {
    const updated = await tasksApi.update(id, patch);
    setTaskState((current) => ({
      ...current,
      key: sessionKey,
      tasks: (current.key === sessionKey ? current.tasks : []).map((task) => (task.id === id ? updated : task)),
    }));
  }, [sessionKey]);

  // Delete task via API and remove it from state only after successful request
  const deleteTask = useCallback(async (id: string) => {
    await tasksApi.remove(id);
    setTaskState((current) => ({
      ...current,
      key: sessionKey,
      tasks: (current.key === sessionKey ? current.tasks : []).filter((task) => task.id !== id),
    }));
  }, [sessionKey]);

  const addQuote = useCallback(async (quote: Omit<Quote, "id" | "number">) => {
    const projectId = quote.projectId || quote.project;
    const projectTitle = [...projects, ...assignedProjects].find((p) => p.id === projectId)?.title || projectId;
    const created = mapQuoteApi(await quotesApi.create({
      clientId: quote.clientId,
      client: quote.client,
      projectId,
      project: projectTitle,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      status: quote.status,
      notes: quote.notes,
      lines: quote.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        discount: line.discount,
      })),
    }));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      quotes: [created, ...current.quotes.filter((item) => item.id !== created.id)],
    }));
    return created;
  }, [sessionKey, projects, assignedProjects]);

  const updateQuote = useCallback(async (id: string, patch: Partial<Quote>) => {
    const updated = mapQuoteApi(await quotesApi.update(id, quotePayload(patch)));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      quotes: current.quotes.map((item) => (item.id === id ? updated : item)),
    }));
    return updated;
  }, [sessionKey]);

  const deleteQuote = useCallback(async (id: string) => {
    await quotesApi.remove(id);
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      quotes: current.quotes.filter((item) => item.id !== id),
    }));
  }, [sessionKey]);

  const setQuoteStatus = useCallback(async (id: string, status: QuoteStatus, note?: string, abandon?: boolean) => {
    const updated = mapQuoteApi(await quotesApi.updateStatus(id, status, note, abandon));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      quotes: current.quotes.map((item) => (item.id === id ? updated : item)),
    }));
    return updated;
  }, [sessionKey]);

  const addInvoice = useCallback(async (invoice: Omit<Invoice, "id" | "number">) => {
    const projectId = invoice.projectId || invoice.project;
    const projectTitle = [...projects, ...assignedProjects].find((p) => p.id === projectId)?.title || projectId;
    const created = mapInvoiceApi(await invoicesApi.create({
      clientId: invoice.clientId,
      client: invoice.client,
      projectId,
      project: projectTitle,
      quoteId: invoice.quoteId,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      lines: invoice.lines.map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate,
        discount: line.discount,
      })),
      notes: invoice.notes,
    }));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      invoices: [created, ...current.invoices.filter((item) => item.id !== created.id)],
    }));
    return created;
  }, [sessionKey, projects, assignedProjects]);

  const updateInvoice = useCallback(async (id: string, patch: Partial<Invoice>) => {
    const updated = mapInvoiceApi(await invoicesApi.update(id, invoicePayload(patch)));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      invoices: current.invoices.map((item) => (item.id === id ? updated : item)),
    }));
    return updated;
  }, [sessionKey]);

  const deleteInvoice = useCallback(async (id: string) => {
    await invoicesApi.remove(id);
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      invoices: current.invoices.filter((item) => item.id !== id),
    }));
  }, [sessionKey]);

  const setInvoiceStatus = useCallback(async (id: string, status: InvoiceStatus) => {
    const updated = mapInvoiceApi(await invoicesApi.updateStatus(id, status));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      invoices: current.invoices.map((item) => (item.id === id ? updated : item)),
    }));
    return updated;
  }, [sessionKey]);

  const applyPaymentResult = useCallback((result: PaymentResultApi) => {
    const transaction = mapPaymentApi(result.transaction);
    const invoice = mapInvoiceApi(result.invoice);
    setPaymentState((current) => ({
      key: sessionKey,
      payments: [transaction, ...current.payments.filter((item) => item.id !== transaction.id)],
      loading: false,
      error: "",
    }));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      invoices: current.invoices.map((item) => (item.id === invoice.id ? invoice : item)),
    }));
    return { transaction, invoice };
  }, [sessionKey]);

  const refreshPayments = useCallback(async () => {
    setPaymentState((current) => ({ ...current, key: sessionKey, loading: true, error: "" }));
    try {
      const result = await paymentsApi.list();
      setPaymentState({ key: sessionKey, payments: result.map(mapPaymentApi), loading: false, error: "" });
    } catch (error) {
      setPaymentState((current) => ({
        ...current,
        key: sessionKey,
        loading: false,
        error: error instanceof Error ? error.message : "Impossible de charger les transactions.",
      }));
      throw error;
    }
  }, [sessionKey]);

  const payInvoice = useCallback(async (input: { invoiceId: string; amount: number; method?: string; note?: string; idempotencyKey?: string; simulateOutcome?: "success" | "failed"; provider?: "internal" | "konnect" | "blockchain" }) => {
    const result = await paymentsApi.create(input);
    return applyPaymentResult(result);
  }, [applyPaymentResult]);

  const verifyInvoicePayment = useCallback(async (transactionId: string) => {
    const result = await paymentsApi.verify(transactionId);
    return applyPaymentResult(result);
  }, [applyPaymentResult]);

  const verifyBlockchainPayment = useCallback(async (transactionId: string, txHash: string) => {
    const result = await paymentsApi.verifyBlockchain(transactionId, txHash);
    return applyPaymentResult(result);
  }, [applyPaymentResult]);

  const blockchainConfig = useCallback(() => paymentsApi.blockchainConfig(), []);

  const retryInvoicePayment = useCallback(async (transactionId: string) => {
    const result = await paymentsApi.retry(transactionId);
    return applyPaymentResult(result);
  }, [applyPaymentResult]);

  const cancelInvoicePayment = useCallback(async (transactionId: string, reason?: string) => {
    const result = await paymentsApi.cancel(transactionId, reason);
    return applyPaymentResult(result);
  }, [applyPaymentResult]);

  const downloadPaymentReceipt = useCallback(async (transactionId: string, reference?: string | null) => {
    await paymentsApi.downloadReceipt(transactionId, reference);
  }, []);

  const recordPayment = useCallback(async (
    id: string,
    input: { amount: number; date?: string; note?: string; reference?: string; method?: string; simulateOutcome?: "success" | "failed"; idempotencyKey?: string },
  ) => {
    // Alias historique : toute la logique passe désormais par le moteur de
    // transactions, qui renvoie la transaction créée et la facture à jour.
    const note = input.reference
      ? `${input.note ? `${input.note.trim()} ` : ""}(réf. client : ${input.reference})`
      : input.note;
    const result = await paymentsApi.create({
      invoiceId: id,
      amount: input.amount,
      method: input.method,
      note,
      idempotencyKey: input.idempotencyKey,
      simulateOutcome: input.simulateOutcome,
    });
    return applyPaymentResult(result).invoice;
  }, [applyPaymentResult]);

  const createInvoiceFromQuote = useCallback(async (quoteId: string, input?: { dueDate?: string; notes?: string }) => {
    const created = mapInvoiceApi(await invoicesApi.createFromQuote(quoteId, input));
    setDocumentState((current) => ({
      ...current,
      key: sessionKey,
      invoices: [created, ...current.invoices.filter((item) => item.id !== created.id)],
      quotes: current.quotes.map((item) => (
        item.id === quoteId ? { ...item, status: item.status === "accepted" ? item.status : "accepted", convertedTo: created.id } : item
      )),
    }));
    return created;
  }, [sessionKey]);

  const convertQuoteToInvoice = useCallback(async (quoteId: string) => {
    const created = await createInvoiceFromQuote(quoteId);
    return created;
  }, [createInvoiceFromQuote]);

  const refreshFeedback = useCallback(async () => {
    if (status !== "authenticated") {
      setFeedback([]);
      setFeedbackError("");
      return;
    }
    setFeedbackLoading(true);
    setFeedbackError("");
    try {
      const items = await feedbacksApi.mine();
      setFeedback(items);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "Une erreur est survenue");
      setFeedback([]);
    } finally {
      setFeedbackLoading(false);
    }
  }, [status]);

  const submitFeedback = useCallback(async (projectId: string, input: SubmitFeedbackInput) => {
    const submitted = await feedbacksApi.submit(projectId, input);
    setFeedback((prev) => {
      const others = prev.filter((item) => item.id !== submitted.id);
      return [submitted, ...others];
    });
    return submitted;
  }, []);

  const portfolio = useMemo(
    () =>
      status === "authenticated" && role === "freelancer" && portfolioState.key === sessionKey
        ? portfolioState.items
        : [],
    [portfolioState.items, portfolioState.key, role, sessionKey, status],
  );
  const portfolioLoading =
    status === "authenticated" && role === "freelancer" && (portfolioState.key !== sessionKey || portfolioState.loading);
  const portfolioError = portfolioState.key === sessionKey ? portfolioState.error : "";

  const value = useMemo<MarketplaceContextValue>(
    () => ({
      projects,
      projectsLoading,
      projectsError,
      catalogProjects,
      catalogLoading,
      catalogError,
      assignedProjects,
      assignedLoading,
      assignedError,
      assignees,
      assigneesLoading,
      assigneesError,
      myProposals,
      myProposalsLoading,
      myProposalsError,
      receivedProposals,
      receivedProposalsLoading,
      receivedProposalsError,
      refreshProjects,
      refreshCatalog,
      refreshAssigned,
      refreshAssignees,
      catalogSearch,
      setCatalogSearch,
      refreshMyProposals,
      refreshReceivedProposals,
      submitProposal,
      withdrawProposal,
      reviewProposal,
      tasks,
      quotes,
      invoices,
      documentsLoading,
      documentsError,
      feedback,
      portfolio,
      portfolioLoading,
      portfolioError,
      refreshPortfolio,
      addProject,
      updateProject,
      reopenProject,
      milestoneAction,
      deleteProject,
      assignProject,
      submitProjectForReview,
      addTask,
      updateTask,
      deleteTask,
      addQuote,
      updateQuote,
      deleteQuote,
      setQuoteStatus,
      addInvoice,
      updateInvoice,
      deleteInvoice,
      setInvoiceStatus,
      createInvoiceFromQuote,
      recordPayment,
      payments,
      paymentsLoading,
      paymentsError,
      refreshPayments,
      payInvoice,
      verifyInvoicePayment,
      verifyBlockchainPayment,
      blockchainConfig,
      retryInvoicePayment,
      cancelInvoicePayment,
      downloadPaymentReceipt,
      convertQuoteToInvoice,
      feedbackLoading,
      feedbackError,
      refreshFeedback,
      submitFeedback,
      addPortfolioItem,
      updatePortfolioItem,
      deletePortfolioItem,
    }),
    [
      projects,
      projectsLoading,
      projectsError,
      catalogProjects,
      catalogLoading,
      catalogError,
      assignedProjects,
      assignedLoading,
      assignedError,
      assignees,
      assigneesLoading,
      assigneesError,
      myProposals,
      myProposalsLoading,
      myProposalsError,
      receivedProposals,
      receivedProposalsLoading,
      receivedProposalsError,
      refreshProjects,
      refreshCatalog,
      refreshAssigned,
      refreshAssignees,
      catalogSearch,
      setCatalogSearch,
      refreshMyProposals,
      refreshReceivedProposals,
      submitProposal,
      withdrawProposal,
      reviewProposal,
      tasks,
      quotes,
      invoices,
      documentsLoading,
      documentsError,
      feedback,
      portfolio,
      portfolioLoading,
      portfolioError,
      refreshPortfolio,
      addProject,
      updateProject,
      reopenProject,
      milestoneAction,
      deleteProject,
      assignProject,
      submitProjectForReview,
      addTask,
      updateTask,
      deleteTask,
      addQuote,
      updateQuote,
      deleteQuote,
      setQuoteStatus,
      addInvoice,
      updateInvoice,
      deleteInvoice,
      setInvoiceStatus,
      createInvoiceFromQuote,
      recordPayment,
      payments,
      paymentsLoading,
      paymentsError,
      refreshPayments,
      payInvoice,
      verifyInvoicePayment,
      verifyBlockchainPayment,
      blockchainConfig,
      retryInvoicePayment,
      cancelInvoicePayment,
      downloadPaymentReceipt,
      convertQuoteToInvoice,
      feedbackLoading,
      feedbackError,
      refreshFeedback,
      submitFeedback,
      addPortfolioItem,
      updatePortfolioItem,
      deletePortfolioItem,
    ],
  );

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const context = useContext(MarketplaceContext);
  if (!context) throw new Error("useMarketplace must be used inside MarketplaceProvider");
  return context;
}
