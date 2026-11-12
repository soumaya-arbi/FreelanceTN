"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  quoteCorrectionState,
  quoteStatusLabel,
} from "@/lib/documents";
import {
  collectPaymentTransactions,
  transactionFromInvoicePayment,
} from "@/lib/payments";
import {
  BillingSkeleton,
  PaymentDetailPanel,
  PaymentHistoryTable,
  PaymentsPanel,
} from "@/components/modules/BillingPayments";
import { paymentsApi, type BlockchainBalanceApi } from "@/lib/api";
import { shortAddress } from "@/lib/walletBalance";
import type { DocumentLine, Invoice, PaymentTransaction, Quote, QuoteHistoryEntry } from "@/lib/types";

const formatEth = (value: number) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(value)} ETH`;

const balanceTime = (iso?: string) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("fr-FR");
};

type Tab = "quotes" | "invoices" | "payments";
type QuoteFilter = "all" | "draft" | "sent" | "accepted" | "refused" | "expired";
type InvoiceFilter = "all" | "draft" | "emise" | "unpaid" | "partially_paid" | "paid" | "overdue";

const statusClass = (status: string) => `doc-status ${status}`;
const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Une erreur est survenue.";

function LineTable({ lines }: { lines: DocumentLine[] }) {
  return (
    <table className="doc-lines billing-modal-lines">
      <thead>
        <tr>
          <th>Description</th><th>Qté</th><th>Prix unitaire</th><th>TVA</th><th>Remise</th><th>Total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id}>
            <td>{line.description || "—"}</td>
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

function Totals({ lines, extra }: { lines: DocumentLine[]; extra?: React.ReactNode }) {
  const totals = documentTotals(lines);
  return (
    <aside className="doc-totals billing-modal-totals">
      <div><span>Sous-total</span><b>{formatTND(totals.subtotal)}</b></div>
      <div><span>Remise</span><b>-{formatTND(totals.discount)}</b></div>
      <div><span>TVA</span><b>{formatTND(totals.tax)}</b></div>
      <div className="grand"><span>Total</span><b>{formatTND(totals.total)}</b></div>
      {extra}
    </aside>
  );
}

function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => ref.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus(), 0);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="billing-modal-root" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={wide ? "billing-modal is-wide" : "billing-modal"} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="billing-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="billing-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const historyActionLabel = (action: string) => {
  const map: Record<string, string> = {
    refused_correction_requested: "Correction demandée par le client",
    abandoned: "Refus définitif",
    accepted: "Devis accepté",
    resent_after_correction: "Devis corrigé et renvoyé",
    sent: "Devis envoyé",
  };
  return map[action] || action;
};

function QuoteHistory({ history }: { history?: QuoteHistoryEntry[] }) {
  const items = (history || []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (items.length === 0) return null;
  return (
    <div className="billing-history-block">
      <h3>Historique des échanges</h3>
      <ul className="billing-history-list">
        {items.map((entry) => (
          <li key={entry.id || `${entry.action}-${entry.createdAt}`} className="billing-history-item">
            <div className="billing-history-item-head">
              <b>{historyActionLabel(entry.action)}</b>
              <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("fr-FR") : "—"}</span>
            </div>
            {entry.actorRole && <div className="billing-history-meta">{entry.actorRole === "client" ? "Client" : "Freelancer"}</div>}
            {entry.note && <p>{entry.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FreelancerBillingCenter({ initialTab = "quotes", initialId }: { initialTab?: Tab; initialId?: string }) {
  const router = useRouter();
  const { notify } = useApp();
  const {
    quotes,
    invoices,
    documentsLoading,
    documentsError,
    payments,
    paymentsLoading,
    paymentsError,
    setQuoteStatus,
    downloadPaymentReceipt,
  } = useMarketplace();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>("all");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentTransaction | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Solde du portefeuille destinataire : uniquement lu par le backend via
  // eth_getBalance sur le réseau actif. Aucun cumul de paiements en base.
  const [walletBalance, setWalletBalance] = useState<BlockchainBalanceApi | null>(null);
  const [walletBalanceError, setWalletBalanceError] = useState("");
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(true);
  const walletRequestSeq = useRef(0);

  const loadWalletBalance = useCallback(async () => {
    const seq = ++walletRequestSeq.current;
    setWalletBalanceLoading(true);
    try {
      const balance = await paymentsApi.blockchainBalance();
      if (seq !== walletRequestSeq.current) return;
      setWalletBalance(balance);
      setWalletBalanceError("");
    } catch (error) {
      if (seq !== walletRequestSeq.current) return;
      // Échec fermé : aucun solde n'est affiché si la lecture on-chain échoue.
      setWalletBalance(null);
      setWalletBalanceError(errorMessage(error));
    } finally {
      if (seq === walletRequestSeq.current) setWalletBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWalletBalance();
  }, [loadWalletBalance]);

  // Après chaque paiement enregistré (liste rafraîchie par le contexte), le
  // solde est relu sur la blockchain : il n'est jamais incrémenté localement.
  const paymentsSignature = useMemo(
    () => payments.map((payment) => `${payment.id}:${payment.status}`).join("|"),
    [payments],
  );
  useEffect(() => {
    if (!paymentsSignature) return;
    void loadWalletBalance();
  }, [paymentsSignature, loadWalletBalance]);

  // Retour sur l'onglet : le solde on-chain peut avoir changé (paiement reçu
  // pendant l'absence). Relecture systématique, sans valeur mise en cache.
  useEffect(() => {
    const onFocus = () => void loadWalletBalance();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadWalletBalance();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    // Rafraîchissement léger tant que la page est visible : un paiement
    // confirmé côté client apparaît sans action du freelancer.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadWalletBalance();
    }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [loadWalletBalance]);

  useEffect(() => {
    if (!initialId) return;
    const q = quotes.find((item) => item.id === initialId);
    if (q) { setTab("quotes"); setSelectedQuoteId(q.id); return; }
    const inv = invoices.find((item) => item.id === initialId);
    if (inv) { setTab("invoices"); setSelectedInvoiceId(inv.id); }
  }, [initialId, quotes, invoices]);

  const selectedQuote = quotes.find((q) => q.id === selectedQuoteId) || null;
  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId) || null;
  const allTransactions = useMemo(() => collectPaymentTransactions(invoices, payments), [invoices, payments]);
  const historyInvoiceTransactions = useMemo(() => {
    if (!historyInvoice) return [];
    return (historyInvoice.payments || [])
      .map((payment) => transactionFromInvoicePayment(payment, historyInvoice))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [historyInvoice]);

  const onDownloadReceipt = useCallback(async (transaction: PaymentTransaction) => {
    setDownloadingId(transaction.id);
    try {
      await downloadPaymentReceipt(transaction.id, transaction.reference);
      notify(`Reçu ${transaction.receiptNumber || transaction.reference} téléchargé.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setDownloadingId(null);
    }
  }, [downloadPaymentReceipt, notify]);

  const summary = useMemo(() => {
    const draft = quotes.filter((q) => q.status === "draft").length;
    const pending = quotes.filter((q) => q.status === "sent").length;
    const accepted = quotes.filter((q) => q.status === "accepted").length;
    const refused = quotes.filter((q) => q.status === "refused" || q.status === "expired").length;
    const unpaid = invoices.filter((i) => i.status === "unpaid" || i.status === "overdue" || i.status === "emise" || i.status === "partially_paid").length;
    const paid = invoices.filter((i) => i.status === "paid").length;
    return { draft, pending, accepted, refused, unpaid, paid, received: invoices.reduce((s, i) => s + (i.amountPaid || 0), 0), balance: invoices.reduce((s, i) => s + invoiceBalance(i), 0) };
  }, [quotes, invoices]);

  const filteredQuotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((item) => {
      if (quoteFilter !== "all" && item.status !== quoteFilter) return false;
      if (!q) return true;
      return [item.number, item.client, item.project, item.issueDate, item.status, item.correctionNote || ""].join(" ").toLowerCase().includes(q);
    });
  }, [quotes, quoteFilter, search]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((item) => {
      if (invoiceFilter !== "all" && item.status !== invoiceFilter) return false;
      if (!q) return true;
      return [item.number, item.client, item.project, item.issueDate, item.dueDate, item.status].join(" ").toLowerCase().includes(q);
    });
  }, [invoices, invoiceFilter, search]);

  const sendQuote = useCallback(async (quote: Quote) => {
    setBusy(true);
    try {
      const updated = await setQuoteStatus(quote.id, "sent");
      setSelectedQuoteId(updated.id);
      notify(`Devis ${updated.number} envoyé au client.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [setQuoteStatus, notify]);

  const resendCorrectedQuote = useCallback(async (quote: Quote) => {
    setBusy(true);
    try {
      const updated = await setQuoteStatus(quote.id, "sent");
      setSelectedQuoteId(updated.id);
      notify(`Devis corrigé ${updated.number} renvoyé au client.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [setQuoteStatus, notify]);

  const quoteCounts = useMemo(() => ({
    all: quotes.length,
    draft: quotes.filter((q) => q.status === "draft").length,
    sent: quotes.filter((q) => q.status === "sent").length,
    accepted: quotes.filter((q) => q.status === "accepted").length,
    refused: quotes.filter((q) => q.status === "refused").length,
    expired: quotes.filter((q) => q.status === "expired").length,
  }), [quotes]);

  const invoiceCounts = useMemo(() => ({
    all: invoices.length,
    unpaid: invoices.filter((i) => i.status === "unpaid").length,
    partially_paid: invoices.filter((i) => i.status === "partially_paid").length,
    paid: invoices.filter((i) => i.status === "paid").length,
    overdue: invoices.filter((i) => i.status === "overdue").length,
    emise: invoices.filter((i) => i.status === "emise").length,
    draft: invoices.filter((i) => i.status === "draft").length,
  }), [invoices]);

  const quoteFilters: { key: QuoteFilter; label: string }[] = [
    { key: "all", label: `Tous (${quoteCounts.all})` },
    { key: "draft", label: `Brouillons (${quoteCounts.draft})` },
    { key: "sent", label: `En attente (${quoteCounts.sent})` },
    { key: "accepted", label: `Acceptés (${quoteCounts.accepted})` },
    { key: "refused", label: `Refusés (${quoteCounts.refused})` },
    { key: "expired", label: `Expirés (${quoteCounts.expired})` },
  ];
  const invoiceFilters: { key: InvoiceFilter; label: string }[] = [
    { key: "all", label: `Toutes (${invoiceCounts.all})` },
    { key: "unpaid", label: `Impayées (${invoiceCounts.unpaid})` },
    { key: "partially_paid", label: `Partielles (${invoiceCounts.partially_paid})` },
    { key: "paid", label: `Payées (${invoiceCounts.paid})` },
    { key: "overdue", label: `En retard (${invoiceCounts.overdue})` },
    { key: "emise", label: `Émises (${invoiceCounts.emise})` },
    { key: "draft", label: `Brouillons (${invoiceCounts.draft})` },
  ];

  return (
    <ModuleShell role="freelancer" page="quotes">
      <main className="workspace module-page billing-center">
        <div className="workspace-title">
          <div>
            <p>ESPACE FREELANCER</p>
            <h1>Devis &amp; factures</h1>
            <span>Gérez vos devis, traitez les demandes de correction, suivez les factures créées par les clients et consultez les paiements.</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button icon="file" onClick={() => router.push("/freelancer/quotes/new")}>Nouveau devis</Button>
          </div>
        </div>

        <div className="summary-row billing-summary">
          <div className="summary-card"><span>Brouillons devis</span><h3>{summary.draft}</h3></div>
          <div className="summary-card"><span>Devis en attente</span><h3>{summary.pending}</h3></div>
          <div className="summary-card"><span>Devis acceptés</span><h3>{summary.accepted}</h3></div>
          <div className="summary-card"><span>Refusés / expirés</span><h3>{summary.refused}</h3></div>
          <div className="summary-card"><span>Factures à suivre</span><h3>{summary.unpaid}</h3></div>
          <div className="summary-card"><span>Reçu / solde</span><h3>{formatTND(summary.received)}</h3><small style={{ color: "var(--muted)", fontSize: 11 }}>Solde {formatTND(summary.balance)}</small></div>
        </div>

        <section className="wallet-balance-card billing-center-wallet" aria-label="Portefeuille de paiement">
          <div className="wallet-balance-head">
            <div>
              <h2>Portefeuille de paiement</h2>
              <p>
                Solde reçu sur votre compte de paiement. Il est actualisé à l&apos;ouverture de la page et
                après chaque paiement confirmé.
              </p>
            </div>
            <div className="wallet-balance-actions">
              <Button
                type="button"
                variant="secondary"
                icon="refresh"
                onClick={() => void loadWalletBalance()}
                disabled={walletBalanceLoading}
              >
                {walletBalanceLoading ? "Actualisation…" : "Actualiser le solde"}
              </Button>
            </div>
          </div>

          {walletBalanceError && (
            <p className="form-error" role="alert">
              {walletBalanceError}
            </p>
          )}

          {walletBalance && !walletBalanceError && (
            <>
              <div className="wallet-balance-grid">
                <div>
                  <span>Solde disponible</span>
                  <b>{formatEth(walletBalance.balanceEth)}</b>
                </div>
                <div>
                  <span>Dernière actualisation</span>
                  <b>{balanceTime(walletBalance.checkedAt)}</b>
                </div>
              </div>
              <p className="wallet-balance-meta">
                <span>Compte destinataire <code>{shortAddress(walletBalance.address)}</code></span>
                <span>Réseau {walletBalance.network} ({walletBalance.chainId})</span>
              </p>
              {!walletBalanceLoading && (
                <p className="billing-note">
                  <Icon name="wallet" size={14} />
                  Chaque paiement confirmé augmente ce solde. Aucun montant n&apos;est saisi manuellement.
                </p>
              )}
            </>
          )}
        </section>

        <div className="dash-card billing-tabs-card">
          <div className="billing-toolbar">
            <div className="billing-tabs" role="tablist" aria-label="Devis, factures et paiements">
              <button type="button" role="tab" aria-selected={tab === "quotes"} className={tab === "quotes" ? "is-active" : ""} onClick={() => setTab("quotes")}>Devis</button>
              <button type="button" role="tab" aria-selected={tab === "invoices"} className={tab === "invoices" ? "is-active" : ""} onClick={() => setTab("invoices")}>Factures</button>
              <button type="button" role="tab" aria-selected={tab === "payments"} className={tab === "payments" ? "is-active" : ""} onClick={() => setTab("payments")}>Paiements reçus</button>
            </div>
            {tab !== "payments" && (
              <div className="table-search billing-search"><Icon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "quotes" ? "Rechercher un devis" : "Rechercher une facture"} /></div>
            )}
          </div>

          {tab !== "payments" && (
            <div className="module-tabs billing-filters" role="group" aria-label="Filtres par statut">
              {(tab === "quotes" ? quoteFilters : invoiceFilters).map((item) => (
                <button key={item.key} type="button" className={(tab === "quotes" ? quoteFilter : invoiceFilter) === item.key ? "active" : ""} onClick={() => tab === "quotes" ? setQuoteFilter(item.key as QuoteFilter) : setInvoiceFilter(item.key as InvoiceFilter)}>{item.label}</button>
              ))}
            </div>
          )}

          {tab !== "payments" && documentsLoading && <BillingSkeleton rows={5} />}
          {tab !== "payments" && documentsError && <p className="form-error" role="alert">{documentsError}</p>}

          {!documentsLoading && !documentsError && tab === "quotes" && (
            <table className="dash-table doc-table">
              <thead><tr><th>Devis</th><th>Client</th><th>Projet</th><th>Émission</th><th>Validité</th><th>Total</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr key={quote.id}>
                    <td><b>{quote.number}</b></td>
                    <td>{quote.client || "—"}</td>
                    <td>{quote.project}</td>
                    <td>{quote.issueDate}</td>
                    <td>{quote.validUntil}</td>
                    <td>{formatTND(documentTotals(quote.lines).total)}</td>
                    <td><span className={statusClass(quote.status)}>{quoteStatusLabel(quote)}</span></td>
                    <td><Button variant="secondary" onClick={() => setSelectedQuoteId(quote.id)}>Consulter</Button></td>
                  </tr>
                ))}
                {filteredQuotes.length === 0 && <tr><td colSpan={8} className="task-empty">Aucun devis pour ce filtre.</td></tr>}
              </tbody>
            </table>
          )}

          {!documentsLoading && !documentsError && tab === "invoices" && (
            <table className="dash-table doc-table">
              <thead><tr><th>Facture</th><th>Client</th><th>Projet</th><th>Échéance</th><th>Total</th><th>Payé</th><th>Solde</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td><b>{invoice.number}</b></td>
                    <td>{invoice.client || "—"}</td>
                    <td>{invoice.project}</td>
                    <td>{invoice.dueDate}</td>
                    <td>{formatTND(documentTotals(invoice.lines).total)}</td>
                    <td>{formatTND(invoice.amountPaid || 0)}</td>
                    <td>{formatTND(invoiceBalance(invoice))}</td>
                    <td><span className={statusClass(invoice.status)}>{invoiceStatusLabel(invoice)}</span></td>
                    <td><Button variant="secondary" onClick={() => setSelectedInvoiceId(invoice.id)}>Consulter</Button></td>
                  </tr>
                ))}
                {filteredInvoices.length === 0 && <tr><td colSpan={9} className="task-empty">Aucune facture pour ce filtre.</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "payments" && (
            <PaymentsPanel
              role="freelancer"
              transactions={allTransactions}
              invoices={invoices}
              loading={paymentsLoading || documentsLoading}
              error={paymentsError || documentsError}
              onOpen={setSelectedPayment}
              onDownload={(transaction) => void onDownloadReceipt(transaction)}
              downloadingId={downloadingId}
            />
          )}
        </div>
      </main>

      <Modal open={!!selectedQuote} title={selectedQuote ? `Devis ${selectedQuote.number}` : "Devis"} onClose={() => setSelectedQuoteId(null)} wide>
        {selectedQuote && (
          <div className="billing-detail">
            <div className="billing-detail-meta">
              <div><span>Client</span><b>{selectedQuote.client || "—"}</b></div>
              <div><span>Projet</span><b>{selectedQuote.project}</b></div>
              <div><span>Émission</span><b>{selectedQuote.issueDate}</b></div>
              <div><span>Validité</span><b>{selectedQuote.validUntil}</b></div>
              <div><span>Statut</span><b><span className={statusClass(selectedQuote.status)}>{quoteStatusLabel(selectedQuote)}</span></b></div>
            </div>
            {selectedQuote.status === "refused" && selectedQuote.correctionNote && (
              <div className={`billing-alert ${selectedQuote.abandoned ? "is-danger" : "is-warning"}`}>
                <Icon name={selectedQuote.abandoned ? "close" : "message"} size={15} />
                <div>
                  <b>{selectedQuote.abandoned ? "Refus définitif" : "Correction demandée par le client"}</b>
                  <p>{selectedQuote.correctionNote}</p>
                  {!selectedQuote.abandoned && <span>Modifiez le devis puis renvoyez-le au client pour validation.</span>}
                </div>
              </div>
            )}
            <div className="doc-detail-grid">
              <div className="doc-detail-main">
                <LineTable lines={selectedQuote.lines} />
                {selectedQuote.notes && <div className="doc-notes"><h3>Notes</h3><p>{selectedQuote.notes}</p></div>}
                <QuoteHistory history={selectedQuote.history} />
              </div>
              <Totals lines={selectedQuote.lines} />
            </div>
            <div className="billing-modal-actions">
              {selectedQuote.status === "draft" && !selectedQuote.convertedTo && (
                <>
                  <Button variant="secondary" onClick={() => router.push(`/freelancer/quotes/${selectedQuote.id}/edit`)}>Modifier</Button>
                  <Button icon="check" onClick={() => void sendQuote(selectedQuote)} disabled={busy}>{busy ? "Envoi…" : "Envoyer au client"}</Button>
                </>
              )}
              {selectedQuote.status === "refused" && quoteCorrectionState(selectedQuote) === "pending_correction" && !selectedQuote.convertedTo && (
                <>
                  <Button variant="secondary" icon="file" onClick={() => router.push(`/freelancer/quotes/${selectedQuote.id}/edit`)}>Corriger le devis</Button>
                  <Button icon="check" onClick={() => void resendCorrectedQuote(selectedQuote)} disabled={busy}>{busy ? "Envoi…" : "Renvoyer au client"}</Button>
                </>
              )}
              {selectedQuote.status === "sent" && <p className="task-empty">En attente de réponse du client.</p>}
              {selectedQuote.status === "accepted" && !selectedQuote.convertedTo && <p className="task-empty">Devis accepté. Le client peut créer la facture depuis son espace.</p>}
              {selectedQuote.convertedTo && (
                <Button icon="file" onClick={() => { const inv = invoices.find((i) => i.id === selectedQuote.convertedTo); if (inv) { setSelectedQuoteId(null); setTab("invoices"); setSelectedInvoiceId(inv.id); } else { notify("Facture introuvable dans la liste chargée."); } }}>Voir la facture</Button>
              )}
              {selectedQuote.status === "expired" && <p className="form-error" role="status">Ce devis est expiré. Mettez à jour sa validité si nécessaire.</p>}
              {selectedQuote.status === "refused" && quoteCorrectionState(selectedQuote) === "abandoned" && <p className="task-empty">Ce devis est refusé et définitivement abandonné.</p>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!selectedInvoice} title={selectedInvoice ? `Facture ${selectedInvoice.number}` : "Facture"} onClose={() => setSelectedInvoiceId(null)} wide>
        {selectedInvoice && (
          <div className="billing-detail">
            <div className="billing-detail-meta">
              <div><span>Client</span><b>{selectedInvoice.client || "—"}</b></div>
              <div><span>Projet</span><b>{selectedInvoice.project}</b></div>
              <div><span>Émission</span><b>{selectedInvoice.issueDate}</b></div>
              <div><span>Échéance</span><b>{selectedInvoice.dueDate}</b></div>
              <div><span>Statut</span><b><span className={statusClass(selectedInvoice.status)}>{invoiceStatusLabel(selectedInvoice)}</span></b></div>
            </div>
            <div className="doc-detail-grid">
              <div className="doc-detail-main"><LineTable lines={selectedInvoice.lines} />{selectedInvoice.notes && <div className="doc-notes"><h3>Notes</h3><p>{selectedInvoice.notes}</p></div>}</div>
              <Totals lines={selectedInvoice.lines} extra={<><div><span>Payé</span><b>{formatTND(selectedInvoice.amountPaid || 0)}</b></div><div><span>Solde restant</span><b>{formatTND(invoiceBalance(selectedInvoice))}</b></div></>} />
            </div>
            <p className="billing-note"><Icon name="shield" size={14} /> Consultation en lecture seule : les paiements sont effectués par le client. Aucune donnée bancaire réelle n'est collectée.</p>
            <div className="billing-modal-actions">
              <Button variant="secondary" icon="file" onClick={() => setHistoryInvoice(selectedInvoice)}>Historique des paiements</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!historyInvoice} title={historyInvoice ? `Historique — ${historyInvoice.number}` : "Historique"} onClose={() => setHistoryInvoice(null)} wide>
        {historyInvoice && (
          <div className="billing-history">
            <div className="billing-detail-meta">
              <div><span>Total</span><b>{formatTND(documentTotals(historyInvoice.lines).total)}</b></div>
              <div><span>Payé</span><b>{formatTND(historyInvoice.amountPaid || 0)}</b></div>
              <div><span>Solde restant</span><b>{formatTND(invoiceBalance(historyInvoice))}</b></div>
            </div>
            <PaymentHistoryTable
              transactions={historyInvoiceTransactions}
              invoices={invoices}
              role="freelancer"
              showInvoice={false}
              onView={setSelectedPayment}
              onDownload={(transaction) => void onDownloadReceipt(transaction)}
              downloadingId={downloadingId}
              emptyLabel="Aucune transaction pour cette facture."
            />
          </div>
        )}
      </Modal>

      <Modal open={!!selectedPayment} title={selectedPayment ? `Transaction ${selectedPayment.reference}` : "Transaction"} onClose={() => setSelectedPayment(null)} wide>
        {selectedPayment && (
          <PaymentDetailPanel
            transaction={selectedPayment}
            invoices={invoices}
            role="freelancer"
            onDownload={(transaction) => void onDownloadReceipt(transaction)}
            downloadingId={downloadingId}
            busy={busy}
          />
        )}
      </Modal>
    </ModuleShell>
  );
}
