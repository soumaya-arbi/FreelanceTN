import type { DocumentLine, Invoice, Quote } from "@/lib/types";

export const formatTND = (amount: number) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} TND`;

export const lineNet = (line: DocumentLine) => line.quantity * line.unitPrice;
export const lineDiscount = (line: DocumentLine) => lineNet(line) * (line.discount / 100);
export const lineTaxable = (line: DocumentLine) => lineNet(line) - lineDiscount(line);
export const lineTax = (line: DocumentLine) => lineTaxable(line) * (line.taxRate / 100);
export const lineTotal = (line: DocumentLine) => lineTaxable(line) + lineTax(line);

export function documentTotals(lines: DocumentLine[]) {
  const subtotal = lines.reduce((sum, line) => sum + lineNet(line), 0);
  const discount = lines.reduce((sum, line) => sum + lineDiscount(line), 0);
  const tax = lines.reduce((sum, line) => sum + lineTax(line), 0);
  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  return { subtotal, discount, tax, total };
}

const quoteStatusLabels: Record<Quote["status"], string> = {
  draft: "Brouillon",
  sent: "En attente",
  accepted: "Accepté",
  refused: "Refusé",
  expired: "Expiré",
};

const invoiceStatusLabels: Record<Invoice["status"], string> = {
  draft: "Brouillon",
  emise: "Émise",
  unpaid: "Impayée",
  partially_paid: "Partiellement payée",
  paid: "Payée",
  overdue: "En retard",
};

export const quoteStatusLabel = (quote: Quote) => {
  if (quote.status === "refused") {
    if (quote.abandoned) return "Refusé (abandonné)";
    if (quote.correctionRequested) return "Refusé — correction demandée";
    return "Refusé";
  }
  return quoteStatusLabels[quote.status] ?? quote.status;
};

export const quoteCorrectionState = (quote: Quote): "none" | "pending_correction" | "abandoned" => {
  if (quote.status !== "refused") return "none";
  if (quote.abandoned) return "abandoned";
  if (quote.correctionRequested) return "pending_correction";
  return "none";
};

export const invoiceStatusLabel = (invoice: Invoice) => invoiceStatusLabels[invoice.status] ?? invoice.status;

export const invoiceBalance = (invoice: Invoice) =>
  invoice.balanceDue ?? Math.max(0, documentTotals(invoice.lines).total - (invoice.amountPaid ?? 0));
