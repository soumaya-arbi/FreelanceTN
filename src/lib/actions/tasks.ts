"use server";

// Server Actions du module tâches.
// L'identité et le rôle viennent toujours de la session ; le client ne fournit
// que les champs métier. Les sorties sont sérialisées (dates ISO, ids string).

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { serialize } from "@/lib/server/serialize";
import { requireUser } from "@/lib/server/session";
import * as tasksService from "@/lib/server/services/tasks";
import type { TaskCommentDto, TaskDto } from "@/lib/server/services/tasks";

export async function listTasks(): Promise<ActionResult<TaskDto[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await tasksService.listTasks(user)) as TaskDto[];
  });
}

export async function getTask(id: string): Promise<ActionResult<TaskDto>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await tasksService.getTask(user, id)) as TaskDto;
  });
}

export async function createTask(input: Record<string, unknown>): Promise<ActionResult<TaskDto>> {
  return runAction(async () => {
    const user = await requireUser();
    const created = await tasksService.createTask(user, input);
    revalidateApp();
    return serialize(created) as TaskDto;
  });
}

export async function updateTask(
  id: string,
  input: Record<string, unknown>,
): Promise<ActionResult<TaskDto>> {
  return runAction(async () => {
    const user = await requireUser();
    const updated = await tasksService.updateTask(user, id, input);
    revalidateApp();
    return serialize(updated) as TaskDto;
  });
}

export async function deleteTask(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await tasksService.deleteTask(user, id);
    revalidateApp();
    return serialize(null) as null;
  });
}

export async function listTaskComments(id: string): Promise<ActionResult<TaskCommentDto[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await tasksService.listTaskComments(user, id)) as TaskCommentDto[];
  });
}

export async function addTaskComment(
  id: string,
  content: string,
): Promise<ActionResult<TaskCommentDto>> {
  return runAction(async () => {
    const user = await requireUser();
    const comment = await tasksService.addTaskComment(user, id, content);
    revalidateApp();
    return serialize(comment) as TaskCommentDto;
  });
}
