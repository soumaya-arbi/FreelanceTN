// Vérification de session côté serveur.
//
// Le frontend ne fournit jamais d'identifiant utilisateur ni de rôle : tout est
// déduit du cookie httpOnly "freelancetn_auth" posé par le backend .NET. On
// reproduit exactement sa validation :
//   1. signature HMAC-SHA256, issuer, audience et expiration du JWT ;
//   2. si le claim "sid" est présent, la session correspondante doit exister
//      dans "authSessions", ne pas être révoquée et ne pas être expirée
//      (le document ne contient que SHA-256 hexadécimal majuscule du sid) ;
//   3. le rôle et l'identité sont relus en base, jamais lus dans le jeton.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { ObjectId } from "mongodb";
import { collections } from "@/lib/server/db";
import { unauthorized, forbidden } from "@/lib/server/errors";
import { resolveJwtKey } from "@/lib/server/jwtKey";

// La clé n'est résolue qu'au premier usage (et non à l'import) pour que
// `next build` ne dépende pas de la configuration runtime. La résolution
// échoue volontairement en production si la clé est absente ou si la clé de
// développement est réutilisée (voir jwtKey.ts).
let resolvedJwtKey: string | null = null;

function getJwtKey(): string {
  if (!resolvedJwtKey) resolvedJwtKey = resolveJwtKey();
  return resolvedJwtKey;
}

const JWT_ISSUER = process.env.JWT_ISSUER ?? process.env.Jwt__Issuer ?? "FreelanceTn";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? process.env.Jwt__Audience ?? "FreelanceTnFrontend";
const COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME ?? process.env.Jwt__CookieName ?? "freelancetn_auth";

export type SessionRole = "client" | "freelancer";

export type SessionUser = {
  id: string;
  email: string;
  role: SessionRole;
  firstName: string;
  lastName: string;
  avatar: string;
  avatarSource: string;
  avatarConfig: string;
  doc: Record<string, unknown>;
};

type JwtPayload = {
  sub?: unknown;
  sid?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iss?: unknown;
  aud?: unknown;
};

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function parseJson(input: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(input.toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Vérifie la signature et les claims du JWT ; renvoie le payload si valide. */
function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const header = parseJson(base64UrlDecode(encodedHeader));
  if (!header || header.alg !== "HS256") return null;

  const expected = createHmac("sha256", getJwtKey()).update(`${encodedHeader}.${encodedPayload}`).digest();
  const actual = base64UrlDecode(encodedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  const payload = parseJson(base64UrlDecode(encodedPayload)) as JwtPayload | null;
  if (!payload) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp <= now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  if (payload.iss !== JWT_ISSUER) return null;

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(JWT_AUDIENCE)) return null;

  return payload;
}

export function hashSessionKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex").toUpperCase();
}

/** Clé de session opaque ("sid") du cookie courant, si présente. */
export const getSessionKey = cache(async (): Promise<string | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyJwt(token);
  return typeof payload?.sid === "string" && payload.sid.length > 0 ? payload.sid : null;
});

async function loadSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifyJwt(token);
  if (!payload || typeof payload.sub !== "string" || !ObjectId.isValid(payload.sub)) return null;

  const sessionKey = typeof payload.sid === "string" && payload.sid.length > 0 ? payload.sid : null;
  if (sessionKey) {
    const sessions = await collections.authSessions();
    const session = await sessions.findOne({
      tokenHash: hashSessionKey(sessionKey),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!session) return null;
  }

  const users = await collections.users();
  const user = await users.findOne({ _id: new ObjectId(payload.sub) });
  if (!user) return null;

  const doc = user as Record<string, unknown>;
  const rawRole = typeof doc.role === "string" ? doc.role.trim().toLowerCase() : "";
  const role: SessionRole = rawRole === "client" ? "client" : "freelancer";

  return {
    id: String(doc._id),
    email: typeof doc.email === "string" ? doc.email : "",
    role,
    firstName: typeof doc.firstName === "string" ? doc.firstName : "",
    lastName: typeof doc.lastName === "string" ? doc.lastName : "",
    avatar: typeof doc.avatar === "string" ? doc.avatar : "",
    avatarSource: typeof doc.avatarSource === "string" ? doc.avatarSource : "initials",
    avatarConfig: typeof doc.avatarConfig === "string" ? doc.avatarConfig : "",
    doc,
  };
}

/** Session courante (null si non authentifié), mémoïsée par requête. */
export const getSessionUser = cache(loadSessionUser);

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}

export async function requireRole(role: SessionRole): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) {
    throw forbidden(
      role === "client"
        ? "Cette action est réservée aux comptes client."
        : "Cette action est réservée aux freelances.",
    );
  }
  return user;
}

/** Nom affiché dénormalisé (identique à AuthService/ProjectService). */
export function displayName(user: {
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.email || "Utilisateur FreelanceTN";
}

/** Identifiant d'un utilisateur référencé par un champ string/ObjectId. */
export function userIdOf(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  return typeof value === "string" ? value : "";
}
