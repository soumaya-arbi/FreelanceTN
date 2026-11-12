// Test d'intégration réel contre MongoDB `freelancetn_dev`.
//
// Objectif : vérifier de bout en bout (services + repositories + Mongo) les
// opérations CRUD migrées, les contrôles de rôle/propriété et la parité
// d'arrondi avec le backend .NET. Toutes les données créées sont isolées
// (suffixe unique) et supprimées dans `afterAll`, y compris en cas d'échec.
//
// Lancement : npx vitest run --config vitest.integration.config.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, getDb } from "@/lib/server/db";
import { ActionError } from "@/lib/server/errors";
import type { SessionUser } from "@/lib/server/session";
import {
  createProject,
  deleteProject,
  getProject,
  updateProject,
} from "@/lib/server/services/projects";
import { createQuote, deleteQuote, getQuote, updateQuote } from "@/lib/server/services/quotes";
import { addTaskComment, createTask, deleteTask, listTaskComments, updateTask } from "@/lib/server/services/tasks";

const CLIENT_ID = "6ae44c383b0b092edf1a4ea6"; // clientdev@test.com
const FREELANCER_ID = "6ad7dcc8a4586fa928d1c19d"; // soumayaaarbi@gmail.com

const clientUser: SessionUser = {
  id: CLIENT_ID,
  email: "clientdev@test.com",
  role: "client",
  firstName: "Client",
  lastName: "Dev",
  avatar: "",
  avatarSource: "initials",
  avatarConfig: "",
  doc: {},
};

const freelancerUser: SessionUser = {
  id: FREELANCER_ID,
  email: "soumayaaarbi@gmail.com",
  role: "freelancer",
  firstName: "SOUMAYA",
  lastName: "ARBI",
  avatar: "",
  avatarSource: "initials",
  avatarConfig: "",
  doc: {},
};

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const projectTitle = `zz-audit-projet-${suffix}`;
const taskTitle = `zz-audit-tache-${suffix}`;

let projectId = "";
let quoteId = "";
let taskId = "";

async function expectActionError(promise: Promise<unknown>, status: number): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ActionError);
  expect((error as ActionError).status).toBe(status);
}

beforeAll(async () => {
  // Garde-fou : on refuse de tourner sur une base qui ne serait pas la base de
  // développement attendue.
  const db = await getDb();
  expect(db.databaseName).toBe("freelancetn_dev");
});

afterAll(async () => {
  try {
    if (quoteId) await deleteQuote(freelancerUser, quoteId).catch(() => undefined);
  } catch {}
  try {
    if (taskId) await deleteTask(freelancerUser, taskId).catch(() => undefined);
  } catch {}
  try {
    if (projectId) await deleteProject(clientUser, projectId).catch(() => undefined);
  } catch {}

  // Nettoyage de sécurité si un service a échoué avant la suppression.
  if (projectId && ObjectId.isValid(projectId)) {
    await (await collections.projects()).deleteOne({ _id: new ObjectId(projectId) });
  }
  if (quoteId && ObjectId.isValid(quoteId)) {
    await (await collections.quotes()).deleteOne({ _id: new ObjectId(quoteId) });
  }
  if (taskId && ObjectId.isValid(taskId)) {
    await (await collections.tasks()).deleteOne({ _id: new ObjectId(taskId) });
    await (await collections.taskComments()).deleteMany({ TaskId: taskId });
  }
  await (await collections.notifications()).deleteMany({
    $or: [{ ProjectId: projectId }, { TaskId: taskId }, { TaskTitle: taskTitle }],
  });
});

