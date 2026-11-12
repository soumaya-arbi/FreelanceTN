// Résolution de la clé de signature JWT du frontend.
//
// La clé doit être identique à celle du backend .NET (Jwt:Key) pour vérifier
// les cookies qu'il émet. En développement, une valeur par défaut est tolérée
// pour ne pas bloquer le démarrage. En production, cette valeur par défaut est
// strictement interdite : une clé explicite d'au moins 32 caractères est
// obligatoire, sinon toutes les vérifications de session échouent (fail-closed)
// au lieu d'accepter des jetons signés avec un secret public.

export const DEV_JWT_KEY = "dev-only-super-secret-key-change-me-please-32c";
export const MIN_JWT_KEY_LENGTH = 32;

type JwtEnv = {
  JWT_KEY?: string;
  Jwt__Key?: string;
  NODE_ENV?: string;
};

export function resolveJwtKey(env: JwtEnv = process.env): string {
  const configured = (env.JWT_KEY ?? env.Jwt__Key ?? "").trim();
  const isProduction = env.NODE_ENV === "production";

  if (!configured) {
    if (isProduction) {
      throw new Error(
        "JWT_KEY est obligatoire en production : définissez une clé aléatoire d'au moins 32 caractères.",
      );
    }
    return DEV_JWT_KEY;
  }

  if (isProduction && configured === DEV_JWT_KEY) {
    throw new Error(
      "La clé JWT de développement est interdite en production : définissez JWT_KEY avec un secret propre à l'environnement.",
    );
  }

  if (configured.length < MIN_JWT_KEY_LENGTH) {
    throw new Error(`JWT_KEY doit contenir au moins ${MIN_JWT_KEY_LENGTH} caractères.`);
  }

  return configured;
}
