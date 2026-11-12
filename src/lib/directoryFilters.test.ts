import { describe, expect, it } from "vitest";
import {
  applyTalentFilters,
  buildProjectCatalogParams,
  type TalentFilters,
} from "@/lib/directoryFilters";
import type { Freelancer } from "@/lib/types";

// Profils réels tels que renvoyés par GET /api/freelancers sur l'environnement
// local (données de développement, aucun profil inventé).
const JEAN: Freelancer = {
  id: "6ae85e877244cfd83042101c",
  name: "Jean Dupont",
  role: "Développeur full-stack senior",
  rate: 120,
  rating: 0,
  jobs: 0,
  location: "Tunis, Tunisie",
  avatar: "",
  skills: ["React", "TypeScript", ".NET", "MongoDB", "Salesforce", "Apex"],
};

const SOUMAYA: Freelancer = {
  id: "6ad7dcc8a4586fa928d1c19d",
  name: "SOUMAYA ARBI",
  role: "CONSULTANTE TECHNIQUE ET FONCTIONNELLE",
  rate: 15,
  rating: 0,
  jobs: 0,
  location: "Ariana, Tunisie",
  avatar: "",
  skills: [
    "React",
    "React.js",
    "TypeScript",
    "JavaScript",
    "Node.js",
    "Docker",
    "Salesforce Marketing cloud",
  ],
};

const NO_DATA: Freelancer = {
  id: "6ada125417759798c3b5c850",
  name: "Free Lancer",
  role: "",
  rate: 0,
  rating: 0,
  jobs: 0,
  location: "",
  avatar: "",
  skills: [],
};

const base: TalentFilters = {
  query: "",
  skills: [],
  location: "",
  minRate: "",
  maxRate: "",
  sort: "Most relevant",
};

const ids = (list: Freelancer[]) => list.map((item) => item.name);

describe("filtres Talent combinés", () => {
  it("ne filtre rien quand tous les critères sont vides (Clear All)", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA, NO_DATA], base);
    expect(result).toHaveLength(3);
  });

  it("combine recherche par mot-clé et compétence sélectionnée", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA, NO_DATA], {
      ...base,
      query: "react",
      skills: ["React"],
    });
    expect(ids(result).sort()).toEqual(["Jean Dupont", "SOUMAYA ARBI"]);
  });

  it("combine compétence et gouvernorat", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA, NO_DATA], {
      ...base,
      skills: ["React"],
      location: "Ariana",
    });
    expect(ids(result)).toEqual(["SOUMAYA ARBI"]);
  });

  it("combine plusieurs compétences et un tarif minimum", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA, NO_DATA], {
      ...base,
      skills: ["React", "TypeScript"],
      minRate: "20",
    });
    expect(ids(result)).toEqual(["Jean Dupont"]);
  });

  it("combine gouvernorat et tarif maximum", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA, NO_DATA], {
      ...base,
      location: "Ariana",
      maxRate: "20",
    });
    expect(ids(result)).toEqual(["SOUMAYA ARBI"]);
  });

  it("exclut un gouvernorat différent", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA], {
      ...base,
      location: "Tunis",
    });
    expect(ids(result)).toEqual(["Jean Dupont"]);
  });

  it("trie par tarif croissant en classant « sur demande » après", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA, NO_DATA], {
      ...base,
      sort: "Rate: low to high",
    });
    expect(ids(result)).toEqual(["SOUMAYA ARBI", "Jean Dupont", "Free Lancer"]);
  });

  it("trie par tarif décroissant", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA, NO_DATA], {
      ...base,
      sort: "Rate: high to low",
    });
    expect(ids(result)).toEqual(["Jean Dupont", "SOUMAYA ARBI", "Free Lancer"]);
  });

  it("trie par nom A–Z", () => {
    const result = applyTalentFilters([JEAN, SOUMAYA], {
      ...base,
      sort: "Name A–Z",
    });
    expect(ids(result)).toEqual(["Jean Dupont", "SOUMAYA ARBI"]);
  });
});

describe("paramètres du catalogue projet", () => {
  it("n'envoie aucun paramètre quand les filtres sont vides (Reset)", () => {
    expect(
      buildProjectCatalogParams({
        query: "",
        category: "",
        type: "",
        minBudget: "",
        maxBudget: "",
        durationValue: "",
        durationUnit: "",
      }),
    ).toEqual({});
  });

  it("transmet tous les critères combinés avec des nombres", () => {
    expect(
      buildProjectCatalogParams({
        query: "  project ",
        category: "Programming & Technology",
        type: "Fixed price",
        minBudget: "1000",
        maxBudget: "3000",
        durationValue: "2",
        durationUnit: "Weeks",
      }),
    ).toEqual({
      q: "project",
      category: "Programming & Technology",
      type: "Fixed price",
      minBudget: 1000,
      maxBudget: 3000,
      durationValue: 2,
      durationUnit: "Weeks",
    });
  });

  it("ignore les nombres invalides sans casser les autres filtres", () => {
    expect(
      buildProjectCatalogParams({
        query: "react",
        category: "",
        type: "Hourly",
        minBudget: "abc",
        maxBudget: "",
        durationValue: "-",
        durationUnit: "",
      }),
    ).toEqual({ q: "react", type: "Hourly" });
  });
});
