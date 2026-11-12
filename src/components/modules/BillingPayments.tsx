"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { formatTND, invoiceBalance } from "@/lib/documents";
import {
  invoiceForTransaction,
  normalizePaymentStatus,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusTone,
  paymentSummary,
  publicPaymentMessage,
} from "@/lib/payments";
import type { Invoice, PaymentTransaction } from "@/lib/types";

type Role = "client" | "freelancer";

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
};

export function PaymentStatusBadge({ status, legacy }: { status?: string | null; legacy?: boolean }) {
  const tone = paymentStatusTone(status);
  const label = paymentStatusLabel(status);
  return (
    <span className="payment-status" data-tone={tone}>
      <span className="payment-status-dot" aria-hidden="true" />
      {label}
      {legacy ? <em className="payment-status-tag">historique</em> : null}
    </span>
  );
}

export function PaymentHistoryTable({
  transactions,
  invoices,
  role,
  onView,
  onDownload,
  downloadingId,
  showInvoice = true,
  emptyLabel = "Aucune transaction à afficher.",
}: {
  transactions: PaymentTransaction[];
  invoices: Invoice[];
  role: Role;
  onView?: (transaction: PaymentTransaction) => void;
  onDownload?: (transaction: PaymentTransaction) => void;
  downloadingId?: string | null;
  showInvoice?: boolean;
  emptyLabel?: string;
}) {
  if (transactions.length === 0) {
    return <p className="task-empty billing-empty">{emptyLabel}</p>;
  }
  return (
    <div className="billing-table-wrap">
      <table className="dash-table doc-table billing-payment-table">
        <thead>
          <tr>
            <th>Date</th>
            {showInvoice && <th>Facture</th>}
            {role === "freelancer" && showInvoice && <th>Client</th>}
            <th>Montant</th>
            <th>Moyen</th>
            <th>Statut</th>
            <th>Référence</th>
            <th className="billing-col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const invoice = invoiceForTransaction(transaction, invoices);
            const receiptReady = transaction.receiptAvailable && isReady(transaction);
            return (
              <tr key={transaction.id}>
                <td className="billing-nowrap">{formatDate(transaction.completedAt || transaction.createdAt)}</td>
                {showInvoice && (
                  <td>
                    <b>{transaction.invoiceNumber || invoice?.number || "—"}</b>
                    {invoice && role === "client" ? (
                      <small className="billing-cell-sub">Solde {formatTND(invoiceBalance(invoice))}</small>
                    ) : null}
                  </td>
                )}
                {role === "freelancer" && showInvoice && (
                  <td>{transaction.clientName || invoice?.client || "—"}</td>
                )}
                <td className="billing-amount">{formatTND(transaction.amount)}</td>
                <td>
                  <span className="billing-method">
                    <Icon name={methodIcon(transaction.method)} size={14} />
                    {paymentMethodLabel(transaction.method)}
                  </span>
                </td>
                <td><PaymentStatusBadge status={transaction.status} legacy={transaction.legacy} /></td>
                <td><code className="billing-reference">{transaction.reference || "—"}</code></td>
                <td>
                  <div className="billing-row-actions">
                    {onView && (
                      <Button variant="secondary" onClick={() => onView(transaction)}>Détails</Button>
                    )}
                    {onDownload && receiptReady && (
                      <Button
                        variant="ghost"
                        icon="download"
                        onClick={() => onDownload(transaction)}
                        disabled={downloadingId === transaction.id}
                        title={transaction.receiptNumber ? `Reçu ${transaction.receiptNumber}` : "Télécharger le reçu PDF"}
                      >
                        {downloadingId === transaction.id ? "…" : "Reçu"}
                      </Button>
                    )}
                    {!receiptReady && transaction.legacy && (
                      <span className="billing-cell-sub">Sans reçu</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const isReady = (transaction: PaymentTransaction) =>
  normalizePaymentStatus(transaction.status) === "succeeded" && Boolean(transaction.receiptAvailable);

const methodIcon = (method?: string | null): "card" | "wallet" | "bank" | "file" => {
  switch ((method || "").toLowerCase()) {
    case "metamask":
    case "metamask_sepolia":
    case "sepolia":
    case "wallet":
    case "wallet_simulated":
      return "wallet";
    case "bank_transfer":
    case "bank_transfer_simulated":
      return "bank";
    case "other":
    case "cash":
    case "cash_simulated":
      return "file";
    default:
      return "card";
  }
};

type StatusFilter = "all" | "succeeded" | "failed" | "pending" | "cancelled";

export function PaymentsPanel({
  role,
  transactions,
  invoices,
  loading,
  error,
  onOpen,
  onDownload,
  downloadingId,
}: {
  role: Role;
  transactions: PaymentTransaction[];
  invoices: Invoice[];
  loading: boolean;
  error?: string;
  onOpen: (transaction: PaymentTransaction) => void;
  onDownload: (transaction: PaymentTransaction) => void;
  downloadingId?: string | null;
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const summary = useMemo(() => paymentSummary(transactions), [transactions]);
  const pending = summary.pendingCount;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((transaction) => {
      const status = normalizePaymentStatus(transaction.status);
      if (filter === "succeeded" && status !== "succeeded") return false;
      if (filter === "failed" && status !== "failed") return false;
      if (filter === "cancelled" && status !== "cancelled") return false;
      if (filter === "pending" && !["pending", "processing"].includes(status)) return false;
      if (!query) return true;
      return [
        transaction.reference,
        transaction.invoiceNumber,
        transaction.clientName,
        transaction.freelancerName,
        transaction.projectTitle,
        paymentMethodLabel(transaction.method),
        transaction.receiptNumber || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [transactions, filter, search]);

  const filters: { key: StatusFilter; label: string }[] = [
    { key: "all", label: `Toutes (${summary.count})` },
    { key: "succeeded", label: `Réussies (${summary.succeededCount})` },
    { key: "pending", label: `En attente (${pending})` },
    { key: "failed", label: `Échouées (${summary.failedCount})` },
    { key: "cancelled", label: "Annulées" },
  ];

  return (
    <div className="billing-payments-panel">
      <div className="billing-payment-summary">
        <div className="billing-payment-kpi">
          <span>{role === "client" ? "Total réglé" : "Total reçu"}</span>
          <b>{formatTND(summary.totalReceived)}</b>
          <small>{summary.succeededCount} transaction{summary.succeededCount === 1 ? "" : "s"} réussie{summary.succeededCount === 1 ? "" : "s"}</small>
        </div>
        <div className="billing-payment-kpi">
          <span>En attente</span>
          <b>{pending}</b>
          <small>Suivi du traitement</small>
        </div>
        <div className="billing-payment-kpi">
          <span>Échecs / annulations</span>
          <b>{summary.failedCount}</b>
          <small>Aucun montant prélevé</small>
        </div>
      </div>

      <div className="billing-toolbar billing-payments-toolbar">
        <div className="module-tabs billing-filters" role="group" aria-label="Filtrer les paiements">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              className={filter === item.key ? "active" : ""}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="table-search billing-search">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Référence, facture, projet"
            aria-label="Rechercher une transaction"
          />
        </div>
      </div>

      {loading ? (
        <BillingSkeleton rows={4} />
      ) : error ? (
        <p className="form-error" role="alert">{error}</p>
      ) : (
        <PaymentHistoryTable
          transactions={filtered}
          invoices={invoices}
          role={role}
          onView={onOpen}
          onDownload={onDownload}
          downloadingId={downloadingId}
          emptyLabel="Aucune transaction pour ce filtre."
        />
      )}
    </div>
  );
}

export function BillingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="billing-skeleton" role="status" aria-label="Chargement">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="billing-skeleton-row" key={index}>
          <span className="billing-skeleton-cell is-wide" />
          <span className="billing-skeleton-cell" />
          <span className="billing-skeleton-cell is-short" />
        </div>
      ))}
    </div>
  );
}

export function PaymentDetailPanel({
  transaction,
  invoices,
  role,
  onDownload,
  downloadingId,
  onRetry,
  onCancel,
  busy,
}: {
  transaction: PaymentTransaction;
  invoices: Invoice[];
  role: Role;
  onDownload: (transaction: PaymentTransaction) => void;
  downloadingId?: string | null;
  onRetry?: (transaction: PaymentTransaction) => void;
  onCancel?: (transaction: PaymentTransaction) => void;
  busy?: boolean;
}) {
  const invoice = invoiceForTransaction(transaction, invoices);
  const status = normalizePaymentStatus(transaction.status);
  const isBlockchain = transaction.provider === "blockchain";
  // Un paiement blockchain ne peut être ni relancé ni annulé localement : seul
  // l'état on-chain fait foi.
  const canRetry = role === "client" && !isBlockchain && (status === "failed" || status === "cancelled") && Boolean(onRetry);
  const canCancel = role === "client" && !isBlockchain && status === "pending" && Boolean(onCancel);
  const receiptReady = isReady(transaction);

  return (
    <div className="billing-payment-detail">
      <div className="billing-detail-meta">
        <div><span>Référence</span><b><code>{transaction.reference || "—"}</code></b></div>
        <div><span>Statut</span><b><PaymentStatusBadge status={transaction.status} legacy={transaction.legacy} /></b></div>
        <div><span>Montant</span><b>{formatTND(transaction.amount)}</b></div>
        <div><span>Moyen de paiement</span><b>{paymentMethodLabel(transaction.method)}</b></div>
        <div><span>Facture</span><b>{transaction.invoiceNumber || invoice?.number || "—"}</b></div>
        <div><span>Projet</span><b>{transaction.projectTitle || invoice?.project || "—"}</b></div>
        <div><span>Client</span><b>{transaction.clientName || invoice?.client || "—"}</b></div>
        {role === "freelancer" && <div><span>Freelancer</span><b>{transaction.freelancerName || "—"}</b></div>}
        <div><span>Date</span><b>{formatDate(transaction.completedAt || transaction.createdAt)}</b></div>
        <div><span>Solde avant</span><b>{formatTND(transaction.balanceBefore)}</b></div>
        <div><span>Solde restant après</span><b>{transaction.balanceAfter == null ? "—" : formatTND(transaction.balanceAfter)}</b></div>
        <div><span>N° de reçu</span><b>{transaction.receiptNumber || "—"}</b></div>
        {transaction.provider === "blockchain" && (
          <>
            {transaction.blockchainAmountEth != null && (
              <div><span>Montant en ETH</span><b>{Number(transaction.blockchainAmountEth)} ETH</b></div>
            )}
            <div><span>Confirmations</span><b>{transaction.blockchainConfirmations ?? 0}</b></div>
          </>
        )}
        {invoice && <div><span>Solde actuel de la facture</span><b>{formatTND(invoiceBalance(invoice))}</b></div>}
      </div>

      {transaction.note && (
        <p className="billing-note"><Icon name="file" size={14} /> {transaction.note}</p>
      )}

      {transaction.errorMessage && (
        <div className={`billing-alert ${status === "failed" ? "is-danger" : "is-warning"}`}>
          <Icon name={status === "failed" ? "close" : "clock"} size={15} />
          <div>
            <b>{status === "failed" ? "Paiement non abouti" : "Transaction annulée"}</b>
            <p>{publicPaymentMessage(transaction.errorMessage)}</p>
            <span>Le solde de la facture n'a pas été modifié.</span>
          </div>
        </div>
      )}

      {transaction.attempts.length > 0 && (
        <div className="billing-history-block">
          <h3>Historique des tentatives</h3>
          <ol className="payment-attempts">
            {transaction.attempts.map((attempt) => (
              <li key={attempt.attemptNumber} className="payment-attempt">
                <div className="payment-attempt-head">
                  <b>Tentative {attempt.attemptNumber}</b>
                  <PaymentStatusBadge status={attempt.status} />
                </div>
                <span>{formatDate(attempt.startedAt)}</span>
                {attempt.errorMessage && <p>{publicPaymentMessage(attempt.errorMessage)}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="billing-modal-actions">
        {canCancel && <Button variant="secondary" icon="close" onClick={() => onCancel!(transaction)} disabled={busy}>Annuler la transaction</Button>}
        {canRetry && <Button icon="arrow" onClick={() => onRetry!(transaction)} disabled={busy}>{busy ? "Traitement…" : "Relancer le paiement"}</Button>}
        {receiptReady && (
          <Button icon="download" onClick={() => onDownload(transaction)} disabled={downloadingId === transaction.id}>
            {downloadingId === transaction.id ? "Préparation…" : "Télécharger le reçu PDF"}
          </Button>
        )}
      </div>
      {!receiptReady && transaction.legacy && (
        <p className="billing-cell-sub">Ce paiement historique a été enregistré avant la génération automatique des reçus : aucun PDF n'est disponible.</p>
      )}
    </div>
  );
}
