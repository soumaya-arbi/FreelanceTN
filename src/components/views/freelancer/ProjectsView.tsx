"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { AppShell } from "@/components/layout/AppShell";
import { useMarketplace } from "@/context/MarketplaceContext";
import { ApiError } from "@/lib/api";
import { invitationsApi, projectsApi } from "@/lib/api";
import { freelancerClientProfilePath } from "@/lib/navigation";
import { PROPOSAL_STATUSES, type Page, type ProposalStatus } from "@/lib/types";

function statusClass(status: string) {
  return status === "Client review" ? "reviewing" : status === "Completed" ? "done" : "";
}

// Libellé lisible côté freelance : le statut API reste inchangé.
function statusLabel(status: string) {
  if (status === "Client review") return "Awaiting client approval";
  if (status === "In progress") return "In progress";
  return status || "Open";
}

function formatBudget(p: { budget: string; budgetMin?: number | null; budgetMax?: number | null; type: string }) {
  if (p.budgetMin != null && p.budgetMax != null) {
    const unit = p.type === "Hourly" ? "TND/hr" : "TND";
    return `${p.budgetMin} – ${p.budgetMax} ${unit}`;
  }
  return p.budget || "—";
}

function projectDuration(p: { durationValue?: number | null; durationUnit?: string | null }) {
  return p.durationValue && p.durationUnit ? `${p.durationValue} ${p.durationUnit}` : "—";
}

// Rendu de l'état d'une candidature, en réutilisant la couleur de statut
// existante des lignes de tableau.
function proposalClass(status: ProposalStatus) {
  return status === "Accepted"
    ? "done"
    : status === "Refused"
      ? "reviewing"
      : status === "Cancelled"
        ? "cancelled"
        : "";
}

