"use server";

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { getSessionUser, requireUser } from "@/lib/server/session";
import { serialize } from "@/lib/server/serialize";
import * as commentService from "@/lib/server/services/comments";
import type { CommentResponse } from "@/lib/server/services/comments";

export async function listProjectComments(
  projectId: string,
): Promise<ActionResult<CommentResponse[]>> {
  return runAction(async () => {
    const user = await getSessionUser();
    return serialize(
      await commentService.listProjectComments(user, projectId),
    ) as CommentResponse[];
  });
}

export async function createComment(
  projectId: string,
  content: string,
): Promise<ActionResult<CommentResponse>> {
  return runAction(async () => {
    const user = await requireUser();
    const comment = await commentService.createComment(user, projectId, content);
    revalidateApp();
    return serialize(comment) as CommentResponse;
  });
}

export async function updateComment(
  id: string,
  content: string,
): Promise<ActionResult<CommentResponse>> {
  return runAction(async () => {
    const user = await requireUser();
    const comment = await commentService.updateComment(user, id, content);
    revalidateApp();
    return serialize(comment) as CommentResponse;
  });
}

export async function deleteComment(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await commentService.deleteComment(user, id);
    revalidateApp();
    return serialize(null) as null;
  });
}
