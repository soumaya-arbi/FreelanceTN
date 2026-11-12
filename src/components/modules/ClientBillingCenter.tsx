"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  normalizePaymentStatus,
  paymentMethodLabel,
  paymentMethodOptions,
  publicPaymentMessage,
  transactionFromInvoicePayment,
  validatePaymentAmount,
} from "@/lib/payments";
import {
  BillingSkeleton,
  PaymentDetailPanel,
  PaymentHistoryTable,
  PaymentsPanel,
} from "@/components/modules/BillingPayments";
import { ClientWalletOverview } from "@/components/modules/ClientWalletOverview";
import {
  getEthereumProvider,
  metaMaskErrorMessage,
  networkFromConfig,
  readAccountBalance,
  tndToWeiEstimate,
  weiToEthNumber,
} from "@/lib/metamask";
import type { EthereumNetworkConfig } from "@/lib/metamask";
import {
  assertSufficientFunds,
  openWalletSession,
  preflightTransfer,
  sendIntentTransfer,
  type WalletPreflight,
  type WalletSession,
} from "@/lib/walletPayment";
import { createSingleFlight, type SingleFlight } from "@/lib/singleFlight";
import { paymentJournal } from "@/lib/paymentJournal";
import type { BlockchainConfigApi } from "@/lib/api";
import type {
  DocumentLine,
  Invoice,
  PaymentMethod,
  PaymentTransaction,
  Quote,
  QuoteHistoryEntry,
} from "@/lib/types";

/** Marqueur local d'un paiement carte parti vers la page hébergée Konnect. */
const GATEWAY_PENDING_KEY = "freelancetn.konnect.pending";
const GATEWAY_PENDING_TTL_MS = 30 * 60 * 1000;

/** Horodatage du marqueur de retour passerelle (hors rendu React). */
function gatewayMarkerTimestamp(): number {
  return Date.now();
}

type Tab = "quotes" | "invoices" | "payments";
type QuoteFilter = "all" | "draft" | "sent" | "accepted" | "refused" | "expired";
type InvoiceFilter = "all" | "draft" | "emise" | "unpaid" | "partially_paid" | "paid" | "overdue";

const statusClass = (status: string) => `doc-status ${status}`;
const errorMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? publicPaymentMessage(error.message) || "Une erreur est survenue."
    : "Une erreur est survenue.";

