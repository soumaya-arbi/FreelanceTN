"use client";

import { useState } from "react";
import { aiApi } from "@/lib/api";
import type {
  FreelancerMatchSuggestion,
  ProjectAssistSuggestion,
  ProjectBreakdownSuggestion,
  ProposalAssistSuggestion,
} from "@/lib/api";

export function ProjectDraftAssistant({
  category,
  onAccept,
}: {
  category: string;
  onAccept: (suggestion: ProjectAssistSuggestion) => void;
}) {
  const [idea, setIdea] = useState("");
  const [suggestion, setSuggestion] = useState<ProjectAssistSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      setSuggestion(await aiApi.assistProject({ idea, category, language: "fr" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’assistant IA est indisponible.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="dash-card ai-project-assistant" aria-labelledby="ai-project-assistant-title">
      <div className="card-heading"><div><span>ASSISTANT IA</span><h3 id="ai-project-assistant-title">Clarifier votre idée</h3></div></div>
      <p>Décrivez le besoin. L’assistant proposera un brouillon que vous pourrez relire et modifier avant publication.</p>
      <textarea aria-label="Votre idée de projet" value={idea} onChange={(event) => setIdea(event.target.value)} minLength={20} maxLength={4000} rows={4} placeholder="Quel problème souhaitez-vous résoudre ? Pour qui ? Qu’attendez-vous du prestataire ?" />
      <button type="button" className="btn" onClick={generate} disabled={loading || idea.trim().length < 20}>{loading ? "Génération…" : suggestion ? "Régénérer" : "Générer un brouillon"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {suggestion && <div className="ai-suggestion" aria-live="polite">
        <h4>{suggestion.title}</h4><p>{suggestion.description}</p>
        {suggestion.objectives.length > 0 && <p><b>Objectifs :</b> {suggestion.objectives.join(" · ")}</p>}
        {suggestion.skills.length > 0 && <p><b>Compétences :</b> {suggestion.skills.join(" · ")}</p>}
        {suggestion.technologies.length > 0 && <p><b>Technologies :</b> {suggestion.technologies.join(" · ")}</p>}
        {suggestion.deliverables.length > 0 && <p><b>Livrables :</b> {suggestion.deliverables.join(" · ")}</p>}
        {(suggestion.durationValue || suggestion.budgetMin || suggestion.budgetMax) && <p><b>Indications :</b> {suggestion.durationValue ? `${suggestion.durationValue} ${suggestion.durationUnit ?? ""}` : "Durée à définir"} · {suggestion.budgetMin || suggestion.budgetMax ? `${suggestion.budgetMin ?? "…"}–${suggestion.budgetMax ?? "…"} TND` : "Budget à définir"}</p>}
        <button type="button" className="btn" onClick={() => onAccept(suggestion)}>Utiliser ce brouillon</button>
      </div>}
    </section>
  );
}

export function ProposalDraftAssistant({
  projectId,
  onAccept,
}: {
  projectId: string;
  onAccept: (suggestion: ProposalAssistSuggestion) => void;
}) {
  const [suggestion, setSuggestion] = useState<ProposalAssistSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      setSuggestion(await aiApi.assistProposal(projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’assistant IA est indisponible.");
    } finally {
      setLoading(false);
    }
  };
  return <section className="ai-suggestion" aria-labelledby="ai-proposal-title">
    <div className="card-heading"><div><span>ASSISTANT IA</span><h3 id="ai-proposal-title">Préparer ma proposition</h3></div></div>
    <p>Le brouillon s’appuie sur le projet et votre profil. Vérifiez chaque détail avant de l’utiliser.</p>
    <button type="button" className="btn btn-secondary" onClick={generate} disabled={loading}>{loading ? "Génération…" : suggestion ? "Régénérer" : "Générer un brouillon"}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {suggestion && <div className="ai-proposal-result" aria-live="polite"><h4>{suggestion.introduction}</h4><p><b>Compréhension :</b> {suggestion.understanding}</p><p><b>Approche :</b> {suggestion.approach}</p>{suggestion.steps.length > 0 && <ul>{suggestion.steps.map((step) => <li key={step}>{step}</li>)}</ul>}<p><b>Compétences :</b> {suggestion.relevantSkills.join(" · ") || "À préciser"}</p><p><b>Technologies :</b> {suggestion.relevantTechnologies.join(" · ") || "À préciser"}</p><p><b>Délai indicatif :</b> {suggestion.indicativeTimeline}</p>{suggestion.questions.length > 0 && <p><b>Questions à clarifier :</b> {suggestion.questions.join(" · ")}</p>}<p>{suggestion.conclusion}</p><button type="button" className="btn" onClick={() => onAccept(suggestion)}>Insérer dans ma proposition</button></div>}
  </section>;
}

export function FreelancerMatchAssistant({
  projectId,
  onViewProfile,
  onInvite,
}: {
  projectId: string;
  onViewProfile: (freelancerId: string) => void;
  onInvite: (match: FreelancerMatchSuggestion) => Promise<void>;
}) {
  const [matches, setMatches] = useState<FreelancerMatchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      setMatches((await aiApi.matchFreelancers(projectId)).matches);
      setHasSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le matching est indisponible.");
    } finally {
      setLoading(false);
    }
  };
  return <section className="dash-card ai-matching" aria-labelledby="ai-matching-title">
    <div className="card-heading"><div><span>ASSISTANT IA</span><h3 id="ai-matching-title">Freelances recommandés</h3></div><button type="button" onClick={generate} disabled={loading}>{loading ? "Analyse…" : matches.length ? "Régénérer" : "Trouver des profils"}</button></div>
    <p>Recommandations calculées à partir des profils, portfolios publiés et avis publiés. À vous de choisir qui contacter.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {hasSearched && matches.length === 0 && !error && <p className="ai-empty-state" role="status">Aucun profil ne présente une correspondance suffisamment forte avec les compétences et éléments vérifiés de ce projet.</p>}
    {matches.map((match) => <article className="ai-match-card" key={match.freelancerId}>
      <div className="ai-match-heading">{match.avatar && <img src={match.avatar} alt="" width="44" height="44"/>}<div><b>{match.name}</b><small>{match.title} · pertinence indicative {match.score}%</small></div></div>
      <p>{match.explanation}</p>{match.strengths.length > 0 && <p><b>Atouts :</b> {match.strengths.join(" · ")}</p>}
      <p><b>Compétences correspondantes :</b> {match.matchedSkills.join(" · ") || "Aucune correspondance exacte"}</p>
      {match.missingSkills.length > 0 && <p><b>Compétences manquantes :</b> {match.missingSkills.join(" · ")}</p>}
      <small>{match.publishedFeedbackCount} avis publiés{match.averagePublishedRating !== null ? ` · moyenne ${match.averagePublishedRating}/5` : ""} · {match.publishedPortfolioCount} portfolio(s) publié(s)</small>
      <div className="ai-match-actions"><button type="button" className="btn btn-secondary" onClick={() => onViewProfile(match.freelancerId)}>Consulter le profil</button><button type="button" className="btn" disabled={!!inviting} onClick={async () => { setInviting(match.freelancerId); try { await onInvite(match); } catch (cause) { setError(cause instanceof Error ? cause.message : "Invitation impossible."); } finally { setInviting(""); } }}>{inviting === match.freelancerId ? "Envoi…" : "Inviter"}</button></div>
    </article>)}
  </section>;
}

export function ProjectBreakdownAssistant({
  projectId,
  onCreateTask,
  onTasksCreated,
  onTasksFailed,
}: {
  projectId: string;
  onCreateTask: (task: ProjectBreakdownSuggestion["tasks"][number]) => Promise<void>;
  onTasksCreated: (count: number) => void;
  onTasksFailed: (createdCount: number) => void;
}) {
  const [suggestion, setSuggestion] = useState<ProjectBreakdownSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [createdKeys, setCreatedKeys] = useState<string[]>([]);
  const [error, setError] = useState("");
  const selected = suggestion?.tasks.filter((task) => task.selected && !createdKeys.includes(task.title.trim().toLocaleLowerCase()) && task.title.trim()) ?? [];

  const generate = async () => {
    setLoading(true);
    setError("");
    setConfirming(false);
    try {
      const next = await aiApi.breakdownProject(projectId);
      setSuggestion({ ...next, tasks: next.tasks.filter((task) => !createdKeys.includes(task.title.trim().toLocaleLowerCase())) });
    } catch {
      setError("Le découpage du projet est indisponible. Réessayez dans quelques instants.");
    } finally {
      setLoading(false);
    }
  };

  const createSelectedTasks = async () => {
    if (creating || selected.length === 0) return;
    setCreating(true);
    setConfirming(false);
    setError("");
    let createdCount = 0;
    try {
      for (const task of selected) {
        await onCreateTask(task);
        createdCount += 1;
        const key = task.title.trim().toLocaleLowerCase();
        setCreatedKeys((current) => current.includes(key) ? current : [...current, key]);
        setSuggestion((current) => current ? { ...current, tasks: current.tasks.filter((item) => item.id !== task.id) } : current);
      }
      onTasksCreated(createdCount);
    } catch {
      setError(createdCount > 0
        ? `La création a échoué après ${createdCount} tâche(s). Les tâches déjà ajoutées ont été retirées des suggestions.`
        : "Impossible de créer les tâches sélectionnées. Vérifiez votre connexion et réessayez.");
      onTasksFailed(createdCount);
    } finally {
      setCreating(false);
    }
  };

  const updateTask = (id: string, update: Partial<ProjectBreakdownSuggestion["tasks"][number]>) => {
    setSuggestion((current) => current ? { ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, ...update } : task) } : current);
  };

  return <section className="dash-card ai-breakdown" aria-labelledby="ai-breakdown-title">
    <div className="card-heading"><div><span>ASSISTANT IA</span><h3 id="ai-breakdown-title">Découper le projet</h3></div><button type="button" onClick={generate} disabled={loading || creating}>{loading ? "Génération…" : suggestion ? "Régénérer" : "Proposer des tâches"}</button></div>
    <p>Relisez, modifiez et sélectionnez les tâches. Rien ne sera créé sans votre confirmation.</p>
    {loading && <p className="ai-loading" role="status">Préparation des suggestions…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {suggestion && <>
      <p className="ai-breakdown-summary">{suggestion.summary}</p>
      {suggestion.phases.length > 0 && <div className="ai-phases"><b>Phases proposées</b>{suggestion.phases.map((phase) => <div key={phase.name}><span>{phase.name}</span><small>{phase.description}{phase.indicativeDays ? ` · ${phase.indicativeDays} jours indicatifs` : ""}</small></div>)}</div>}
      {suggestion.tasks.length === 0 && <p className="ai-empty-state" role="status">Toutes les suggestions ont déjà été ajoutées ou retirées.</p>}
      {suggestion.tasks.map((task) => <article className="ai-breakdown-task" key={task.id}>
        <label className="ai-task-title"><input type="checkbox" checked={task.selected} disabled={creating} onChange={(event) => updateTask(task.id, { selected: event.target.checked })}/><input aria-label="Titre de la tâche" disabled={creating} value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })}/></label>
        <textarea aria-label="Description de la tâche" disabled={creating} value={task.description} onChange={(event) => updateTask(task.id, { description: event.target.value })}/>
        <label className="ai-deliverable"><span>Livrable indicatif</span><input aria-label="Livrable indicatif" disabled={creating} value={task.deliverable} onChange={(event) => updateTask(task.id, { deliverable: event.target.value })}/></label>
        <div className="ai-task-meta"><select aria-label="Priorité" disabled={creating} value={task.priority} onChange={(event) => updateTask(task.id, { priority: event.target.value as typeof task.priority })}><option value="low">Basse</option><option value="medium">Moyenne</option><option value="high">Haute</option></select><span>{task.phase}</span>{task.indicativeDays && <span>{task.indicativeDays} jours indicatifs</span>}<button type="button" disabled={creating} onClick={() => setSuggestion((current) => current ? { ...current, tasks: current.tasks.filter((item) => item.id !== task.id) } : current)}>Retirer</button></div>
        {task.dependsOn.length > 0 && <small>Dépend de : {task.dependsOn.join(", ")}</small>}
      </article>)}
      <div className="ai-breakdown-footer">
        <button type="button" className="btn" disabled={creating || selected.length === 0} onClick={() => setConfirming(true)}>{creating ? "Création…" : `Créer les tâches sélectionnées${selected.length ? ` (${selected.length})` : ""}`}</button>
        {confirming && <div className="ai-create-confirm" role="group" aria-label="Confirmer la création des tâches"><p>Ajouter {selected.length} tâche{selected.length > 1 ? "s" : ""} sélectionnée{selected.length > 1 ? "s" : ""} au projet ?</p><div><button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Annuler</button><button type="button" className="btn" onClick={createSelectedTasks}>Confirmer l’ajout</button></div></div>}
      </div>
    </>}
  </section>;
}
