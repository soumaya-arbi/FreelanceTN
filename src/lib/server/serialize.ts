// Sérialisation des documents MongoDB vers le format JSON renvoyé
// historiquement par l'API ASP.NET Core (ObjectId -> string, Decimal128 ->
// number, DateTime -> chaîne ISO 8601). Les composants et src/lib/api.ts
// continuent ainsi de recevoir exactement les mêmes formes.

import { Decimal128, ObjectId } from "mongodb";

function decimalToNumber(value: Decimal128): number {
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Decimal128) return decimalToNumber(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => serializeValue(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    // Les types BSON restants (Long, Int32, Double) exposent toJSON/valueOf.
    const maybeBson = value as { _bsontype?: string };
    if (maybeBson._bsontype) {
      if (maybeBson._bsontype === "Long" || maybeBson._bsontype === "Int32" || maybeBson._bsontype === "Double") {
        const numeric = Number((value as { toString(): string }).toString());
        return Number.isFinite(numeric) ? numeric : 0;
      }
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (key === "_id" && entry instanceof ObjectId) {
        result.id = entry.toHexString();
        continue;
      }
      result[key] = serializeValue(entry);
    }
    return result;
  }
  return value;
}

/** Sérialise récursivement un document (ou un tableau) pour le client. */
export function serialize<T>(value: T): unknown {
  return serializeValue(value);
}

/** Convertit un identifiant reçu du client en ObjectId sûr. */
export function toObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ObjectId.isValid(trimmed)) return null;
  return new ObjectId(trimmed);
}

/** Convertit un montant en Decimal128 (précision identique au backend). */
export function toDecimal(value: unknown): Decimal128 {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return Decimal128.fromString("0");
  return Decimal128.fromString(String(numeric));
}

/**
 * Arrondi à 3 décimales identique à `Math.Round(decimal, 3)` en .NET.
 *
 * .NET utilise par défaut `MidpointRounding.ToEven` (arrondi au pair), alors
 * que `Math.round` de JavaScript arrondit les demi-valeurs vers +∞. On nettoie
 * d'abord le bruit binaire (ex. 1.0005 * 1000 = 1000.4999999999999) pour
 * retrouver la valeur décimale saisie, puis on applique l'arrondi au pair.
 */
export function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;

  const scaled = Number((value * 1000).toPrecision(15));
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const isMidpoint = Math.abs(fraction - 0.5) <= 1e-9;

  const rounded = isMidpoint ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(scaled);
  return rounded / 1000;
}

/** Texte sûr pour un champ JSON éventuellement absent. */
export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Nombre sûr. */
export function number(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === "object" && (value as { _bsontype?: string })._bsontype === "Decimal128") {
    const parsed = Number((value as { toString(): string }).toString());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