const formatEth = (value: number) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(value)} ETH`;

function LineTable({ lines }: { lines: DocumentLine[] }) {
  return (
    <table className="doc-lines billing-modal-lines">
      <thead>
        <tr>
          <th>Description</th>
          <th>Qté</th>
          <th>Prix unitaire</th>
          <th>TVA</th>
          <th>Remise</th>
          <th>Total</th>
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

function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => ref.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
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
    refused_correction_requested: "Correction demandée",
    abandoned: "Refus définitivement abandonné",
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

export function ClientBillingCenter({ initialTab = "quotes", initialId, initialPayment }: { initialTab?: Tab; initialId?: string; initialPayment?: string }) {
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
    createInvoiceFromQuote,
    payInvoice,
    verifyInvoicePayment,
    verifyBlockchainPayment,
    blockchainConfig,
    retryInvoicePayment,
    cancelInvoicePayment,
    downloadPaymentReceipt,
  } = useMarketplace();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>("all");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentTransaction | null>(null);
  const [acceptQuote, setAcceptQuote] = useState<Quote | null>(null);
  const [refuseQuote, setRefuseQuote] = useState<Quote | null>(null);
  const [createInvoiceFor, setCreateInvoiceFor] = useState<Quote | null>(null);
  const [payInvoiceTarget, setPayInvoiceTarget] = useState<Invoice | null>(null);
  const [gatewayResult, setGatewayResult] = useState<PayOutcome | null>(null);
  // Facture à rouvrir une fois le parcours de paiement fermé : elle ne doit
  // jamais recouvrir l'écran de résultat pendant la confirmation.
  const [invoiceAfterPayment, setInvoiceAfterPayment] = useState<string | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Incrémenté après un paiement confirmé : les deux soldes sont relus on-chain.
  const [walletRefreshToken, setWalletRefreshToken] = useState(0);
  const gatewayCheckStarted = useRef(false);

  useEffect(() => {
    if (!initialId) return;
    const q = quotes.find((item) => item.id === initialId);
    if (q) { setTab("quotes"); setSelectedQuoteId(q.id); return; }
    const inv = invoices.find((item) => item.id === initialId);
    if (inv) { setTab("invoices"); setSelectedInvoiceId(inv.id); }
  }, [initialId, quotes, invoices]);

  // Retour depuis la page hébergée Konnect : seule la vérification serveur
  // fait foi. Le paramètre d'URL ou le marqueur de session ne contient qu'un
  // identifiant de transaction, jamais un statut ni un montant.
  useEffect(() => {
    if (gatewayCheckStarted.current) return;
    let transactionId = initialPayment?.trim() || "";
    if (!transactionId) {
      try {
        const raw = sessionStorage.getItem(GATEWAY_PENDING_KEY);
        if (raw) {
          const pending = JSON.parse(raw) as { transactionId?: string; createdAt?: number };
          if (pending.transactionId
            && (!pending.createdAt || Date.now() - pending.createdAt < GATEWAY_PENDING_TTL_MS)) {
            transactionId = pending.transactionId;
          } else {
            sessionStorage.removeItem(GATEWAY_PENDING_KEY);
          }
        }
      } catch {
        // Stockage indisponible : aucune vérification automatique, sans erreur.
      }
    }
    if (!transactionId) return;
    gatewayCheckStarted.current = true;

    void (async () => {
      try {
        const outcome = await verifyInvoicePayment(transactionId);
        sessionStorage.removeItem(GATEWAY_PENDING_KEY);
        setTab("invoices");
        setInvoiceAfterPayment(outcome.invoice.id);
        setGatewayResult(outcome);
        setPayInvoiceTarget(outcome.invoice);
        const ok = normalizePaymentStatus(outcome.transaction.status) === "succeeded";
        notify(ok
          ? `Paiement de ${formatTND(outcome.transaction.amount)} confirmé par la passerelle Konnect.`
          : outcome.transaction.errorMessage || "La passerelle n'a pas encore confirmé ce paiement. Vous pouvez vérifier à nouveau.");
      } catch (error) {
        sessionStorage.removeItem(GATEWAY_PENDING_KEY);
        notify(errorMessage(error));
      } finally {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          if (url.searchParams.has("payment") || url.searchParams.has("gateway_result")) {
            url.searchParams.delete("payment");
            url.searchParams.delete("gateway_result");
            window.history.replaceState({}, "", url.toString());
          }
        }
      }
    })();
  }, [initialPayment, notify, verifyInvoicePayment]);

  const closePaymentModal = useCallback(() => {
    setPayInvoiceTarget(null);
    setGatewayResult(null);
    if (invoiceAfterPayment) setSelectedInvoiceId(invoiceAfterPayment);
    setInvoiceAfterPayment(null);
  }, [invoiceAfterPayment]);

  const selectedQuote = quotes.find((q) => q.id === selectedQuoteId) || null;
  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId) || null;
  const allTransactions = useMemo(
    () => collectPaymentTransactions(invoices, payments),
    [invoices, payments],
  );
  const historyInvoiceTransactions = useMemo(() => {
    if (!historyInvoice) return [];
    return (historyInvoice.payments || [])
      .map((payment) => transactionFromInvoicePayment(payment, historyInvoice))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [historyInvoice]);

  const summary = useMemo(() => {
    const pending = quotes.filter((q) => q.status === "sent" || q.status === "draft").length;
    const accepted = quotes.filter((q) => q.status === "accepted").length;
    const refused = quotes.filter((q) => q.status === "refused").length;
    const unpaid = invoices.filter((i) => i.status === "unpaid" || i.status === "overdue" || i.status === "emise").length;
    const paid = invoices.filter((i) => i.status === "paid").length;
    const partial = invoices.filter((i) => i.status === "partially_paid").length;
    return { pending, accepted, refused, unpaid, paid, partial, balance: invoices.reduce((s, i) => s + invoiceBalance(i), 0) };
  }, [quotes, invoices]);

  const filteredQuotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((item) => {
      if (quoteFilter !== "all" && item.status !== quoteFilter) return false;
      if (!q) return true;
      return [item.number, item.project, item.issueDate, item.status, item.correctionNote || ""].join(" ").toLowerCase().includes(q);
    });
  }, [quotes, quoteFilter, search]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((item) => {
      if (invoiceFilter !== "all" && item.status !== invoiceFilter) return false;
      if (!q) return true;
      return [item.number, item.project, item.issueDate, item.dueDate, item.status].join(" ").toLowerCase().includes(q);
    });
  }, [invoices, invoiceFilter, search]);

  const onAccept = useCallback(async (quote: Quote) => {
    setBusy(true);
    try {
      const updated = await setQuoteStatus(quote.id, "accepted");
      setSelectedQuoteId(updated.id);
      setAcceptQuote(null);
      notify(`Devis ${updated.number} accepté.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [setQuoteStatus, notify]);

  const onRefuse = useCallback(async (quote: Quote, note: string, abandon: boolean) => {
    setBusy(true);
    try {
      const updated = await setQuoteStatus(quote.id, "refused", note, abandon);
      setSelectedQuoteId(updated.id);
      setRefuseQuote(null);
      notify(abandon ? `Devis ${updated.number} refusé.` : `Demande de correction envoyée au freelancer pour ${updated.number}.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [setQuoteStatus, notify]);

  const onCreateInvoice = useCallback(async (quote: Quote, input: { dueDate: string; notes: string }) => {
    setBusy(true);
    try {
      const created = await createInvoiceFromQuote(quote.id, input);
      setCreateInvoiceFor(null);
      setSelectedQuoteId(null);
      setTab("invoices");
      setSelectedInvoiceId(created.id);
      notify(`Facture ${created.number} créée à partir du devis ${quote.number}.`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [createInvoiceFromQuote, notify]);

  const onPay = useCallback(async (
    invoice: Invoice,
    input: { amount: number; method: PaymentMethod; note: string; idempotencyKey: string; provider: "internal" | "konnect" | "blockchain" },
  ) => {
    const result = await payInvoice({
      invoiceId: invoice.id,
      amount: input.amount,
      method: input.method,
      note: input.note || undefined,
      idempotencyKey: input.idempotencyKey,
      provider: input.provider,
    });
    // Le détail de la facture ne doit pas recouvrir le parcours de paiement :
    // il est rouvert uniquement après confirmation (onPaid).
    return result;
  }, [payInvoice]);

  const onRetryPayment = useCallback(async (transaction: PaymentTransaction) => {
    const result = await retryInvoicePayment(transaction.id);
    return result;
  }, [retryInvoicePayment]);

  const onCancelPayment = useCallback(async (transaction: PaymentTransaction) => {
    setBusy(true);
    try {
      const result = await cancelInvoicePayment(transaction.id, "Annulation demandée par le client.");
      setSelectedPayment(result.transaction);
      notify("Transaction annulée. Aucun montant n'a été prélevé.");
      return result;
    } catch (error) {
      notify(errorMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  }, [cancelInvoicePayment, notify]);

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

  const quoteFilters: { key: QuoteFilter; label: string }[] = [
    { key: "all", label: "Tous" },
    { key: "sent", label: "En attente" },
    { key: "accepted", label: "Acceptés" },
    { key: "refused", label: "Refusés" },
    { key: "expired", label: "Expirés" },
    { key: "draft", label: "Brouillons" },
  ];
  const invoiceFilters: { key: InvoiceFilter; label: string }[] = [
    { key: "all", label: "Toutes" },
    { key: "unpaid", label: "Impayées" },
    { key: "partially_paid", label: "Partielles" },
    { key: "paid", label: "Payées" },
    { key: "overdue", label: "En retard" },
    { key: "emise", label: "Émises" },
    { key: "draft", label: "Brouillons" },
  ];

  return (
    <ModuleShell role="client" page="quotes">
      <main className="workspace module-page billing-center">
        <div className="workspace-title">
          <div>
            <p>ESPACE CLIENT</p>
            <h1>Devis &amp; factures</h1>
            <span>Consultez vos devis, demandez des corrections si nécessaire, créez des factures à partir des devis acceptés et suivez vos paiements.</span>
          </div>
        </div>

        <div className="summary-row billing-summary">
          <div className="summary-card"><span>Devis en attente</span><h3>{summary.pending}</h3></div>
          <div className="summary-card"><span>Devis acceptés</span><h3>{summary.accepted}</h3></div>
          <div className="summary-card"><span>Devis refusés</span><h3>{summary.refused}</h3></div>
          <div className="summary-card"><span>Factures impayées</span><h3>{summary.unpaid + summary.partial}</h3></div>
          <div className="summary-card"><span>Factures payées</span><h3>{summary.paid}</h3></div>
          <div className="summary-card"><span>Solde restant</span><h3>{formatTND(summary.balance)}</h3></div>
        </div>

        <ClientWalletOverview
          loadBlockchainConfig={blockchainConfig}
          refreshToken={walletRefreshToken}
        />

        <div className="dash-card billing-tabs-card">
          <div className="billing-toolbar">
            <div className="billing-tabs" role="tablist" aria-label="Devis, factures et paiements">
              <button type="button" role="tab" aria-selected={tab === "quotes"} className={tab === "quotes" ? "is-active" : ""} onClick={() => setTab("quotes")}>Devis</button>
              <button type="button" role="tab" aria-selected={tab === "invoices"} className={tab === "invoices" ? "is-active" : ""} onClick={() => setTab("invoices")}>Factures</button>
              <button type="button" role="tab" aria-selected={tab === "payments"} className={tab === "payments" ? "is-active" : ""} onClick={() => setTab("payments")}>Paiements</button>
            </div>
            {tab !== "payments" && (
              <div className="table-search billing-search"><Icon name="search" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "quotes" ? "Rechercher un devis" : "Rechercher une facture"} /></div>
            )}
          </div>

          {tab !== "payments" && (
            <div className="module-tabs billing-filters" role="group" aria-label="Filtres">
              {(tab === "quotes" ? quoteFilters : invoiceFilters).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={(tab === "quotes" ? quoteFilter : invoiceFilter) === item.key ? "active" : ""}
                  onClick={() => tab === "quotes" ? setQuoteFilter(item.key as QuoteFilter) : setInvoiceFilter(item.key as InvoiceFilter)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {tab !== "payments" && documentsLoading && <BillingSkeleton rows={5} />}
          {tab !== "payments" && documentsError && <p className="form-error" role="alert">{documentsError}</p>}

          {!documentsLoading && !documentsError && tab === "quotes" && (
            <table className="dash-table doc-table">
              <thead><tr><th>Devis</th><th>Projet</th><th>Émission</th><th>Validité</th><th>Total</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr key={quote.id}>
                    <td><b>{quote.number}</b></td>
                    <td>{quote.project}</td>
                    <td>{quote.issueDate}</td>
                    <td>{quote.validUntil}</td>
                    <td>{formatTND(documentTotals(quote.lines).total)}</td>
                    <td><span className={statusClass(quote.status)}>{quoteStatusLabel(quote)}</span></td>
                    <td><Button variant="secondary" onClick={() => setSelectedQuoteId(quote.id)}>Consulter</Button></td>
                  </tr>
                ))}
                {filteredQuotes.length === 0 && <tr><td colSpan={7} className="task-empty">Aucun devis pour ce filtre.</td></tr>}
              </tbody>
            </table>
          )}

          {!documentsLoading && !documentsError && tab === "invoices" && (
            <table className="dash-table doc-table">
              <thead><tr><th>Facture</th><th>Projet</th><th>Émission</th><th>Échéance</th><th>Total</th><th>Solde</th><th>Statut</th><th>Action</th></tr></thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td><b>{invoice.number}</b></td>
                    <td>{invoice.project}</td>
                    <td>{invoice.issueDate}</td>
                    <td>{invoice.dueDate}</td>
                    <td>{formatTND(documentTotals(invoice.lines).total)}</td>
                    <td>{formatTND(invoiceBalance(invoice))}</td>
                    <td><span className={statusClass(invoice.status)}>{invoiceStatusLabel(invoice)}</span></td>
                    <td><Button variant="secondary" onClick={() => setSelectedInvoiceId(invoice.id)}>Consulter</Button></td>
                  </tr>
                ))}
                {filteredInvoices.length === 0 && <tr><td colSpan={8} className="task-empty">Aucune facture pour ce filtre.</td></tr>}
              </tbody>
            </table>
          )}

          {tab === "payments" && (
            <PaymentsPanel
              role="client"
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
              <div><span>Projet</span><b>{selectedQuote.project}</b></div>
              <div><span>Émission</span><b>{selectedQuote.issueDate}</b></div>
              <div><span>Validité</span><b>{selectedQuote.validUntil}</b></div>
              <div><span>Statut</span><b><span className={statusClass(selectedQuote.status)}>{quoteStatusLabel(selectedQuote)}</span></b></div>
            </div>
            {selectedQuote.status === "refused" && selectedQuote.correctionNote && (
              <div className="billing-alert is-warning">
                <Icon name="message" size={15} />
                <div>
                  <b>{selectedQuote.abandoned ? "Motif du refus" : "Demande de correction envoyée"}</b>
                  <p>{selectedQuote.correctionNote}</p>
                </div>
              </div>
            )}
            <div className="doc-detail-grid">
              <div className="doc-detail-main">
                <LineTable lines={selectedQuote.lines} />
                {selectedQuote.notes && <div className="doc-notes"><h3>Notes du devis</h3><p>{selectedQuote.notes}</p></div>}
                <QuoteHistory history={selectedQuote.history} />
              </div>
              <Totals lines={selectedQuote.lines} />
            </div>
            <div className="billing-modal-actions">
              {selectedQuote.status === "sent" && (
                <>
                  <Button icon="check" onClick={() => setAcceptQuote(selectedQuote)} disabled={busy}>Accepter le devis</Button>
                  <Button variant="secondary" icon="close" onClick={() => setRefuseQuote(selectedQuote)} disabled={busy}>Refuser</Button>
                </>
              )}
              {selectedQuote.status === "accepted" && !selectedQuote.convertedTo && (
                <Button icon="file" onClick={() => setCreateInvoiceFor(selectedQuote)} disabled={busy}>Créer une facture</Button>
              )}
              {selectedQuote.convertedTo && <p className="task-empty">Une facture a déjà été créée à partir de ce devis.</p>}
              {selectedQuote.status === "refused" && quoteCorrectionState(selectedQuote) === "pending_correction" && (
                <p className="task-empty">Votre demande de correction a été transmise au freelancer. Le devis repassera par votre validation après renvoi.</p>
              )}
              {selectedQuote.status === "refused" && quoteCorrectionState(selectedQuote) === "abandoned" && (
                <p className="task-empty">Ce devis est refusé et marqué comme définitivement abandonné.</p>
              )}
              {selectedQuote.status === "expired" && <p className="form-error" role="status">Ce devis est expiré et ne peut plus générer de facture.</p>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!acceptQuote} title="Confirmer l'acceptation" onClose={() => !busy && setAcceptQuote(null)}>
        {acceptQuote && (
          <div className="billing-confirm">
            <p>Accepter le devis <b>{acceptQuote.number}</b> ? Vous pourrez ensuite créer une facture à partir de ce devis.</p>
            <div className="billing-modal-actions">
              <Button variant="secondary" onClick={() => setAcceptQuote(null)} disabled={busy}>Annuler</Button>
              <Button icon="check" onClick={() => void onAccept(acceptQuote)} disabled={busy}>{busy ? "Traitement…" : "Accepter"}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!refuseQuote} title={refuseQuote ? `Refuser le devis ${refuseQuote.number}` : "Refuser le devis"} onClose={() => !busy && setRefuseQuote(null)} wide>
        {refuseQuote && <RefusalForm quote={refuseQuote} busy={busy} onCancel={() => setRefuseQuote(null)} onSubmit={(note, abandon) => void onRefuse(refuseQuote, note, abandon)} />}
      </Modal>

      <Modal open={!!createInvoiceFor} title={createInvoiceFor ? `Créer une facture — ${createInvoiceFor.number}` : "Créer une facture"} onClose={() => !busy && setCreateInvoiceFor(null)} wide>
        {createInvoiceFor && <CreateInvoiceForm quote={createInvoiceFor} busy={busy} onCancel={() => setCreateInvoiceFor(null)} onSubmit={(input) => void onCreateInvoice(createInvoiceFor, input)} />}
      </Modal>

      <Modal open={!!selectedInvoice} title={selectedInvoice ? `Facture ${selectedInvoice.number}` : "Facture"} onClose={() => setSelectedInvoiceId(null)} wide>
        {selectedInvoice && (
          <div className="billing-detail">
            <div className="billing-detail-meta">
              <div><span>Projet</span><b>{selectedInvoice.project}</b></div>
              <div><span>Émission</span><b>{selectedInvoice.issueDate}</b></div>
              <div><span>Échéance</span><b>{selectedInvoice.dueDate}</b></div>
              <div><span>Statut</span><b><span className={statusClass(selectedInvoice.status)}>{invoiceStatusLabel(selectedInvoice)}</span></b></div>
            </div>
            <div className="doc-detail-grid">
              <div className="doc-detail-main"><LineTable lines={selectedInvoice.lines} />{selectedInvoice.notes && <div className="doc-notes"><h3>Notes</h3><p>{selectedInvoice.notes}</p></div>}</div>
              <Totals lines={selectedInvoice.lines} extra={<><div><span>Payé</span><b>{formatTND(selectedInvoice.amountPaid || 0)}</b></div><div><span>Solde restant</span><b>{formatTND(invoiceBalance(selectedInvoice))}</b></div></>} />
            </div>
            <div className="billing-modal-actions">
              {invoiceBalance(selectedInvoice) > 0.0001 && selectedInvoice.status !== "draft" && (
                <Button icon="wallet" onClick={() => { setSelectedInvoiceId(null); setPayInvoiceTarget(selectedInvoice); }} disabled={busy}>Effectuer un paiement</Button>
              )}
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
              role="client"
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
            role="client"
            onDownload={(transaction) => void onDownloadReceipt(transaction)}
            downloadingId={downloadingId}
            busy={busy}
            onCancel={(transaction) => void onCancelPayment(transaction)}
            onRetry={async (transaction) => {
              setBusy(true);
              try {
                const result = await onRetryPayment(transaction);
                setSelectedPayment(result.transaction);
                notify(normalizePaymentStatus(result.transaction.status) === "succeeded"
                  ? "Paiement relancé et enregistré avec succès."
                  : result.transaction.errorMessage || "Le paiement n'a pas abouti. Le solde reste inchangé.");
              } catch (error) {
                notify(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </Modal>

      <Modal open={!!payInvoiceTarget} title={payInvoiceTarget ? `Paiement — ${payInvoiceTarget.number}` : "Paiement"} onClose={() => { if (!busy) closePaymentModal(); }} wide>
        {payInvoiceTarget && (
          <PaymentJourney
            key={gatewayResult?.transaction.id ?? payInvoiceTarget.id}
            invoice={payInvoiceTarget}
            initialResult={gatewayResult}
            onClose={closePaymentModal}
            onPaid={(invoice) => {
              setInvoiceAfterPayment(invoice.id);
              setWalletRefreshToken((token) => token + 1);
            }}
            pay={(input) => onPay(payInvoiceTarget, input)}
            verify={verifyInvoicePayment}
            verifyBlockchain={verifyBlockchainPayment}
            loadBlockchainConfig={blockchainConfig}
            retry={onRetryPayment}
            downloadReceipt={onDownloadReceipt}
            downloadingId={downloadingId}
            notify={notify}
          />
        )}
      </Modal>
    </ModuleShell>
  );
}

function RefusalForm({ quote, busy, onCancel, onSubmit }: { quote: Quote; busy: boolean; onCancel: () => void; onSubmit: (note: string, abandon: boolean) => void }) {
  const [note, setNote] = useState("");
  const [abandon, setAbandon] = useState(false);
  const valid = note.trim().length >= 5;
  return (
    <form className="billing-form" onSubmit={(e) => { e.preventDefault(); if (!valid) return; onSubmit(note.trim(), abandon); }}>
      <p className="billing-note"><Icon name="message" size={14} /> Expliquez clairement les modifications souhaitées. Ce message sera transmis au freelancer et conservé dans l'historique du devis.</p>
      <div className="billing-detail-meta">
        <div><span>Devis</span><b>{quote.number}</b></div>
        <div><span>Projet</span><b>{quote.project}</b></div>
      </div>
      <label className="editor-field">Modifications souhaitées <span style={{ color: "var(--danger, #d92d20)" }}>*</span>
        <textarea required minLength={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. : ajuster le délai, modifier le prix de la prestation X, préciser la livraison..." rows={4} />
      </label>
      <label className="billing-check">
        <input type="checkbox" checked={abandon} onChange={(e) => setAbandon(e.target.checked)} />
        <span>Refuser définitivement (ne pas demander de correction). Le devis ne pourra pas être renvoyé pour correction.</span>
      </label>
      {!abandon && <p className="task-empty">Le freelancer pourra corriger le devis et vous le renvoyer pour validation.</p>}
      <div className="billing-modal-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Annuler</Button>
        <Button type="submit" icon="close" disabled={busy || !valid}>{busy ? "Traitement…" : abandon ? "Refuser définitivement" : "Envoyer la demande de correction"}</Button>
      </div>
    </form>
  );
}

function CreateInvoiceForm({ quote, busy, onCancel, onSubmit }: { quote: Quote; busy: boolean; onCancel: () => void; onSubmit: (input: { dueDate: string; notes: string }) => void }) {
  const [dueDate, setDueDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); });
  const [notes, setNotes] = useState(quote.notes || "");
  const totals = documentTotals(quote.lines);
  return (
    <form className="billing-form" onSubmit={(e) => { e.preventDefault(); onSubmit({ dueDate, notes }); }}>
      <p className="billing-note"><Icon name="shield" size={14} /> Les prestations, lignes et montants sont repris automatiquement du devis accepté. Aucune modification financière n'est possible ici.</p>
      <div className="billing-detail-meta">
        <div><span>Client</span><b>{quote.client}</b></div>
        <div><span>Projet</span><b>{quote.project}</b></div>
        <div><span>Total devis</span><b>{formatTND(totals.total)}</b></div>
      </div>
      <label className="editor-field">Date d'échéance<input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      <label className="editor-field">Notes (optionnel)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="billing-modal-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Annuler</Button>
        <Button type="submit" icon="file" disabled={busy}>{busy ? "Création…" : "Créer la facture"}</Button>
      </div>
    </form>
  );
}

type JourneyStep = "method" | "amount" | "review" | "processing" | "result";
type PayOutcome = { transaction: PaymentTransaction; invoice: Invoice };
type JourneyResult = { ok: boolean; message: string; pending?: boolean; transaction?: PaymentTransaction; invoice: Invoice };

function PaymentJourney({
  invoice,
  initialResult,
  onClose,
  onPaid,
  pay,
  verify,
  verifyBlockchain,
  loadBlockchainConfig,
  retry,
  downloadReceipt,
  downloadingId,
  notify,
}: {
  invoice: Invoice;
  initialResult?: PayOutcome | null;
  onClose: () => void;
  onPaid: (invoice: Invoice) => void;
  pay: (input: { amount: number; method: PaymentMethod; note: string; idempotencyKey: string; provider: "internal" | "konnect" | "blockchain" }) => Promise<PayOutcome>;
  verify: (transactionId: string) => Promise<PayOutcome>;
  verifyBlockchain: (transactionId: string, txHash: string) => Promise<PayOutcome>;
  loadBlockchainConfig: () => Promise<BlockchainConfigApi>;
  retry: (transaction: PaymentTransaction) => Promise<PayOutcome>;
  downloadReceipt: (transaction: PaymentTransaction) => Promise<void>;
  downloadingId?: string | null;
  notify: (message: string) => void;
}) {
  const total = documentTotals(invoice.lines).total;
  const initialBalance = invoiceBalance(invoice);
  const paid = invoice.amountPaid || 0;
  const initialStatus = normalizePaymentStatus(initialResult?.transaction.status);
  const initialProviderLabel = initialResult?.transaction.provider === "blockchain"
    ? "vérifié par le service de paiement"
    : "confirmé par la passerelle Konnect";
  const initialJourneyResult: JourneyResult | null = initialResult
    ? {
        ok: initialStatus === "succeeded",
        message: initialStatus === "succeeded"
          ? `Paiement de ${formatTND(initialResult.transaction.amount)} ${initialProviderLabel}.`
          : initialResult.transaction.errorMessage
            || (initialStatus === "pending" || initialStatus === "processing"
              ? "Le paiement n'a pas encore été confirmé. Vous pouvez vérifier à nouveau dans quelques instants."
              : "Le paiement n'a pas abouti. Le solde de la facture reste inchangé."),
        transaction: initialResult.transaction,
        invoice: initialResult.invoice,
        pending: initialStatus === "pending" || initialStatus === "processing",
      }
    : null;
  const [step, setStep] = useState<JourneyStep>(initialJourneyResult ? "result" : "method");
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [amountStr, setAmountStr] = useState(initialBalance.toFixed(3));
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState("");
  const [result, setResult] = useState<JourneyResult | null>(initialJourneyResult);
  const [busy, setBusy] = useState(false);
  const [chainConfig, setChainConfig] = useState<BlockchainConfigApi | null>(null);
  const [chainConfigError, setChainConfigError] = useState("");
  const [walletCheck, setWalletCheck] = useState<WalletPreflight | null>(null);
  const [walletCheckError, setWalletCheckError] = useState("");
  const [walletChecking, setWalletChecking] = useState(false);
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);
  // Hash déjà envoyé pour une intention : permet de revérifier sans redemander
  // une signature (donc sans risque de double transfert).
  const lastSubmitted = useRef<{ transactionId: string; hash: string } | null>(null);
  const idempotencyKey = useRef<{ key: string; signature: string } | null>(null);
  // Verrou synchrone : `busy` ne devient vrai qu'au rendu suivant, donc un
  // double clic rapide pourrait créer deux intentions et deux demandes
  // MetaMask concurrentes. Ce verrou bloque dès le premier clic.
  const flightRef = useRef<SingleFlight>(createSingleFlight());

  useEffect(() => {
    let active = true;
    loadBlockchainConfig()
      .then((config) => { if (active) setChainConfig(config); })
      .catch((error) => { if (active) setChainConfigError(errorMessage(error)); });
    return () => { active = false; };
  }, [loadBlockchainConfig]);

  useEffect(() => {
    if (mode === "full") setAmountStr(initialBalance.toFixed(3));
  }, [mode, initialBalance]);

  const selectedMethod = paymentMethodOptions.find((option) => option.value === method) ?? paymentMethodOptions[0];
  const validation = validatePaymentAmount(mode === "full" ? initialBalance : amountStr, initialBalance);
  const amount = validation.ok ? validation.value : 0;
  const estimatedEth = chainConfig && chainConfig.tndPerEth > 0 && amount > 0
    ? amount / chainConfig.tndPerEth
    : null;
  // Réseau de paiement fourni par la configuration serveur.
  const chainNetwork = chainConfig ? networkFromConfig(chainConfig) : null;
  const blockchainUnavailable = chainConfig !== null && !chainConfig.enabled;

  // Détection silencieuse du portefeuille déjà autorisé : aucun popup n'est
  // ouvert ici. Le libellé de la carte MetaMask reflète l'état réel.
  useEffect(() => {
    const provider = getEthereumProvider();
    if (!provider) return;
    let active = true;
    void (async () => {
      try {
        const accounts = await provider.request({ method: "eth_accounts" });
        if (active && Array.isArray(accounts) && typeof accounts[0] === "string") {
          setWalletAccount(accounts[0]);
        }
      } catch {
        // Un portefeuille verrouillé reste un état normal : la connexion reste proposée.
      }
    })();
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      setWalletAccount(typeof accounts[0] === "string" ? accounts[0] : null);
    };
    provider.on?.("accountsChanged", onAccountsChanged);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, []);

  // Un changement de moyen ou de montant invalide la vérification affichée.
  useEffect(() => {
    setWalletCheck(null);
    setWalletCheckError("");
  }, [method, validation.value]);

  // Changement de compte ou de réseau MetaMask : le solde affiché est
  // immédiatement relu côté serveur (jamais repris d'un état local).
  useEffect(() => {
    if (method !== "metamask" || !chainConfig?.receiver) return;
    const provider = getEthereumProvider();
    if (!provider) return;
    const network = networkFromConfig(chainConfig);
    const receiver = chainConfig.receiver;
    const amountWei = validation.ok
      ? tndToWeiEstimate(validation.value, chainConfig.tndPerEth)
      : null;

    const refreshFor = (account: string) => {
      if (!amountWei) return;
      setWalletChecking(true);
      setWalletCheckError("");
      void (async () => {
        try {
          const check = await preflightTransfer(
            { provider, from: account, network },
            receiver,
            amountWei,
          );
          setWalletCheck(check);
        } catch (error) {
          setWalletCheck(null);
          setWalletCheckError(metaMaskErrorMessage(error, network));
        } finally {
          setWalletChecking(false);
        }
      })();
    };

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      setWalletCheck(null);
      if (typeof accounts[0] === "string") {
        refreshFor(accounts[0]);
      } else {
        setWalletCheckError(
          "Aucun compte MetaMask n'est sélectionné : connectez un compte pour vérifier le solde.",
        );
      }
    };

    const onChainChanged = (...args: unknown[]) => {
      const observed = typeof args[0] === "string" ? Number.parseInt(args[0], 16) : null;
      setWalletCheck(null);
      if (observed !== network.chainId) {
        setWalletCheckError(
          `MetaMask a changé de réseau. Revenez sur le réseau requis ` +
            "pour vérifier le solde et payer. Aucun montant n'a été envoyé.",
        );
        return;
      }
      void (async () => {
        try {
          const accounts = await provider.request({ method: "eth_accounts" });
          const account = Array.isArray(accounts) && typeof accounts[0] === "string"
            ? accounts[0]
            : null;
          if (account) refreshFor(account);
        } catch {
          setWalletCheckError("Impossible de relire le compte MetaMask.");
        }
      })();
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [method, chainConfig, validation.ok, validation.value]);

  /**
   * Clé d'idempotence stable pour un couple (facture, moyen, montant).
   *
   * Elle est conservée dans sessionStorage : un rechargement de page, un
   * changement d'onglet de l'interface ou une nouvelle tentative après un refus
   * MetaMask renvoie donc la MÊME intention au backend au lieu d'en créer une
   * seconde. Si le montant ou le moyen change, une nouvelle clé est créée.
   */
  const idempotencyFor = useCallback((value: number) => {
    const signature = `${invoice.id}|${method}|${value.toFixed(3)}`;
    if (!idempotencyKey.current || idempotencyKey.current.signature !== signature) {
      idempotencyKey.current = {
        signature,
        key: paymentJournal.idempotencyKey(signature),
      };
    }
    return idempotencyKey.current.key;
  }, [invoice.id, method]);

  const goReview = () => {
    if (!validation.ok) {
      setLocalError(validation.error);
      return;
    }
    setLocalError("");
    setConfirmed(false);
    idempotencyFor(validation.value);
    setStep("review");
  };

  /** Carte bancaire : parcours Konnect inchangé, aucune clé ni vérification modifiée. */
  const chooseCard = () => {
    setMethod("card");
    setLocalError("");
    setConfirmed(false);
    setStep("amount");
  };

  /**
   * MetaMask : la connexion (compte + réseau) est demandée avant toute création
   * d'intention. Un refus ou une absence d'extension n'engage donc aucun montant.
   */
  const chooseMetaMask = async () => {
    setMethod("metamask");
    setLocalError("");
    setConfirmed(false);
    if (chainConfig && !chainConfig.enabled) {
      setLocalError("Le paiement par portefeuille n'est pas disponible pour le moment.");
      return;
    }
    const provider = getEthereumProvider();
    if (!provider) {
      setLocalError(
        "MetaMask n'est pas installé dans ce navigateur. Installez l'extension MetaMask puis rechargez la page.",
      );
      return;
    }
    if (!walletAccount) {
      if (!chainNetwork) {
        setLocalError("Le paiement MetaMask est momentanément indisponible. Réessayez dans un instant.");
        return;
      }
      if (walletConnecting) return;
      setWalletConnecting(true);
      try {
        const session = await openWalletSession(provider, chainNetwork);
        setWalletAccount(session.from);
      } catch (error) {
        setLocalError(metaMaskErrorMessage(error, chainNetwork));
        return;
      } finally {
        setWalletConnecting(false);
      }
    }
    setStep("amount");
  };

  /**
   * Abandon local d'une tentative MetaMask définitivement refusée par le
   * backend (hash déjà crédité, chaîne réinitialisée, intention sans Genesis).
   * Le hash et la clé d'idempotence sont oubliés : un nouveau clic ouvre un
   * nouveau paiement au lieu de rejouer indéfiniment le même refus.
   */
  const forgetBlockchainAttempt = (transactionId: string, amount: number) => {
    paymentJournal.forget(transactionId);
    paymentJournal.forgetKey(`${invoice.id}|${method}|${Number(amount).toFixed(3)}`);
    idempotencyKey.current = null;
    lastSubmitted.current = null;
    setSubmittedHash(null);
  };

  /**
   * Étape 1 du paiement MetaMask : connecter le portefeuille et imposer le
   * réseau AVANT de créer l'intention. Un refus, un verrou MetaMask (-32002)
   * ou une bascule réseau incomplète n'engage ainsi aucun montant.
   */
  const prepareWallet = async (network: EthereumNetworkConfig): Promise<WalletSession> => {
    const ethereum = getEthereumProvider();
    if (!ethereum) {
      throw new Error(
        "MetaMask n'est pas détecté dans ce navigateur. Installez l'extension MetaMask puis rechargez la page.",
      );
    }
    return openWalletSession(ethereum, network);
  };

  const finishBlockchain = (verified: PayOutcome): boolean => {
    const status = normalizePaymentStatus(verified.transaction.status);
    const ok = status === "succeeded";
    const waiting = status === "pending" || status === "processing";
    if (status === "failed" || status === "cancelled") {
      // Refus définitif côté backend : ne jamais boucler sur le même hash.
      forgetBlockchainAttempt(verified.transaction.id, verified.transaction.amount);
    }
    const message = ok
      ? `Paiement de ${formatTND(verified.transaction.amount)} confirmé.`
      : verified.transaction.errorMessage
        || (waiting
          ? "Transaction envoyée. Elle est en attente de confirmation : utilisez « Vérifier le paiement » dans quelques instants. Aucun crédit avant confirmation."
          : "Le paiement n'a pas abouti. Le solde de la facture reste inchangé.");
    setResult({ ok, message, pending: waiting, transaction: verified.transaction, invoice: verified.invoice });
    if (ok) onPaid(verified.invoice);
    notify(message);
    return ok;
  };

  /** Recalcule l'affichage du solde à partir de la blockchain (jamais d'un cumul local). */
  const refreshBalanceFromChain = async (account?: string | null) => {
    const provider = getEthereumProvider();
    const address = account || walletCheck?.account;
    if (!provider || !chainNetwork || !address) return;
    try {
      const reading = await readAccountBalance(provider, chainNetwork, address);
      setWalletCheck((previous) => {
        if (!previous) return previous;
        const balance = BigInt(reading.balanceWei);
        const amount = BigInt(previous.amountWei);
        const required = BigInt(previous.requiredWei);
        const reason = balance < amount ? "amount" : balance < required ? "fees" : "ok";
        return {
          ...previous,
          balanceWei: reading.balanceWei,
          blockNumber: reading.blockNumber,
          sufficient: reason === "ok",
          reason,
          shortfallWei: reason === "ok" ? "0" : (required - balance).toString(),
        };
      });
    } catch {
      // Un rafraîchissement d'affichage ne vaut jamais preuve de paiement.
    }
  };

  /** Contrôle solde + frais pour l'affichage, sans autoriser la signature. */
  const checkFundsForDisplay = async (
    session: WalletSession,
    receiver: string,
    amountWei: string,
  ) => {
    setWalletChecking(true);
    setWalletCheckError("");
    try {
      const check = await preflightTransfer(session, receiver, amountWei);
      setWalletCheck(check);
      return check;
    } catch (error) {
      setWalletCheck(null);
      setWalletCheckError(metaMaskErrorMessage(error, session.network));
      return null;
    } finally {
      setWalletChecking(false);
    }
  };

  /** Bouton « Connecter MetaMask et vérifier le solde » du récapitulatif. */
  const connectAndCheckFunds = async () => {
    if (!chainConfig || !chainNetwork || !validation.ok) {
      setWalletCheckError("Le paiement est momentanément indisponible : rechargez la page.");
      return;
    }
    if (!chainConfig.receiver) {
      setWalletCheckError("Le paiement MetaMask est indisponible pour le moment.");
      return;
    }
    // Même verrou que « Payer » : un double clic ne peut pas lancer deux
    // demandes MetaMask concurrentes.
    if (!flightRef.current.begin()) return;
    setWalletChecking(true);
    setWalletCheckError("");
    try {
      const session = await prepareWallet(chainNetwork);
      await checkFundsForDisplay(
        session,
        chainConfig.receiver,
        tndToWeiEstimate(validation.value, chainConfig.tndPerEth),
      );
    } catch (error) {
      setWalletCheck(null);
      setWalletCheckError(metaMaskErrorMessage(error, chainNetwork));
    } finally {
      flightRef.current.end();
      setWalletChecking(false);
    }
  };

  /**
   * Étape 3 du paiement MetaMask : un seul `eth_sendTransaction`, puis
   * vérification serveur. Le succès n'est jamais déduit du hash : seul le
   * statut relu en JSON-RPC par le backend crédite la facture.
   */
  const settleBlockchain = async (
    outcome: PayOutcome,
    network: EthereumNetworkConfig,
    wallet: WalletSession,
  ) => {
    const transaction = outcome.transaction;

    // Un hash déjà transmis pour CETTE intention ne doit JAMAIS provoquer un
    // second transfert : si la vérification serveur a échoué (réseau, 5xx), on
    // revérifie le même hash au lieu de redemander une signature MetaMask. Le
    // hash est aussi relu depuis sessionStorage, car un rechargement de page
    // vide l'état React alors que la transaction reste diffusée.
    const knownHash = transaction.blockchainTxHash
      || (lastSubmitted.current?.transactionId === transaction.id ? lastSubmitted.current.hash : null)
      || paymentJournal.submittedHash(transaction.id);
    if (knownHash) {
      if (!transaction.blockchainTxHash) {
        lastSubmitted.current = { transactionId: transaction.id, hash: knownHash };
        setSubmittedHash(knownHash);
      }
      const verified = await verifyBlockchain(transaction.id, knownHash);
      const ok = finishBlockchain(verified);
      if (ok) void refreshBalanceFromChain(wallet.from);
      return;
    }
    if (normalizePaymentStatus(transaction.status) === "succeeded") {
      setResult({
        ok: true,
        message: `Paiement de ${formatTND(transaction.amount)} déjà confirmé sur la blockchain.`,
        transaction,
        invoice: outcome.invoice,
      });
      onPaid(outcome.invoice);
      void refreshBalanceFromChain(wallet.from);
      return;
    }

    if (!transaction.blockchainAmountWei || !transaction.blockchainReceiver) {
      throw new Error("Intention de paiement incomplète : recommencez le paiement.");
    }

    // Contrôle final AVANT la signature : le solde doit couvrir le montant
    // exact figé par le backend ET les frais estimés. Une lecture RPC
    // impossible bloque le paiement (échec fermé).
    const funding = await preflightTransfer(
      wallet,
      transaction.blockchainReceiver,
      transaction.blockchainAmountWei,
    );
    setWalletCheck(funding);
    assertSufficientFunds(funding);

    // Envoi unique : `sendIntentTransfer` refuse de renvoyer une intention qui
    // porte déjà un hash et annule l'envoi si compte/réseau change.
    const hash = await sendIntentTransfer(wallet, {
      id: transaction.id,
      receiver: transaction.blockchainReceiver,
      amountWei: transaction.blockchainAmountWei,
      txHash: transaction.blockchainTxHash,
    });

    setSubmittedHash(hash);
    lastSubmitted.current = { transactionId: transaction.id, hash };
    // Mémorisé avant la vérification : si celle-ci échoue ou si la page est
    // rechargée, le prochain essai revérifie ce hash au lieu de renvoyer.
    paymentJournal.rememberSubmittedHash(transaction.id, hash);
    const verified = await verifyBlockchain(transaction.id, hash);
    const ok = finishBlockchain(verified);
    if (ok) void refreshBalanceFromChain(wallet.from);
  };

  const confirm = async () => {
    if (!validation.ok || !confirmed) return;
    // Double clic / double soumission : le verrou est synchrone, une seule
    // demande MetaMask peut démarrer même avant le prochain rendu.
    if (!flightRef.current.begin()) return;
    // La clé est stable tant que (facture, moyen, montant) ne change pas :
    // une nouvelle tentative réutilise l'intention existante.
    const key = idempotencyFor(validation.value);
    let redirecting = false;
    let created: PayOutcome | null = null;
    let wallet: WalletSession | null = null;
    setBusy(true);
    setLocalError("");
    setStep("processing");
    try {
      // MetaMask : portefeuille prêt AVANT l'intention (aucun montant engagé
      // si la demande est refusée ou si une demande est déjà en attente).
      if (method === "metamask") {
        if (!chainNetwork || !chainConfig?.receiver) {
          throw new Error(
            "Le paiement est momentanément indisponible : rechargez la page avant de payer avec MetaMask.",
          );
        }
        wallet = await prepareWallet(chainNetwork);
        // Contrôle avant toute intention : solde réel + frais estimés. Un
        // solde insuffisant ou une lecture RPC impossible bloque ici.
        const funding = await preflightTransfer(
          wallet,
          chainConfig.receiver,
          tndToWeiEstimate(validation.value, chainConfig.tndPerEth),
        );
        setWalletCheck(funding);
        assertSufficientFunds(funding);
      }

      const provider = method === "card" ? "konnect" as const : method === "metamask" ? "blockchain" as const : "internal" as const;
      const outcome = await pay({
        amount: validation.value,
        method,
        note: note.trim(),
        idempotencyKey: key,
        provider,
      });
      created = outcome;

      // MetaMask : intention créée (ou reprise à l'identique), puis UN seul
      // envoi et vérification serveur obligatoire.
      if (method === "metamask") {
        if (!chainNetwork || !wallet) {
          throw new Error("Portefeuille indisponible : recommencez le paiement.");
        }
        await settleBlockchain(outcome, chainNetwork, wallet);
        return;
      }

      // Paiement carte : le backend a créé un paiement Konnect. Le
      // statut n'est jamais déduit ici : on quitte vers la page hébergée et
      // seule la vérification serveur au retour validera la transaction.
      if (outcome.transaction.gatewayRedirect && outcome.transaction.providerPayUrl) {
        redirecting = true;
        try {
          sessionStorage.setItem(GATEWAY_PENDING_KEY, JSON.stringify({
            transactionId: outcome.transaction.id,
            invoiceId: outcome.transaction.invoiceId,
            createdAt: gatewayMarkerTimestamp(),
          }));
        } catch {
          // Le retour passe aussi par l'URL successUrl fournie par le backend.
        }
        window.location.assign(outcome.transaction.providerPayUrl);
        return;
      }

      const ok = normalizePaymentStatus(outcome.transaction.status) === "succeeded";
      const status = normalizePaymentStatus(outcome.transaction.status);
      const message = ok
        ? `Paiement de ${formatTND(outcome.transaction.amount)} enregistré pour la facture ${outcome.transaction.invoiceNumber || invoice.number}.`
        : outcome.transaction.errorMessage || "Le paiement n'a pas abouti. Le solde de la facture reste inchangé.";
      setResult({ ok, message, pending: status === "pending" || status === "processing", transaction: outcome.transaction, invoice: outcome.invoice });
      if (ok) onPaid(outcome.invoice);
      notify(message);
    } catch (error) {
      const message = method === "metamask" ? metaMaskErrorMessage(error, chainNetwork ?? undefined) : errorMessage(error);
      setResult({
        ok: false,
        message,
        pending: false,
        transaction: created?.transaction,
        invoice: created?.invoice ?? invoice,
      });
      notify(message);
    } finally {
      flightRef.current.end();
      if (!redirecting) {
        setBusy(false);
        setStep("result");
      }
    }
  };

  const verifyPayment = async () => {
    if (!result?.transaction) return;
    setBusy(true);
    try {
      const outcome = await verify(result.transaction.id);
      const ok = normalizePaymentStatus(outcome.transaction.status) === "succeeded";
      const verifyingStatus = normalizePaymentStatus(outcome.transaction.status);
      const message = ok
        ? `Paiement de ${formatTND(outcome.transaction.amount)} confirmé par la passerelle Konnect.`
        : outcome.transaction.errorMessage
          || "La passerelle n'a pas encore confirmé ce paiement. Le solde de la facture reste inchangé.";
      setResult({ ok, message, pending: verifyingStatus === "pending" || verifyingStatus === "processing", transaction: outcome.transaction, invoice: outcome.invoice });
      if (ok) onPaid(outcome.invoice);
      notify(message);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const verifyOnChain = async () => {
    const transaction = result?.transaction;
    const hash = transaction?.blockchainTxHash
      || submittedHash
      || (transaction ? paymentJournal.submittedHash(transaction.id) : null);
    if (!transaction || !hash) {
      notify("Aucun paiement MetaMask à vérifier. Relancez le paiement.");
      return;
    }
    if (!flightRef.current.begin()) return;
    setBusy(true);
    try {
      lastSubmitted.current = { transactionId: transaction.id, hash };
      const outcome = await verifyBlockchain(transaction.id, hash);
      const status = normalizePaymentStatus(outcome.transaction.status);
      const ok = status === "succeeded";
      const waiting = status === "pending" || status === "processing";
      if (status === "failed" || status === "cancelled") {
        forgetBlockchainAttempt(outcome.transaction.id, outcome.transaction.amount);
      }
      const message = ok
        ? `Paiement de ${formatTND(outcome.transaction.amount)} confirmé.`
        : outcome.transaction.errorMessage
          || (waiting
            ? `Transaction encore en attente de confirmations (${outcome.transaction.blockchainConfirmations ?? 0}/${chainConfig?.minConfirmations ?? 2}). Aucun crédit tant que le seuil n'est pas atteint.`
            : "Le paiement n'a pas abouti. Le solde de la facture reste inchangé.");
      setResult({ ok, message, pending: waiting, transaction: outcome.transaction, invoice: outcome.invoice });
      if (ok) {
        onPaid(outcome.invoice);
        void refreshBalanceFromChain();
      }
      notify(message);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      flightRef.current.end();
      setBusy(false);
    }
  };

  const retryPayment = async () => {
    if (!result?.transaction) return;
    if (result.transaction.provider === "konnect") {
      notify("Cette transaction relève de la passerelle Konnect : utilisez la vérification serveur.");
      return;
    }
    if (result.transaction.provider === "blockchain") {
      notify("Cette transaction ne peut pas être relancée : utilisez la vérification du paiement.");
      return;
    }
    if (!flightRef.current.begin()) return;
    setBusy(true);
    try {
      const outcome = await retry(result.transaction);
      const ok = normalizePaymentStatus(outcome.transaction.status) === "succeeded";
      const retryStatus = normalizePaymentStatus(outcome.transaction.status);
      const message = ok
        ? `Paiement de ${formatTND(outcome.transaction.amount)} relancé et enregistré.`
        : outcome.transaction.errorMessage || "Le paiement n'a pas abouti. Le solde de la facture reste inchangé.";
      setResult({ ok, message, pending: retryStatus === "pending" || retryStatus === "processing", transaction: outcome.transaction, invoice: outcome.invoice });
      if (ok) onPaid(outcome.invoice);
      notify(message);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      flightRef.current.end();
      setBusy(false);
    }
  };

  const steps: { key: JourneyStep; label: string }[] = [
    { key: "method", label: "Moyen" },
    { key: "amount", label: "Montant" },
    { key: "review", label: "Récapitulatif" },
    { key: "processing", label: "Traitement" },
    { key: "result", label: "Résultat" },
  ];
  const stepIndex = steps.findIndex((item) => item.key === step);

  const downloadResultReceipt = () => {
    if (result?.transaction) void downloadReceipt(result.transaction);
  };

  const resultPending = Boolean(result && !result.ok && result.pending);

  return (
    <div className="billing-payflow">
      <div className="billing-steps" aria-label="Étapes du paiement">
        {steps.map((item, index) => (
          <div key={item.key} className={`billing-step${index === stepIndex ? " is-active" : ""}${index < stepIndex ? " is-done" : ""}`}>
            <span className="billing-step-dot">{index < stepIndex ? "✓" : index + 1}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="billing-pay-summary">
        <div><span>Montant total</span><b>{formatTND(total)}</b></div>
        <div><span>Déjà payé</span><b>{formatTND(paid)}</b></div>
        <div><span>Solde restant</span><b>{formatTND(initialBalance)}</b></div>
      </div>

      {step === "method" && (
        <div className="billing-form">
          <p className="billing-note">
            <Icon name="shield" size={14} />
            Choisissez votre moyen de paiement. Un paiement n&apos;est enregistré qu&apos;après vérification par le serveur, jamais avant.
          </p>
          <div className="billing-method-grid" aria-label="Moyen de paiement">
            {paymentMethodOptions.map((option) => {
              const isMetaMask = option.value === "metamask";
              return (
                <div key={option.value} className="billing-method-card">
                  <span className="billing-method-icon"><Icon name={option.icon} size={20} /></span>
                  <b>{option.label}</b>
                  <span className="billing-method-desc">{option.description}</span>
                  <ul>
                    {option.details.map((detail) => <li key={detail}>{detail}</li>)}
                  </ul>
                  <div className="billing-method-action">
                    {isMetaMask ? (
                      <Button
                        type="button"
                        variant="secondary"
                        icon={walletAccount ? "arrow" : "wallet"}
                        onClick={() => void chooseMetaMask()}
                        disabled={walletConnecting || blockchainUnavailable}
                      >
                        {walletConnecting
                          ? "Connexion…"
                          : walletAccount
                            ? "Payer avec MetaMask"
                            : "Connecter MetaMask"}
                      </Button>
                    ) : (
                      <Button type="button" icon="arrow" onClick={chooseCard}>
                        Continuer
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {localError && <p className="form-error" role="alert">{localError}</p>}
          <div className="billing-modal-actions">
            <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          </div>
        </div>
      )}

      {step === "amount" && (
        <div className="billing-form">
          <div className="billing-pay-modes" role="radiogroup" aria-label="Type de paiement">
            <label className={`billing-pay-mode${mode === "full" ? " is-active" : ""}`}>
              <input type="radio" name="paymode" checked={mode === "full"} onChange={() => setMode("full")} />
              <b>Paiement intégral</b>
              <span>Régler le solde restant : {formatTND(initialBalance)}</span>
            </label>
            <label className={`billing-pay-mode${mode === "partial" ? " is-active" : ""}`}>
              <input type="radio" name="paymode" checked={mode === "partial"} onChange={() => setMode("partial")} />
              <b>Paiement partiel</b>
              <span>Saisir un montant libre dans la limite du solde</span>
            </label>
          </div>
          <label className="editor-field">Montant (TND)
            <input
              type="number"
              min="0.001"
              max={initialBalance}
              step="0.001"
              value={mode === "full" ? initialBalance.toFixed(3) : amountStr}
              onChange={(event) => { setMode("partial"); setAmountStr(event.target.value); }}
              disabled={mode === "full"}
            />
          </label>
          {mode === "partial" && !validation.ok && amountStr !== "" && (
            <p className="form-error" role="alert">{validation.error}</p>
          )}
          <label className="editor-field">Note (optionnel)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex. acompte, règlement final" /></label>
          <p className="billing-note"><Icon name={selectedMethod.icon} size={14} /> Moyen sélectionné : <b>{selectedMethod.label}</b>. Vous pourrez le modifier à l&apos;étape précédente.</p>
          {localError && <p className="form-error" role="alert">{localError}</p>}
          <div className="billing-modal-actions">
            <Button type="button" variant="secondary" onClick={() => setStep("method")}>Retour</Button>
            <Button type="button" icon="arrow" onClick={goReview} disabled={!validation.ok}>Continuer</Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="billing-form">
          <div className="billing-review-card">
            <h3>Récapitulatif du paiement</h3>
            <div className="billing-detail-meta">
              <div><span>Facture</span><b>{invoice.number}</b></div>
              <div><span>Projet</span><b>{invoice.project}</b></div>
              <div><span>Montant du paiement</span><b>{formatTND(amount)}</b></div>
              <div><span>Moyen de paiement</span><b>{selectedMethod.label}</b></div>
              <div><span>Solde actuel</span><b>{formatTND(initialBalance)}</b></div>
              <div><span>Solde après paiement</span><b>{formatTND(Math.max(0, initialBalance - amount))}</b></div>
              {method === "metamask" && (
                <>
                  <div><span>Taux de conversion</span><b>1 ETH = {chainConfig ? formatTND(chainConfig.tndPerEth) : "…"}</b></div>
                  <div><span>Montant à envoyer</span><b>{estimatedEth !== null ? `≈ ${formatEth(estimatedEth)}` : "Calcul en cours…"}</b></div>
                </>
              )}
            </div>
            {method === "metamask" && (
              <div className={`wallet-funds${walletCheck ? (walletCheck.sufficient ? " is-ok" : " is-danger") : ""}`}>
                <div className="billing-detail-meta">
                  <div><span>Compte MetaMask</span><b>{walletCheck ? "Connecté" : "Non connecté"}</b></div>
                  <div><span>Solde disponible</span><b>{walletCheck ? formatEth(weiToEthNumber(walletCheck.balanceWei)) : "—"}</b></div>
                  <div><span>Montant requis</span><b>{walletCheck ? formatEth(weiToEthNumber(walletCheck.amountWei)) : estimatedEth !== null ? `≈ ${formatEth(estimatedEth)}` : "—"}</b></div>
                  <div><span>Frais de réseau estimés</span><b>{walletCheck?.gas ? `${formatEth(weiToEthNumber(walletCheck.gas.bufferedFeeWei))} (marge 20 % incluse)` : "—"}</b></div>
                  <div><span>Total requis</span><b>{walletCheck ? formatEth(weiToEthNumber(walletCheck.requiredWei)) : "—"}</b></div>
                </div>
                {walletCheck && (
                  <p className={walletCheck.sufficient ? "billing-note" : "form-error"} role={walletCheck.sufficient ? undefined : "alert"}>
                    <Icon name={walletCheck.sufficient ? "check" : "close"} size={14} />
                    {walletCheck.sufficient
                      ? "Solde suffisant : le montant et les frais estimés sont couverts."
                      : walletCheck.reason === "amount"
                        ? `Solde ETH insuffisant : il manque ${formatEth(weiToEthNumber(walletCheck.shortfallWei))} pour le montant du paiement.`
                        : `Solde ETH insuffisant pour les frais de réseau : il manque ${formatEth(weiToEthNumber(walletCheck.shortfallWei))} pour couvrir le montant et les frais estimés.`}
                  </p>
                )}
                {walletCheckError && <p className="form-error" role="alert">{walletCheckError}</p>}
                <div className="billing-modal-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    icon="wallet"
                    onClick={() => void connectAndCheckFunds()}
                    disabled={walletChecking || busy || blockchainUnavailable || !chainConfig?.enabled}
                  >
                    {walletChecking
                      ? "Lecture du solde…"
                      : walletCheck
                        ? "Actualiser le solde"
                        : "Connecter MetaMask et vérifier le solde"}
                  </Button>
                </div>
              </div>
            )}
            {method === "metamask" && (
              <p className="billing-note">
                <Icon name="wallet" size={14} />
                {blockchainUnavailable
                  ? "Le paiement par portefeuille n'est pas disponible pour le moment. Aucun montant ne sera demandé."
                  : chainConfigError
                    ? "La configuration du paiement est momentanément indisponible. Réessayez plus tard."
                    : "Le montant en ETH est calculé au taux fixe affiché et vérifié côté serveur ; aucun crédit n'est appliqué avant confirmation serveur."}
              </p>
            )}
            {note.trim() && <p className="billing-note"><Icon name="file" size={14} /> Note : {note.trim()}</p>}
          </div>
          <label className="billing-check">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>
              {method === "card"
                ? "Je confirme la facture, le montant et le moyen de paiement. Je serai redirigé vers la page sécurisée Konnect ; le paiement ne sera enregistré qu'après vérification serveur."
                : method === "metamask"
                  ? "Je confirme la facture, le montant et le taux affiché. MetaMask me demandera d'envoyer ce montant en ETH ; le paiement ne sera enregistré qu'après vérification serveur."
                  : "Je confirme la facture, le montant et le moyen de paiement. Le paiement sera enregistré immédiatement après validation."}
            </span>
          </label>
          {method === "metamask" && (!walletCheck || !walletCheck.sufficient) && !blockchainUnavailable && (
            <p className="billing-note">
              <Icon name="shield" size={14} />
              Le paiement reste bloqué tant que le solde vérifié ne couvre pas le montant et les frais de réseau.
            </p>
          )}
          {localError && <p className="form-error" role="alert">{localError}</p>}
          <div className="billing-modal-actions">
            <Button type="button" variant="secondary" onClick={() => setStep("amount")} disabled={busy}>Modifier</Button>
            <Button
              type="button"
              icon="check"
              onClick={() => void confirm()}
              disabled={busy || !confirmed || blockchainUnavailable || (method === "metamask" && (!walletCheck || !walletCheck.sufficient))}
            >
              {busy ? "Traitement…" : `Confirmer le paiement de ${formatTND(amount)}`}
            </Button>
          </div>
        </div>
      )}

      {step === "processing" && (
        <div className="billing-processing" role="status" aria-live="polite">
          <div className="billing-spinner" aria-hidden="true" />
          <h3>Traitement en cours</h3>
          <p>
            {method === "card"
              ? "Redirection vers la page sécurisée Konnect. Ne fermez pas cette fenêtre : le paiement sera confirmé par vérification serveur."
              : method === "metamask"
                ? "Confirmez la transaction dans MetaMask. La facture ne sera créditée qu'après vérification serveur."
                : "Votre paiement est en cours de traitement par le moteur FreelanceTN. Ne fermez pas cette fenêtre."}
          </p>
        </div>
      )}

      {step === "result" && result && (
        <div className={`billing-result ${result.ok ? "is-success" : resultPending ? "is-pending" : "is-failure"}`} role="status">
          <div className="billing-result-icon"><Icon name={result.ok ? "check" : resultPending ? "clock" : "close"} size={22} /></div>
          <h3>{result.ok ? "Paiement enregistré" : resultPending ? "Paiement en attente de confirmation" : "Paiement non abouti"}</h3>
          <p>{publicPaymentMessage(result.message)}</p>
          <div className="billing-detail-meta">
            <div><span>Statut facture</span><b>{invoiceStatusLabel(result.invoice)}</b></div>
            <div><span>Montant payé</span><b>{formatTND(result.invoice.amountPaid || 0)}</b></div>
            <div><span>Solde restant</span><b>{formatTND(invoiceBalance(result.invoice))}</b></div>
            {result.transaction && <div><span>Moyen</span><b>{paymentMethodLabel(result.transaction.method)}</b></div>}
            {result.transaction && <div><span>Référence</span><b><code>{result.transaction.reference}</code></b></div>}
            {result.transaction?.receiptNumber && <div><span>N° de reçu</span><b>{result.transaction.receiptNumber}</b></div>}
          </div>
          <div className="billing-modal-actions">
            {!result.ok && !result.transaction && method === "metamask" && (
              <Button
                type="button"
                variant="secondary"
                icon="wallet"
                onClick={() => { setConfirmed(false); setStep("review"); }}
                disabled={busy}
              >
                Réessayer avec MetaMask
              </Button>
            )}
            {!result.ok && result.transaction && (
              result.transaction.provider === "konnect" ? (
                <Button type="button" variant="secondary" icon="shield" onClick={() => void verifyPayment()} disabled={busy}>
                  {busy ? "Vérification…" : "Vérifier le paiement"}
                </Button>
              ) : result.transaction.provider === "blockchain" ? (
                normalizePaymentStatus(result.transaction.status) === "failed"
                || normalizePaymentStatus(result.transaction.status) === "cancelled" ? (
                  <Button type="button" variant="secondary" icon="wallet" onClick={() => { setConfirmed(false); setStep("review"); }} disabled={busy}>
                    Nouveau paiement MetaMask
                  </Button>
                ) : (result.transaction.blockchainTxHash || submittedHash) ? (
                  <Button type="button" variant="secondary" icon="shield" onClick={() => void verifyOnChain()} disabled={busy}>
                    {busy ? "Vérification…" : "Vérifier le paiement"}
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" icon="wallet" onClick={() => { setConfirmed(false); setStep("review"); }} disabled={busy}>
                    Réessayer avec MetaMask
                  </Button>
                )
              ) : (
                <Button type="button" variant="secondary" icon="arrow" onClick={() => void retryPayment()} disabled={busy}>
                  {busy ? "Nouvelle tentative…" : "Réessayer"}
                </Button>
              )
            )}
            {result.ok && result.transaction?.receiptAvailable && (
              <Button type="button" icon="download" onClick={downloadResultReceipt} disabled={downloadingId === result.transaction.id}>
                {downloadingId === result.transaction.id ? "Préparation…" : "Télécharger le reçu PDF"}
              </Button>
            )}
            <Button type="button" variant={result.ok ? "primary" : "secondary"} icon="check" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      )}
    </div>
  );
}
