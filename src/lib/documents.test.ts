import { describe, expect, it } from "vitest";
import {
  documentTotals,
  formatTND,
  invoiceBalance,
  invoiceStatusLabel,
  lineDiscount,
  lineNet,
  lineTax,
  lineTaxable,
  lineTotal,
  quoteCorrectionState,
  quoteStatusLabel,
} from "@/lib/documents";
import type { DocumentLine, Invoice, Quote } from "@/lib/types";

const line = (overrides: Partial<DocumentLine> = {}): DocumentLine => ({
  id: "line-1",
  description: "Prestation",
  quantity: 2,
  unitPrice: 100,
  taxRate: 19,
  discount: 10,
  ...overrides,
});

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv-1",
  number: "FAC-2026-001",
  client: "Client Test",
  project: "Projet test",
  issueDate: "2026-11-01",
  dueDate: "2026-11-30",
  status: "unpaid",
  lines: [line()],
  notes: "",
  amountPaid: 0,
  balanceDue: 214.2,
  payments: [],
  ...overrides,
});

const quote = (overrides: Partial<Quote> = {}): Quote =>
  ({
    id: "quote-1",
    number: "DEV-2026-001",
    client: "Client Test",
    project: "Projet test",
    status: "sent",
    lines: [],
    notes: "",
    ...overrides,
  }) as Quote;

describe("calculs de document", () => {
  it("applique remise puis TVA sur une ligne", () => {
    const value = line();
    expect(lineNet(value)).toBe(200);
    expect(lineDiscount(value)).toBe(20);
    expect(lineTaxable(value)).toBe(180);
    expect(lineTax(value)).toBeCloseTo(34.2, 6);
    expect(lineTotal(value)).toBeCloseTo(214.2, 6);
  });

  it("additionne plusieurs lignes sans perdre les remises ni la TVA", () => {
    const totals = documentTotals([
      line(),
      line({ id: "line-2", quantity: 1, unitPrice: 50, discount: 0, taxRate: 0 }),
    ]);
    expect(totals.subtotal).toBe(250);
    expect(totals.discount).toBe(20);
    expect(totals.tax).toBeCloseTo(34.2, 6);
    expect(totals.total).toBeCloseTo(264.2, 6);
  });

  it("calcule le solde d'une facture partiellement payée", () => {
    expect(invoiceBalance(invoice({ amountPaid: 100, balanceDue: undefined }))).toBeCloseTo(114.2, 6);
  });

  it("respecte le solde fourni par le serveur", () => {
    expect(invoiceBalance(invoice({ amountPaid: 0, balanceDue: 0 }))).toBe(0);
    expect(invoiceBalance(invoice({ amountPaid: 214.2, balanceDue: undefined }))).toBe(0);
  });

  it("ne produit jamais un solde négatif", () => {
    expect(invoiceBalance(invoice({ amountPaid: 500, balanceDue: undefined }))).toBe(0);
  });

  it("formate les montants en TND", () => {
    expect(formatTND(1234.5)).toBe("1,234.50 TND");
    expect(formatTND(0)).toBe("0.00 TND");
  });
});

describe("libellés de statut", () => {
  it("nomme les statuts de facture", () => {
    expect(invoiceStatusLabel(invoice({ status: "partially_paid" }))).toBe("Partiellement payée");
    expect(invoiceStatusLabel(invoice({ status: "overdue" }))).toBe("En retard");
  });

  it("distingue un refus abandonné d'une correction demandée", () => {
    expect(quoteStatusLabel(quote({ status: "refused" }))).toBe("Refusé");
    expect(quoteStatusLabel(quote({ status: "refused", correctionRequested: true }))).toBe(
      "Refusé — correction demandée",
    );
    expect(quoteStatusLabel(quote({ status: "refused", abandoned: true }))).toBe("Refusé (abandonné)");
    expect(quoteStatusLabel(quote({ status: "accepted" }))).toBe("Accepté");
  });

  it("expose l'état de correction d'un devis", () => {
    expect(quoteCorrectionState(quote({ status: "sent" }))).toBe("none");
    expect(quoteCorrectionState(quote({ status: "refused", correctionRequested: true }))).toBe(
      "pending_correction",
    );
    expect(quoteCorrectionState(quote({ status: "refused", abandoned: true }))).toBe("abandoned");
  });
});
