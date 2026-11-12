"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleTable } from "@/components/ui/ModuleTable";
import { SupportContent } from "@/components/ui/SupportContent";
import { AppShell } from "@/components/layout/AppShell";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import type { Page, EditorMode } from "@/lib/types";
import { freelancerClientProfilePath, moduleInfo } from "@/lib/navigation";
import { ApiError } from "@/lib/api";
import { accountApi, invitationsApi, projectsApi, type PublicClientProfile } from "@/lib/api";

// Forme renvoyée par GET /api/invitations/mine (InvitationResponse du backend).
// Les invitations concernent uniquement le freelancer connecté.
type InvitationItem = {
  id: string;
  projectId: string;
  projectTitle: string;
  clientId: string;
  clientName: string;
  message: string;
  offeredPrice?: string | null;
  offeredDelivery?: string | null;
  status: string;
  declineReason?: string | null;
  createdAt: string;
};

function FreelancerModule({ page, go, notify, openEditor }: { page: Page; go: (p: Page) => void; notify: (s: string) => void; openEditor: (mode: EditorMode) => void }) {
  const [activeTab, setActiveTab] = useState("All");
  const [available, setAvailable] = useState(true);
  const router = useRouter();
  const info = moduleInfo[page] || ["Workspace", "Manage your freelance business.", "Create"];
  // Chargement des invitations pour le freelancer connecté.
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [invitationsError, setInvitationsError] = useState("");
  const [detailInvitation, setDetailInvitation] = useState<InvitationItem | null>(null);
  const [detailProject, setDetailProject] = useState<any>(null);
  const [detailClient, setDetailClient] = useState<PublicClientProfile | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  useEffect(() => {
    if (page !== "invitations") return;
    let cancelled = false;
    setInvitationsLoading(true);
    setInvitationsError("");
    invitationsApi.mine()
      .then((rows) => {
        if (cancelled) return;
        setInvitations(Array.isArray(rows) ? (rows as InvitationItem[]) : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setInvitationsError(err instanceof ApiError ? err.message : "Could not load invitations.");
      })
      .finally(() => { if (!cancelled) setInvitationsLoading(false); });
    return () => { cancelled = true; };
  }, [page]);
  const acceptInvitation = async (invitation: InvitationItem) => {
    setBusyId(invitation.id);
    try {
      await invitationsApi.accept(invitation.id);
      notify("Invitation accepted");
      setInvitations((prev) => prev.map((x) => x.id === invitation.id ? { ...x, status: "Accepted" } : x));
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not accept the invitation.");
    } finally {
      setBusyId("");
    }
  };
  const declineInvitation = async (invitation: InvitationItem) => {
    const reason = window.prompt("Reason for declining this invitation (optional):");
    if (reason === null) return;
    setBusyId(invitation.id);
    try {
      await invitationsApi.decline(invitation.id, reason);
      notify("Invitation declined");
      setInvitations((prev) => prev.map((x) => x.id === invitation.id ? { ...x, status: "Declined", declineReason: reason } : x));
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Could not decline the invitation.");
    } finally {
      setBusyId("");
    }
  };
  const openInvitationDetail = async (invitation: InvitationItem) => {
    setDetailInvitation(invitation);
    setDetailProject(null);
    setDetailClient(null);
    setDetailLoading(true);
    try {
      // Le client est identifié par son identifiant réel (clientId), jamais par
      // son nom. On réutilise la projection publique du profil client : elle
      // ne contient aucun email, téléphone, adresse ou donnée de facturation.
      const [project, client] = await Promise.all([
        projectsApi.get(invitation.projectId).catch(() => null),
        accountApi.getPublicProfile(invitation.clientId).catch(() => null),
      ]);
      setDetailProject(project);
      setDetailClient(client);
    } finally {
      setDetailLoading(false);
    }
  };

  // Navigation vers le profil public du client à partir de son identifiant
  // réel. La route est protégée par le layout freelance et reste accessible
  // tant que l'invitation n'a pas été acceptée.
  const openClientProfile = (clientId: string) => {
    if (!clientId) return;
    setDetailInvitation(null);
    router.push(freelancerClientProfilePath(clientId));
  };
  const action = () => page === "reviews" ? openEditor("review") : page === "analytics" ? openEditor("report") : page === "proposals" ? go("invitations") : page === "availability" ? notify("Saving availability requires the backend — changes stay in this session only") : notify(`${info[2]} requires the backend`);
  // Libellés dérivés uniquement du profil public réel ; aucun champ privé.
  const detailClientName = detailClient?.displayName?.trim() || detailClient?.companyName?.trim() || detailInvitation?.clientName || "Client";
  const detailClientNameParts = detailClientName.split(" ").filter(Boolean);
  const detailClientFirstName = detailClientNameParts[0] || "Client";
  const detailClientLastName = detailClientNameParts.slice(1).join(" ");
  const detailClientLocation = detailClient
    ? [detailClient.city, detailClient.governorate, detailClient.country].filter(Boolean).join(", ")
    : "";
  const proposalRows: string[][] = [];
  return <AppShell page={page} go={go} notify={notify}><main className="workspace module-page"><div className="workspace-title"><div><p>FREELANCER WORKSPACE</p><h1>{info[0]}</h1><span>{info[1]}</span></div>{page !== "invitations" && <Button onClick={action} icon={page === "analytics" ? "arrow" : page === "verification" ? "shield" : "check"}>{info[2]}</Button>}</div>
    {page === "proposals" && <ModuleTable tabs={["All", "Submitted", "Viewed", "Shortlisted", "Accepted", "Archived"]} active={activeTab} setActive={setActiveTab} rows={proposalRows} notify={notify} />}
    {page === "invitations" && <div className="invitation-list">
      {invitationsLoading && <p className="task-empty">Loading invitations</p>}
      {!invitationsLoading && invitationsError && <p className="task-empty">{invitationsError}</p>}
      {!invitationsLoading && !invitationsError && invitations.length === 0 && <p className="task-empty">No project invitation received yet.</p>}
      {!invitationsLoading && invitations.map((inv) => (
        <article
          className={`invitation-card invitation-card--clickable${inv.status ? ` is-${inv.status.toLowerCase()}` : ""}`}
          key={inv.id}
          role="button"
          tabIndex={0}
          onClick={() => void openInvitationDetail(inv)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openInvitationDetail(inv); } }}
        >
          <span className="invitation-mark" aria-hidden="true"><Icon name="briefcase" size={16} /></span>
          <div className="invitation-body">
            <div className="invitation-heading">
              <h3>{inv.projectTitle}</h3>
              <span className={`proposal-pill ${String(inv.status || "").toLowerCase()}`}>{inv.status}</span>
            </div>
            <div className="invitation-meta">
              <span>
                <Icon name="users" size={13} />
                <button
                  type="button"
                  className="invitation-client-link"
                  onClick={(event) => { event.stopPropagation(); openClientProfile(inv.clientId); }}
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
          <div className="invitation-side" onClick={(event) => event.stopPropagation()}>
            {inv.status === "Pending" ? (
              <div className="invitation-actions">
                <Button disabled={busyId === inv.id} onClick={() => void acceptInvitation(inv)}>Accept</Button>
                <Button variant="secondary" disabled={busyId === inv.id} onClick={() => void declineInvitation(inv)}>Decline</Button>
              </div>
            ) : (
              <span className="invitation-note">No action required</span>
            )}
            <button className="invitation-open" onClick={() => window.open(`/projects/${inv.projectId}`, "_blank")} aria-label="View project"><Icon name="chevron" size={15} /></button>
          </div>
        </article>
      ))}
    </div>}
    {page === "reviews" && <div className="reviews-layout"><article className="dash-card reputation"><span>Reputation</span><div className="stars"><span className="star">★</span><span className="star">★</span><span className="star">★</span><span className="star">★</span><span className="star">★</span></div><b>No reviews yet</b><small>Reviews appear here once clients complete projects with you.</small></article><section className="dash-card review-feed"><p className="task-empty">No reviews yet.</p></section></div>}
    {page === "analytics" && <><div className="module-summary"><article><span><Icon name="users" /></span><b>—</b><small>Profile views</small></article><article><span><Icon name="search" /></span><b>—</b><small>Search appearances</small></article><article><span><Icon name="portfolio" /></span><b>—</b><small>Portfolio views</small></article><article><span><Icon name="briefcase" /></span><b>—</b><small>Hire conversion</small></article></div><div className="analytics-grid"><article className="dash-card"><div className="card-heading"><h3>Profile discovery</h3><select><option>Last 30 days</option></select></div><p className="task-empty">No analytics data yet.</p></article><article className="dash-card sources"><h3>Top discovery sources</h3><p className="task-empty">No data yet.</p></article></div></>}
    {page === "availability" && <div className="availability-grid"><section className="dash-card"><div className="availability-head"><div><h3>Work availability</h3><p>Visible to clients across FreelanceTN.</p></div><button className={available ? "switch on" : "switch"} onClick={() => setAvailable(!available)}><i /></button></div><div className="capacity-choice"><button className={available ? "active" : ""} onClick={() => setAvailable(true)}><Icon name="check" /><span><b>Available now</b><small>Open to new projects</small></span></button><button onClick={() => notify("Setting an availability date requires the backend")}><Icon name="clock" /><span><b>Available soon</b><small>Set a future date</small></span></button><button className={!available ? "active" : ""} onClick={() => setAvailable(false)}><Icon name="close" /><span><b>Not available</b><small>Hide from new work</small></span></button></div><h3 className="setting-title">Weekly schedule</h3><p className="task-empty">No weekly schedule saved yet.</p></section><aside className="dash-card availability-side"><h3>Work preferences</h3><label>Weekly capacity<select defaultValue=""><option value="">Not set</option><option>30–40 hours</option><option>20–30 hours</option><option>Under 20 hours</option></select></label><label>Project preference<select defaultValue=""><option value="">Not set</option><option>Long-term & short-term</option><option>Long-term only</option><option>Short-term only</option></select></label><label>Expected response<select defaultValue=""><option value="">Not set</option><option>Within 2 hours</option><option>Within 24 hours</option></select></label><hr /><h3>Time away</h3><p>No vacation dates scheduled.</p><Button variant="secondary" onClick={() => notify("Scheduling time away requires the backend")}>Add time away</Button></aside></div>}
    {page === "verification" && <div className="verification-layout"><section className="dash-card verification-hero"><div className="verify-progress"><strong>0%</strong><span>Not started</span></div><div><span className="overline">TRUST PROFILE</span><h2>Complete your verification.</h2><p>Complete identity verification to unlock the verified badge and improve client confidence.</p></div></section><section className="verify-list"><article className="dash-card"><span><Icon name="shield" /></span><div><b>Government-issued ID</b><small>Securely verify with our identity partner</small></div><em>Action required</em><Button onClick={() => notify("Identity verification requires the backend")}>Start</Button></article></section></div>}
    {page === "support" && <SupportContent notify={notify} />}
  </main>{detailInvitation && <div className="modal-backdrop" onClick={() => setDetailInvitation(null)}><div className="proposal-modal invitation-modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setDetailInvitation(null)}>×</button>      <div className="invitation-modal-head">
      <span className="overline">PROJECT INVITATION</span>
      <div className="invitation-heading">
        <h2>{detailInvitation.projectTitle}</h2>
        <span className={`proposal-pill ${String(detailInvitation.status || "").toLowerCase()}`}>{detailInvitation.status}</span>
      </div>
      <p className="invitation-modal-sub">
        From{" "}
        <button
          type="button"
          className="invitation-client-link"
          onClick={() => openClientProfile(detailInvitation.clientId)}
          aria-label={`View ${detailClientName} public profile`}
        >
          {detailClientName}
        </button>
      </p>
    </div>
      {detailLoading ? <p className="task-empty">Loading details…</p> : <div className="invitation-modal-grid">
        <section className="invitation-modal-section">
          <h3>Client</h3>
          {detailClient ? (
            <div className="invitation-client-summary">
              <div className="invitation-client-identity">
                <AvatarBadge
                  url={detailClient.avatar || undefined}
                  firstName={detailClientFirstName}
                  lastName={detailClientLastName}
                  size={48}
                  source={detailClient.avatarSource}
                  avatarConfig={detailClient.avatarConfig}
                />
                <div>
                  <button
                    type="button"
                    className="invitation-client-link invitation-client-name"
                    onClick={() => openClientProfile(detailInvitation.clientId)}
                    aria-label={`View ${detailClientName} public profile`}
                  >
                    {detailClientName}
                  </button>
                  {(detailClient.position || detailClient.companyName) && (
                    <small>{detailClient.position || detailClient.companyName}</small>
                  )}
                  {detailClientLocation && <small>{detailClientLocation}</small>}
                </div>
              </div>
              <dl className="invitation-facts">
                {detailClient.companyName && <div><dt>Company</dt><dd>{detailClient.companyName}</dd></div>}
                {detailClient.industry && <div><dt>Industry</dt><dd>{detailClient.industry}</dd></div>}
                <div><dt>Location</dt><dd>{detailClientLocation || "Not provided"}</dd></div>
              </dl>
              <Button variant="secondary" onClick={() => openClientProfile(detailInvitation.clientId)}>
                View full profile <Icon name="arrow" size={13} />
              </Button>
            </div>
          ) : (
            <div>
              <p className="task-empty">{detailInvitation.clientName}</p>
              <Button variant="secondary" onClick={() => openClientProfile(detailInvitation.clientId)}>
                View full profile <Icon name="arrow" size={13} />
              </Button>
            </div>
          )}
        </section>
        <section className="invitation-modal-section">
          <h3>Project</h3>
          {detailProject ? <dl className="invitation-facts"><div><dt>Title</dt><dd>{detailProject.title}</dd></div><div><dt>Category</dt><dd>{detailProject.category || "—"}</dd></div><div><dt>Budget</dt><dd>{detailProject.budget || "—"}</dd></div><div><dt>Type</dt><dd>{detailProject.type || "—"}</dd></div><div><dt>Duration</dt><dd>{detailProject.durationValue ? `${detailProject.durationValue} ${detailProject.durationUnit ?? ""}` : "—"}</dd></div></dl> : <><h4>{detailInvitation.projectTitle}</h4><p>Project details are unavailable right now.</p></>}
          {detailProject?.description && <p className="invitation-modal-description">{detailProject.description}</p>}
          {detailProject?.skills?.length > 0 && <div className="chips">{(detailProject.skills as string[]).map((s) => <span key={s}>{s}</span>)}</div>}
        </section>
        <section className="invitation-modal-section invitation-modal-message">
          <h3>Message</h3>
          <p>{detailInvitation.message || "No message was attached to this invitation."}</p>
          <dl className="invitation-facts">{detailInvitation.offeredPrice && <div><dt>Offered price</dt><dd>{detailInvitation.offeredPrice}</dd></div>}{detailInvitation.offeredDelivery && <div><dt>Offered delivery</dt><dd>{detailInvitation.offeredDelivery}</dd></div>}<div><dt>Received</dt><dd>{String(detailInvitation.createdAt).slice(0, 10)}</dd></div></dl>
        </section>
      </div>}
      {detailInvitation.status === "Pending" && !detailLoading && <div className="invitation-modal-actions">
        <Button disabled={busyId === detailInvitation.id} onClick={() => { void acceptInvitation(detailInvitation); setDetailInvitation(null); }}>Accept invitation</Button>
        <Button variant="secondary" disabled={busyId === detailInvitation.id} onClick={() => { void declineInvitation(detailInvitation); setDetailInvitation(null); }}>Decline</Button>
        <button className="invitation-modal-link" onClick={() => window.open(`/projects/${detailInvitation.projectId}`, "_blank")}>Open full project <Icon name="chevron" size={14} /></button>
      </div>}
      {detailInvitation.status !== "Pending" && !detailLoading && <div className="invitation-modal-actions"><span className={`proposal-pill ${String(detailInvitation.status || "").toLowerCase()}`}>{detailInvitation.status}</span><span className="invitation-note">This invitation is no longer actionable.</span></div>}
    </div></div>} </AppShell>;
}

export { FreelancerModule };
