import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";

export type Silhouette = "female" | "male";

export type AvatarConfig = {
  style: string;
  seed: string;
  silhouette?: Silhouette;
  top?: string;
  accessories?: string; // "none" = no accessories
  accessoriesColor?: string;
  clothing?: string;
  clothesColor?: string;
  clothingGraphic?: string;
  eyes?: string;
  eyebrows?: string;
  mouth?: string;
  nose?: string;
  skinColor?: string;
  hairColor?: string;
  hatColor?: string;
  facialHair?: string; // "none" = no facial hair
  facialHairColor?: string;
  backgroundColor?: string; // "transparent" allowed
  base?: string;
};

/** avataaars v9 (DiceBear collection 9.x) valid option values. */
export const AVATAAARS = {
  top: [
    "hat","hijab","turban","winterHat1","winterHat02","winterHat03","winterHat04",
    "bob","bun","curly","curvy","dreads","frida","fro","froBand",
    "longButNotTooLong","miaWallace","shavedSides","straight02","straight01","straightAndStrand",
    "dreads01","dreads02","frizzle","shaggy","shaggyMullet","shortCurly","shortFlat","shortRound","shortWaved",
    "sides","theCaesar","theCaesarAndSidePart","bigHair",
  ],
  accessories: ["kurt","prescription01","prescription02","round","sunglasses","wayfarers","eyepatch"],
  clothing: ["blazerAndShirt","blazerAndSweater","collarAndSweater","graphicShirt","hoodie","overall","shirtCrewNeck","shirtScoopNeck","shirtVNeck"],
  clothingGraphic: ["bat","bear","cumbia","deer","diamond","hola","pizza","resist","skull","skullOutline"],
  eyes: ["closed","cry","default","eyeRoll","happy","hearts","side","squint","surprised","winkWacky","wink","xDizzy"],
  eyebrows: ["angryNatural","defaultNatural","flatNatural","frownNatural","raisedExcitedNatural","sadConcernedNatural","unibrowNatural","upDownNatural","angry","default","raisedExcited","sadConcerned","upDown"],
  mouth: ["concerned","default","disbelief","eating","grimace","sad","screamOpen","serious","smile","tongue","twinkle","vomit"],
  facialHair: ["beardLight","beardMajestic","beardMedium","moustacheFancy","moustacheMagnum"],
  skinColor: ["614335","d08b5b","ae5d29","edb98a","ffdbb4","fd9841","f8d25c"],
  hairColor: ["a55728","2c1b18","b58143","d6b370","724133","4a312c","f59797","ecdcbf","c93305","e8e1e1"],
  clothesColor: ["262e33","65c9ff","5199e4","25557c","e6e6e6","929598","3c4f5c","b1e2ff","a7ffc4","ffafb9","ffffb1","ff488e","ff5c5c","ffffff"],
  hatColor: ["262e33","65c9ff","5199e4","25557c","e6e6e6","929598","3c4f5c","b1e2ff","a7ffc4","ffdeb5","ffafb9","ffffb1","ff488e","ff5c5c","ffffff"],
  accessoriesColor: ["262e33","65c9ff","5199e4","25557c","e6e6e6","929598","3c4f5c","b1e2ff","a7ffc4","ffdeb5","ffafb9","ffffb1","ff488e","ff5c5c","ffffff"],
  facialHairColor: ["a55728","2c1b18","b58143","d6b370","724133","4a312c","f59797","ecdcbf","c93305","e8e1e1"],
  backgroundColor: ["b6e3f4","c0aede","d1d4f9","ffd5dc","ffdfbf","65c9ff","a7ffc4","ffffff","transparent"],
} as const;

export const NONE = "none";

