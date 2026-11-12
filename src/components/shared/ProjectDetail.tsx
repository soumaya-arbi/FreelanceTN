"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import type { Page, Project } from "@/lib/types";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { ApiError, commentsApi, invitationsApi } from "@/lib/api";
import type { BreakdownTaskSuggestion, FreelancerMatchSuggestion, ProposalAssistSuggestion } from "@/lib/api";
import { FreelancerMatchAssistant, ProjectBreakdownAssistant, ProposalDraftAssistant } from "@/components/shared/AiAssistantPanel";
import { ProjectDiscussion } from "@/components/shared/ProjectDiscussion";
import { ProjectPipeline } from "@/components/shared/ProjectPipeline";
import { AttachmentList } from "@/components/shared/AttachmentList";
import { FormField } from "@/components/ui/Form";

// Délais proposés au freelance. La valeur stockée est un libellé, comme le
// budget du projet : le backend ne fait que la valider et la conserver.
const DELIVERY_OPTIONS = ["4—6 weeks", "6—8 weeks", "8—12 weeks"];

// Libellés utilisés pour rendre l'état d'une candidature existante.
const PROPOSAL_STATE: Record<string, { label: string; note: string }> = {
  Pending: { label: "Proposal submitted", note: "Your proposal is waiting for the client's decision." },
  Accepted: { label: "Proposal accepted", note: "The client approved your proposal and this project has been assigned to you." },
  Refused: { label: "Proposal declined", note: "The client declined your proposal for this project." },
  Withdrawn: { label: "Proposal withdrawn", note: "You withdrew your proposal for this project." },
  Cancelled: { label: "Acceptance cancelled", note: "The client cancelled the acceptance of your proposal. The project is open again." },
};

