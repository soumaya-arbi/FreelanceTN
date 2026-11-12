import type { Invoice, InvoicePayment, PaymentMethod, PaymentStatus, PaymentTransaction } from "@/lib/types";

export type PaymentMethodOption = {
  value: PaymentMethod;
  label: string;
  short: string;
  icon: "card" | "wallet";
  description: string;
  details: string[];
};

/**
 * Seuls deux moyens sont proposés pour un nouveau paiement : la carte bancaire
 * (passerelle Konnect) et MetaMask (intégration blockchain). Les moyens
 * historiques restent lisibles dans l'historique via `paymentMethodLabels`.
 */
export const paymentMethodOptions: PaymentMethodOption[] = [
  {
    value: "card",
    label: "Carte bancaire",
    short: "Carte",
    icon: "card",
    description: "Payez simplement avec votre carte bancaire.",
    details: ["Paiement sécurisé", "Confirmation vérifiée"],
  },
  {
    value: "metamask",
    label: "MetaMask",
    short: "MetaMask",
    icon: "wallet",
    description: "Payez directement depuis votre portefeuille crypto.",
    details: ["Paiement depuis votre portefeuille", "Confirmation vérifiée"],
  },
];

/**
 * Libellés de lecture, y compris les moyens historiques qui ne sont plus
 * proposés (portefeuille interne). Aucun document ancien n'est perdu.
 */
const paymentMethodLabels: Record<string, string> = {
  card: "Carte bancaire",
  metamask: "MetaMask",
  wallet: "Portefeuille FreelanceTN (historique)",
  bank_transfer: "Virement bancaire",
  other: "Autre moyen",
};

export const normalizePaymentMethod = (method?: string | null): PaymentMethod => {
  switch ((method || "").trim().toLowerCase()) {
    case "metamask":
    case "metamask_sepolia":
    case "sepolia":
      return "metamask";
    case "wallet":
    case "wallet_simulated":
      return "wallet";
    case "bank_transfer":
    case "bank_transfer_simulated":
      return "bank_transfer";
    case "other":
    case "cash":
    case "cash_simulated":
      return "other";
    default:
      return "card";
  }
};

export const paymentMethodLabel = (method?: string | null) =>
  paymentMethodLabels[normalizePaymentMethod(method)] || "—";

/** Libellé du réseau blockchain à partir du chainId figé sur la transaction. */
/**
 * Message de paiement destiné à l'interface.
 *
 * Le backend nomme l'environnement de la passerelle (par exemple « Konnect
 * Sandbox ») pour la traçabilité. Ce détail technique ne doit pas apparaître
 * à l'écran : on ne garde que le nom du moyen de paiement. Le texte d'origine
 * reste intact côté serveur.
 */
export const publicPaymentMessage = (value?: string | null): string =>
  (value || "")
    .replace(/\bKonnect\s+Sandbox\b/gi, "Konnect")
    .replace(/\bSandbox\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

export const blockchainNetworkLabel = (chainId?: number | null): string => {
  if (chainId === 31337) return "Hardhat Local";
  if (chainId === 11155111) return "Sepolia";
  return chainId ? `Réseau ${chainId}` : "Sepolia";
};

export const normalizePaymentStatus = (status?: string | null): PaymentStatus => {
  switch ((status || "").trim().toLowerCase()) {
    case "succeeded":
    case "completed":
    case "success":
    case "paid":
      return "succeeded";
    case "failed":
    case "failure":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "processing":
      return "processing";
    default:
      return "pending";
  }
};

const statusLabels: Record<PaymentStatus, string> = {
  pending: "En attente",
  processing: "En traitement",
  succeeded: "Réussi",
  failed: "Échoué",
  cancelled: "Annulé",
};

export const paymentStatusLabel = (status?: string | null) => statusLabels[normalizePaymentStatus(status)];

export const paymentStatusTone = (status?: string | null): "success" | "warning" | "danger" | "neutral" => {
  switch (normalizePaymentStatus(status)) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
    default:
      return "warning";
  }
};

export const isSuccessfulPayment = (payment?: { status?: string | null } | null) =>
  normalizePaymentStatus(payment?.status) === "succeeded";

