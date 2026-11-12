"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleShell } from "@/components/modules/ModuleShell";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import {
  documentTotals,
  formatTND,
  invoiceBalance,
  invoiceStatusLabel,
  lineTotal,
  quoteStatusLabel,
} from "@/lib/documents";
import type { DocumentLine, Invoice, Quote, QuoteStatus, Role } from "@/lib/types";

function LineTable({ lines }: { lines: DocumentLine[] }) {
  return (
    <table className="doc-lines">
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit price</th>
          <th>Tax</th>
          <th>Discount</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id}>
            <td>{line.description}</td>
            <td>{line.quantity}</td>
            <td>{formatTND(line.unitPrice)}</td>
            <td>{line.taxRate}%</td>
            <td>{line.discount}%</td>
            <td>{formatTND(lineTotal(line))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ lines, invoice }: { lines: DocumentLine[]; invoice?: Invoice }) {
  const totals = documentTotals(lines);
  return (
    <div className="doc-totals">
      <div><span>Subtotal</span><b>{formatTND(totals.subtotal)}</b></div>
      <div><span>Discount</span><b>-{formatTND(totals.discount)}</b></div>
      <div><span>Tax</span><b>{formatTND(totals.tax)}</b></div>
      <div className={invoice ? "" : "grand"}><span>{invoice ? "Invoice total" : "Amount due"}</span><b>{formatTND(totals.total)}</b></div>
      {invoice && (
        <>
          <div><span>Paid</span><b>{formatTND(invoice.amountPaid ?? 0)}</b></div>
          <div className="grand"><span>Balance due</span><b>{formatTND(invoiceBalance(invoice))}</b></div>
        </>
      )}
    </div>
  );
}

function DocumentUnavailable({
  role,
  kind,
  loading,
  error,
  onBack,
}: {
  role: Role;
  kind: "quote" | "invoice";
  loading: boolean;
  error: string;
  onBack: () => void;
}) {
  const isQuote = kind === "quote";
  return (
    <ModuleShell role={role} page={isQuote ? "quotes" : "invoices"}>
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>{role === "client" ? "CLIENT WORKSPACE" : "FREELANCER WORKSPACE"}</p>
            <h1>{loading ? "Loading document" : "Document not available"}</h1>
            <span>
              {loading
                ? "Retrieving the latest version from the server."
                : error || "This document could not be found or you do not have access to it."}
            </span>
          </div>
          <Button variant="secondary" onClick={onBack}>Back to list</Button>
        </div>
      </main>
    </ModuleShell>
  );
}

export function DocumentDetail({ role, kind, id }: { role: Role; kind: "quote" | "invoice"; id: string }) {
  const router = useRouter();
  const { quotes, invoices, documentsLoading, documentsError } = useMarketplace();
  const isQuote = kind === "quote";
  const document = isQuote
    ? quotes.find((item) => item.id === id)
    : invoices.find((item) => item.id === id);
  const base = isQuote ? "/freelancer/quotes" : "/freelancer/invoices";

  if (!document) {
    return (
      <DocumentUnavailable
        role={role}
        kind={kind}
        loading={documentsLoading}
        error={documentsError}
        onBack={() => router.push(role === "client" ? (isQuote ? "/client/quotes" : "/client/invoices") : base)}
      />
    );
  }

  return <DocumentDetailView key={`${kind}-${document.id}`} role={role} kind={kind} document={document} />;
}

