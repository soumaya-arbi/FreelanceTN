import { describe, expect, it } from "vitest";
import {
  TUNISIA_GOVERNORATES,
  matchesGovernorate,
  matchesSkill,
} from "@/lib/locations";

describe("gouvernorats tunisiens", () => {
  it("contient exactement les 24 gouvernorats", () => {
    expect(TUNISIA_GOVERNORATES).toHaveLength(24);
  });

  it("associe un profil 'Tunis, Tunisie' au gouvernorat Tunis", () => {
    expect(matchesGovernorate("Tunis, Tunisie", "Tunis")).toBe(true);
  });

  it("n'associe pas 'Ariana, Tunisie' au gouvernorat Tunis", () => {
    expect(matchesGovernorate("Ariana, Tunisie", "Tunis")).toBe(false);
  });

  it("ignore la casse et les accents", () => {
    expect(matchesGovernorate("béja, tunisie", "Béja")).toBe(true);
  });
});

describe("compétences des profils", () => {
  it("reconnaît une compétence exacte", () => {
    expect(matchesSkill(["React", "TypeScript"], "React")).toBe(true);
  });

  it("reconnaît une correspondance partielle", () => {
    expect(matchesSkill(["Salesforce Marketing cloud"], "salesforce")).toBe(true);
  });

  it("rejette une compétence absente", () => {
    expect(matchesSkill(["React"], "Vue.js")).toBe(false);
  });
});