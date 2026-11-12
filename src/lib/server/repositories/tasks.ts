// Accès MongoDB du module tâches.
//
// Les collections "tasks" et "task_comments" stockent des champs PascalCase
// (mêmes noms que les modèles C# Task / TaskComment). Les identifiants de
// projet/tâche sont des ObjectId, alors que OwnerId / AssignedTo / AuthorId
// restent des chaînes hexadécimales. Aucune règle métier ici.

import { ObjectId, type Filter } from "mongodb";
import { COLLECTIONS, getCollection } from "@/lib/server/db";
import { toObjectId } from "@/lib/server/serialize";

export type TaskStatusHistoryDocument = {
  Status?: string;
  ChangedBy?: string;
  ChangedAt?: Date;
  Note?: string | null;
};

export type TaskDocument = {
  _id: ObjectId;
  ProjectId: ObjectId;
  Title?: string;
  Description?: string;
  Assignee?: string;
  AssigneeUserId?: string;
  AssigneeRole?: string;
  Status?: string;
  Priority?: string;
  StoryPoints?: number;
  StartDate?: Date;
  DueDate?: Date;
  CreatedAt?: Date;
  UpdatedAt?: Date;
  StatusHistory?: TaskStatusHistoryDocument[];
};

export type TaskCommentDocument = {
  _id: ObjectId;
  TaskId: ObjectId;
  ProjectId: ObjectId;
  AuthorId?: string;
  AuthorName?: string;
  AuthorAvatar?: string;
  AuthorRole?: string;
  Content?: string;
  CreatedAt?: Date;
  UpdatedAt?: Date;
};

/** Projection minimale d'un projet nécessaire aux contrôles d'accès. */
export type ProjectAccessDocument = {
  _id: ObjectId;
  ownerId?: string;
  assignedTo?: string | null;
  title?: string;
};

export async function findTaskById(id: string): Promise<TaskDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const tasks = await getCollection<TaskDocument>(COLLECTIONS.tasks);
  return await tasks.findOne({ _id: objectId });
}

export async function findTasksByProjectIds(projectIds: ObjectId[]): Promise<TaskDocument[]> {
  if (projectIds.length === 0) return [];
  const tasks = await getCollection<TaskDocument>(COLLECTIONS.tasks);
  const filter: Filter<TaskDocument> = { ProjectId: { $in: projectIds } };
  return await tasks.find(filter).sort({ UpdatedAt: -1 }).toArray();
}

export async function insertTask(task: TaskDocument): Promise<void> {
  const tasks = await getCollection<TaskDocument>(COLLECTIONS.tasks);
  await tasks.insertOne(task);
}

export async function replaceTask(task: TaskDocument): Promise<void> {
  const tasks = await getCollection<TaskDocument>(COLLECTIONS.tasks);
  await tasks.replaceOne({ _id: task._id }, task);
}

export async function deleteTaskById(id: string): Promise<void> {
  const objectId = toObjectId(id);
  if (!objectId) return;
  const tasks = await getCollection<TaskDocument>(COLLECTIONS.tasks);
  await tasks.deleteOne({ _id: objectId });
}

export async function findTaskComments(taskId: string): Promise<TaskCommentDocument[]> {
  const objectId = toObjectId(taskId);
  if (!objectId) return [];
  const comments = await getCollection<TaskCommentDocument>(COLLECTIONS.taskComments);
  return await comments.find({ TaskId: objectId }).sort({ CreatedAt: 1 }).toArray();
}

export async function insertTaskComment(comment: TaskCommentDocument): Promise<void> {
  const comments = await getCollection<TaskCommentDocument>(COLLECTIONS.taskComments);
  await comments.insertOne(comment);
}

export async function deleteTaskComments(taskId: string): Promise<void> {
  const objectId = toObjectId(taskId);
  if (!objectId) return;
  const comments = await getCollection<TaskCommentDocument>(COLLECTIONS.taskComments);
  await comments.deleteMany({ TaskId: objectId });
}

export async function findProjectById(id: string): Promise<ProjectAccessDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const projects = await getCollection<ProjectAccessDocument>(COLLECTIONS.projects);
  return await projects.findOne(
    { _id: objectId },
    { projection: { ownerId: 1, assignedTo: 1, title: 1 } },
  );
}

/** Projets dont l'utilisateur est propriétaire ou freelance assigné. */
export async function findAccessibleProjects(userId: string): Promise<ProjectAccessDocument[]> {
  const projects = await getCollection<ProjectAccessDocument>(COLLECTIONS.projects);
  const filter: Filter<ProjectAccessDocument> = {
    $or: [{ ownerId: userId }, { assignedTo: userId }],
  };
  return await projects
    .find(filter, { projection: { ownerId: 1, assignedTo: 1, title: 1 } })
    .toArray();
}
