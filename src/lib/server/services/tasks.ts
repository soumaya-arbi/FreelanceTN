// Règles métier du module tâches.
// Port fidèle de backend/src/FreelanceTn.Api/Services/TaskService.cs :
// accès limité au propriétaire du projet et au freelance assigné, transitions
// de statut encadrées, historique, commentaires et notifications.

import { ObjectId } from "mongodb";
import type { SessionUser } from "@/lib/server/session";
import { forbidden, notFound, validationError } from "@/lib/server/errors";
import { createNotification } from "@/lib/server/notifications";
import { number, text, toObjectId } from "@/lib/server/serialize";
import { findUserById } from "@/lib/server/repositories/users";
import {
  deleteTaskById,
  deleteTaskComments,
  findAccessibleProjects,
  findProjectById,
  findTaskById,
  findTaskComments,
  findTasksByProjectIds,
  insertTask,
  insertTaskComment,
  replaceTask,
  type ProjectAccessDocument,
  type TaskCommentDocument,
  type TaskDocument,
  type TaskStatusHistoryDocument,
} from "@/lib/server/repositories/tasks";

export type TaskStatusHistoryDto = {
  status: string;
  changedBy: string;
  changedAt: string;
  note: string | null;
};

export type TaskDto = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  assignee: string;
  assigneeUserId: string;
  assigneeRole: string;
  status: string;
  priority: string;
  storyPoints: number;
  startDate: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  statusHistory: TaskStatusHistoryDto[];
};

export type TaskCommentDto = {
  id: string;
  taskId: string;
  projectId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

const INVALID_PROJECT_ID = "Identifiant de projet invalide.";
const PROJECT_NOT_FOUND = "Projet introuvable.";
const ACCESS_DENIED = "Accès refusé au projet.";
const INVALID_TASK_ID = "Identifiant de tâche invalide.";
const TASK_NOT_FOUND = "Tâche introuvable.";
const ASSIGNEE_RULE = "Le responsable doit être le freelance ou le client du projet.";
const EMPTY_COMMENT = "Le commentaire ne peut pas être vide.";
const TRANSITION_DENIED = "Transition de statut non autorisée.";
const COMMENT_REQUIRED = "Un commentaire est requis pour demander des corrections.";

function idOf(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  return typeof value === "string" ? value : "";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

/** DisplayName identique à TaskService (nom complet, sinon e-mail, sinon repli). */
function displayName(doc: Record<string, unknown> | null, fallback: string): string {
  if (!doc) return fallback;
  const name = `${text(doc.firstName)} ${text(doc.lastName)}`.trim();
  return name || text(doc.email);
}

function mapHistory(entry: TaskStatusHistoryDocument): TaskStatusHistoryDto {
  return {
    status: text(entry.Status),
    changedBy: text(entry.ChangedBy),
    changedAt: iso(entry.ChangedAt),
    note: typeof entry.Note === "string" ? entry.Note : null,
  };
}

/** TaskResponse du contrôleur .NET (camelCase, dates ISO). */
export function toTaskDto(task: TaskDocument): TaskDto {
  return {
    id: idOf(task._id),
    projectId: idOf(task.ProjectId),
    title: text(task.Title),
    description: text(task.Description),
    assignee: text(task.Assignee),
    assigneeUserId: text(task.AssigneeUserId),
    assigneeRole: text(task.AssigneeRole, "freelancer"),
    status: text(task.Status, "todo"),
    priority: text(task.Priority, "medium"),
    storyPoints: number(task.StoryPoints),
    startDate: iso(task.StartDate),
    dueDate: iso(task.DueDate),
    createdAt: iso(task.CreatedAt),
    updatedAt: iso(task.UpdatedAt),
    statusHistory: Array.isArray(task.StatusHistory) ? task.StatusHistory.map(mapHistory) : [],
  };
}

/** TaskComment renvoyé tel quel par le contrôleur .NET (camelCase). */
export function toTaskCommentDto(comment: TaskCommentDocument): TaskCommentDto {
  return {
    id: idOf(comment._id),
    taskId: idOf(comment.TaskId),
    projectId: idOf(comment.ProjectId),
    authorId: text(comment.AuthorId),
    authorName: text(comment.AuthorName),
    authorAvatar: text(comment.AuthorAvatar),
    authorRole: text(comment.AuthorRole),
    content: text(comment.Content),
    createdAt: iso(comment.CreatedAt),
    updatedAt: iso(comment.UpdatedAt),
  };
}

function hasValue(input: Record<string, unknown>, key: string): boolean {
  return input[key] !== undefined && input[key] !== null;
}

function optionalText(input: Record<string, unknown>, key: string): string | null {
  if (!hasValue(input, key)) return null;
  const value = input[key];
  if (typeof value !== "string") throw validationError("Données invalides.");
  return value;
}

function storyPointsOf(input: Record<string, unknown>, fallback: number): number {
  if (!hasValue(input, "storyPoints")) return fallback;
  const value = input.storyPoints;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed)) {
    throw validationError("Les points d'histoire doivent être un nombre entier.");
  }
  return parsed;
}

