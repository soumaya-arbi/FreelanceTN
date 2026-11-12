import { describe, expect, it } from "vitest";
import {
  blockchainNetworkLabel,
  collectPaymentTransactions,
  invoiceForTransaction,
  isSuccessfulPayment,
  normalizePaymentMethod,
  normalizePaymentStatus,
  paymentMethodLabel,
  paymentMethodOptions,
  paymentStatusLabel,
  paymentSummary,
  publicPaymentMessage,
  receiptFileName,
  transactionFromInvoicePayment,
  validatePaymentAmount,
} from "@/lib/payments";
import type { Invoice, PaymentTransaction } from "@/lib/types";

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv-1",
  number: "FAC-2026-001",
  clientId: "client-1",
  client: "Client Test",
  projectId: "proj-1",
  project: "Projet test",
  issueDate: "2026-11-01",
  dueDate: "2026-11-30",
  status: "unpaid",
  lines: [],
  notes: "",
  amountPaid: 0,
  balanceDue: 1000,
  payments: [],
  ...overrides,
});

const makeTransaction = (overrides: Partial<PaymentTransaction> = {}): PaymentTransaction => ({
  id: "tx-1",
  reference: "PAY-20261109-ABCDEF",
  invoiceId: "inv-1",
  invoiceNumber: "FAC-2026-001",
  clientId: "client-1",
  clientName: "Client Test",
  freelancerId: "freelancer-1",
  freelancerName: "Freelance Test",
  projectId: "proj-1",
  projectTitle: "Projet test",
  amount: 250,
  currency: "TND",
  method: "card",
  methodLabel: "Carte bancaire",
  status: "succeeded",
  note: null,
  invoiceTotal: 1000,
  balanceBefore: 500,
  balanceAfter: 250,
  receiptNumber: "REC-2026-000001",
  receiptAvailable: true,
  errorCode: null,
  errorMessage: null,
  idempotencyKey: null,
  legacy: false,
  attempts: [],
  createdAt: "2026-11-09T09:00:00Z",
  updatedAt: "2026-11-09T09:00:00Z",
  completedAt: "2026-11-09T09:00:00Z",
  ...overrides,
});

describe("payment methods and statuses", () => {
  it("normalise les anciennes valeurs simulées vers les valeurs canoniques", () => {
    expect(normalizePaymentMethod("card_simulated")).toBe("card");
    expect(normalizePaymentMethod("metamask")).toBe("metamask");
    expect(normalizePaymentMethod("metamask_sepolia")).toBe("metamask");
    expect(normalizePaymentMethod("sepolia")).toBe("metamask");
    expect(normalizePaymentMethod("wallet_simulated")).toBe("wallet");
    expect(normalizePaymentMethod("bank_transfer_simulated")).toBe("bank_transfer");
    expect(normalizePaymentMethod("cash_simulated")).toBe("other");
    expect(normalizePaymentMethod(undefined)).toBe("card");
  });

  it("affiche un libellé métier pour chaque moyen", () => {
    expect(paymentMethodLabel("card")).toBe("Carte bancaire");
    expect(paymentMethodLabel("metamask")).toBe("MetaMask");
    expect(paymentMethodLabel("wallet_simulated")).toBe("Portefeuille FreelanceTN (historique)");
    expect(paymentMethodLabel("bank_transfer")).toBe("Virement bancaire");
    expect(paymentMethodLabel("other")).toBe("Autre moyen");
  });

  it("ne propose que la carte bancaire et MetaMask pour un nouveau paiement", () => {
    expect(paymentMethodOptions.map((option) => option.value)).toEqual(["card", "metamask"]);
    expect(paymentMethodOptions[0]).toMatchObject({
      label: "Carte bancaire",
      description: "Payez simplement avec votre carte bancaire.",
    });
    expect(paymentMethodOptions[1]).toMatchObject({
      label: "MetaMask",
      description: "Payez directement depuis votre portefeuille crypto.",
    });
  });

  it("normalise les statuts historiques et du moteur", () => {
    expect(normalizePaymentStatus("completed")).toBe("succeeded");
    expect(normalizePaymentStatus("SUCCEEDED")).toBe("succeeded");
    expect(normalizePaymentStatus("failed")).toBe("failed");
    expect(normalizePaymentStatus("canceled")).toBe("cancelled");
    expect(normalizePaymentStatus("processing")).toBe("processing");
    expect(normalizePaymentStatus(null)).toBe("pending");
    expect(paymentStatusLabel("failed")).toBe("Échoué");
  });

  it("nomme le réseau blockchain figé sur la transaction", () => {
    expect(blockchainNetworkLabel(31337)).toBe("Hardhat Local");
    expect(blockchainNetworkLabel(11155111)).toBe("Sepolia");
    expect(blockchainNetworkLabel(1)).toBe("Réseau 1");
    expect(blockchainNetworkLabel(null)).toBe("Sepolia");
  });
});

