// Validation stricte des réponses JSON du fournisseur IA.
// Toute structure invalide est rejetée : aucune donnée fictive de repli.

import { ActionError } from "@/lib/server/errors";
import { INVALID_RESPONSE } from "@/lib/server/ai/provider";

export function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const payload = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ActionError(502, INVALID_RESPONSE);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError(502, INVALID_RESPONSE);
  }
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function asStringArray(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asObjectArray(value: unknown, max = 20): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    .slice(0, max);
}

export function clampScore(value: unknown): number {
  const n = asNumber(value);
  if (n === null) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