function DocumentDetailView({
  role,
  kind,
  document,
}: {
  role: Role;
  kind: "quote" | "invoice";
  document: Quote | Invoice;
}) {
  const router = useRouter();
  const { notify } = useApp();
  const {
    projects,
    assignedProjects,
    quotes,
    invoices,
    setQuoteStatus,
    setInvoiceStatus,
    deleteQuote,
    deleteInvoice,
  } = useMarketplace();

  const [pending, setPending] = useState("");
  const [actionError, setActionError] = useState("");

  const isQuote = kind === "quote";
  const quote = isQuote ? (document as Quote) : undefined;
  const invoice = isQuote ? undefined : (document as Invoice);
  const number = document.number;
  const status = quote ? quoteStatusLabel(quote) : invoiceStatusLabel(invoice!);
  const projectTitle =
    projects.find((project) => project.id === document.project)?.title ??
    assignedProjects.find((project) => project.id === document.project)?.title ??
    document.project;
  const balance = invoice ? invoiceBalance(invoice) : 0;
  const amountPaid = invoice?.amountPaid ?? 0;
  const payments = invoice?.payments ?? [];
  const busy = Boolean(pending);

  const canEdit =
    role === "freelancer" && (quote ? !quote.convertedTo : invoice?.status !== "paid");
  const canDelete =
    role === "freelancer" &&
    (quote ? !quote.convertedTo : invoice?.status !== "paid" && amountPaid <= 0);
  // Le client crée la facture depuis l'interface centralisée ; le paiement simulé est réservé au client.

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setActionError("");
    setPending(label);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "The action could not be completed.";
      setActionError(message);
      notify(message);
    } finally {
      setPending("");
    }
  };

  const changeQuoteStatus = (next: QuoteStatus, label: string) =>
    run(label, async () => {
      const updated = await setQuoteStatus(document.id, next);
      notify(`Quote ${updated.number} marked as ${quoteStatusLabel(updated).toLowerCase()}.`);
    });

  const markInvoiceSent = () =>
    run("send", async () => {
      const updated = await setInvoiceStatus(document.id, "emise");
      notify(`Invoice ${updated.number} marked as ${invoiceStatusLabel(updated).toLowerCase()}.`);
    });

  const remove = () => {
    if (!window.confirm(`Delete ${number}? This cannot be undone.`)) return;
    run("delete", async () => {
      if (isQuote) await deleteQuote(document.id);
      else await deleteInvoice(document.id);
      notify(`${isQuote ? "Quote" : "Invoice"} ${number} deleted.`);
      router.push(isQuote ? "/freelancer/quotes" : "/freelancer/invoices");
    });
  };

  // Les paiements simulés sont initiés par le client depuis l'interface centralisée.

  return (
    <ModuleShell role={role} page={isQuote ? "quotes" : "invoices"}>
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>{isQuote ? "QUOTE" : "INVOICE"} · {status.toUpperCase()}</p>
            <h1>{number}</h1>
            <span>{projectTitle} · {document.client}</span>
          </div>
          <div className="doc-actions">
            <Button variant="secondary" onClick={() => window.print()} icon="file">Print / PDF</Button>
            {canEdit && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => router.push(isQuote ? `/freelancer/quotes/${document.id}/edit` : `/freelancer/invoices/${document.id}/edit`)}
              >
                Edit
              </Button>
            )}
            {canDelete && (
              <Button variant="secondary" disabled={busy} onClick={remove}>
                {pending === "delete" ? "Deleting…" : "Delete"}
              </Button>
            )}
            {isQuote && role === "freelancer" && !quote?.convertedTo && quote?.status === "draft" && (
              <Button variant="secondary" disabled={busy} onClick={() => changeQuoteStatus("sent", "send")}>
                {pending === "send" ? "Sending…" : "Mark as sent"}
              </Button>
            )}
            {isQuote && role === "freelancer" && !quote?.convertedTo && quote?.status === "sent" && (
              <Button variant="secondary" disabled={busy} onClick={() => changeQuoteStatus("accepted", "accept")}>
                {pending === "accept" ? "Saving…" : "Mark as accepted"}
              </Button>
            )}
            {role === "freelancer" && quote?.status === "accepted" && !quote?.convertedTo && (
              <p className="task-empty">Le client peut créer la facture à partir de ce devis accepté.</p>
            )}
            {isQuote && quote?.convertedTo && (
              <Button
                variant="secondary"
                onClick={() => router.push(`${role === "client" ? "/client" : "/freelancer"}/invoices/${quote.convertedTo}`)}
              >
                View invoice
              </Button>
            )}
            {isQuote && role === "client" && !quote?.convertedTo && quote?.status === "sent" && (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => changeQuoteStatus("refused", "decline")}>
                  {pending === "decline" ? "Declining…" : "Decline"}
                </Button>
                <Button disabled={busy} onClick={() => changeQuoteStatus("accepted", "accept")} icon="check">
                  {pending === "accept" ? "Saving…" : "Accept quote"}
                </Button>
              </>
            )}
            {!isQuote && role === "freelancer" && invoice?.status === "draft" && (
              <Button variant="secondary" disabled={busy} onClick={markInvoiceSent}>
                {pending === "send" ? "Sending…" : "Mark as sent"}
              </Button>
            )}
            {/* Paiement client géré via l'interface centralisée */}
          </div>
        </div>

        {actionError && <p className="form-error" role="alert">{actionError}</p>}

        <div className="doc-layout">
          <article className="dash-card doc-paper">
            <header className="doc-paper-header">
              <div>
                <h2>{isQuote ? "Quote" : "Invoice"}</h2>
                <span>{number}</span>
              </div>
              <span className={`doc-status ${document.status}`}>{status}</span>
            </header>
            <div className="doc-parties">
              <div>
                <small>Billed to</small>
                <b>{document.client}</b>
              </div>
              <div>
                <small>{isQuote ? "Valid until" : "Due date"}</small>
                <b>{isQuote ? (document as Quote).validUntil : (document as Invoice).dueDate}</b>
                <span>Issued {document.issueDate}</span>
              </div>
            </div>
            <LineTable lines={document.lines} />
            <Totals lines={document.lines} invoice={invoice} />
            <div className="doc-notes">
              <small>Notes &amp; terms</small>
              <p>{document.notes || "No additional notes."}</p>
            </div>
          </article>

          <aside className="dash-card doc-side">
            <h3>Details</h3>
            <div className="doc-side-row"><span><Icon name="briefcase" size={14} /> Project</span><b>{projectTitle}</b></div>
            <div className="doc-side-row"><span><Icon name="users" size={14} /> Client</span><b>{document.client}</b></div>
            <div className="doc-side-row"><span><Icon name="clock" size={14} /> Issued</span><b>{document.issueDate}</b></div>
            <div className="doc-side-row"><span><Icon name="file" size={14} /> Items</span><b>{document.lines.length}</b></div>
            {invoice && (
              <>
                <div className="doc-side-row"><span><Icon name="wallet" size={14} /> Paid</span><b>{formatTND(amountPaid)}</b></div>
                <div className="doc-side-row"><span><Icon name="clock" size={14} /> Balance</span><b>{formatTND(balance)}</b></div>
              </>
            )}

            {invoice && (
              <>
                <h3>Payments</h3>
                {payments.length === 0 && <p className="task-empty">No payments recorded.</p>}
                {payments.length > 0 && (
                  <ul className="doc-payment-list">
                    {[...payments].reverse().map((payment, index) => (
                      <li key={`${payment.date}-${payment.amount}-${index}`}>
                        <b>{formatTND(payment.amount)}</b>
                        <small>
                          {payment.date}
                          {payment.reference ? ` · ${payment.reference}` : ""}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                {invoice && (
                  <p className="task-empty">Les paiements sont initiés par le client via un paiement simulé (aucune donnée bancaire réelle).</p>
                )}
              </>
            )}

            <h3>History</h3>
            <ul className="doc-timeline">
              <li><b>{number} created</b><small>{document.issueDate}</small></li>
              {invoice?.quoteId && (
                <li>
                  <b>Created from quote</b>
                  <small>{quotes.find((item) => item.id === invoice.quoteId)?.number ?? invoice.quoteId}</small>
                </li>
              )}
              {quote?.convertedTo && (
                <li>
                  <b>Converted to invoice</b>
                  <small>{invoices.find((item) => item.id === quote.convertedTo)?.number ?? quote.convertedTo}</small>
                </li>
              )}
              {invoice && payments.length > 0 && (
                <li>
                  <b>{payments.length} payment{payments.length > 1 ? "s" : ""} recorded</b>
                  <small>{formatTND(amountPaid)} received</small>
                </li>
              )}
              <li><b>Status set to {status.toLowerCase()}</b><small>Current status</small></li>
            </ul>
          </aside>
        </div>
      </main>
    </ModuleShell>
  );
}