function dateOf(input: Record<string, unknown>, key: string, message: string): Date | null {
  if (!hasValue(input, key)) return null;
  const value = input[key];
  if (value === "") return null;
  const parsed =
    value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw validationError(message);
  return parsed;
}

async function loadProject(projectId: string): Promise<ProjectAccessDocument> {
  if (!toObjectId(projectId)) throw validationError(INVALID_PROJECT_ID);
  const project = await findProjectById(projectId);
  if (!project) throw notFound(PROJECT_NOT_FOUND);
  return project;
}

/** Contrôle d'accès du service .NET : propriétaire du projet ou freelance assigné. */
async function validateAccess(
  projectId: string,
  requesterId: string,
): Promise<ProjectAccessDocument> {
  const project = await loadProject(projectId);
  const ownerId = text(project.ownerId);
  const assignedTo = text(project.assignedTo);
  if (ownerId !== requesterId && assignedTo !== requesterId) {
    throw forbidden(ACCESS_DENIED);
  }
  return project;
}

async function loadTaskForUser(user: SessionUser, taskId: string): Promise<TaskDocument> {
  if (!toObjectId(taskId)) throw validationError(INVALID_TASK_ID);
  const task = await findTaskById(taskId);
  if (!task) throw notFound(TASK_NOT_FOUND);
  await validateAccess(idOf(task.ProjectId), user.id);
  return task;
}

type NotifyOptions = {
  recipientIds: string[];
  type: string;
  message: string;
  taskTitle: string;
  projectTitle: string;
  actorName: string;
  taskId: string;
  projectId: string;
  actorId: string;
};

/** NotificationService/TaskService.NotifyAsync : jamais pour l'auteur, ids valides uniquement. */
async function notify(options: NotifyOptions): Promise<void> {
  const seen = new Set<string>();
  for (const raw of options.recipientIds) {
    const recipientId = typeof raw === "string" ? raw.trim() : "";
    if (!recipientId || recipientId === options.actorId) continue;
    if (!toObjectId(recipientId)) continue;
    if (seen.has(recipientId)) continue;
    seen.add(recipientId);
    await createNotification({
      recipientId,
      type: options.type,
      title: options.taskTitle,
      message: options.message,
      taskId: options.taskId,
      projectId: options.projectId,
      taskTitle: options.taskTitle,
      projectTitle: options.projectTitle,
      actorName: options.actorName,
    });
  }
}

function validateTransition(
  current: string,
  next: string,
  isOwner: boolean,
  isFreelancer: boolean,
  comment: string | null,
): void {
  const allowed = new Set<string>();
  if (isFreelancer) {
    allowed.add("todo|in-progress");
    allowed.add("in-progress|in-review");
  }
  if (isOwner) {
    allowed.add("in-review|done");
    allowed.add("in-review|in-progress");
  }
  if (!allowed.has(`${current}|${next}`)) throw forbidden(TRANSITION_DENIED);
  if (current === "in-review" && next === "in-progress" && (comment ?? "").trim() === "") {
    throw validationError(COMMENT_REQUIRED);
  }
}