const TOP_MIGRATION: Record<string, string> = {
  shortHairShortFlat: "shortFlat",
  shortHairShortRound: "shortRound",
  shortHairShortWaved: "shortWaved",
  shortHairShortCurly: "shortCurly",
  shortHairDreads01: "dreads01",
  shortHairDreads02: "dreads02",
  shortHairFrizzle: "frizzle",
  shortHairShaggyMullet: "shaggyMullet",
  shortHairSides: "sides",
  shortHairTheCaesar: "theCaesar",
  shortHairTheCaesarSidePart: "theCaesarAndSidePart",
  longHairBigHair: "bigHair",
  longHairBob: "bob",
  longHairBun: "bun",
  longHairCurly: "curly",
  longHairCurvy: "curvy",
  longHairDreads: "dreads",
  longHairFrida: "frida",
  longHairFro: "fro",
  longHairFroBand: "froBand",
  longHairMiaWallace: "miaWallace",
  longHairNotTooLong: "longButNotTooLong",
  longHairShavedSides: "shavedSides",
  longHairStraight: "straight01",
  longHairStraight2: "straight02",
  longHairStraightStrand: "straightAndStrand",
  winterHat02: "winterHat02",
  winterHat03: "winterHat03",
  winterHat04: "winterHat04",
};

const EYES_MIGRATION: Record<string, string> = { close: "closed", dizzy: "xDizzy" };
const EYEBROWS_MIGRATION: Record<string, string> = { raisedExcited: "raisedExcited", raisedExcitedNatural: "raisedExcitedNatural" };

function inList<T extends readonly string[]>(list: T, value: string | undefined): value is T[number] {
  return !!value && (list as readonly string[]).includes(value);
}

export function normalizeHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const raw = value.trim().replace(/^#/, "");
  if (raw === "transparent") return "transparent";
  return /^[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback;
}

export function displayHex(value: string | undefined, fallback = "b6e3f4"): string {
  const n = normalizeHex(value, fallback);
  return n === "transparent" ? "transparent" : `#${n}`;
}

export function migrateAvatarConfig(raw: unknown): AvatarConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const pick = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : undefined);
  const topRaw = pick("top");
  const top = inList(AVATAAARS.top, topRaw) ? topRaw : (topRaw ? TOP_MIGRATION[topRaw] : undefined);
  const accRaw = pick("accessories");
  const accessories = accRaw === "blank" ? NONE : inList(AVATAAARS.accessories, accRaw) ? accRaw : undefined;
  const facialRaw = pick("facialHair");
  const facialHair = facialRaw === "blank" ? NONE : inList(AVATAAARS.facialHair, facialRaw) ? facialRaw : undefined;
  const eyesRaw = pick("eyes");
  const eyes = inList(AVATAAARS.eyes, eyesRaw) ? eyesRaw : (eyesRaw ? EYES_MIGRATION[eyesRaw] : undefined);
  const eyebrowsRaw = pick("eyebrows");
  const eyebrows = inList(AVATAAARS.eyebrows, eyebrowsRaw) ? eyebrowsRaw : (eyebrowsRaw ? EYEBROWS_MIGRATION[eyebrowsRaw] : undefined);
  const mouth = pick("mouth");
  const clothing = pick("clothing");
  const silhouette = pick("silhouette") === "male" ? "male" : pick("silhouette") === "female" ? "female" : undefined;
  return {
    style: "avataaars",
    seed: pick("seed") || "freelancetn",
    silhouette,
    top: inList(AVATAAARS.top, top) ? top : undefined,
    accessories: accessories === NONE || inList(AVATAAARS.accessories, accessories) ? accessories : undefined,
    accessoriesColor: pick("accessoriesColor"),
    clothing: inList(AVATAAARS.clothing, clothing) ? clothing : undefined,
    clothesColor: pick("clothesColor"),
    clothingGraphic: pick("clothingGraphic"),
    eyes: inList(AVATAAARS.eyes, eyes) ? eyes : undefined,
    eyebrows: inList(AVATAAARS.eyebrows, eyebrows) ? eyebrows : undefined,
    mouth: inList(AVATAAARS.mouth, mouth) ? mouth : undefined,
    nose: "default",
    skinColor: pick("skinColor"),
    hairColor: pick("hairColor"),
    hatColor: pick("hatColor"),
    facialHair: facialHair === NONE || inList(AVATAAARS.facialHair, facialHair) ? facialHair : undefined,
    facialHairColor: pick("facialHairColor"),
    backgroundColor: pick("backgroundColor"),
  };
}

