// Accès à la collection "comments" et lecture des projets pour les droits.

import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { toObjectId } from "@/lib/server/serialize";

export type CommentDocument = {
  _id: ObjectId;
  projectId: ObjectId;
  projectTitle: string;
  authorId: ObjectId;
  authorName: string;
  authorAvatar: string;
  authorRole: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CommentProjectDocument = {
  _id: ObjectId;
  title?: string;
  ownerId?: string;
  status?: string;
  assignedTo?: string | null;
};

export async function listCommentsByProject(projectId: string): Promise<CommentDocument[]> {
  const objectId = toObjectId(projectId);
  if (!objectId) return [];
  const comments = await collections.comments();
  return (await comments
    .find({ projectId: objectId })
    .sort({ createdAt: 1 })
    .toArray()) as CommentDocument[];
}

export async function findCommentById(id: string): Promise<CommentDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const comments = await collections.comments();
  return (await comments.findOne({ _id: objectId })) as CommentDocument | null;
}

export async function insertComment(doc: CommentDocument): Promise<void> {
  const comments = await collections.comments();
  await comments.insertOne(doc);
}

export async function replaceComment(doc: CommentDocument): Promise<void> {
  const comments = await collections.comments();
  await comments.replaceOne({ _id: doc._id }, doc);
}

export async function deleteComment(id: string): Promise<void> {
  const objectId = toObjectId(id);
  if (!objectId) return;
  const comments = await collections.comments();
  await comments.deleteOne({ _id: objectId });
}

export async function findCommentProjectById(
  id: string,
): Promise<CommentProjectDocument | null> {
  const objectId = toObjectId(id);
  if (!objectId) return null;
  const projects = await collections.projects();
  return (await projects.findOne({ _id: objectId })) as CommentProjectDocument | null;
}
