// Les 24 gouvernorats tunisiens, dans l'ordre officiel. Ce tableau est la
// seule source de valeurs pour le filtre Location de l'annuaire talent : il
// n'est plus alimenté par les saisies libres des profils.
export const TUNISIA_GOVERNORATES = [
  "Tunis",
  "Ariana",
  "Ben Arous",
  "Manouba",
  "Nabeul",
  "Zaghouan",
  "Bizerte",
  "Béja",
  "Jendouba",
  "Le Kef",
  "Siliana",
  "Sousse",
  "Monastir",
  "Mahdia",
  "Sfax",
  "Kairouan",
  "Kasserine",
  "Sidi Bouzid",
  "Gabès",
  "Médenine",
  "Tataouine",
  "Gafsa",
  "Tozeur",
  "Kébili",
] as const;

// Normalisation accent-insensible et casse-insensible.
export const normalizeText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

// Un profil est rattaché à un gouvernorat si la première partie de sa
// localisation (avant la virgule) correspond au gouvernorat. Le pays est
// toujours suffixé (« Tunis, Tunisie ») et ne doit pas déclencher de
// faux positif sur « Tunis ».
export const matchesGovernorate = (profileLocation: string, governorate: string): boolean => {
  if (!governorate) return true;
  const profile = normalizeText(profileLocation.split(",")[0] || "");
  const target = normalizeText(governorate);
  if (!profile) return false;
  return profile === target || profile.includes(target) || target.includes(profile);
};

// Une compétence saisie par le client est comparée aux compétences réelles du
// profil de façon accent/casse-insensible, en acceptant une correspondance
// partielle pour ne pas exiger l'orthographe exacte des données.
export const matchesSkill = (profileSkills: string[], skill: string): boolean => {
  const needle = normalizeText(skill);
  if (!needle) return true;
  return profileSkills.some((item) => {
    const haystack = normalizeText(item);
    return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
  });
};

export const allSkillsMatch = (profileSkills: string[], selectedSkills: string[]): boolean =>
  selectedSkills.every((skill) => matchesSkill(profileSkills, skill));