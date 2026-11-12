// Accès MongoDB côté serveur uniquement.
//
// Ce module ne doit jamais être importé par un composant client : il ouvre une
// connexion directe à la base utilisée par le backend .NET. Les variables
// d'environnement reprennent la configuration existante (Mongo:ConnectionString
// / Mongo:DatabaseName) avec les mêmes valeurs de développement par défaut que
// backend/src/FreelanceTn.Api/appsettings.Development.json.

import { MongoClient, type Collection, type Db, type Document } from "mongodb";

// Garde-fou : ce module ne doit jamais être évalué dans le navigateur.
if (typeof window !== "undefined") {
  throw new Error("L'accès MongoDB est réservé au serveur (Server Actions / Server Components).");
}

const MONGODB_URI =
  process.env.MONGODB_URI ??
  process.env.MONGO_URL ??
  process.env.Mongo__ConnectionString ??
  "mongodb://localhost:27017";

const MONGODB_DB =
  process.env.MONGODB_DB ?? process.env.Mongo__DatabaseName ?? "freelancetn_dev";

// Noms de collections : identiques à Configuration/MongoSettings.cs.
export const COLLECTIONS = {
  users: "users",
  services: "services",
  projects: "projects",
  proposals: "proposals",
  invitations: "invitations",
  tasks: "tasks",
  taskComments: "task_comments",
  notifications: "notifications",
  quotes: "quotes",
  invoices: "invoices",
  payments: "paymentTransactions",
  feedback: "feedback",
  comments: "comments",
  portfolio: "portfolio",
  counters: "counters",
  teamMembers: "teamMembers",
  billingProfiles: "billingProfiles",
  userPreferences: "userPreferences",
  notificationPreferences: "notificationPreferences",
  authSessions: "authSessions",
  accountChanges: "accountChanges",
} as const;

type MongoGlobal = typeof globalThis & {
  __freelanceTnMongoClient?: MongoClient;
  __freelanceTnMongoDb?: Db;
};

const globalForMongo = globalThis as MongoGlobal;

export function getMongoClient(): MongoClient {
  if (!globalForMongo.__freelanceTnMongoClient) {
    globalForMongo.__freelanceTnMongoClient = new MongoClient(MONGODB_URI, {
      // Une seule connexion partagée par processus Next ; les pools du driver
      // gèrent la concurrence.
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
    });
  }
  return globalForMongo.__freelanceTnMongoClient;
}

export async function getDb(): Promise<Db> {
  if (globalForMongo.__freelanceTnMongoDb) return globalForMongo.__freelanceTnMongoDb;
  const client = getMongoClient();
  await client.connect();
  globalForMongo.__freelanceTnMongoDb = client.db(MONGODB_DB);
  return globalForMongo.__freelanceTnMongoDb;
}

export async function getCollection<TSchema extends Document = Document>(
  name: string,
): Promise<Collection<TSchema>> {
  const db = await getDb();
  return db.collection<TSchema>(name);
}

export const collections = {
  users: () => getCollection(COLLECTIONS.users),
  services: () => getCollection(COLLECTIONS.services),
  projects: () => getCollection(COLLECTIONS.projects),
  proposals: () => getCollection(COLLECTIONS.proposals),
  invitations: () => getCollection(COLLECTIONS.invitations),
  tasks: () => getCollection(COLLECTIONS.tasks),
  taskComments: () => getCollection(COLLECTIONS.taskComments),
  notifications: () => getCollection(COLLECTIONS.notifications),
  quotes: () => getCollection(COLLECTIONS.quotes),
  invoices: () => getCollection(COLLECTIONS.invoices),
  payments: () => getCollection(COLLECTIONS.payments),
  feedback: () => getCollection(COLLECTIONS.feedback),
  comments: () => getCollection(COLLECTIONS.comments),
  portfolio: () => getCollection(COLLECTIONS.portfolio),
  counters: () => getCollection(COLLECTIONS.counters),
  teamMembers: () => getCollection(COLLECTIONS.teamMembers),
  billingProfiles: () => getCollection(COLLECTIONS.billingProfiles),
  userPreferences: () => getCollection(COLLECTIONS.userPreferences),
  notificationPreferences: () => getCollection(COLLECTIONS.notificationPreferences),
  authSessions: () => getCollection(COLLECTIONS.authSessions),
  accountChanges: () => getCollection(COLLECTIONS.accountChanges),
};