function ProjectDetail({ project, go, notify, backPage = "projects", openProject }: { project: Project; go: (p: Page) => void; notify: (s: string) => void; backPage?: Page; openProject?: (project: Project) => void }) {
  const router = useRouter();
  const [proposal, setProposal] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [cover, setCover] = useState("");
  const [price, setPrice] = useState("");
  const [delivery, setDelivery] = useState(DELIVERY_OPTIONS[0]);
  const [portfolioId, setPortfolioId] = useState("");
  const { projects, portfolio, myProposals, submitProposal, updateProject, addTask } = useMarketplace();
  const { status: authStatus, role, authUser } = useUser();


  // Candidature du freelance connecté sur ce projet, si elle existe déjà.
  const myProposal = myProposals.find((item) => item.projectId === project.id) ?? null;
  const isFreelancer = authStatus === "authenticated" && role === "freelancer";
  const isOwner = authUser?.id === project.ownerId;
  const isAssignedFreelancer = authUser?.id === project.assignedTo;
  const isProjectParticipant = authStatus === "authenticated" && (isOwner || isAssignedFreelancer);
  const isOpen = project.status === "Open";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError("");
    setSaving(true);
    try {
      await submitProposal({
        projectId: project.id,
        coverLetter: cover.trim(),
        price: price.trim(),
        delivery,
        portfolioId: portfolioId || null,
      });
      setSubmitted(true);
      notify("Proposal submitted – the client has been notified");
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : "Your proposal could not be submitted. Please try again.";
      setFormError(message);
      notify(message);
    } finally {
      setSaving(false);
    }
  };

  const reopen = () => {
    setSubmitted(false);
    setCover("");
    setPrice("");
    setDelivery(DELIVERY_OPTIONS[0]);
    setPortfolioId("");
    setFormError("");
    setProposal(false);
  };

  // Approbation ou demande de correction de la livraison soumise par le
  // freelance : réutilise la transition de statut existante du projet.
  const approveDelivery = async () => {
    setCompleting(true);
    setApprovalError("");
    try {
      await updateProject(project.id, { status: "Completed" });
      notify("Delivery approved — the project is now completed");
    } catch (err) {
      setApprovalError(err instanceof ApiError ? err.message : "The delivery could not be approved.");
    } finally {
      setCompleting(false);
    }
  };

  const requestRevision = async () => {
    const note = revisionNote.trim();
    if (note.length < 5) {
      setApprovalError("Explain what needs to change before sending the request.");
      return;
    }
    setCompleting(true);
    setApprovalError("");
    try {
      await updateProject(project.id, { status: "In progress" });
      // La note est publiée dans la discussion existante du projet : le
      // freelance la retrouve dans son espace sans nouveau système.
      try {
        await commentsApi.create(project.id, `Revision requested: ${note}`);
      } catch {
        /* la transition de statut reste valable même si le message échoue */
      }
      notify("Revision request sent — the project is back in progress");
      setRevisionOpen(false);
      setRevisionNote("");
    } catch (err) {
      setApprovalError(err instanceof ApiError ? err.message : "The revision request could not be sent.");
    } finally {
      setCompleting(false);
    }
  };

  const inviteRecommendedFreelancer = async (match: FreelancerMatchSuggestion) => {
    await invitationsApi.create({
      projectId: project.id,
      freelancerId: match.freelancerId,
      message: `Bonjour ${match.name}, votre profil correspond à notre projet « ${project.title} ». Seriez-vous disponible pour en discuter ?`,
    });
    notify(`Invitation envoyée à ${match.name}`);
  };

  const createBreakdownTask = async (task: BreakdownTaskSuggestion) => {
    if (!authUser || !isProjectParticipant || project.status !== "In progress" || !project.assignedTo) {
      throw new Error("Seuls les participants d’un projet accepté peuvent créer ses tâches.");
    }
    const assigneeId = role === "client" ? project.assignedTo : project.ownerId;
    const assigneeName = role === "client" ? (project.assignedToName || "Freelancer") : (project.client || "Client");
    const assigneeRole = role === "client" ? "freelancer" : "client";
    const today = new Date();
    const details = [task.description, task.phase ? `Phase : ${task.phase}` : "", task.deliverable ? `Livrable indicatif : ${task.deliverable}` : "", task.dependsOn.length ? `Dépendances proposées : ${task.dependsOn.join(", ")}` : ""].filter(Boolean).join("\n\n");
    const due = new Date(today);
    due.setDate(due.getDate() + Math.max(1, task.indicativeDays ?? 7));
    await addTask({
      title: task.title.trim(), description: details, projectId: project.id,
      assignee: assigneeName, assigneeUserId: assigneeId, assigneeRole,
      status: "todo", priority: task.priority, storyPoints: 0,
      startDate: today.toISOString().slice(0, 10), dueDate: due.toISOString().slice(0, 10),
    });
  };

  const applyBlock = (() => {
    if (!authStatus || authStatus !== "authenticated") {
      return <p className="apply-note"><Icon name="shield" size={14}/> Sign in as a freelancer to submit a proposal.</p>;
    }
    if (!isFreelancer) {
      return <p className="apply-note"><Icon name="shield" size={14}/> Only freelancer accounts can submit proposals.</p>;
    }
    if (isOwner) {
      return <p className="apply-note"><Icon name="shield" size={14}/> You posted this project, so you cannot apply to it.</p>;
    }
    if (myProposal) {
      const state = PROPOSAL_STATE[myProposal.status] ?? PROPOSAL_STATE.Pending;
      return <div className="apply-note"><b>{state.label}</b><small>{state.note}</small></div>;
    }
    // Un projet déjà attribué ne doit plus proposer de candidature, même si
    // son statut est encore « Open » (approbation manuelle d'un freelance).
    if (project.assignedTo) {
      return <p className="apply-note"><Icon name="shield" size={14}/> This project has already been assigned to {project.assignedToName || "a freelancer"}.</p>;
    }
    if (!isOpen) {
      return <p className="apply-note"><Icon name="shield" size={14}/> This project is no longer accepting proposals.</p>;
    }
    return <Button onClick={() => { setSubmitted(false); setFormError(""); setProposal(true); }}>Submit a proposal</Button>;
  })();
  const similar = projects.filter((item) => item.id !== project.id);
  return <main className="project-detail-page"><div className="container project-breadcrumb"><button onClick={() => go(backPage)}>Projects</button><Icon name="chevron" size={13}/><span>{project.title}</span></div><div className="container"><ProjectPipeline project={project} /></div><div className="container project-detail-grid"><section>
    <article className="project-detail-main"><div className="detail-labels"><span className="fresh">{project.status || "Open"}</span>{project.time && <span>Posted {project.time}</span>}</div><h1>{project.title}</h1><div className="detail-meta"><span><Icon name="wallet"/> {project.budget}</span><span><Icon name="briefcase"/> {project.type}</span>{project.deadline && <span><Icon name="clock"/> {project.deadline}</span>}</div><div className="detail-section"><h2>Project overview</h2>{project.description ? <p>{project.description}</p> : <p className="task-empty">No description has been provided for this project.</p>}</div><div className="detail-section"><h2>Skills and expertise</h2>{project.skills.length > 0 ? <div className="chips large">{project.skills.map(x=><span key={x}>{x}</span>)}</div> : <p className="task-empty">No skills listed for this project.</p>}</div><div className="detail-section"><h2>Project details</h2><div className="project-facts"><div><small>Project type</small><b>{project.type || "—"}</b><span>{project.type === "Hourly" ? "Hourly billing" : "Fixed scope"}</span></div><div><small>Category</small><b>{project.category || "—"}</b><span>Declared category</span></div><div><small>Proposal deadline</small><b>{project.deadline || "—"}</b><span>Set by the client</span></div><div><small>Status</small><b>{project.status || "—"}</b><span>Current status</span></div></div></div>{project.attachments && project.attachments.length > 0 && <div className="detail-section"><h2>Attachments</h2><AttachmentList items={project.attachments}/></div>}
    {isOwner && project.status === "Open" && !project.assignedTo && <FreelancerMatchAssistant projectId={project.id} onViewProfile={(freelancerId) => router.push(`/client/talent/${encodeURIComponent(freelancerId)}`)} onInvite={inviteRecommendedFreelancer} />}
    {isProjectParticipant && project.status === "In progress" && <ProjectBreakdownAssistant projectId={project.id} onCreateTask={createBreakdownTask} onTasksCreated={(count) => notify(`${count} tâche${count > 1 ? "s" : ""} ajoutée${count > 1 ? "s" : ""} au projet avec succès.`)} onTasksFailed={(createdCount) => notify(createdCount > 0 ? `Échec de création : ${createdCount} tâche${createdCount > 1 ? "s ont" : " a"} été ajoutée${createdCount > 1 ? "s" : "e"}, les autres n’ont pas pu être créées.` : "Impossible de créer les tâches sélectionnées. Vérifiez votre connexion et réessayez.")} />}
    <ProjectDiscussion project={project} notify={notify} />
  </article>
    <article className="project-detail-main similar-projects"><div className="card-heading"><h2>Similar opportunities</h2><button onClick={() => go(backPage)}>View all</button></div>{similar.map(x=><button key={x.id} onClick={()=>openProject?.(x)}><span><b>{x.title}</b><small>{x.budget}{x.time ? ` · ${x.time}` : ""}</small></span><Icon name="chevron"/></button>)}{similar.length === 0 && <p className="task-empty">No other projects are available.</p>}</article>
  </section><aside className="project-apply-card"><div className="project-budget"><small>Project budget</small><strong>{project.budget}</strong><span>{project.type}</span></div>{isOwner && project.status === "Client review" && <div className="delivery-review"><div className="delivery-review-head"><span><Icon name="check" size={16}/></span><div><b>Awaiting your approval</b><small>{project.assignedToName || "The freelancer"} submitted this project on {project.updatedAt.slice(0, 10)}. Review the details, then approve the delivery or request changes.</small></div></div>{approvalError && <p className="form-error" role="alert">{approvalError}</p>}<div className="delivery-review-actions"><Button onClick={approveDelivery} disabled={completing}>{completing ? "Saving..." : "Approve & complete"}</Button><Button variant="secondary" onClick={() => setRevisionOpen(!revisionOpen)} disabled={completing}>{revisionOpen ? "Cancel" : "Request changes"}</Button></div>{revisionOpen && <div className="revision-box"><FormField label="What needs to change?"><textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} rows={3} placeholder="Describe the corrections the freelancer should make…"/></FormField><Button onClick={requestRevision} disabled={completing || revisionNote.trim().length < 5}>{completing ? "Sending..." : "Send revision request"}</Button></div>}</div>}{isOwner && project.status === "In progress" && <Button onClick={async () => { if (!window.confirm("Mark this project as completed?")) return; setCompleting(true); try { await updateProject(project.id, { status: "Completed" }); notify("Project marked as completed"); } catch (err) { notify(err instanceof ApiError ? err.message : "Failed to mark as completed"); } finally { setCompleting(false); } }} disabled={completing}>{completing ? "Saving..." : "Mark as completed"}</Button>}{applyBlock}<Button variant="secondary" onClick={() => {setSaved(!saved);notify(saved?"Project removed from saved items":"Project saved")}}><Icon name={saved?"heart":"bookmark"}/> {saved?"Saved":"Save project"}</Button><p><Icon name="shield" size={14}/> Vos échanges et paiements restent suivis dans votre espace FreelanceTN.</p><hr/><h3>About the client</h3><div className="client-rating"><span>★</span><b>—</b><small>No reviews yet</small></div>{[["Name",project.client || "—"],["Location","—"],["Projects posted","—"],["Total spent","—"],["Member since","—"]].map(x=><div className="client-fact" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>)}</aside></div>
    {proposal&&<div className="modal-backdrop" onMouseDown={()=>{if(!saving)setProposal(false)}}><div className="proposal-modal" onMouseDown={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>{if(!saving)setProposal(false)}}><Icon name="close"/></button>{!submitted?<><span className="overline">SUBMIT A PROPOSAL</span><h2>Show why you’re the right fit.</h2><p>Your proposal will be shared with the client for review.</p><form onSubmit={submit}><ProposalDraftAssistant projectId={project.id} onAccept={(suggestion: ProposalAssistSuggestion) => { setCover(suggestion.coverLetter); if (!price && suggestion.suggestedPrice) setPrice(suggestion.suggestedPrice.replace(/[^\d.]/g, "")); if (suggestion.suggestedDelivery && DELIVERY_OPTIONS.includes(suggestion.suggestedDelivery)) setDelivery(suggestion.suggestedDelivery); }} /><label>Cover letter<textarea required minLength={20} maxLength={5000} value={cover} onChange={e=>setCover(e.target.value)} placeholder="Introduce yourself, explain your approach, and highlight relevant experience…"/></label><div className="form-split"><label>Your {project.type === "Hourly" ? "hourly rate" : "project price"}<div className="money-input"><span>TND</span><input required type="number" min="1" value={price} onChange={e=>setPrice(e.target.value)}/><em>{project.type === "Hourly" ? "/hr" : "total"}</em></div></label><label>Estimated delivery<select value={delivery} onChange={e=>setDelivery(e.target.value)}>{DELIVERY_OPTIONS.map((option)=><option key={option}>{option}</option>)}</select></label></div><label>Relevant portfolio project<select value={portfolioId} onChange={e=>setPortfolioId(e.target.value)}><option value="">No portfolio item selected</option>{portfolio.filter((item)=>item.published&&item.visibility!=="Private").map((item)=><option value={item.id} key={item.id}>{item.title}</option>)}</select></label><div className="proposal-summary"><span><Icon name="shield"/></span><div><b>Proposal</b><small>Sent to the client for review. You can withdraw it for as long as it stays pending.</small></div></div>{formError&&<p className="form-error" role="alert">{formError}</p>}<div className="wizard-actions"><Button type="submit" icon="arrow" disabled={saving}>{saving?"Submitting…":"Submit proposal"}</Button></div></form></>:<div className="proposal-success"><span><Icon name="check" size={31}/></span><h2>Proposal submitted.</h2><p>Your proposal for <b>{project.title}</b> has been sent to the client. You can follow its status or withdraw it from your proposals.</p><div><Button onClick={()=>{setProposal(false);go("proposals")}}>View my proposals</Button><Button variant="secondary" onClick={reopen}>Back to project</Button></div></div>}</div></div>}
  </main>;
}

export { ProjectDetail };