export const receiptFileName = (reference?: string | null) =>
  `Recu-${(reference || "FreelanceTN").replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf`;

export type AmountValidation = { ok: boolean; value: number; error: string };

export const validatePaymentAmount = (raw: string | number, balance: number): AmountValidation => {
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(value)) return { ok: false, value: 0, error: "Saisissez un montant valide." };
  if (value <= 0) return { ok: false, value, error: "Le montant doit être supérieur à 0." };
  if (value > balance + 0.0005) {
    return { ok: false, value, error: `Le montant ne peut pas dépasser le solde restant (${formatAmount(balance)}).` };
  }
  const rounded = Math.round(value * 1000) / 1000;
  if (Math.abs(rounded - value) > 0.0000001) {
    return { ok: false, value, error: "Le montant est limité à trois décimales." };
  }
  return { ok: true, value: rounded, error: "" };
};

const formatAmount = (value: number) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value)} TND`;

export const paymentSummary = (transactions: PaymentTransaction[]) => {
  const succeeded = transactions.filter(isSuccessfulPayment);
  return {
    count: transactions.length,
    succeededCount: succeeded.length,
    failedCount: transactions.filter((item) => normalizePaymentStatus(item.status) === "failed").length,
    pendingCount: transactions.filter((item) => ["pending", "processing"].includes(normalizePaymentStatus(item.status))).length,
    totalReceived: succeeded.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
  };
};

export const transactionFromInvoicePayment = (
  payment: InvoicePayment,
  invoice: { id: string; number: string; clientId?: string; client: string; projectId?: string; project: string; amountPaid?: number; balanceDue?: number },
): PaymentTransaction => {
  const status = normalizePaymentStatus(payment.status);
  const createdAt = payment.createdAt || `${payment.date}T00:00:00.000Z`;
  return {
    id: payment.id || payment.transactionId || `${invoice.id}-${payment.reference || payment.date}`,
    reference: payment.reference || payment.transactionId || "—",
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    clientId: invoice.clientId || "",
    clientName: invoice.client,
    freelancerId: "",
    freelancerName: "",
    projectId: invoice.projectId || "",
    projectTitle: invoice.project,
    amount: Number(payment.amount) || 0,
    currency: "TND",
    method: normalizePaymentMethod(payment.method),
    methodLabel: paymentMethodLabel(payment.method),
    status,
    note: payment.note || null,
    invoiceTotal: (invoice.amountPaid || 0) + (invoice.balanceDue || 0),
    balanceBefore: 0,
    balanceAfter: null,
    receiptNumber: payment.receiptNumber || null,
    receiptAvailable: Boolean(payment.receiptAvailable) && status === "succeeded",
    errorCode: null,
    errorMessage: null,
    idempotencyKey: payment.idempotencyKey || null,
    legacy: Boolean(payment.legacy),
    attempts: payment.attempts || [],
    createdAt,
    updatedAt: createdAt,
    completedAt: status === "succeeded" || status === "failed" || status === "cancelled" ? createdAt : null,
  };
};

/**
 * Construit la liste affichable des transactions pour un espace de facturation.
 * Les transactions canoniques (moteur interne) sont prioritaires ; les
 * paiements historiques embarqués dans les factures complètent la liste sans
 * jamais créer de doublon. Une transaction canonique absente de la liste
 * dédiée mais présente dans une facture reste visible.
 */
export const collectPaymentTransactions = (
  invoices: Invoice[],
  transactions: PaymentTransaction[],
): PaymentTransaction[] => {
  const rows = new Map<string, PaymentTransaction>();
  for (const transaction of transactions) {
    rows.set(transaction.id, transaction);
  }
  for (const invoice of invoices) {
    for (const payment of invoice.payments || []) {
      const mapped = transactionFromInvoicePayment(payment, invoice);
      if (!rows.has(mapped.id)) {
        rows.set(mapped.id, mapped);
      }
    }
  }
  return Array.from(rows.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
};

/** La facture associée à une transaction, quand elle est chargée. */
export const invoiceForTransaction = (
  transaction: PaymentTransaction,
  invoices: Invoice[],
): Invoice | undefined => invoices.find((invoice) => invoice.id === transaction.invoiceId);

