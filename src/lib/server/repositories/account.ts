// Accès aux collections du module Account Settings.
//
// Les collections de compte utilisent "userId"/"ownerId" en ObjectId (même
// convention que les modèles C# avec BsonRepresentation ObjectId) et des champs
// camelCase pour le reste. Le document "users" est lu via repositories/users.

import { ObjectId } from "mongodb";
import { COLLECTIONS, getCollection } from "@/lib/server/db";

export type BillingHistoryDocument = {
  changedAt?: Date;
  changedByUserId?: string;
  fields?: string[];
};

export type BillingProfileDocument = Record<string, unknown> & {
  _id: ObjectId;
  userId: ObjectId;
  history?: BillingHistoryDocument[];
  createdAt?: Date;
  updatedAt?: Date;
};

export type UserPreferencesDocument = Record<string, unknown> & {
  _id: ObjectId;
  userId: ObjectId;
};

export type NotificationPreferencesDocument = Record<string, unknown> & {
  _id: ObjectId;
  userId: ObjectId;
};

export type AccountChangeDocument = Record<string, unknown> & {
  _id: ObjectId;
  userId: ObjectId;
};

export type TeamMemberDocument = Record<string, unknown> & {
  _id: ObjectId;
  ownerId: ObjectId;
};

function billingProfiles() {
  return getCollection<BillingProfileDocument>(COLLECTIONS.billingProfiles);
}

function userPreferences() {
  return getCollection<UserPreferencesDocument>(COLLECTIONS.userPreferences);
}

function notificationPreferences() {
  return getCollection<NotificationPreferencesDocument>(
    COLLECTIONS.notificationPreferences,
  );
}

function accountChanges() {
  return getCollection<AccountChangeDocument>(COLLECTIONS.accountChanges);
}

function teamMembers() {
  return getCollection<TeamMemberDocument>(COLLECTIONS.teamMembers);
}

function users() {
  return getCollection<Record<string, unknown>>(COLLECTIONS.users);
}

export async function updateUserFields(
  userId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!ObjectId.isValid(userId)) return;
  const collection = await users();
  await collection.updateOne({ _id: new ObjectId(userId) }, { $set: fields });
}

export async function findBillingProfile(
  userId: string,
): Promise<BillingProfileDocument | null> {
  if (!ObjectId.isValid(userId)) return null;
  const collection = await billingProfiles();
  return collection.findOne({ userId: new ObjectId(userId) });
}

export async function insertBillingProfile(profile: BillingProfileDocument): Promise<void> {
  const collection = await billingProfiles();
  await collection.insertOne(profile);
}

export async function replaceBillingProfile(profile: BillingProfileDocument): Promise<void> {
  const collection = await billingProfiles();
  await collection.replaceOne({ _id: profile._id }, profile);
}

export async function findUserPreferences(
  userId: string,
): Promise<UserPreferencesDocument | null> {
  if (!ObjectId.isValid(userId)) return null;
  const collection = await userPreferences();
  return collection.findOne({ userId: new ObjectId(userId) });
}

export async function insertUserPreferences(
  preferences: UserPreferencesDocument,
): Promise<void> {
  const collection = await userPreferences();
  await collection.insertOne(preferences);
}

export async function replaceUserPreferences(
  preferences: UserPreferencesDocument,
): Promise<void> {
  const collection = await userPreferences();
  await collection.replaceOne({ _id: preferences._id }, preferences);
}

export async function findNotificationPreferences(
  userId: string,
): Promise<NotificationPreferencesDocument | null> {
  if (!ObjectId.isValid(userId)) return null;
  const collection = await notificationPreferences();
  return collection.findOne({ userId: new ObjectId(userId) });
}

export async function insertNotificationPreferences(
  preferences: NotificationPreferencesDocument,
): Promise<void> {
  const collection = await notificationPreferences();
  await collection.insertOne(preferences);
}

export async function replaceNotificationPreferences(
  preferences: NotificationPreferencesDocument,
): Promise<void> {
  const collection = await notificationPreferences();
  await collection.replaceOne({ _id: preferences._id }, preferences);
}

export async function listAccountChanges(
  userId: string,
  limit = 50,
): Promise<AccountChangeDocument[]> {
  if (!ObjectId.isValid(userId)) return [];
  const collection = await accountChanges();
  return collection
    .find({ userId: new ObjectId(userId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** Lecture seule des membres d'équipe, utilisée par l'export du compte. */
export async function listTeamMembers(ownerId: string): Promise<TeamMemberDocument[]> {
  if (!ObjectId.isValid(ownerId)) return [];
  const collection = await teamMembers();
  return collection.find({ ownerId: new ObjectId(ownerId) }).sort({ invitedAt: 1 }).toArray();
}
