import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeJson: vi.fn(),
  feedbackFind: vi.fn(),
  projectFind: vi.fn(),
  invitationFind: vi.fn(),
  getProject: vi.fn(),
  listFreelancers: vi.fn(),
  getFreelancer: vi.fn(),
  listFreelancerPortfolio: vi.fn(),
  listReceivedProposals: vi.fn(),
  listMyProposals: vi.fn(),
}));

vi.mock("@/lib/server/ai/provider", () => ({ completeJson: mocks.completeJson }));
vi.mock("@/lib/server/db", () => ({
  collections: {
    feedback: async () => ({ find: mocks.feedbackFind }),
    projects: async () => ({ find: mocks.projectFind }),
    invitations: async () => ({ findOne: mocks.invitationFind }),
  },
}));
vi.mock("@/lib/server/services/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/server/services/freelancers", () => ({
  listFreelancers: mocks.listFreelancers,
  getFreelancer: mocks.getFreelancer,
}));
vi.mock("@/lib/server/services/portfolio", () => ({
  listFreelancerPortfolio: mocks.listFreelancerPortfolio,
}));
vi.mock("@/lib/server/services/proposals", () => ({
  listReceivedProposals: mocks.listReceivedProposals,
  listMyProposals: mocks.listMyProposals,
}));

import { assistProjectDraft, assistProposalDraft, breakdownProject, matchFreelancersForProject } from "@/lib/server/services/ai";
import type { SessionUser } from "@/lib/server/session";

const client = { id: "client-1", role: "client" } as SessionUser;
const freelancer = { id: "freelancer-1", role: "freelancer" } as SessionUser;

