"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleShell } from "@/components/modules/ModuleShell";
import { useMarketplace } from "@/context/MarketplaceContext";
import { documentTotals, formatTND, invoiceBalance, invoiceStatusLabel, quoteStatusLabel } from "@/lib/documents";
import type { Role } from "@/lib/types";

const quoteTabs = ["All", "Draft", "Sent", "Accepted", "Refused", "Expired"];
const invoiceTabs = ["All", "Draft", "Sent", "Unpaid", "Partially paid", "Paid", "Overdue"];

const statusClass = (status: string) => `doc-status ${status}`;

function DocumentStateNotice({ loading, error, noun }: { loading: boolean; error: string; noun: string }) {
  if (loading) return <p className="task-empty" role="status">Loading {noun}…</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  return null;
}

function Summary({ cards }: { cards: [string, string][] }) {
  const icons = ["file", "wallet", "check", "clock"];
  return (
    <div className="module-summary">
      {cards.map(([value, label], index) => (
        <article key={label}>
          <span><Icon name={icons[index] as "file" | "wallet" | "check" | "clock"} /></span>
          <b>{value}</b>
          <small>{label}</small>
        </article>
      ))}
    </div>
  );
}

export function QuotesView({ role }: { role: Role }) {
  const router = useRouter();
  const { quotes, projects, assignedProjects, documentsLoading, documentsError } = useMarketplace();
  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("Newest first");

  const projectName = useCallback(
    (id: string) =>
      projects.find((project) => project.id === id)?.title ??
      assignedProjects.find((project) => project.id === id)?.title ??
      "Project",
    [assignedProjects, projects],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (tab !== "All" && quoteStatusLabel(quote) !== tab) return false;
      if (!term) return true;
      return quote.number.toLowerCase().includes(term) || quote.client.toLowerCase().includes(term) || projectName(quote.project).toLowerCase().includes(term);
    });
  }, [quotes, tab, search, projectName]);

  const sorted = useMemo(() => {
    if (sort === "Highest value") return [...filtered].sort((a, b) => documentTotals(b.lines).total - documentTotals(a.lines).total);
    return filtered;
  }, [filtered, sort]);

  const pipeline = quotes.filter((quote) => quote.status === "sent").reduce((sum, quote) => sum + documentTotals(quote.lines).total, 0);
  const accepted = quotes.filter((quote) => quote.status === "accepted").reduce((sum, quote) => sum + documentTotals(quote.lines).total, 0);

  const base = role === "client" ? "/client/quotes" : "/freelancer/quotes";

  return (
    <ModuleShell role={role} page="quotes">
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>{role === "client" ? "CLIENT WORKSPACE" : "FREELANCER WORKSPACE"}</p>
            <h1>Quotes</h1>
            <span>{role === "client" ? "Review pricing and approve scope before work begins." : "Send clear, itemized pricing and track every decision."}</span>
          </div>
          {role === "freelancer" && <Button icon="check" onClick={() => router.push("/freelancer/quotes/new")}>New quote</Button>}
        </div>

        <DocumentStateNotice loading={documentsLoading} error={documentsError} noun="quotes" />

        <Summary
          cards={[
            [`${quotes.length}`, "Total quotes"],
            [formatTND(pipeline), "Awaiting decision"],
            [formatTND(accepted), "Accepted value"],
            [`${quotes.filter((quote) => quote.status === "draft").length}`, "Drafts"],
          ]}
        />

        <div className="dash-card module-table">
          <div className="module-tabs">
            {quoteTabs.map((item) => (
              <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
            ))}
          </div>
          <div className="table-toolbar">
            <div className="conversation-search">
              <Icon name="search" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quotes" />
            </div>
            <select aria-label="Sort quotes" value={sort} onChange={(event) => setSort(event.target.value)}><option>Newest first</option><option>Highest value</option></select>
          </div>
          {sorted.length === 0 && <p className="task-empty">No quotes match this view.</p>}
          {sorted.map((quote) => (
            <button className="module-table-row doc-row" onClick={() => router.push(`${base}/${quote.id}`)} key={quote.id}>
              <span className="project-symbol p0"><Icon name="file" /></span>
              <span>
                <b>{quote.number} · {projectName(quote.project)}</b>
                <small>{quote.client} · Issued {quote.issueDate} · Valid until {quote.validUntil}</small>
              </span>
              <strong>{formatTND(documentTotals(quote.lines).total)}</strong>
              <em><span className={statusClass(quote.status)}>{quoteStatusLabel(quote)}</span></em>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      </main>
    </ModuleShell>
  );
}

export function InvoicesView({ role }: { role: Role }) {
  const router = useRouter();
  const { invoices, projects, assignedProjects, documentsLoading, documentsError } = useMarketplace();
  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("Newest first");

  const projectName = useCallback(
    (id: string) =>
      projects.find((project) => project.id === id)?.title ??
      assignedProjects.find((project) => project.id === id)?.title ??
      "Project",
    [assignedProjects, projects],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (tab !== "All" && invoiceStatusLabel(invoice) !== tab) return false;
      if (!term) return true;
      return invoice.number.toLowerCase().includes(term) || invoice.client.toLowerCase().includes(term) || projectName(invoice.project).toLowerCase().includes(term);
    });
  }, [invoices, tab, search, projectName]);

  const sorted = useMemo(() => {
    if (sort === "Highest value") return [...filtered].sort((a, b) => documentTotals(b.lines).total - documentTotals(a.lines).total);
    return filtered;
  }, [filtered, sort]);

  const outstanding = invoices.reduce(
    (sum, invoice) => sum + (invoice.status === "paid" ? 0 : invoiceBalance(invoice)),
    0,
  );
  const collected = invoices.reduce((sum, invoice) => {
    const paid = invoice.amountPaid ?? (invoice.status === "paid" ? documentTotals(invoice.lines).total : 0);
    return sum + paid;
  }, 0);

  const base = role === "client" ? "/client/invoices" : "/freelancer/invoices";

  return (
    <ModuleShell role={role} page="invoices">
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>{role === "client" ? "CLIENT WORKSPACE" : "FREELANCER WORKSPACE"}</p>
            <h1>Invoices</h1>
            <span>{role === "client" ? "Track amounts due and keep every payment documented." : "Bill completed work and follow every payment to settled."}</span>
          </div>
          {role === "freelancer" && <Button icon="check" onClick={() => router.push("/freelancer/invoices/new")}>New invoice</Button>}
        </div>

        <DocumentStateNotice loading={documentsLoading} error={documentsError} noun="invoices" />

        <Summary
          cards={[
            [`${invoices.length}`, "Total invoices"],
            [formatTND(outstanding), "Outstanding"],
            [formatTND(collected), "Collected"],
            [`${invoices.filter((invoice) => invoice.status === "overdue").length}`, "Overdue"],
          ]}
        />

        <div className="dash-card module-table">
          <div className="module-tabs">
            {invoiceTabs.map((item) => (
              <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>
            ))}
          </div>
          <div className="table-toolbar">
            <div className="conversation-search">
              <Icon name="search" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoices" />
            </div>
            <select aria-label="Sort invoices" value={sort} onChange={(event) => setSort(event.target.value)}><option>Newest first</option><option>Highest value</option></select>
          </div>
          {sorted.length === 0 && <p className="task-empty">No invoices match this view.</p>}
          {sorted.map((invoice) => (
            <button className="module-table-row doc-row" onClick={() => router.push(`${base}/${invoice.id}`)} key={invoice.id}>
              <span className="project-symbol p1"><Icon name="wallet" /></span>
              <span>
                <b>{invoice.number} · {projectName(invoice.project)}</b>
                <small>
                  {invoice.client} · Issued {invoice.issueDate} · Due {invoice.dueDate}
                  {(invoice.amountPaid ?? 0) > 0 && invoice.status !== "paid" ? ` · Paid ${formatTND(invoice.amountPaid ?? 0)}` : ""}
                </small>
              </span>
              <strong>{formatTND(documentTotals(invoice.lines).total)}</strong>
              <em><span className={statusClass(invoice.status)}>{invoiceStatusLabel(invoice)}</span></em>
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      </main>
    </ModuleShell>
  );
}
