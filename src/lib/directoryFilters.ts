import type { Freelancer } from "@/lib/types";
import { allSkillsMatch, matchesGovernorate } from "@/lib/locations";

// Filtres Talent appliqués côté client : la liste des freelances est déjà
// entièrement chargée depuis /api/freelancers, on ne filtre donc que les
// profils réels reçus. Ces helpers purs sont testés dans directoryFilters.test.ts.

export type TalentFilters = {
  query: string;
  skills: string[];
  location: string;
  minRate: string;
  maxRate: string;
  sort: string;
};

export type ProjectCatalogInput = {
  query: string;
  category: string;
  type: string;
  minBudget: string;
  maxBudget: string;
  durationValue: string;
  durationUnit: string;
};

// Sous-ensemble de ProjectCatalogParams construit pour l'API. Les champs vides
// sont absents afin que setCatalogSearch supprime réellement le paramètre.
export type ProjectCatalogQuery = {
  q?: string;
  category?: string;
  type?: string;
  minBudget?: number;
  maxBudget?: number;
  durationValue?: number;
  durationUnit?: string;
};

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortTalent(list: Freelancer[], sort: string): Freelancer[] {
  if (sort === "Rate: low to high") {
    // Un tarif à 0 signifie « sur demande » : il est classé après les tarifs
    // connus plutôt qu'en tête.
    return [...list].sort(
      (a, b) =>
        (a.rate > 0 ? a.rate : Number.MAX_SAFE_INTEGER) -
          (b.rate > 0 ? b.rate : Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
  }
  if (sort === "Rate: high to low") {
    return [...list].sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  }
  if (sort === "Name A–Z") {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }
  return list;
}

export function applyTalentFilters(list: Freelancer[], filters: TalentFilters): Freelancer[] {
  const queryText = filters.query.trim().toLowerCase();
  const min = optionalNumber(filters.minRate);
  const max = optionalNumber(filters.maxRate);

  const filtered = list.filter((freelancer) => {
    if (queryText) {
      const haystack =
        `${freelancer.name} ${freelancer.role} ${freelancer.skills.join(" ")} ${freelancer.location ?? ""}`.toLowerCase();
      if (!haystack.includes(queryText)) return false;
    }
    // Plusieurs compétences sélectionnées : le profil doit toutes les maîtriser.
    if (!allSkillsMatch(freelancer.skills, filters.skills)) return false;
    if (!matchesGovernorate(freelancer.location ?? "", filters.location)) return false;
    if (min != null && freelancer.rate < min) return false;
    if (max != null && freelancer.rate > max) return false;
    return true;
  });

  return sortTalent(filtered, filters.sort);
}

export function buildProjectCatalogParams(input: ProjectCatalogInput): ProjectCatalogQuery {
  const params: ProjectCatalogQuery = {};

  const query = input.query.trim();
  if (query) params.q = query;

  const category = input.category.trim();
  if (category) params.category = category;

  const type = input.type.trim();
  if (type) params.type = type;

  const minBudget = optionalNumber(input.minBudget);
  if (minBudget != null) params.minBudget = minBudget;

  const maxBudget = optionalNumber(input.maxBudget);
  if (maxBudget != null) params.maxBudget = maxBudget;

  const durationValue = optionalNumber(input.durationValue);
  if (durationValue != null) params.durationValue = durationValue;

  const durationUnit = input.durationUnit.trim();
  if (durationUnit) params.durationUnit = durationUnit;

  return params;
}