function statusNotification(
  newStatus: string,
  previousStatus: string,
  taskTitle: string,
  comment: string | null,
): { type: string; message: string } {
  if (newStatus === "in-review") {
    return {
      type: "review",
      message: `La tâche « ${taskTitle} » a été soumise pour validation.`,
    };
  }
  if (newStatus === "done") {
    return { type: "approve", message: `La tâche « ${taskTitle} » a été approuvée.` };
  }
  if (previousStatus === "in-review" && newStatus === "in-progress") {
    return {
      type: "reject",
      message: `Des corrections sont demandées pour « ${taskTitle} » : ${comment ?? ""}`,
    };
  }
  return { type: "status", message: `Le statut de « ${taskTitle} » est maintenant ${newStatus}.` };
}

export async function listTasks(user: SessionUser): Promise<TaskDto[]> {
  const projects = await findAccessibleProjects(user.id);
  const projectIds = projects
    .map((project) => (project._id instanceof ObjectId ? project._id : toObjectId(idOf(project._id))))
    .filter((id): id is ObjectId => id !== null);
  const tasks = await findTasksByProjectIds(projectIds);
  return tasks.map(toTaskDto);
}

export async function getTask(user: SessionUser, taskId: string): Promise<TaskDto> {
  const task = await loadTaskForUser(user, taskId);
  return toTaskDto(task);
}

