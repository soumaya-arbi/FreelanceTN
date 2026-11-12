// Test d'intégration réel du profil public client consulté depuis une
// invitation freelance (MongoDB `freelancetn_dev`).
//
// Lancement : npx vitest run --config vitest.integration.config.ts
//
// Le test ne crée qu'une invitation temporaire, supprimée dans `afterAll`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, getDb } from "@/lib/server/db";
import { ActionError } from "@/lib/server/errors";
import { getPublicClientProfile } from "@/lib/server/services/account";
import { acceptInvitation, listMyInvitations } from "@/lib/server/services/invitations";
import type { SessionUser } from "@/lib/server/session";

// Comptes de développement utilisés par les autres tests d'intégration.
const CLIENT_ID = "6ad933e3d523034152a802dc"; // hello@hello.com (rôle client)
const FREELANCER_ID = "6ad7dcc8a4586fa928d1c19d"; // soumayaaarbi@gmail.com

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

const temporaryInvitationId = new ObjectId();
const temporaryProjectId = new ObjectId().toHexString();
const acceptanceProjectId = new ObjectId();
const acceptanceInvitationId = new ObjectId();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

beforeAll(async () => {
  const db = await getDb();
  expect(db.databaseName).toBe("freelancetn_dev");

  // Invitation temporaire reçue par le freelance connecté, avec le vrai
  // identifiant du client (jamais son nom comme clé).
  await (await collections.invitations()).insertOne({
    _id: temporaryInvitationId,
    projectId: temporaryProjectId,
    projectTitle: `zz-audit-invitation-${suffix}`,
    clientId: CLIENT_ID,
    clientName: "hello hello",
    freelancerId: FREELANCER_ID,
    freelancerName: "SOUMAYA ARBI",
    message: "Invitation temporaire de test d'intégration.",
    offeredPrice: null,
    offeredDelivery: null,
    status: "Pending",
    declineReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  // Projet + invitation isolés pour vérifier que l'acceptation fonctionne
  // toujours normalement. Ils sont supprimés dans `afterAll`.
  await (await collections.projects()).insertOne({
    _id: acceptanceProjectId,
    ownerId: CLIENT_ID,
    title: `zz-audit-acceptance-${suffix}`,
    description: "",
    budget: "",
    budgetMin: null,
    budgetMax: null,
    type: "Fixed price",
    durationValue: null,
    durationUnit: null,
    proposals: 0,
    skills: [],
    client: "hello hello",
    status: "Open",
    category: null,
    deadline: null,
    assignedTo: null,
    assignedToName: null,
    assignedAt: null,
    assignmentHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    attachments: [],
    milestones: [],
    milestoneHistory: [],
  });

  await (await collections.invitations()).insertOne({
    _id: acceptanceInvitationId,
    projectId: acceptanceProjectId.toHexString(),
    projectTitle: `zz-audit-acceptance-${suffix}`,
    clientId: CLIENT_ID,
    clientName: "hello hello",
    freelancerId: FREELANCER_ID,
    freelancerName: "SOUMAYA ARBI",
    message: "Invitation temporaire à accepter.",
    offeredPrice: null,
    offeredDelivery: null,
    status: "Pending",
    declineReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
});

afterAll(async () => {
  await (await collections.invitations()).deleteMany({
    _id: { $in: [temporaryInvitationId, acceptanceInvitationId] },
  });
  await (await collections.projects()).deleteOne({ _id: acceptanceProjectId });
  await (await collections.notifications()).deleteMany({
    ProjectId: acceptanceProjectId.toHexString(),
  });
});

describe("Profil public client", () => {
  it("renvoie uniquement les informations publiques réelles", async () => {
    const profile = (await getPublicClientProfile(CLIENT_ID)) as Record<string, unknown>;

    expect(profile.displayName).toBe("hello hello");
    expect(profile.createdAt).toBe("2026-10-21T21:51:31.475Z");
    expect(profile.avatar).toBe("/api/uploads/avatar/c326a3d9100a491bb2875236d647a582.webp");
    expect(profile.avatarConfig).toBeTypeOf("string");
    expect(profile.verified).toBe(true);

    // Aucun champ privé ne doit être exposé.
    for (const privateKey of [
      "email",
      "phone",
      "businessAddress",
      "professionalEmail",
      "professionalPhone",
      "billingAddress",
      "taxId",
      "passwordHash",
      "twoFactorSecret",
      "recoveryCodeHashes",
    ]) {
      expect(profile).not.toHaveProperty(privateKey);
    }
  });

  it("refuse un identifiant qui n'est pas un compte client", async () => {
    const error = await getPublicClientProfile(FREELANCER_ID).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).status).toBe(404);
  });

  it("refuse un identifiant invalide", async () => {
    const error = await getPublicClientProfile("not-an-object-id").then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).status).toBe(404);
  });
});

describe("Invitation reçue par le freelance", () => {
  it("expose le clientId réel sans divulguer de données privées", async () => {
    const invitations = await listMyInvitations(freelancerUser);
    const item = invitations.find((entry) => entry.id === temporaryInvitationId.toHexString());

    expect(item).toBeDefined();
    expect(item?.clientId).toBe(CLIENT_ID);
    expect(item?.clientName).toBe("hello hello");
    expect(item?.freelancerId).toBe(FREELANCER_ID);

    for (const privateKey of ["email", "phone", "businessAddress", "billingAddress"]) {
      expect(item).not.toHaveProperty(privateKey);
    }
  });

  it("peut toujours être acceptée après consultation du profil client", async () => {
    // 1. Le freelance consulte le profil public du client de l'invitation.
    const profile = (await getPublicClientProfile(CLIENT_ID)) as Record<string, unknown>;
    expect(profile.displayName).toBe("hello hello");

    // 2. L'invitation reste en attente et donc actionnable.
    const pending = await listMyInvitations(freelancerUser);
    const before = pending.find((entry) => entry.id === acceptanceInvitationId.toHexString());
    expect(before?.status).toBe("Pending");

    // 3. L'acceptation aboutit normalement.
    const accepted = await acceptInvitation(freelancerUser, acceptanceInvitationId.toHexString());
    expect(accepted.status).toBe("Accepted");
    expect(accepted.clientId).toBe(CLIENT_ID);

    const project = await (await collections.projects()).findOne({ _id: acceptanceProjectId });
    expect(project).not.toBeNull();
    expect(project?.assignedTo).toBe(FREELANCER_ID);
    expect(project?.status).toBe("In progress");

    const invitation = await (await collections.invitations()).findOne({
      _id: acceptanceInvitationId,
    });
    expect(invitation?.status).toBe("Accepted");
  });
});
