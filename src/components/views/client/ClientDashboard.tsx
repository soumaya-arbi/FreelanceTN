"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ClientShell } from "@/components/layout/ClientShell";
import type { IconName, Page } from "@/lib/types";
import { freelancersApi, type PublicFreelancerSummary } from "@/lib/api";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";

function ClientDashboard({ go, notify, invite }: { go: (p: Page) => void; notify: (s: string) => void; invite: (id: string, name: string) => void }) {
  const router = useRouter();
  const { projects, projectsLoading, projectsError } = useMarketplace();
  const { user, authUser } = useUser();
  // Talents recommandés : comptes réels uniquement, chargés depuis l'API.
  const [talent, setTalent] = useState<PublicFreelancerSummary[]>([]);
  const [talentLoading, setTalentLoading] = useState(true);
  const [talentError, setTalentError] = useState("");
  useEffect(() => {
    let cancelled = false;
    freelancersApi
      .list()
      .then((items) => {
        if (!cancelled) setTalent(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) setTalentError(error instanceof Error ? error.message : "Recommended talent could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setTalentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const openCount = projects.filter((p) => p.status === "Open").length;
  const displayName = user.name || user.email;
  const metrics: { label: string; value: string; detail: string; icon: IconName }[] = [
    {
      label: "Open projects",
      value: String(openCount),
      detail: openCount === 0 ? "No project accepting proposals" : "Accepting proposals",
      icon: "file",
    },
    {
      label: "All projects",
      value: String(projects.length),
      detail: "Published from your account",
      icon: "briefcase",
    },
    {
      label: "Talent profiles",
      value: talentLoading ? "…" : String(talent.length),
      detail: talentLoading ? "Loading professionals" : "Available on FreelanceTN",
      icon: "users",
    },
  ];
  return (
    <ClientShell go={go} notify={notify}>
      <main className="workspace client-workspace">
        <div className="client-welcome">
          <div>
            <span className="overline">CLIENT WORKSPACE</span>
            <h1>Turn your next idea into something exceptional.</h1>
            <p>Find the right people, publish your briefs and keep every project moving.</p>
            <div>
              <Button onClick={() => go("client-post")} icon="file">Post a project</Button>
              <Button variant="secondary" onClick={() => go("client-talent")} icon="search">Find talent</Button>
            </div>
          </div>
          <div className="client-welcome-art">
            {displayName && (
              <div className="art-card a1">
                <AvatarBadge
                  url={authUser?.avatar || undefined}
                  firstName={authUser?.firstName ?? ""}
                  lastName={authUser?.lastName ?? ""}
                  preset={authUser?.avatarPreset}
                  color={authUser?.avatarColor}
                  size={56}
                  source={authUser?.avatarSource}
                  avatarConfig={authUser?.avatarConfig}
                />
                <span><b>{displayName}</b><small>{user.title || "Client account"}</small></span>
                <em>Signed in</em>
              </div>
            )}
            <div className="art-card a2"><Icon name="check" /><span><b>Your workspace</b><small>Everything stays tied to your account</small></span></div>
            <span className="art-orbit" />
          </div>
        </div>

        <div className="client-metrics">
          {metrics.map((m, i) => (
            <article key={m.label}>
              <span className={`client-metric-icon c${i}`}><Icon name={m.icon} /></span>
              <div><small>{m.label}</small><strong>{m.value}</strong><p>{m.detail}</p></div>
            </article>
          ))}
        </div>

        <div className="client-dashboard-grid">
          <section className="dash-card">
            <div className="card-heading">
              <div><h3>Your projects</h3><span>Manage work and review proposals</span></div>
              <button onClick={() => go("client-post")}>New project <Icon name="arrow" size={15} /></button>
            </div>
            <div className="client-projects">
              {projectsLoading && <p className="task-empty">Loading your projects…</p>}
              {!projectsLoading && projectsError && <p className="task-empty">{projectsError}</p>}
              {!projectsLoading && !projectsError && projects.length === 0 && <p className="task-empty">No projects yet. Post a project to start hiring.</p>}
              {!projectsLoading && !projectsError && projects.map((x) => (
                <div className="client-project" key={x.id}>
                  <span className="project-symbol"><Icon name="file" /></span>
                  <div><b>{x.title}</b><small>{x.proposals} proposal{x.proposals === 1 ? "" : "s"}</small></div>
                  <em className={x.status === "In progress" ? "working" : ""}>{x.status}</em>
                  <button onClick={() => router.push(`/client/projects/${x.id}`)} aria-label={`Open ${x.title}`}><Icon name="chevron" /></button>
                </div>
              ))}
            </div>
          </section>
          <aside className="dash-card client-activity">
            <div className="card-heading"><h3>Next steps</h3></div>
            <button onClick={() => go("client-talent")}>
              <span className="project-symbol"><Icon name="users" /></span>
              <span><b>Find freelancers</b><small>Browse published profiles</small></span>
              <Icon name="chevron" />
            </button>
            <button onClick={() => go("client-proposals")}>
              <span className="project-symbol p1"><Icon name="file" /></span>
              <span><b>Review proposals</b><small>Compare the applications you received</small></span>
              <Icon name="chevron" />
            </button>
            <button onClick={() => go("client-quotes")}>
              <span className="project-symbol p2"><Icon name="wallet" /></span>
              <span><b>Devis &amp; factures</b><small>Follow quotes, invoices and payments</small></span>
              <Icon name="chevron" />
            </button>
          </aside>
        </div>

        <section className="client-talent">
          <div className="section-head">
            <div><span className="overline">RECOMMENDED TALENT</span><h2>Talent that fits your ambitions.</h2></div>
            <button className="link-btn" onClick={() => go("client-talent")}>Explore all talent <Icon name="arrow" /></button>
          </div>
          <div className="talent-grid">
            {talentLoading && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><span><Icon name="clock" size={20} /></span><b>Loading talent…</b><p>Fetching published profiles.</p></div>}
            {!talentLoading && talentError && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><span><Icon name="shield" size={20} /></span><b>Talent could not be loaded</b><p>{talentError}</p></div>}
            {!talentLoading && !talentError && talent.slice(0, 3).map((f) => (
              <article className="talent-card client-talent-card" key={f.id}>
                <div className="talent-top">
                  {f.avatar ? <img src={f.avatar} alt={f.name} /> : <span className="talent-avatar-fallback" aria-hidden="true">{(f.name.charAt(0) || "F").toUpperCase()}</span>}
                  <span className="available">Available</span>
                </div>
                <h3>{f.name} <span className="verified"><Icon name="check" size={11} /></span></h3>
                <p>{f.title || "Freelancer"}</p>
                <div className="meta"><span>{f.location || "Location not provided"}</span>{f.hourlyRate > 0 ? <strong>{f.hourlyRate} TND/hr</strong> : <strong className="rate-on-request">Rate on request</strong>}</div>
                <div className="card-foot">
                  <Button variant="secondary" onClick={() => router.push(`/client/talent/${f.id}`)}>View profile</Button>
                  <Button onClick={() => invite(f.id, f.name)}>Invite</Button>
                </div>
              </article>
            ))}
            {!talentLoading && !talentError && talent.length === 0 && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><span><Icon name="users" size={20} /></span><b>No talent profiles published yet</b><p>Professionals appear here once they create their account.</p></div>}
          </div>
        </section>
      </main>
    </ClientShell>
  );
}

export { ClientDashboard };