export async function createTask(
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<TaskDto> {
  const projectIdValue = input.projectId;
  if (typeof projectIdValue !== "string" || projectIdValue.trim() === "") {
    throw validationError("L'identifiant du projet est requis.");
  }
  const projectId = projectIdValue.trim();

  const titleValue = typeof input.title === "string" ? input.title : "";
  if (titleValue.trim() === "") throw validationError("Le titre est requis.");

  const project = await validateAccess(projectId, user.id);

  const requesterId = user.id;
  const assigneeUserIdInput = text(input.assigneeUserId).trim();
  const assigneeUserId = assigneeUserIdInput || requesterId;
  const assigneeRoleInput = text(input.assigneeRole).trim().toLowerCase();
  const assigneeRole = assigneeRoleInput || "freelancer";
  const assigneeUser = await findUserById(assigneeUserId);
  const assigneeInput = text(input.assignee).trim();
  const assigneeName = assigneeInput || displayName(assigneeUser, assigneeUserId);

  const allowed = new Set<string>([text(project.ownerId)]);
  if (text(project.assignedTo).trim() !== "") allowed.add(text(project.assignedTo));
  if (!allowed.has(assigneeUserId)) throw validationError(ASSIGNEE_RULE);

  const statusInput = text(input.status).trim().toLowerCase();
  const status = statusInput || "todo";
  const priority = typeof input.priority === "string" ? input.priority : "medium";
  const storyPoints = storyPointsOf(input, 0);
  const now = new Date();
  const startDate =
    dateOf(input, "startDate", "La date de début est invalide.") ?? now;
  const dueDate =
    dateOf(input, "dueDate", "La date d'échéance est invalide.") ??
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const task: TaskDocument = {
    _id: new ObjectId(),
    ProjectId: project._id,
    Title: titleValue,
    Description: typeof input.description === "string" ? input.description : "",
    Assignee: assigneeName,
    AssigneeUserId: assigneeUserId,
    AssigneeRole: assigneeRole,
    Status: status,
    Priority: priority,
    StoryPoints: storyPoints,
    StartDate: startDate,
    DueDate: dueDate,
    CreatedAt: now,
    UpdatedAt: now,
    StatusHistory: [
      {
        Status: status,
        ChangedBy: requesterId,
        ChangedAt: now,
        Note: "Création",
      },
    ],
  };

  await insertTask(task);

  const actorName = displayName(user.doc, requesterId);
  await notify({
    recipientIds: [assigneeUserId],
    type: "assign",
    message: `Vous avez été assigné à la tâche « ${text(task.Title)} ».`,
    taskTitle: text(task.Title),
    projectTitle: text(project.title),
    actorName,
    taskId: idOf(task._id),
    projectId: idOf(task.ProjectId),
    actorId: requesterId,
  });

  return toTaskDto(task);
}

export async function updateTask(
  user: SessionUser,
  taskId: string,
  input: Record<string, unknown>,
): Promise<TaskDto> {
  const task = await loadTaskForUser(user, taskId);
  const project = await loadProject(idOf(task.ProjectId));
  const requesterId = user.id;
  const ownerId = text(project.ownerId);
  const assignedTo = text(project.assignedTo);
  const isOwner = ownerId === requesterId;
  const isFreelancer = assignedTo === requesterId;

  const history: TaskStatusHistoryDocument[] = Array.isArray(task.StatusHistory)
    ? task.StatusHistory
    : [];
  task.StatusHistory = history;

  const titleInput = optionalText(input, "title");
  if (titleInput !== null) task.Title = titleInput;
  const descriptionInput = optionalText(input, "description");
  if (descriptionInput !== null) task.Description = descriptionInput;
  const priorityInput = optionalText(input, "priority");
  if (priorityInput !== null) task.Priority = priorityInput;
  const storyPointsInput = storyPointsOf(input, Number.NaN);
  if (!Number.isNaN(storyPointsInput)) task.StoryPoints = storyPointsInput;
  const startDateInput = dateOf(input, "startDate", "La date de début est invalide.");
  if (startDateInput !== null) task.StartDate = startDateInput;
  const dueDateInput = dateOf(input, "dueDate", "La date d'échéance est invalide.");
  if (dueDateInput !== null) task.DueDate = dueDateInput;

  const assigneeUserIdInput = optionalText(input, "assigneeUserId");
  const assigneeInput = optionalText(input, "assignee");
  const assigneeRoleInput = optionalText(input, "assigneeRole");

  // Réassignation : déclenchée dès qu'un des trois champs est fourni.
  if (
    assigneeUserIdInput !== null ||
    assigneeInput !== null ||
    assigneeRoleInput !== null
  ) {
    let newAssigneeUserId =
      assigneeUserIdInput !== null
        ? assigneeUserIdInput.trim()
        : text(task.AssigneeUserId);
    if (newAssigneeUserId.trim() === "") newAssigneeUserId = text(task.AssigneeUserId);

    const allowed = new Set<string>([ownerId]);
    if (assignedTo.trim() !== "") allowed.add(assignedTo);
    if (!allowed.has(newAssigneeUserId)) throw validationError(ASSIGNEE_RULE);

    let newRole =
      assigneeRoleInput !== null
        ? assigneeRoleInput.trim().toLowerCase()
        : text(task.AssigneeRole);
    if (newRole.trim() === "") newRole = text(task.AssigneeRole);

    const assigneeUser = await findUserById(newAssigneeUserId);
    const newName =
      assigneeInput !== null
        ? assigneeInput.trim()
        : displayName(assigneeUser, newAssigneeUserId);

    if (
      newAssigneeUserId !== text(task.AssigneeUserId) ||
      newRole !== text(task.AssigneeRole) ||
      newName !== text(task.Assignee)
    ) {
      task.AssigneeUserId = newAssigneeUserId;
      task.AssigneeRole = newRole;
      task.Assignee = newName;
      history.push({
        Status: text(task.Status),
        ChangedBy: requesterId,
        ChangedAt: new Date(),
        Note: `Réassignation à ${newName}`,
      });
      await notify({
        recipientIds: [newAssigneeUserId],
        type: "assign",
        message: `Vous avez été assigné à la tâche « ${text(task.Title)} ».`,
        taskTitle: text(task.Title),
        projectTitle: text(project.title),
        actorName: displayName(user.doc, requesterId),
        taskId: idOf(task._id),
        projectId: idOf(task.ProjectId),
        actorId: requesterId,
      });
    }
  }

  // Changement de statut : transitions contrôlées + notification + commentaire.
  const statusInput = optionalText(input, "status");
  if (statusInput !== null) {
    const newStatus = statusInput.trim().toLowerCase();
    const previousStatus = text(task.Status);
    if (newStatus !== previousStatus) {
      const comment = optionalText(input, "comment");
      validateTransition(previousStatus, newStatus, isOwner, isFreelancer, comment);
      task.Status = newStatus;
      history.push({
        Status: newStatus,
        ChangedBy: requesterId,
        ChangedAt: new Date(),
        Note: comment,
      });

      const actorName = displayName(user.doc, requesterId);
      let recipient = isOwner ? text(task.AssigneeUserId) : ownerId;
      if (recipient.trim() === "") recipient = isOwner ? assignedTo : ownerId;

      const notification = statusNotification(
        newStatus,
        previousStatus,
        text(task.Title),
        comment,
      );
      await notify({
        recipientIds: [recipient],
        type: notification.type,
        message: notification.message,
        taskTitle: text(task.Title),
        projectTitle: text(project.title),
        actorName,
        taskId: idOf(task._id),
        projectId: idOf(task.ProjectId),
        actorId: requesterId,
      });

      if (
        comment !== null &&
        comment.trim() !== "" &&
        (newStatus === "in-progress" || newStatus === "done")
      ) {
        const now = new Date();
        await insertTaskComment({
          _id: new ObjectId(),
          TaskId: task._id,
          ProjectId: task.ProjectId,
          AuthorId: requesterId,
          AuthorName: actorName,
          AuthorAvatar: text(user.doc.avatar),
          AuthorRole: isOwner ? "client" : "freelancer",
          Content: comment.trim(),
          CreatedAt: now,
          UpdatedAt: now,
        });
      }
    }
  }

  const projectIdInput = optionalText(input, "projectId");
  if (projectIdInput !== null && projectIdInput !== idOf(task.ProjectId)) {
    const newProject = await validateAccess(projectIdInput.trim(), requesterId);
    task.ProjectId = newProject._id;
  }

  task.UpdatedAt = new Date();
  await replaceTask(task);
  return toTaskDto(task);
}

export async function deleteTask(user: SessionUser, taskId: string): Promise<void> {
  const task = await loadTaskForUser(user, taskId);
  const id = idOf(task._id);
  await deleteTaskById(id);
  await deleteTaskComments(id);
}

export async function listTaskComments(
  user: SessionUser,
  taskId: string,
): Promise<TaskCommentDto[]> {
  const task = await loadTaskForUser(user, taskId);
  const comments = await findTaskComments(idOf(task._id));
  return comments.map(toTaskCommentDto);
}

export async function addTaskComment(
  user: SessionUser,
  taskId: string,
  content: string,
): Promise<TaskCommentDto> {
  const trimmed = typeof content === "string" ? content.trim() : "";
  if (trimmed === "") throw validationError(EMPTY_COMMENT);

  const task = await loadTaskForUser(user, taskId);
  const project = await loadProject(idOf(task.ProjectId));
  const requesterId = user.id;
  const isOwner = text(project.ownerId) === requesterId;
  const actorName = displayName(user.doc, requesterId);
  const now = new Date();

  const comment: TaskCommentDocument = {
    _id: new ObjectId(),
    TaskId: task._id,
    ProjectId: task.ProjectId,
    AuthorId: requesterId,
    AuthorName: actorName,
    AuthorAvatar: text(user.doc.avatar),
    AuthorRole: isOwner ? "client" : "freelancer",
    Content: trimmed,
    CreatedAt: now,
    UpdatedAt: now,
  };
  await insertTaskComment(comment);

  let otherRecipient = isOwner ? text(task.AssigneeUserId) : text(project.ownerId);
  if (otherRecipient.trim() === "") {
    otherRecipient = isOwner ? text(project.assignedTo) : text(project.ownerId);
  }
  if (otherRecipient.trim() !== "" && otherRecipient !== requesterId) {
    await notify({
      recipientIds: [otherRecipient],
      type: "comment",
      message: `${actorName} a commenté « ${text(task.Title)} ».`,
      taskTitle: text(task.Title),
      projectTitle: text(project.title),
      actorName,
      taskId: idOf(task._id),
      projectId: idOf(task.ProjectId),
      actorId: requesterId,
    });
  }

  return toTaskCommentDto(comment);
}
