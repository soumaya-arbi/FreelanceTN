"use client";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { AppShell } from "@/components/layout/AppShell";
import { useUser } from "@/context/UserContext";
import type { IconName, Page, Project } from "@/lib/types";

function Dashboard({
  go,
  notify,
  projectItems,
  assignedItems = [],
  openProject,
  firstName,
  loading = false,
  error = "",
  assignedLoading = false,
  assignedError = "",
}: {
  go: (p: Page) => void;
  notify: (s: string) => void;
  projectItems: Project[];
  assignedItems?: Project[];
  openProject: (project: Project) => void;
  firstName?: string;
  loading?: boolean;
  error?: string;
  assignedLoading?: boolean;
  assignedError?: string;
}) {
  const { authUser } = useUser();
  // Seules des valeurs calculées à partir des données réellement chargées
  // sont affichées : aucun revenu, vue ou score n'est inventé.
  const activeProjects = assignedItems.filter(
    (p) => p.status === "In progress" || p.status === "Client review",
  ).length;
  const profileCriteria = [
    Boolean(authUser?.title),
    Boolean(authUser?.location),
    Boolean(authUser?.bio),
    Boolean(authUser?.avatar || authUser?.avatarSource === "generated" || authUser?.avatarSource === "preset"),
    (authUser?.skills?.length ?? 0) > 0,
    (authUser?.hourlyRate ?? 0) > 0,
  ];
  const profileStrength = Math.round((profileCriteria.filter(Boolean).length / profileCriteria.length) * 100);
  const metrics: { label: string; value: string; detail: string; icon: IconName }[] = [
    {
      label: "Active projects",
      value: String(activeProjects),
      detail: activeProjects === 0 ? "No approved project yet" : "Approved by clients",
      icon: "briefcase",
    },
    {
      label: "Open client projects",
      value: String(projectItems.length),
      detail: "Published on the marketplace",
      icon: "search",
    },
    {
      label: "Profile strength",
      value: `${profileStrength}%`,
      detail: profileStrength === 100 ? "Profile complete" : "Add the missing details",
      icon: "users",
    },
  ];
  return (
    <AppShell page="dashboard" go={go} notify={notify}>
      <main className="workspace">
        <div className="workspace-title">
          <div>
            <p>FREELANCER WORKSPACE</p>
            <h1>Welcome{firstName ? `, ${firstName}` : ""}.</h1>
            <span>Here is what needs your attention today.</span>
          </div>
          <div className="title-actions">
            <Button variant="secondary" onClick={() => go("find-work")} icon="search">Browse client projects</Button>
            <Button onClick={() => go("profile-edit")} icon="arrow">Improve my profile</Button>
          </div>
        </div>

        <div className="metric-grid">
          {metrics.map((m, i) => (
            <article className="metric-card" key={m.label}>
              <div>
                <span className={`metric-icon m${i}`}><Icon name={m.icon} /></span>
                <small>{m.label}</small>
              </div>
              <strong>{m.value}</strong>
              <p><span>{m.detail}</span></p>
            </article>
          ))}
        </div>

        <section className="client-project-board">
          <div className="board-intro">
            <span><Icon name="search" /></span>
            <div>
              <p>CLIENT PROJECT BOARD</p>
              <h2>Projects shared by clients</h2>
              <small>Review active briefs, budgets and requirements, then send a tailored proposal.</small>
            </div>
            <Button onClick={() => go("find-work")} icon="arrow">View all projects</Button>
          </div>
          <div className="board-projects">
            {loading && <p className="task-empty">Loading client projects…</p>}
            {!loading && error && <p className="task-empty">{error}</p>}
            {!loading && !error && projectItems.slice(0, 3).map((project) => (
              <button key={project.id} onClick={() => openProject(project)}>
                <div>
                  <span className="live">{project.time ? `Posted ${project.time}` : "Published project"}</span>
                  <h3>{project.title}</h3>
                  <p>{project.description}</p>
                  <div className="chips">{project.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}</div>
                </div>
                <div className="board-foot">
                  <strong>{project.budget}</strong>
                  <span>{project.type} · {project.proposals} proposal{project.proposals === 1 ? "" : "s"}</span>
                  <Icon name="chevron" />
                </div>
              </button>
            ))}
            {!loading && !error && projectItems.length === 0 && (
              <p className="task-empty">No client projects are available yet. New briefs appear here as soon as clients publish them.</p>
            )}
          </div>
        </section>

        <div className="dash-grid lower">
          <article className="dash-card">
            <div className="card-heading">
              <h3>Your active projects</h3>
              <button onClick={() => go("orders")}>View all</button>
            </div>
            {assignedLoading && <p className="task-empty">Loading your projects…</p>}
            {!assignedLoading && assignedError && <p className="task-empty">{assignedError}</p>}
            {!assignedLoading && !assignedError && assignedItems.slice(0, 4).map((p, i) => (
              <div className="order-row" key={p.id}>
                <span className={`order-logo o${i}`}>{p.client.charAt(0) || "P"}</span>
                <span><b>{p.title}</b><small>{p.client}{p.deadline ? ` · Due ${p.deadline}` : ""}</small></span>
                <strong>{p.budget}</strong>
                <em className={p.status === "Client review" ? "reviewing" : ""}>{p.status}</em>
                <button onClick={() => go("orders")} aria-label={`Open ${p.title}`}><Icon name="chevron" /></button>
              </div>
            ))}
            {!assignedLoading && !assignedError && assignedItems.length === 0 && (
              <p className="task-empty">No project has been approved for you yet.</p>
            )}
          </article>

          <article className="dash-card profile-score">
            <div className="card-heading">
              <h3>Profile strength</h3>
              <button onClick={() => go("profile-edit")}>Edit</button>
            </div>
            <div className="score-ring">
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" />
                <circle className="progress" cx="50" cy="50" r="42" style={{ strokeDasharray: `${Math.round(profileStrength * 2.64)} 264` }} />
              </svg>
              <div><strong>{profileStrength}%</strong><span>{profileStrength === 100 ? "Complete" : "Incomplete"}</span></div>
            </div>
            <p>Complete your profile to improve your visibility.</p>
            <button onClick={() => go("invitations")}>
              <Icon name="bell" />
              <span><b>Client invitations</b><small>Review opportunities selected for you</small></span>
              <Icon name="chevron" />
            </button>
            <button onClick={() => go("quotes")}>
              <Icon name="file" />
              <span><b>Devis &amp; factures</b><small>Track quotes, invoices and payments</small></span>
              <Icon name="chevron" />
            </button>
          </article>
        </div>
      </main>
    </AppShell>
  );
}

export { Dashboard };
