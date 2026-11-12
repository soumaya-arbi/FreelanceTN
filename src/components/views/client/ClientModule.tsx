"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleTable } from "@/components/ui/ModuleTable";
import { SupportContent } from "@/components/ui/SupportContent";
import { ClientShell } from "@/components/layout/ClientShell";
import type { Page, ClientProcessMode, Proposal } from "@/lib/types";
import { moduleInfo } from "@/lib/navigation";
import { ApiError, invitationsApi, proposalsApi } from "@/lib/api";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { AccountSettings } from "@/components/views/account/AccountSettings";

// Filtres des propositions reçues, alignés sur les statuts gérés par l'API.
const RECEIVED_TABS = ["All", "Pending", "Accepted", "Refused", "Cancelled"];

// Libellés explicites pour rendre l'état d'une candidature.
const RECEIVED_STATE: Record<string, string> = {
  Pending: "Awaiting your decision",
  Accepted: "Accepted",
  Refused: "Declined",
  Withdrawn: "Withdrawn",
  Cancelled: "Acceptance cancelled",
};

function ClientModule({ page, go, notify, openProcess }: { page: Page; go:(p:Page)=>void; notify:(x:string)=>void; openProcess:(mode:ClientProcessMode)=>void }) {
  const router = useRouter();
  const {
    projects,
    projectsLoading,
    projectsError,
    receivedProposals,
    receivedProposalsLoading,
    receivedProposalsError,
    reviewProposal,
    refreshProjects,
  } = useMarketplace();
  const { role, status } = useUser();
  const [tab,setTab]=useState("All");
  const [busyId, setBusyId] = useState("");
  const [invitations, setInvitations] = useState<any[]>([]);
  useEffect(() => {
    if (status !== "authenticated" || role !== "client") return;
    let cancelled = false;
    invitationsApi.sent().then((rows: any) => { if (!cancelled) setInvitations(Array.isArray(rows) ? rows : []); }).catch(() => { if (!cancelled) setInvitations([]); });
    return () => { cancelled = true; };
  }, [status, role]);
  // À l'ouverture de l'espace projets, les statuts sont relus depuis l'API :
  // une livraison soumise par un freelance (« Client review ») apparaît ainsi
  // dans « Pending approval » sans rechargement manuel de la page.
  useEffect(() => {
    if (page !== "client-projects" || status !== "authenticated" || role !== "client") return;
    void refreshProjects();
  }, [page, refreshProjects, role, status]);
  // Vue filtrée par projet : le `projectId` est transmis à l'API, qui
  // restreint déjà la requête aux projets du client connecté.
  const [scopedProjectId, setScopedProjectId] = useState("");
  const [scopedProposals, setScopedProposals] = useState<Proposal[]>([]);
  const [scopedLoading, setScopedLoading] = useState(false);
  const [scopedError, setScopedError] = useState("");
  useEffect(() => {
    if (page !== "client-proposals") return;
    const requested = new URLSearchParams(window.location.search).get("project") ?? "";
    setScopedProjectId(requested);
    if (!requested) {
      setScopedProposals([]);
      setScopedLoading(false);
      setScopedError("");
      return;
    }
    if (status !== "authenticated" || role !== "client") return;
    let cancelled = false;
    setScopedLoading(true);
    setScopedError("");
    proposalsApi
      .received(requested)
      .then((rows) => {
        if (!cancelled) setScopedProposals(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setScopedError(error instanceof ApiError ? error.message : "Proposals could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setScopedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, role, status]);
  const titles:Partial<Record<Page,[string,string,string]>>={
    "client-projects":["My Projects","Create, manage, and track all of your hiring initiatives.","Post a project"],
    "client-proposals":["Proposals","Review the proposals professionals sent on your projects and hire the right fit.",""],
    "client-contracts":["Contracts","Manage agreements, milestones, deliveries, and completed work.","Open workspace"],
    payments:["Payments & Invoices","Manage billing methods, transactions, invoices, and project spending.","Add payment method"],
    settings:["Company Settings","Manage your company profile, billing details, team, security, and preferences.",""],
    support:["Help & Support","Find answers or continue a conversation with the FreelanceTN support team.","Contact support"],
  };
  const info=titles[page]||moduleInfo[page]||["Client workspace","Manage your account.","Create"];
  const formatBudget = (p: any) => (p.budgetMin != null && p.budgetMax != null) ? `${p.budgetMin} – ${p.budgetMax} ${p.type === "Hourly" ? "TND/hr" : "TND"}` : (p.budget || "—");
  const projectRows = projects
    .filter((p) => tab==="All" || (tab==="Drafts"&&p.status==="Draft") || (tab==="Open"&&p.status==="Open") || (tab==="In progress"&&p.status==="In progress") || (tab==="Pending approval"&&p.status==="Client review") || (tab==="Completed"&&p.status==="Completed"))
    .map((p) => [p.title, `${p.proposals} proposal${p.proposals === 1 ? "" : "s"}`, formatBudget(p), p.status === "Client review" ? "Awaiting your approval" : p.status, p.id, p.time]);

  // Compteurs calculés sur les données réelles du compte : le nombre de
  // propositions est celui retenu par le backend (candidatures actives), le
  // nombre de contrats actifs est celui des projets ayant un freelance approuvé.
  const totalProposals = projects.reduce((sum, p) => sum + (p.proposals || 0), 0);
  const activeContracts = projects.filter((p) => p.assignedTo).length;
  const completedProjects = projects.filter((p) => p.status === "Completed").length;

  // Propositions reçues, filtrées par l'onglet de statut actif. En vue
  // projet, seules les candidatures renvoyées par l'API pour ce projet sont
  // utilisées : le filtrage n'est pas seulement visuel.
  const scopedProject = scopedProjectId ? projects.find((project) => project.id === scopedProjectId) : undefined;
  const activeProposals = scopedProjectId ? scopedProposals : receivedProposals;
  const proposalsLoading = scopedProjectId ? scopedLoading : receivedProposalsLoading;
  const proposalsError = scopedProjectId ? scopedError : receivedProposalsError;
  const filteredProposals = useMemo(() => {
    if (tab === "All") return activeProposals;
    return activeProposals.filter((item) => item.status === tab);
  }, [activeProposals, tab]);

  // Décision du client : accepter (affecte le freelance au projet) ou refuser.
  const decide = async (id: string, status: "Accepted" | "Refused") => {
    if (busyId) return;
    setBusyId(id);
    try {
      const updated = await reviewProposal(id, status);
      if (scopedProjectId) {
        setScopedProposals((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
      notify(status === "Accepted"
        ? `${updated.freelancerName} has been approved on ${updated.projectTitle}`
        : "Proposal declined");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "The decision could not be saved.");
    } finally {
      setBusyId("");
    }
  };

  return <ClientShell page={page} go={go} notify={notify}><main className="workspace module-page"><div className="workspace-title"><div><p>CLIENT WORKSPACE</p><h1>{info[0]}</h1><span>{info[1]}</span></div>{page==="client-projects"&&<Button onClick={()=>go("client-post")}>Post a project</Button>}</div>
    {page==="client-projects"&&<><div className="module-summary"><article><span><Icon name="file"/></span><b>{String(projects.filter((p)=>p.status==="Open").length)}</b><small>Open projects</small></article><article><span><Icon name="users"/></span><b>{String(totalProposals)}</b><small>Total proposals</small></article><article><span><Icon name="briefcase"/></span><b>{String(activeContracts)}</b><small>Active contracts</small></article><article><span><Icon name="check"/></span><b>{String(completedProjects)}</b><small>Completed projects</small></article></div>{projectsLoading&&<p className="task-empty">Loading your projects…</p>}{!projectsLoading&&projectsError&&<p className="task-empty">{projectsError}</p>}{!projectsLoading&&!projectsError&&<ModuleTable tabs={["All","Drafts","Open","In progress","Pending approval","Completed","Cancelled"]} active={tab} setActive={setTab} notify={notify} rows={projectRows} onOpen={(row)=>{const match=projects.find((p)=>p.id===row[4]); if(match) router.push(`/client/projects/${match.id}`); else openProcess("project");}}/>}</>}{page==="client-projects"&&(
      <section className="dash-card proposals-by-project">
        <div className="card-heading">
          <div><h3>Proposals by project</h3><span>Review the professionals who applied to each of your projects.</span></div>
          <button onClick={()=>router.push("/client/proposals")}>View all proposals <Icon name="arrow" size={14}/></button>
        </div>
        {receivedProposalsLoading&&<p className="task-empty">Loading proposals…</p>}
        {!receivedProposalsLoading&&receivedProposalsError&&<p className="task-empty">{receivedProposalsError}</p>}
        {!receivedProposalsLoading&&!receivedProposalsError&&receivedProposals.length===0&&(
          <div className="empty-state"><span><Icon name="users" size={20}/></span><b>No proposal received yet</b><p>Proposals appear here as soon as professionals respond to one of your published projects.</p></div>
        )}
        {!receivedProposalsLoading&&!receivedProposalsError&&projects.map((proj)=>{
          const props=receivedProposals.filter((rp)=>rp.projectId===proj.id);
          if(props.length===0) return null;
          const pending=props.filter((p)=>p.status==="Pending").length;
          return (
            <article className="proposal-group" key={proj.id}>
              <header className="proposal-group-head">
                <div>
                  <span className="proposal-group-icon"><Icon name="briefcase" size={15}/></span>
                  <div><h4>{proj.title}</h4><small>{props.length} proposal{props.length===1?"":"s"}{pending>0?` · ${pending} awaiting your decision`:""}</small></div>
                </div>
                <button onClick={()=>router.push(`/client/proposals?project=${proj.id}`)}>View proposals <Icon name="chevron" size={14}/></button>
              </header>
              <div className="proposal-group-list">
                {props.map((p)=>(
                  <div className="proposal-group-row" key={p.id}>
                    <span className="proposal-avatar">{(p.freelancerName.charAt(0)||"F").toUpperCase()}</span>
                    <div className="proposal-group-body">
                      <div><b>{p.freelancerName}</b>{p.freelancerTitle&&<small> · {p.freelancerTitle}</small>}</div>
                      <small>{p.price} · {p.delivery} · submitted {p.createdAt.slice(0,10)}</small>
                      <p>{p.coverLetter.length>180?`${p.coverLetter.slice(0,180)}…`:p.coverLetter}</p>
                    </div>
                    <em className={`proposal-pill ${p.status.toLowerCase()}`}>{RECEIVED_STATE[p.status]||p.status}</em>
                    <div className="proposal-group-actions">
                      {p.status==="Pending"&&<><Button disabled={busyId===p.id} onClick={()=>decide(p.id,"Accepted")}>Accept</Button><Button variant="secondary" disabled={busyId===p.id} onClick={()=>decide(p.id,"Refused")}>Decline</Button></>}
                      <button onClick={()=>router.push(`/client/projects/${proj.id}`)} aria-label="Open project"><Icon name="chevron" size={15}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    )}{page==="client-projects"&&(
      <section className="dash-card invitations-panel">
        <div className="card-heading">
          <div><h3>Invited freelancers</h3><span>Follow the invitations you sent and the freelancers' responses.</span></div>
          <button onClick={()=>router.push("/client/talent")}>Invite a freelancer <Icon name="arrow" size={14}/></button>
        </div>
        {invitations.length===0&&(
          <div className="empty-state"><span><Icon name="message" size={20}/></span><b>No invitation sent yet</b><p>Open a freelancer profile and choose “Invite” to send your first invitation.</p></div>
        )}
        <div className="invitation-list">
          {invitations.map((inv:any)=>{
            const status=String(inv.status||"").toLowerCase();
            return (
              <div className="invitation-row" key={inv.id}>
                <span className="proposal-avatar">{(String(inv.freelancerName||"F").charAt(0)||"F").toUpperCase()}</span>
                <div className="invitation-body">
                  <div><b>{inv.freelancerName}</b><small> · {inv.projectTitle}</small></div>
                  <p>{inv.message}</p>
                  {inv.declineReason&&<small className="invitation-decline">Decline reason: {inv.declineReason}</small>}
                  <small>Sent {String(inv.createdAt).slice(0,10)}</small>
                </div>
                <em className={`proposal-pill ${status}`}>{inv.status}</em>
                <button onClick={()=>window.open(`/freelancers/${inv.freelancerId}`,"_blank")} aria-label="View profile"><Icon name="chevron" size={15}/></button>
              </div>
            );
          })}
        </div>
      </section>
    )}
    {page==="client-proposals"&&(
      <div className="proposal-compare">
        {scopedProjectId&&(
          <div className="proposal-filter-banner">
            <div>
              <span className="proposal-group-icon"><Icon name="briefcase" size={15}/></span>
              <div><small>FILTERED BY PROJECT</small><h3>{scopedProject?.title||"Selected project"}</h3></div>
            </div>
            <div>
              <span>{activeProposals.length} proposal{activeProposals.length===1?"":"s"}</span>
              <button onClick={()=>router.push("/client/proposals")}>View all proposals <Icon name="close" size={13}/></button>
            </div>
          </div>
        )}
        <div className="module-tabs">{RECEIVED_TABS.map(x=><button className={tab===x?"active":""} onClick={()=>setTab(x)} key={x}>{x}</button>)}</div>
        {proposalsLoading&&<p className="task-empty">Loading the proposals received…</p>}
        {!proposalsLoading&&proposalsError&&<p className="task-empty">{proposalsError}</p>}
        {!proposalsLoading&&!proposalsError&&filteredProposals.length===0&&(
          <div className="empty-state"><span><Icon name="users" size={20}/></span><b>{scopedProjectId?"No proposal for this project yet":tab==="All"?"No proposals received yet":"No proposal with this status"}</b><p>{scopedProjectId?"This project has not received a proposal matching the selected status.":tab==="All"?"Proposals appear here as soon as professionals respond to one of your published projects.":"Proposals move through their statuses as you accept or decline them."}</p></div>
        )}
        {!proposalsLoading&&!proposalsError&&filteredProposals.map((p,i)=>(
          <article className="proposal-card" key={p.id}>
            <span className={`order-logo o${i%3}`}>{p.freelancerName.charAt(0)||"F"}</span>
            <div className="proposal-card-body">
              <div className="proposal-card-title"><b>{p.freelancerName}</b>{p.freelancerTitle&&<small>· {p.freelancerTitle}</small>}</div>
              <small className="proposal-card-meta">{p.projectTitle} · submitted {p.createdAt.slice(0,10)} · {p.delivery}</small>
              <p>{p.coverLetter}</p>
            </div>
            <div className="proposal-card-side">
              <span className="proposal-price">{p.price}</span>
              <em className={`proposal-pill ${p.status.toLowerCase()}`}>{RECEIVED_STATE[p.status]||p.status}</em>
              <div className="proposal-card-actions">
                {p.status==="Pending"&&<><Button disabled={busyId===p.id} onClick={()=>decide(p.id,"Accepted")}>Accept</Button><Button variant="secondary" disabled={busyId===p.id} onClick={()=>decide(p.id,"Refused")}>Decline</Button></>}
                <button className="proposal-open" onClick={()=>router.push(`/client/projects/${p.projectId}`)} aria-label="Open project"><Icon name="chevron" size={15}/></button>
              </div>
            </div>
          </article>
        ))}
      </div>
    )}
    {page==="client-contracts"&&<div className="contract-list"><p className="task-empty">No contracts yet.</p></div>}
    {page==="payments"&&<><div className="module-summary"><article><span><Icon name="wallet"/></span><b>—</b><small>Spend this month</small></article><article><span><Icon name="clock"/></span><b>—</b><small>Pending milestones</small></article><article><span><Icon name="file"/></span><b>—</b><small>Open invoices</small></article><article><span><Icon name="briefcase"/></span><b>—</b><small>Lifetime spend</small></article></div><section className="payments-grid"><article className="dash-card"><div className="card-heading"><h3>Payment methods</h3><button onClick={()=>notify("Adding a payment method requires the backend")}>Add new</button></div><p className="task-empty">No payment methods yet.</p></article><article className="dash-card"><h3>Billing overview</h3><div className="spend-ring"><strong>—</strong><small>No budget set</small></div><p>No spending activity yet.</p></article></section><div className="dash-card transactions"><div className="card-heading"><h3>Transaction history</h3><button onClick={()=>notify("Invoice downloads require the backend")}>Download invoices</button></div><p className="task-empty">No transactions yet.</p></div></>}
    {page==="support"&&<SupportContent notify={notify}/>}
    {page==="settings"&&<AccountSettings role="client"/>}
  </main></ClientShell>;
}

export { ClientModule };
