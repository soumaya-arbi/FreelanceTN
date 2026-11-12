import type { NextConfig } from "next";

// Cible du proxy same-origin : le front appelle "/api/..." et Next relaie
// vers le backend .NET. Évite tout appel cross-origin (CORS) depuis le
// navigateur, quel que soit l'hôte utilisé pour ouvrir l'application.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:5080";

// "next dev" écrit dans .next/dev et "next build" dans .next : les deux
// partageant le même dossier, un build lancé pendant que le serveur de dev
// tourne réécrit ses fichiers et le fait recompiler en boucle (le front
// "redémarre sans arrêt"). On sépare donc les deux sorties : dev dans .next,
// build/start dans .next-build.
// Le dossier vient des fichiers d'environnement (.env.development.local /
// .env.production.local) : ils sont chargés dans tous les processus, y
// compris les workers de Turbopack, contrairement à process.argv.
const distDir =
  process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === "production" ? ".next-build" : ".next");

const nextConfig: NextConfig = {
  distDir,
  // En développement, Next.js bloque par défaut les ressources internes
  // (notamment le websocket HMR /_next/hmr) lorsqu'elles sont demandées via un
  // hôte différent de celui du serveur. Le serveur écoute sur 0.0.0.0 et
  // l'aperçu peut être ouvert via 127.0.0.1 ou localhost : on autorise donc
  // explicitement ces deux origines.
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0"],
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