export function parseAvatarConfig(value: string | null | undefined): AvatarConfig | undefined {
  if (!value) return undefined;
  try {
    return migrateAvatarConfig(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function defaultAvatarConfig(silhouette: Silhouette, seed?: string): AvatarConfig {
  const base: AvatarConfig = {
    style: "avataaars",
    seed: seed || Math.random().toString(36).slice(2, 10),
    silhouette,
    top: silhouette === "female" ? "bob" : "shortFlat",
    accessories: NONE,
    clothing: silhouette === "female" ? "shirtScoopNeck" : "hoodie",
    clothesColor: "65c9ff",
    eyes: "default",
    eyebrows: "defaultNatural",
    mouth: "smile",
    nose: "default",
    skinColor: "ffdbb4",
    hairColor: "4a312c",
    facialHair: NONE,
    facialHairColor: "4a312c",
    backgroundColor: "b6e3f4",
  };
  return base;
}

function opt<T extends string>(value: T | undefined): [T] | undefined {
  return value ? [value] : undefined;
}

export function buildAvatarOptions(draft: AvatarConfig): Record<string, unknown> {
  const accessories = draft.accessories && draft.accessories !== NONE && inList(AVATAAARS.accessories, draft.accessories)
    ? draft.accessories : undefined;
  const facialHair = draft.facialHair && draft.facialHair !== NONE && inList(AVATAAARS.facialHair, draft.facialHair)
    ? draft.facialHair : undefined;
  const top = inList(AVATAAARS.top, draft.top) ? draft.top : "shortFlat";
  const clothing = inList(AVATAAARS.clothing, draft.clothing) ? draft.clothing : "hoodie";
  const skin = normalizeHex(draft.skinColor, "ffdbb4");
  const hair = normalizeHex(draft.hairColor, "4a312c");
  const bg = normalizeHex(draft.backgroundColor, "b6e3f4");
  const clothes = normalizeHex(draft.clothesColor, "65c9ff");
  const hat = normalizeHex(draft.hatColor, "262e33");
  const accColor = normalizeHex(draft.accessoriesColor, "262e33");
  const facialColor = normalizeHex(draft.facialHairColor, hair);

  return {
    seed: draft.seed || "freelancetn",
    top: [top],
    topProbability: 100,
    accessoriesProbability: accessories ? 100 : 0,
    ...(accessories ? { accessories: [accessories], accessoriesColor: [accColor] } : {}),
    facialHairProbability: facialHair ? 100 : 0,
    ...(facialHair ? { facialHair: [facialHair], facialHairColor: [facialColor] } : {}),
    clothing: [clothing],
    clothesColor: [clothes],
    ...(clothing === "graphicShirt" && inList(AVATAAARS.clothingGraphic, draft.clothingGraphic)
      ? { clothingGraphic: [draft.clothingGraphic] } : {}),
    eyes: opt(inList(AVATAAARS.eyes, draft.eyes) ? draft.eyes : "default"),
    eyebrows: opt(inList(AVATAAARS.eyebrows, draft.eyebrows) ? draft.eyebrows : "defaultNatural"),
    mouth: opt(inList(AVATAAARS.mouth, draft.mouth) ? draft.mouth : "smile"),
    nose: ["default"],
    skinColor: [skin],
    hairColor: [hair],
    hatColor: [hat],
    backgroundColor: [bg],
  };
}

export function renderAvatarSvg(config: AvatarConfig | null | undefined, size?: number): string {
  if (!config) return "";
  try {
    const svg = createAvatar(avataaars, buildAvatarOptions(config) as any).toString();
    if (!size) return svg;
    return svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  } catch {
    return "";
  }
}

export function renderAvatarDataUri(config: AvatarConfig | null | undefined): string {
  const svg = renderAvatarSvg(config);
  if (!svg) return "";
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export type StudioStepKey =
  | "silhouette"
  | "faceSkin"
  | "hair"
  | "hairColor"
  | "eyesBrows"
  | "noseMouth"
  | "accessories"
  | "clothing"
  | "background";

export type StudioOption = {
  value: string;
  label: string;
  /** For color steps: hex without #, or "transparent" */
  hex?: string;
  /** Apply this partial config when selected */
  patch: Partial<AvatarConfig>;
};

export type StudioStep = {
  key: StudioStepKey;
  label: string;
  description: string;
  color?: boolean;
  groups: { title: string; options: StudioOption[] }[];
};

export function prettyLabel(value: string): string {
  if (value === NONE) return "Aucun";
  if (value === "transparent") return "Transparent";
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ") || value;
}

const TOPS_FEMALE: string[] = [
  "bob","bun","curly","curvy","longButNotTooLong","miaWallace","straight01","straight02","straightAndStrand",
  "bigHair","frida","fro","froBand","dreads","dreads01","dreads02","frizzle","shaggy","shaggyMullet",
  "hijab","turban","hat","winterHat1","winterHat02","shortCurly","shortFlat","shortRound","shortWaved","sides","shavedSides",
];
const TOPS_MALE: string[] = [
  "shortFlat","shortRound","shortWaved","shortCurly","theCaesar","theCaesarAndSidePart","sides","shaggy","shaggyMullet",
  "dreads01","dreads02","frizzle","fro","curly","hat","turban","winterHat1","winterHat02","hijab",
  "straight01","straight02","bob","bun","bigHair",
];

// (reserved for future per-option thumbnail metadata)

export function getStudioSteps(silhouette: Silhouette): StudioStep[] {
  const tops = silhouette === "female" ? TOPS_FEMALE : TOPS_MALE;
  const facialOptions: StudioOption[] = [
    { value: NONE, label: "Aucun", patch: { facialHair: NONE } },
    ...AVATAAARS.facialHair.map((v) => ({ value: v, label: prettyLabel(v), patch: { facialHair: v } })),
  ];
  // Keep silhouette coherent in options: for female, prioritize none (but allow all).
  const facialGroups = silhouette === "female"
    ? [{ title: "Pilosité faciale", options: facialOptions }]
    : [{ title: "Pilosité faciale", options: facialOptions }];

  return [
    {
      key: "silhouette",
      label: "Silhouette",
      description: "Choisissez la silhouette de départ. Elle restera la même pendant toute la personnalisation.",
      groups: [
        {
          title: "Silhouette",
          options: [
            { value: "female", label: "Femme", patch: { silhouette: "female" } },
            { value: "male", label: "Homme", patch: { silhouette: "male" } },
          ],
        },
      ],
    },
    {
      key: "faceSkin",
      label: "Visage & peau",
      description: "Choisissez la couleur de peau.",
      color: true,
      groups: [{ title: "Couleur de peau", options: AVATAAARS.skinColor.map((v) => ({ value: v, label: prettyLabel(v), hex: v, patch: { skinColor: v } })) }],
    },
    {
      key: "hair",
      label: "Cheveux",
      description: "Choisissez une coiffure adaptée à votre silhouette.",
      groups: [{ title: "Coiffure", options: tops.map((v) => ({ value: v, label: prettyLabel(v), patch: { top: v } })) }],
    },
    {
      key: "hairColor",
      label: "Couleur cheveux",
      description: "Choisissez la couleur des cheveux.",
      color: true,
      groups: [
        { title: "Couleur des cheveux", options: AVATAAARS.hairColor.map((v) => ({ value: v, label: prettyLabel(v), hex: v, patch: { hairColor: v, facialHairColor: v } })) },
        { title: "Couleur du chapeau (si porté)", options: AVATAAARS.hatColor.map((v) => ({ value: v, label: prettyLabel(v), hex: v, patch: { hatColor: v } })) },
      ],
    },
    {
      key: "eyesBrows",
      label: "Yeux & sourcils",
      description: "Personnalisez le regard.",
      groups: [
        { title: "Yeux", options: AVATAAARS.eyes.map((v) => ({ value: v, label: prettyLabel(v), patch: { eyes: v } })) },
        { title: "Sourcils", options: AVATAAARS.eyebrows.map((v) => ({ value: v, label: prettyLabel(v), patch: { eyebrows: v } })) },
      ],
    },
    {
      key: "noseMouth",
      label: "Nez & bouche",
      description: "Ajustez l'expression du visage.",
      groups: [
        { title: "Bouche", options: AVATAAARS.mouth.map((v) => ({ value: v, label: prettyLabel(v), patch: { mouth: v } })) },
      ],
    },
    {
      key: "accessories",
      label: "Accessoires",
      description: "Ajoutez des lunettes ou accessoires.",
      groups: [
        {
          title: "Accessoires",
          options: [
            { value: NONE, label: "Aucun", patch: { accessories: NONE } },
            ...AVATAAARS.accessories.map((v) => ({ value: v, label: prettyLabel(v), patch: { accessories: v } })),
          ],
        },
        { title: "Couleur des accessoires", colorGroup: true, options: AVATAAARS.accessoriesColor.map((v) => ({ value: v, label: prettyLabel(v), hex: v, patch: { accessoriesColor: v } })) } as any,
        ...facialGroups,
        { title: "Couleur pilosité", colorGroup: true, options: AVATAAARS.facialHairColor.map((v) => ({ value: v, label: prettyLabel(v), hex: v, patch: { facialHairColor: v } })) } as any,
      ],
    },
    {
      key: "clothing",
      label: "Vêtements",
      description: "Choisissez la tenue et ses couleurs.",
      groups: [
        { title: "Vêtements", options: AVATAAARS.clothing.map((v) => ({ value: v, label: prettyLabel(v), patch: { clothing: v } })) },
        { title: "Couleur des vêtements", colorGroup: true, options: AVATAAARS.clothesColor.map((v) => ({ value: v, label: prettyLabel(v), hex: v, patch: { clothesColor: v } })) } as any,
        { title: "Motif (t-shirt graphique)", options: AVATAAARS.clothingGraphic.map((v) => ({ value: v, label: prettyLabel(v), patch: { clothing: "graphicShirt", clothingGraphic: v } })) },
      ],
    },
    {
      key: "background",
      label: "Arrière-plan",
      description: "Choisissez la couleur d'arrière-plan.",
      color: true,
      groups: [{ title: "Arrière-plan", options: AVATAAARS.backgroundColor.map((v) => ({ value: v, label: prettyLabel(v), hex: v, patch: { backgroundColor: v } })) }],
    },
  ];
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomizeAvatarConfig(silhouette: Silhouette): AvatarConfig {
  const cfg = defaultAvatarConfig(silhouette);
  const tops = silhouette === "female" ? TOPS_FEMALE : TOPS_MALE;
  cfg.top = pickRandom(tops);
  cfg.eyes = pickRandom(AVATAAARS.eyes);
  cfg.eyebrows = pickRandom(AVATAAARS.eyebrows);
  cfg.mouth = pickRandom(AVATAAARS.mouth);
  cfg.clothing = pickRandom(AVATAAARS.clothing);
  cfg.clothesColor = pickRandom(AVATAAARS.clothesColor);
  cfg.skinColor = pickRandom(AVATAAARS.skinColor);
  cfg.hairColor = pickRandom(AVATAAARS.hairColor);
  cfg.facialHairColor = cfg.hairColor;
  cfg.backgroundColor = pickRandom(AVATAAARS.backgroundColor.filter((c) => c !== "transparent"));
  cfg.hatColor = pickRandom(AVATAAARS.hatColor);
  if (Math.random() > 0.5) {
    cfg.accessories = pickRandom(AVATAAARS.accessories);
    cfg.accessoriesColor = pickRandom(AVATAAARS.accessoriesColor);
  } else {
    cfg.accessories = NONE;
  }
  if (silhouette === "male" && Math.random() > 0.55) {
    cfg.facialHair = pickRandom(AVATAAARS.facialHair);
  } else {
    cfg.facialHair = NONE;
  }
  if (cfg.clothing === "graphicShirt") cfg.clothingGraphic = pickRandom(AVATAAARS.clothingGraphic);
  cfg.seed = Math.random().toString(36).slice(2, 10);
  return cfg;
}

export function stepDefaultPatch(step: StudioStepKey, silhouette: Silhouette): Partial<AvatarConfig> {
  const d = defaultAvatarConfig(silhouette);
  switch (step) {
    case "faceSkin": return { skinColor: d.skinColor };
    case "hair": return { top: d.top };
    case "hairColor": return { hairColor: d.hairColor, facialHairColor: d.hairColor, hatColor: d.hatColor };
    case "eyesBrows": return { eyes: d.eyes, eyebrows: d.eyebrows };
    case "noseMouth": return { mouth: d.mouth };
    case "accessories": return { accessories: NONE, facialHair: d.facialHair, accessoriesColor: d.accessoriesColor, facialHairColor: d.facialHairColor };
    case "clothing": return { clothing: d.clothing, clothesColor: d.clothesColor };
    case "background": return { backgroundColor: d.backgroundColor };
    default: return {};
  }
}
