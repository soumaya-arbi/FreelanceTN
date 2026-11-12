import { describe, expect, it } from "vitest";
import {
  PROPOSAL_STATUSES,
  PROJECT_STATUSES,
  projectStatusOptions,
  proposalStatusOptions,
} from "@/lib/types";

// Transitions de statut proposées au client. La liste doit rester alignée
// sur la machine à états du backend : une transition refusée par l'API ne
// doit jamais être proposée dans l'interface.
describe("projectStatusOptions", () => {
  it("propose la réouverture et la dépublication d'un projet terminé", () => {
    expect(projectStatusOptions("Completed")).toEqual(["Completed", "In progress", "Open", "Draft"]);
  });

  it("propose l'annulation d'acceptation depuis un projet en cours", () => {
    expect(projectStatusOptions("In progress")).toContain("Open");
  });

  it("ne propose que la publication depuis un brouillon", () => {
    expect(projectStatusOptions("Draft")).toEqual(["Draft", "Open"]);
  });

  it("conserve le statut courant dans les options proposées", () => {
    for (const status of PROJECT_STATUSES) {
      expect(projectStatusOptions(status)).toContain(status);
    }
  });
});

// Le statut « Cancelled » décrit une candidature dont l'acceptation a été
// annulée : il doit être connu du front comme des autres statuts.
describe("proposalStatusOptions", () => {
  it("connaît le statut Cancelled", () => {
    expect(PROPOSAL_STATUSES).toContain("Cancelled");
  });

  it("n'autorise aucune décision sur une candidature annulée", () => {
    expect(proposalStatusOptions("Cancelled")).toEqual(["Cancelled"]);
  });

  it("n'autorise que l'acceptation ou le refus sur une candidature en attente", () => {
    expect(proposalStatusOptions("Pending")).toEqual(["Pending", "Accepted", "Refused"]);
  });
});