describe("validatePaymentAmount", () => {
  it("accepte un montant dans la limite du solde", () => {
    const result = validatePaymentAmount("250.500", 1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(250.5);
  });

  it("refuse un montant nul ou négatif", () => {
    expect(validatePaymentAmount("0", 1000).ok).toBe(false);
    expect(validatePaymentAmount("-10", 1000).ok).toBe(false);
  });

  it("refuse un dépassement de solde", () => {
    const result = validatePaymentAmount("1000.001", 1000);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("solde restant");
  });

  it("refuse plus de trois décimales", () => {
    expect(validatePaymentAmount("10.1234", 1000).ok).toBe(false);
  });

  it("accepte le solde exact et une saisie avec virgule", () => {
    expect(validatePaymentAmount(1000, 1000).ok).toBe(true);
    expect(validatePaymentAmount("12,5", 1000).value).toBe(12.5);
  });
});

describe("paymentSummary", () => {
  it("agrège uniquement les transactions réussies dans le total", () => {
    const summary = paymentSummary([
      makeTransaction({ id: "ok", status: "succeeded", amount: 100 }),
      makeTransaction({ id: "ko", status: "failed", amount: 300 }),
      makeTransaction({ id: "wait", status: "pending", amount: 50 }),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.succeededCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.pendingCount).toBe(1);
    expect(summary.totalReceived).toBe(100);
  });

  it("détecte un paiement réussi", () => {
    expect(isSuccessfulPayment({ status: "completed" })).toBe(true);
    expect(isSuccessfulPayment({ status: "failed" })).toBe(false);
  });
});

describe("transactionFromInvoicePayment", () => {
  it("convertit un paiement embarqué en transaction affichable", () => {
    const invoice = makeInvoice();
    const transaction = transactionFromInvoicePayment(
      {
        id: "tx-9",
        amount: 100,
        date: "2026-11-05",
        status: "completed",
        method: "bank_transfer_simulated",
        reference: "PAY-20261105-ZZZZZZ",
        receiptAvailable: true,
      },
      invoice,
    );
    expect(transaction.invoiceId).toBe(invoice.id);
    expect(transaction.status).toBe("succeeded");
    expect(transaction.method).toBe("bank_transfer");
    expect(transaction.methodLabel).toBe("Virement bancaire");
    expect(transaction.receiptAvailable).toBe(true);
    expect(transaction.legacy).toBe(false);
  });

  it("n'expose pas de reçu pour un paiement échoué", () => {
    const transaction = transactionFromInvoicePayment(
      { amount: 10, date: "2026-11-05", status: "failed", receiptAvailable: true },
      makeInvoice(),
    );
    expect(transaction.status).toBe("failed");
    expect(transaction.receiptAvailable).toBe(false);
  });
});

describe("collectPaymentTransactions", () => {
  it("déduplique et trie les transactions par date décroissante", () => {
    const invoice = makeInvoice({
      payments: [
        {
          id: "tx-1",
          amount: 100,
          date: "2026-11-08",
          status: "succeeded",
          reference: "PAY-20261108-AAAAAA",
          receiptAvailable: true,
        },
        {
          id: "legacy-1",
          amount: 200,
          date: "2026-10-01",
          status: "completed",
          reference: "OLD-REF",
          legacy: true,
          receiptAvailable: false,
        },
      ],
    });
    const canonical = [makeTransaction({ id: "tx-1", createdAt: "2026-11-08T12:00:00Z" })];

    const rows = collectPaymentTransactions([invoice], canonical);

    expect(rows.map((row) => row.id)).toEqual(["tx-1", "legacy-1"]);
    expect(rows[0].receiptNumber).toBe("REC-2026-000001");
    expect(rows[1].legacy).toBe(true);
    expect(rows[1].receiptAvailable).toBe(false);
  });

  it("ajoute les transactions dont la facture n'est pas chargée", () => {
    const orphan = makeTransaction({ id: "tx-orphan", invoiceId: "missing" });
    const rows = collectPaymentTransactions([], [orphan]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("tx-orphan");
  });

  it("retrouve la facture d'une transaction", () => {
    const invoice = makeInvoice();
    expect(invoiceForTransaction(makeTransaction(), [invoice])?.id).toBe(invoice.id);
    expect(invoiceForTransaction(makeTransaction({ invoiceId: "other" }), [invoice])).toBeUndefined();
  });
});

describe("publicPaymentMessage", () => {
  it("nomme la passerelle sans exposer l'environnement technique", () => {
    const message =
      "Le paiement par carte est indisponible : la passerelle Konnect Sandbox n'est pas configurée. " +
      "Aucun montant n'a été engagé.";
    const text = publicPaymentMessage(message);

    expect(text).toContain("Konnect");
    expect(text).not.toMatch(/sandbox/i);
    expect(text).toContain("Aucun montant n'a été engagé");
  });

  it("laisse intact un message sans détail technique", () => {
    expect(publicPaymentMessage("Paiement refusé par la banque.")).toBe("Paiement refusé par la banque.");
    expect(publicPaymentMessage("")).toBe("");
    expect(publicPaymentMessage(null)).toBe("");
  });
});

describe("receiptFileName", () => {
  it("produit un nom de fichier sûr", () => {
    expect(receiptFileName("PAY-20261109-ABCDEF")).toBe("Recu-PAY-20261109-ABCDEF.pdf");
    expect(receiptFileName("réf/2026 09")).toBe("Recu-r-f-2026-09.pdf");
    expect(receiptFileName(null)).toBe("Recu-FreelanceTN.pdf");
  });
});
