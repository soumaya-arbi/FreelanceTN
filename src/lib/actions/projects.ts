"use server";

// Server Actions du module projets. Aucune règle métier ici : la session est
// vérifiée, le service applique les règles puis l'on sérialise la réponse.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { getSessionUser, requireUser } from "@/lib/server/session";
import { serialize } from "@/lib/server/serialize";
import { revalidateApp } from "@/lib/server/revalidate";
import * as projectService from "@/lib/server/services/projects";
import type {
  CreateMilestoneInput,
  CreateProjectInput,
  MilestoneActionInput,
  ProjectCatalogParams,
  UpdateProjectInput,
} from "@/lib/server/services/projects";

/** Projets du compte connecté, tous statuts confondus. */
export async function listProjects(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await projectService.listProjects(user));
  });
}

/** Catalogue public : projets publiés et non attribués. */
export async function listProjectCatalog(
  params: ProjectCatalogParams,
): Promise<ActionResult<unknown>> {
  return runAction(async () => serialize(await projectService.listProjectCatalog(params)));
}

/** Projets approuvés par un client pour le freelance connecté. */
export async function listAssignedProjects(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await projectService.listAssignedProjects(user));
  });
}

/** Comptes freelances qu'un client peut approuver sur un projet. */
export async function listProjectAssignees(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await projectService.listProjectAssignees(user));
  });
}

/** Consultation d'un projet (catalogue public ou projet privé autorisé). */
export async function getProject(id: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await getSessionUser();
    return serialize(await projectService.getProject(user?.id ?? null, id));
  });
}

export async function createProject(input: CreateProjectInput): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const project = await projectService.createProject(user, input);
    revalidateApp();
    return serialize(project);
  });
}

export async function updateProject(
  id: string,
  input: UpdateProjectInput,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const project = await projectService.updateProject(user, id, input);
    revalidateApp();
    return serialize(project);
  });
}

export async function submitProjectForReview(
  id: string,
  message?: string,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const project = await projectService.submitProjectForReview(user, id, message);
    revalidateApp();
    return serialize(project);
  });
}

export async function deleteProject(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await projectService.deleteProject(user, id);
    revalidateApp();
    return null;
  });
}

export async function reopenProject(
  id: string,
  message?: string,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const project = await projectService.reopenProject(user, id, message);
    revalidateApp();
    return serialize(project);
  });
}

export async function projectMilestoneAction(
  projectId: string,
  milestoneId: string,
  input: MilestoneActionInput,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const project = await projectService.projectMilestoneAction(user, projectId, milestoneId, input);
    revalidateApp();
    return serialize(project);
  });
}

export async function addProjectMilestone(
  projectId: string,
  input: CreateMilestoneInput,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const project = await projectService.addProjectMilestone(user, projectId, input);
    revalidateApp();
    return serialize(project);
  });
}

/** Catégories réellement présentes dans le catalogue. */
export async function listProjectCatalogCategories(): Promise<ActionResult<unknown>> {
  return runAction(async () => serialize(await projectService.listProjectCatalogCategories()));
}