describe("AI service access and matching privacy", () => {
  beforeEach(() => {
    vi.stubEnv("AI_SERVICE_URL", "http://127.0.0.1:8100");
    vi.stubEnv("AI_SERVICE_TOKEN", "unit-test-internal-token-with-over-32-chars");
    mocks.completeJson.mockReset();
    mocks.feedbackFind.mockReset();
    mocks.projectFind.mockReset();
    mocks.invitationFind.mockReset();
    mocks.getProject.mockReset();
    mocks.listFreelancers.mockReset();
    mocks.getFreelancer.mockReset();
    mocks.listFreelancerPortfolio.mockReset();
    mocks.listReceivedProposals.mockReset();
    mocks.listMyProposals.mockReset();
    mocks.projectFind.mockReturnValue({
      project: () => ({ limit: () => ({ toArray: async () => [] }) }),
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects the wrong role before calling the AI provider", async () => {
    await expect(assistProjectDraft(freelancer, { idea: "A sufficiently detailed project idea" })).rejects.toMatchObject({ status: 403 });
    await expect(assistProposalDraft(client, "project-1")).rejects.toMatchObject({ status: 403 });
    await expect(matchFreelancersForProject(freelancer, "project-1")).rejects.toMatchObject({ status: 403 });
    expect(mocks.completeJson).not.toHaveBeenCalled();
  });

  it("requires an assigned in-progress project and a valid acceptance before breakdown", async () => {
    mocks.getProject.mockResolvedValue({ id: "project-1", ownerId: client.id, assignedTo: "freelancer-1", status: "Open" });
    await expect(breakdownProject(client, "project-1")).rejects.toMatchObject({ status: 400 });
    expect(mocks.completeJson).not.toHaveBeenCalled();

    mocks.getProject.mockResolvedValue({ id: "project-1", ownerId: client.id, assignedTo: "freelancer-1", status: "In progress" });
    mocks.listReceivedProposals.mockResolvedValue([]);
    mocks.invitationFind.mockResolvedValue(null);
    await expect(breakdownProject(client, "project-1")).rejects.toMatchObject({ status: 400 });
    expect(mocks.completeJson).not.toHaveBeenCalled();
  });

  it("allows breakdown after an accepted invitation assigned to the current freelancer", async () => {
    mocks.getProject.mockResolvedValue({
      id: "project-1", ownerId: client.id, assignedTo: freelancer.id, status: "In progress",
      title: "Invitation project", description: "A valid project", skills: ["React"],
    });
    mocks.listReceivedProposals.mockResolvedValue([]);
    mocks.listMyProposals.mockResolvedValue([]);
    mocks.invitationFind.mockResolvedValue({ status: "Accepted" });
    mocks.completeJson.mockResolvedValue(JSON.stringify({
      summary: "Plan", phases: [], tasks: [{ id: "t1", title: "Review", description: "" }],
    }));

    await expect(breakdownProject(client, "project-1")).resolves.toMatchObject({ summary: "Plan" });
    expect(mocks.invitationFind).toHaveBeenCalledWith({
      projectId: "project-1", freelancerId: freelancer.id, status: "Accepted",
    });
    await expect(breakdownProject(freelancer, "project-1")).resolves.toMatchObject({ summary: "Plan" });
  });

  it("sends only published portfolio and published feedback into matching", async () => {
    mocks.getProject.mockResolvedValue({
      id: "project-1", ownerId: client.id, title: "Site", description: "A real client project",
      skills: ["React"], category: "Web", type: "Fixed price", budget: "1000 TND",
    });
    mocks.listFreelancers.mockResolvedValue([{
      id: "freelancer-1", name: "Samira A.", title: "Frontend developer", skills: ["React"],
      avatar: "", avatarSource: "initials", avatarConfig: "", hourlyRate: 30,
    }]);
    mocks.listFreelancerPortfolio.mockResolvedValue([
      { title: "Published work", summary: "Public summary", skills: ["React"], published: true },
      { title: "Draft work", summary: "Private draft", skills: ["React"], published: false },
    ]);
    mocks.getFreelancer.mockResolvedValue({
      bio: "Public bio", experiences: [],
    });
    mocks.feedbackFind.mockReturnValue({
      project: () => ({
        limit: () => ({ toArray: async () => [
          { recipientId: "freelancer-1", status: "published", averageRating: 5, strengths: "Reliable" },
        ] }),
      }),
    });
    mocks.completeJson.mockResolvedValue(JSON.stringify({
      matches: [{ freelancerId: "freelancer-1", score: 81, strengths: ["React"], explanation: "Compétence vérifiée" }],
    }));

    const result = await matchFreelancersForProject(client, "project-1");
    expect(result.matches).toHaveLength(1);
    expect(mocks.feedbackFind).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    const sentPayload = JSON.parse(mocks.completeJson.mock.calls[0][0][1].content);
    expect(sentPayload.candidates[0].portfolio).toEqual([
      expect.objectContaining({ title: "Published work" }),
    ]);
    expect(JSON.stringify(sentPayload)).not.toContain("Private draft");
    expect(result.matches[0]).toMatchObject({
      freelancerId: "freelancer-1", matchedSkills: ["React"], averagePublishedRating: 5, score: 61,
    });
    expect(result.matches[0].explanation).toContain("compétences 45/45");
    expect(result.matches[0].explanation).toContain("portfolio publié 15/15");
  });

  it("does not recommend weak profiles or fill an empty result list", async () => {
    mocks.getProject.mockResolvedValue({
      id: "project-1", ownerId: client.id, title: "Site", description: "A real client project",
      skills: ["React"], category: "Web", type: "Fixed price", budget: "1000 TND",
    });
    mocks.listFreelancers.mockResolvedValue([{
      id: "freelancer-1", name: "Samira A.", title: "Frontend developer", skills: ["React"],
      avatar: "", avatarSource: "initials", avatarConfig: "", hourlyRate: 30,
    }]);
    mocks.listFreelancerPortfolio.mockResolvedValue([]);
    mocks.getFreelancer.mockResolvedValue({ bio: "Public bio", experiences: [] });
    mocks.feedbackFind.mockReturnValue({ project: () => ({ limit: () => ({ toArray: async () => [] }) }) });
    mocks.completeJson.mockResolvedValue(JSON.stringify({ matches: [] }));

    const result = await matchFreelancersForProject(client, "project-1");
    expect(result.matches).toEqual([]);
    expect(mocks.completeJson).not.toHaveBeenCalled();
  });

  it("caps AI-selected recommendations at three and computes scores from verified evidence", async () => {
    mocks.getProject.mockResolvedValue({
      id: "project-1", ownerId: client.id, title: "Site", description: "A real client project",
      skills: ["React"], category: "Web", type: "Fixed price", budget: "1000 TND",
    });
    const candidates = [1, 2, 3, 4].map((index) => ({
      id: `freelancer-${index}`, name: `Freelancer ${index}`, title: "Frontend developer", skills: ["React"],
      avatar: "", avatarSource: "initials", avatarConfig: "", hourlyRate: 30,
    }));
    mocks.listFreelancers.mockResolvedValue(candidates);
    mocks.listFreelancerPortfolio.mockResolvedValue([
      { title: "Published work", summary: "Public summary", skills: ["React"], published: true },
    ]);
    mocks.getFreelancer.mockResolvedValue({ bio: "Public bio", experiences: [] });
    mocks.feedbackFind.mockReturnValue({
      project: () => ({ limit: () => ({ toArray: async () => candidates.map((candidate) => ({
        recipientId: candidate.id, status: "published", averageRating: 5,
      })) }) }),
    });
    mocks.completeJson.mockResolvedValue(JSON.stringify({
      matches: candidates.map((candidate) => ({ freelancerId: candidate.id, score: 100 })),
    }));

    const result = await matchFreelancersForProject(client, "project-1");
    expect(result.matches).toHaveLength(3);
    expect(result.matches.every((match) => match.score === 61)).toBe(true);
  });
});