function ProjectsView({ go, notify }: { go: (p: Page) => void; notify: (x: string) => void }) {
  // Les projets approuvés par un client, le catalogue public des opportunités
  // et les candidatures du freelance proviennent tous de l'API (MongoDB). Un
  // freelance ne crée pas de projet : la publication revient au client.
  const {
    catalogProjects,
    catalogLoading,
    catalogError,
    assignedProjects,
    assignedLoading,
    assignedError,
    myProposals,
    myProposalsLoading,
    myProposalsError,
    withdrawProposal,
    catalogSearch,
    setCatalogSearch,
    refreshCatalog,
    submitProjectForReview,
  } = useMarketplace();
  const router = useRouter();
  const [tab, setTab] = useState<"find" | "proposals" | "active" | "pending" | "completed" | "invitations">("find");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [busyId, setBusyId] = useState("");
  const [submittingId, setSubmittingId] = useState("");
  const [invitations, setInvitations] = useState<any[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [declineTarget, setDeclineTarget] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineMessage, setDeclineMessage] = useState("");
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const catalogRefreshedOnView = useRef(false);

  useEffect(() => {
    if (catalogRefreshedOnView.current) return;
    catalogRefreshedOnView.current = true;
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .catalogCategories()
      .then((rows) => {
        if (!cancelled) setCatalogCategories(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setCatalogCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== "invitations") return;
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) setInvitationsLoading(true); }, 0);
    invitationsApi.mine()
      .then((rows: any) => { if (!cancelled) setInvitations(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setInvitations([]); })
      .finally(() => { if (!cancelled) { setInvitationsLoading(false); } });
    return () => { cancelled = true; clearTimeout(t); };
  }, [tab]);

  const activeProjects = useMemo(() => assignedProjects.filter((p) => p.status === "In progress"), [assignedProjects]);
  const pendingProjects = useMemo(() => assignedProjects.filter((p) => p.status === "Client review"), [assignedProjects]);
  const completedProjects = useMemo(() => assignedProjects.filter((p) => p.status === "Completed"), [assignedProjects]);

  // Le catalogue est déjà filtré côté serveur (q, catégorie, type, budget,
  // durée). Les autres onglets sont filtrés localement sur leur recherche.
  const filtered = useMemo(() => {
    if (tab === "find") return catalogProjects;
    const list = tab === "active" ? activeProjects : tab === "pending" ? pendingProjects : tab === "completed" ? completedProjects : [];
    const query = search.trim().toLowerCase();
    return list.filter((project) => {
      if (!query) return true;
      return `${project.title} ${project.description} ${project.client} ${project.skills.join(" ")}`.toLowerCase().includes(query);
    });
  }, [activeProjects, pendingProjects, completedProjects, catalogProjects, search, tab]);

  const filteredProposals = useMemo(() => {
    const query = search.trim().toLowerCase();
    return myProposals.filter((item) => {
      const matchesStatus = status === "All statuses" || item.status === status;
      const matchesQuery =
        !query ||
        `${item.projectTitle} ${item.freelancerName} ${item.coverLetter} ${item.price}`.toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [myProposals, search, status]);

  // La recherche de l'onglet Invitations filtre réellement les invitations
  // reçues (projet, client, message, statut).
  const filteredInvitations = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return invitations;
    return invitations.filter((inv) =>
      `${inv.projectTitle ?? ""} ${inv.clientName ?? ""} ${inv.message ?? ""} ${inv.status ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [invitations, search]);

  // Les catégories restent disponibles même après filtrage du catalogue :
  // sinon, choisir une catégorie ferait disparaître les autres options.
  const categoryOptions = useMemo(() => {
    const values = new Set<string>(catalogCategories);
    catalogProjects.forEach((project) => { if (project.category) values.add(project.category); });
    if (catalogSearch.category) values.add(catalogSearch.category);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [catalogCategories, catalogProjects, catalogSearch.category]);

  const searchValue = tab === "find" ? (catalogSearch.q ?? "") : search;
  const hasFilters = Boolean(
    catalogSearch.q?.trim() || catalogSearch.category || catalogSearch.type ||
    catalogSearch.minBudget != null || catalogSearch.maxBudget != null ||
    catalogSearch.durationValue != null || catalogSearch.durationUnit,
  );

  const changeSearch = (value: string) => {
    if (tab === "find") setCatalogSearch({ q: value });
    else setSearch(value);
  };

  const resetFilters = () => {
    setSearch("");
    setCatalogSearch({ q: "", category: "", type: "", minBudget: undefined, maxBudget: undefined, durationValue: undefined, durationUnit: "" });
  };

  const loading = tab === "proposals" ? myProposalsLoading : tab === "find" ? catalogLoading : tab === "invitations" ? false : assignedLoading;
  const error = tab === "proposals" ? myProposalsError : tab === "find" ? catalogError : tab === "invitations" ? "" : assignedError;

  const withdraw = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await withdrawProposal(id);
      notify("Proposal withdrawn");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "The proposal could not be withdrawn.");
    } finally {
      setBusyId("");
    }
  };

  const emptyMessage =
    tab === "find"
      ? "No open project matches your search. Published opportunities appear here as soon as clients post them."
      : tab === "active"
        ? "No active project yet. Accepted projects appear here once a client approves your proposal."
        : tab === "pending"
          ? "No project is awaiting client approval right now."
          : "No completed project yet.";

  return <AppShell page="orders" go={go} notify={notify}><main className="workspace projects-page"><div className="workspace-title"><div><p>WORKSPACE</p><h1>Projects &amp; Contracts</h1><span>Track the projects clients approved for you, browse open opportunities and follow your proposals.</span></div><Button onClick={() => go("find-work")} icon="search" variant="secondary">Find open work</Button></div>
    <div className="table-card projects-panel">
      <div className="module-tabs"><button className={tab === "find" ? "active" : ""} onClick={() => { setTab("find"); setStatus("All statuses"); }}>Find Projects</button><button className={tab === "proposals" ? "active" : ""} onClick={() => { setTab("proposals"); setStatus("All statuses"); }}>My Proposals</button><button className={tab === "active" ? "active" : ""} onClick={() => { setTab("active"); setStatus("All statuses"); }}>Active Projects</button><button className={tab === "pending" ? "active" : ""} onClick={() => { setTab("pending"); setStatus("All statuses"); }}>Pending Approval</button><button className={tab === "invitations" ? "active" : ""} onClick={() => { setTab("invitations"); setStatus("All statuses"); }}>Project Invitations</button><button className={tab === "completed" ? "active" : ""} onClick={() => { setTab("completed"); setStatus("All statuses"); }}>Completed</button></div>

      <div className="table-toolbar projects-toolbar">
        <div className="projects-search">
          <Icon name="search" size={15} />
          <input value={searchValue} onChange={(e) => changeSearch(e.target.value)} placeholder={tab === "proposals" ? "Search proposals" : tab === "invitations" ? "Search invitations" : "Search projects"} aria-label="Search projects" />
          {searchValue && <button className="projects-search-clear" onClick={() => changeSearch("")} aria-label="Clear search"><Icon name="close" size={13} /></button>}
        </div>
        {tab === "find" && (
          <div className="projects-filters">
            <select aria-label="Filter by category" value={catalogSearch.category ?? ""} onChange={(e) => setCatalogSearch({ category: e.target.value })}>
              <option value="">All categories</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select aria-label="Filter by type" value={catalogSearch.type ?? ""} onChange={(e) => setCatalogSearch({ type: e.target.value })}>
              <option value="">All types</option>
              <option value="Fixed price">Fixed price</option>
              <option value="Hourly">Hourly</option>
            </select>
            <input type="number" min="0" aria-label="Minimum budget" placeholder="Min budget" value={catalogSearch.minBudget ?? ""} onChange={(e) => setCatalogSearch({ minBudget: e.target.value ? Number(e.target.value) : undefined })} />
            <input type="number" min="0" aria-label="Maximum budget" placeholder="Max budget" value={catalogSearch.maxBudget ?? ""} onChange={(e) => setCatalogSearch({ maxBudget: e.target.value ? Number(e.target.value) : undefined })} />
            <input type="number" min="0" aria-label="Duration value" placeholder="Max duration" value={catalogSearch.durationValue ?? ""} onChange={(e) => setCatalogSearch({ durationValue: e.target.value ? Number(e.target.value) : undefined })} />
            <select aria-label="Filter by duration unit" value={catalogSearch.durationUnit ?? ""} onChange={(e) => setCatalogSearch({ durationUnit: e.target.value })}>
              <option value="">Any unit</option>
              <option value="Days">Days</option>
              <option value="Weeks">Weeks</option>
              <option value="Months">Months</option>
            </select>
            <button className="projects-filter-reset" onClick={resetFilters} disabled={!hasFilters}>Reset</button>
          </div>
        )}
        {tab === "proposals" && (
          <select className="projects-status-filter" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>All statuses</option>
            {PROPOSAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>

      {loading && <p className="task-empty projects-empty-state">{tab === "proposals" ? "Loading your proposals…" : "Loading your projects…"}</p>}
      {!loading && error && <p className="task-empty projects-empty-state">{error}</p>}

      {!loading && !error && tab === "proposals" && filteredProposals.length === 0 && <p className="task-empty projects-empty-state">No proposal matches your search. You can apply to any open project from the catalogue.</p>}
      {!loading && !error && tab === "proposals" && filteredProposals.map((p, i) => <div className="table-row proposal-row" key={p.id}><span className={`order-logo o${i % 3}`}>{p.projectTitle.charAt(0) || "P"}</span><span className="proposal-body"><b>{p.projectTitle}</b><small>Submitted {p.updatedAt.slice(0, 10)} · {p.delivery}</small><p>{p.coverLetter.length > 220 ? `${p.coverLetter.slice(0, 220)}…` : p.coverLetter}</p></span><span className="proposal-price">{p.price}</span><em className={proposalClass(p.status)}>{p.status}</em><span className="row-actions">{p.status === "Pending" && <Button variant="secondary" disabled={busyId === p.id} onClick={() => withdraw(p.id)}>{busyId === p.id ? "Withdrawing…" : "Withdraw"}</Button>}<button onClick={() => router.push(`/projects/${p.projectId}`)} aria-label="Open project"><Icon name="chevron" size={15} /></button></span></div>)}

      {!loading && !error && tab === "find" && filtered.length === 0 && <p className="task-empty projects-empty-state">{emptyMessage}</p>}
      {!loading && !error && tab === "find" && filtered.map((p, i) => <div className="table-row project-find-row" key={p.id}><span className={`order-logo o${i % 3}`}>{p.client.charAt(0) || "P"}</span><span><b>{p.title}</b><small>{p.client} · {p.type}{p.durationValue && p.durationUnit ? ` · ${p.durationValue} ${p.durationUnit}` : ""}</small></span><strong>{formatBudget(p)}</strong><em className={statusClass(p.status)}>{p.status}</em><span className="row-actions"><button onClick={() => router.push(`/projects/${p.id}`)} aria-label="Open project"><Icon name="chevron" size={15} /></button></span></div>)}

      {!loading && !error && (tab === "active" || tab === "pending" || tab === "completed") && (
        <div className="projects-table">
          <div className="projects-table-head" aria-hidden="true">
            <span>Project</span>
            <span>Client</span>
            <span>Budget</span>
            <span>{tab === "pending" ? "Submitted" : "Duration"}</span>
            <span>Status</span>
            <span />
          </div>
          {filtered.length === 0 && <p className="task-empty projects-empty-state">{emptyMessage}</p>}
          {filtered.map((p, i) => (
            <div className="projects-table-row" key={p.id}>
              <div className="projects-cell-project">
                <span className={`order-logo o${i % 3}`}>{p.client.charAt(0) || "P"}</span>
                <span><b>{p.title}</b><small>{p.type || "Project"}{p.proposals > 0 ? ` · ${p.proposals} proposal${p.proposals === 1 ? "" : "s"}` : ""}</small></span>
              </div>
              <span className="projects-cell muted">{p.client || "—"}</span>
              <strong className="projects-cell budget">{formatBudget(p)}</strong>
              <span className="projects-cell muted">{tab === "pending" ? (p.updatedAt ? p.updatedAt.slice(0, 10) : "—") : projectDuration(p)}</span>
              <em className={`projects-status ${statusClass(p.status)}`}>{statusLabel(p.status)}</em>
              <span className="projects-row-actions">
                {tab === "active" && (
                  <Button variant="secondary" disabled={submittingId === p.id} onClick={async () => {
                    setSubmittingId(p.id);
                    try {
                      await submitProjectForReview(p.id);
                      notify("Submitted for client approval");
                    } catch (err) {
                      notify(err instanceof ApiError ? err.message : "Could not submit.");
                    } finally {
                      setSubmittingId("");
                    }
                  }}>{submittingId === p.id ? "Submitting…" : "Submit for approval"}</Button>
                )}
                <button onClick={() => router.push(`/projects/${p.id}`)} aria-label="Open project"><Icon name="chevron" size={15} /></button>
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && tab === "invitations" && invitationsLoading && <p className="task-empty projects-empty-state">Loading invitations…</p>}
      {!loading && !error && tab === "invitations" && !invitationsLoading && invitations.length === 0 && <p className="task-empty projects-empty-state">No project invitation received yet.</p>}
      {!loading && !error && tab === "invitations" && !invitationsLoading && invitations.length > 0 && filteredInvitations.length === 0 && <p className="task-empty projects-empty-state">No invitation matches your search.</p>}
      {!loading && !error && tab === "invitations" && !invitationsLoading && filteredInvitations.length > 0 && (
        <div className="projects-invitations">
          {filteredInvitations.map((inv: any) => (
            <article className={`invitation-card invitation-card--project${inv.status ? ` is-${String(inv.status).toLowerCase()}` : ""}`} key={inv.id}>
              <span className="invitation-mark avatar" aria-hidden="true">{(String(inv.clientName || "C").charAt(0) || "C").toUpperCase()}</span>
              <div className="invitation-body">
                <div className="invitation-heading"><h3>{inv.projectTitle}</h3></div>
                <div className="invitation-meta">
                  <span>
                    <Icon name="users" size={13} />
                    <button
                      type="button"
                      className="invitation-client-link"
                      onClick={() => router.push(freelancerClientProfilePath(inv.clientId))}
                      aria-label={`View ${inv.clientName || "client"} public profile`}
                    >
                      {inv.clientName || "Client"}
                    </button>
                  </span>
                  <span><Icon name="wallet" size={13} /> {inv.offeredPrice || "No price"}</span>
                  {inv.offeredDelivery && <span><Icon name="clock" size={13} /> {inv.offeredDelivery}</span>}
                  <span>Received {String(inv.createdAt).slice(0, 10)}</span>
                </div>
                {inv.message && <p className="invitation-message">{inv.message}</p>}
                {inv.declineReason && <small className="invitation-decline">Decline reason: {inv.declineReason}</small>}
              </div>
              <div className="invitation-side">
                <span className={`proposal-pill ${String(inv.status || "").toLowerCase()}`}>{inv.status}</span>
                <div className="invitation-actions">
                  {inv.status === "Pending" && <>
                    <Button disabled={busyId === inv.id} onClick={async () => { setBusyId(inv.id); try { await invitationsApi.accept(inv.id); notify("Invitation accepted"); setInvitations((prev) => prev.map((x) => x.id === inv.id ? { ...x, status: "Accepted" } : x)); } catch (err) { notify(err instanceof ApiError ? err.message : "Could not accept."); } finally { setBusyId(""); } }}>Accept</Button>
                    <Button variant="secondary" disabled={busyId === inv.id} onClick={() => { setDeclineTarget(inv.id); setDeclineReason(""); setDeclineMessage(""); }}>Decline</Button>
                  </>}
                  <button className="invitation-open" onClick={() => router.push(freelancerClientProfilePath(inv.clientId))} aria-label="View client profile"><Icon name="chevron" size={15} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {declineTarget && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={() => setDeclineTarget(null)}>
          <div style={{background:"#fff",padding:24,borderRadius:8,maxWidth:480,width:"90%"}} onClick={(e) => e.stopPropagation()}>
            <h3>Decline invitation</h3>
            <p>Choose a predefined response or write your own.</p>
            <select value={declineReason} onChange={(e) => { setDeclineReason(e.target.value); if (e.target.value !== "custom") setDeclineMessage(e.target.value); }} style={{width:"100%",marginBottom:8}}>
              <option value="">Select a response</option>
              <option value="Thank you for the opportunity, but I'm currently unavailable.">Unavailable</option>
              <option value="Thank you for considering me, but this project doesn't match my current availability.">Not matching availability</option>
              <option value="I appreciate your invitation, but I must decline at this time.">Decline at this time</option>
              <option value="custom">Custom message</option>
            </select>
            <textarea value={declineMessage} onChange={(e) => setDeclineMessage(e.target.value)} rows={4} style={{width:"100%"}} placeholder="Optional message" />
            <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
              <Button variant="secondary" onClick={() => setDeclineTarget(null)}>Cancel</Button>
              <Button onClick={async () => {
                const id = declineTarget!;
                setBusyId(id);
                try {
                  await invitationsApi.decline(id, declineMessage || declineReason || undefined);
                  notify("Invitation declined");
                  setInvitations((prev) => prev.map((x) => x.id === id ? { ...x, status: "Declined", declineReason: declineMessage || declineReason } : x));
                  setDeclineTarget(null);
                } catch (err) { notify(err instanceof ApiError ? err.message : "Could not decline."); }
                finally { setBusyId(""); }
              }}>Confirm decline</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  </main></AppShell>;
}

export { ProjectsView };