describe("CRUD projets (client)", () => {
  it("crée, relit et met à jour un projet temporaire", async () => {
    const created = await createProject(clientUser, {
      title: projectTitle,
      description: "Projet temporaire de test d'intégration (supprimé ensuite).",
      budget: "500 - 1000 TND",
      budgetMin: 500,
      budgetMax: 1000,
      type: "Fixed price",
      client: "Client Dev",
      status: "Open",
      skills: ["TypeScript"],
    });
    projectId = String((created as { id: string }).id);
    expect(ObjectId.isValid(projectId)).toBe(true);

    const fetched = await getProject(clientUser.id, projectId);
    expect((fetched as { title: string }).title).toBe(projectTitle);
    expect((fetched as { ownerId: string }).ownerId).toBe(CLIENT_ID);

    const updated = await updateProject(clientUser, projectId, {
      title: `${projectTitle}-modifie`,
      description: "Description mise à jour.",
    });
    expect((updated as { title: string }).title).toBe(`${projectTitle}-modifie`);
  });

  it("refuse la modification par un freelancer non propriétaire (403)", async () => {
    await expectActionError(
      updateProject(freelancerUser, projectId, { title: "intrusion" }),
      403,
    );
  });

  it("autorise la consultation d'un projet ouvert mais pas sa modification par un tiers", async () => {
    // Un projet "Open" est visible dans le catalogue par les freelancers.
    const other = { ...clientUser, id: "6ae44c383b0b092edf1a4ea7", role: "freelancer" as const };
    const visible = await getProject(other.id, projectId);
    expect((visible as { title: string }).title).toBe(`${projectTitle}-modifie`);

    // En revanche, un autre client ne peut ni le modifier ni le supprimer.
    const otherClient = { ...clientUser, id: "6ae44d068671220b55859d76" };
    await expect(updateProject(otherClient, projectId, { title: "intrusion" })).rejects.toBeInstanceOf(
      ActionError,
    );
  });
});

describe("CRUD tâches (projet temporaire)", () => {
  it("assigne le freelance puis crée, commente et met à jour une tâche", async () => {
    await (await collections.projects()).updateOne(
      { _id: new ObjectId(projectId) },
      { $set: { assignedTo: FREELANCER_ID, assignedToName: "SOUMAYA ARBI", assignedAt: new Date() } },
    );

    const task = await createTask(freelancerUser, {
      projectId,
      title: taskTitle,
      description: "Tâche temporaire de test.",
      assigneeUserId: FREELANCER_ID,
      assigneeRole: "freelancer",
      status: "todo",
      priority: "medium",
    });
    taskId = String((task as { id: string }).id);

    const comment = await addTaskComment(freelancerUser, taskId, "Commentaire de test.");
    expect(String((comment as { content: string }).content)).toBe("Commentaire de test.");
    const comments = await listTaskComments(freelancerUser, taskId);
    expect(comments.length).toBeGreaterThanOrEqual(1);

    const updated = await updateTask(freelancerUser, taskId, { title: `${taskTitle}-maj`, priority: "high" });
    expect(String((updated as { title: string }).title)).toBe(`${taskTitle}-maj`);
  });

  it("refuse l'accès à la tâche par un tiers (403)", async () => {
    const stranger = { ...freelancerUser, id: "6ae44c383b0b092edf1a4ea7" };
    await expectActionError(updateTask(stranger, taskId, { title: "intrusion" }), 403);
  });
});

describe("CRUD devis + arrondi financier", () => {
  it("crée un devis et applique l'arrondi au pair identique à .NET", async () => {
    const quote = await createQuote(freelancerUser, {
      projectId,
      clientId: CLIENT_ID,
      client: "Client Dev",
      project: `${projectTitle}-modifie`,
      issueDate: "2026-11-10",
      validUntil: "2026-12-10",
      lines: [
        {
          description: "Ligne de test 1.0005",
          quantity: 3,
          unitPrice: 0.3335,
          taxRate: 0,
          discount: 0,
        },
      ],
    });
    quoteId = String((quote as { id: string }).id);
    expect(ObjectId.isValid(quoteId)).toBe(true);

    // 3 x 0.3335 = 1.0005 -> Math.Round(1.0005m, 3) = 1.000 (arrondi au pair).
    expect(Number((quote as { subtotal: number }).subtotal)).toBe(1);
    expect(Number((quote as { total: number }).total)).toBe(1);
  });

  it("met à jour les lignes et conserve l'arrondi au pair", async () => {
    const updated = await updateQuote(freelancerUser, quoteId, {
      lines: [
        {
          description: "Ligne de test 1.0015",
          quantity: 1,
          unitPrice: 1.0015,
          taxRate: 0,
          discount: 0,
        },
      ],
    });
    expect(Number((updated as { subtotal: number }).subtotal)).toBe(1.002);
    expect(Number((updated as { total: number }).total)).toBe(1.002);

    const fetched = await getQuote(freelancerUser, quoteId);
    expect(Number((fetched as { total: number }).total)).toBe(1.002);
  });

  it("refuse la suppression par un tiers (403)", async () => {
    await expectActionError(deleteQuote(clientUser, quoteId), 403);
  });
});
