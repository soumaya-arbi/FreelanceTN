"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { ClientShell } from "@/components/layout/ClientShell";
import { Icon } from "@/components/ui/Icon";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";

export function AiAssistantHub() {
  const router = useRouter();
  const { go, notify } = useApp();
  const { role, status: authStatus } = useUser();
  const { projects, assignedProjects, catalogProjects } = useMarketplace();
  const client = role === "client";
  const visibleProjects = useMemo(() => {
    const source = client ? projects : [...assignedProjects, ...catalogProjects.filter((project) => project.status === "Open" && !project.assignedTo)];
    return [...new Map(source.map((project) => [project.id, project])).values()];
  }, [assignedProjects, catalogProjects, client, projects]);

  const content = <main className="workspace ai-hub">
    <div className="workspace-title"><div><p>FREELANCETN</p><h1>Assistant IA</h1><span>Des suggestions à relire et valider, toujours sous votre contrôle.</span></div></div>
    <section className="ai-hub-features" aria-label="Fonctionnalités de l’assistant IA">
      <article className="dash-card"><span className="overline">CLIENT</span><h2>Rédiger un brief</h2><p>Transformez une idée en proposition de projet, puis modifiez les champs du formulaire avant toute publication.</p>{client ? <button className="btn" onClick={() => router.push("/client/post")}>Créer un projet</button> : <small>Disponible depuis le formulaire de création de projet client.</small>}</article>
      <article className="dash-card"><span className="overline">CLIENT</span><h2>Recommander des freelances</h2><p>Comparez les compétences et profils réels associés à un projet, puis choisissez manuellement qui inviter.</p><small>Ouvrez un projet ouvert de votre espace pour lancer le matching.</small></article>
      <article className="dash-card"><span className="overline">FREELANCE</span><h2>Préparer une proposition</h2><p>Obtenez un brouillon basé sur le projet et les informations publiées de votre profil. Relisez-le avant l’envoi.</p><small>Disponible dans la fenêtre de candidature d’un projet ouvert.</small></article>
      <article className="dash-card"><span className="overline">CLIENT & FREELANCE</span><h2>Découper un projet accepté</h2><p>Révisez les phases et tâches proposées. Seules les tâches sélectionnées sont créées après votre confirmation.</p><small>Disponible sur le détail d’un projet en cours.</small></article>
    </section>
    <section className="dash-card ai-hub-projects"><div className="card-heading"><div><span>VOTRE ESPACE</span><h2>Continuer depuis un projet</h2></div><button type="button" onClick={() => router.push(client ? "/client/projects" : "/freelancer/find-work")}>{client ? "Tous les projets" : "Parcourir les projets"}</button></div>
      {visibleProjects.length === 0 ? <div className="empty-state"><span><Icon name="briefcase"/></span><b>Aucun projet disponible ici</b><p>{client ? "Publiez un projet pour commencer." : "Les projets qui vous sont attribués apparaîtront ici."}</p></div> : visibleProjects.map((project) => <article className="ai-hub-project" key={project.id}><div><b>{project.title}</b><small>{project.status}{project.assignedToName ? ` · ${project.assignedToName}` : ""}</small></div><button type="button" className="btn btn-secondary" onClick={() => router.push(`/projects/${encodeURIComponent(project.id)}`)}>Ouvrir le projet</button></article>)}
    </section>
  </main>;

  if (authStatus === "authenticated" && client) return <ClientShell page="ai" go={go} notify={notify}>{content}</ClientShell>;
  return <AppShell page="ai" go={go} notify={notify}>{content}</AppShell>;
}
