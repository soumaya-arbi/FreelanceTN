import { afterEach, describe, expect, it, vi } from "vitest";
import * as projectActions from "@/lib/actions/projects";
import * as proposalActions from "@/lib/actions/proposals";
import { projectsApi, proposalsApi } from "@/lib/api";

// Les lectures passent désormais par des Server Actions : on simule leur
// résultat sérialisable (voir vitest.setup.ts) au lieu de simuler `fetch`.
// Les mappings de `api.ts` restent identiques et sont donc toujours couverts.
const ok = (data: unknown) => ({ ok: true as const, data });

afterEach(() => {
  vi.clearAllMocks();
});

// Le statut « Cancelled » est produit par le backend lorsqu'une acceptation
// est annulée : le front doit le reconnaître sans le transformer.
describe("mapping des propositions", () => {
  it("reconnaît le statut Cancelled renvoyé par l'API", async () => {
    vi.mocked(proposalActions.listMyProposals).mockResolvedValue(
      ok([
        {
          id: "proposal-1",
          projectId: "project-1",
          projectTitle: "Refonte du site",
          freelancerId: "freelancer-1",
          freelancerName: "Bob Freelance",
          coverLetter: "Lettre de motivation",
          price: "900",
          delivery: "4 weeks",
          status: "Cancelled",
          createdAt: "2026-01-05T10:00:00Z",
          updatedAt: "2026-01-06T10:00:00Z",
        },
      ]),
    );

    const proposals = await proposalsApi.mine();

    expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe("Cancelled");
  });

  it("conserve les autres statuts connus", async () => {
    vi.mocked(proposalActions.listMyProposals).mockResolvedValue(
      ok([
        { id: "p1", status: "Pending" },
        { id: "p2", status: "Accepted" },
        { id: "p3", status: "Refused" },
        { id: "p4", status: "Withdrawn" },
      ]),
    );

    const proposals = await proposalsApi.mine();

    expect(proposals.map((proposal) => proposal.status)).toEqual([
      "Pending",
      "Accepted",
      "Refused",
      "Withdrawn",
    ]);
  });
});

// L'historique des affectations libérées est renvoyé par l'API Projects : il
// doit être transmis au front sans être perdu au mapping.
describe("mapping des projets", () => {
  it("transmet l'historique des affectations libérées", async () => {
    vi.mocked(projectActions.listProjects).mockResolvedValue(
      ok([
        {
          id: "project-1",
          ownerId: "client-1",
          title: "Refonte du site",
          description: "Description",
          budget: "2000",
          type: "Fixed price",
          proposals: 2,
          skills: ["React"],
          client: "Alice",
          status: "Open",
          assignedTo: null,
          assignedToName: null,
          assignedAt: null,
          assignmentHistory: [
            {
              freelancerId: "freelancer-1",
              freelancerName: "Bob Freelance",
              assignedAt: "2026-01-02T09:00:00Z",
              releasedAt: "2026-01-04T09:00:00Z",
              reason: "acceptance-cancelled",
            },
          ],
          createdAt: "2026-01-01T09:00:00Z",
          updatedAt: "2026-01-04T09:00:00Z",
        },
      ]),
    );

    const projects = await projectsApi.list();

    expect(projects).toHaveLength(1);
    expect(projects[0].status).toBe("Open");
    expect(projects[0].assignedTo).toBeNull();
    expect(projects[0].assignmentHistory).toHaveLength(1);
    expect(projects[0].assignmentHistory[0]).toEqual({
      freelancerId: "freelancer-1",
      freelancerName: "Bob Freelance",
      assignedAt: "2026-01-02T09:00:00Z",
      releasedAt: "2026-01-04T09:00:00Z",
      reason: "acceptance-cancelled",
    });
  });

  it("renvoie un historique vide quand l'API n'en fournit pas", async () => {
    vi.mocked(projectActions.listProjects).mockResolvedValue(
      ok([{ id: "project-2", status: "Completed" }]),
    );

    const projects = await projectsApi.list();

    expect(projects[0].assignmentHistory).toEqual([]);
  });
});
