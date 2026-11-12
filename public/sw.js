// Version du cache. À incrémenter dès que la liste des fichiers précachés ou
// le shell hors ligne change : l'activation supprime alors toutes les anciennes
// entrées, ce qui évite qu'un ancien shell pointe vers des chunks obsolètes.
const CACHE_NAME = "freelance-tn-v11";

// Page affichée quand une navigation échoue faute de réseau. C'est une vraie
// route de l'application avec un layout minimal : logo + navbar habituels,
// jamais le footer ni le contenu de la page demandée.
const OFFLINE_PATH = "/offline";
const OFFLINE_URL = new URL(OFFLINE_PATH, self.location.origin).href;

// Feuille de style Google Fonts importée par globals.css. Sans elle la page
// hors ligne perdrait la typographie de l'application.
const FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap";
const FONT_ORIGINS = new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);

// Le HTML de la page offline référence les chunks Next et la feuille de style
// (/_next/static/...) : ils sont précachés avec elle, sinon la page s'affiche
// sans styles ni composants interactifs.
const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
  "/icons/icon-96.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

const isSameOrigin = (url) => url.origin === self.location.origin;

// Les requêtes API ne doivent jamais être mises en cache : elles dépendent de
// la session (cookie httpOnly) et peuvent contenir des données personnelles.
const isApiRequest = (url) => url.pathname === "/api" || url.pathname.startsWith("/api/");

const isCacheable = (response) => Boolean(response) && response.ok && !response.redirected;

async function putInCache(cache, request, response) {
  if (!isCacheable(response)) return;
  try {
    await cache.put(request, response.clone());
  } catch {
    // Une réponse non stockable (opaque ou déjà consommée) ne doit pas faire
    // échouer l'installation du worker.
  }
}

// Précache la page hors ligne puis tous les assets Next qu'elle référence.
// Le HTML n'est écrit qu'après ses assets : le shell n'est jamais servi
// incomplet.
async function cacheOfflineShell() {
  const cache = await caches.open(CACHE_NAME);
  try {
    const request = new Request(OFFLINE_URL, { cache: "reload", credentials: "same-origin" });
    const response = await fetch(request);
    if (!response.ok || response.redirected) return;

    const html = await response.clone().text();
    const assets = new Set();
    for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
      assets.add(match[1].replace(/&amp;/g, "&"));
    }

    const cachedAssets = await Promise.all(
      [...assets].map(async (path) => {
        try {
          const assetRequest = new Request(new URL(path, OFFLINE_URL), { cache: "reload" });
          const asset = await fetch(assetRequest);
          if (!isCacheable(asset)) return null;
          return [assetRequest, asset];
        } catch {
          return null;
        }
      }),
    );

    await cache.put(new Request(OFFLINE_URL), response);
    for (const entry of cachedAssets) if (entry) await putInCache(cache, entry[0], entry[1]);
  } catch {
    // Réseau indisponible pendant l'installation : la page sera mise en cache
    // à la prochaine navigation réussie (voir ensureOfflineShell).
  }
}

// Filet de sécurité : si l'installation n'a pas pu récupérer la page hors ligne,
// la première navigation réussie la met en cache. Après un nouveau build, les
// chunks référencés par le shell ont changé de nom : on détecte les assets
// manquants et on reconstruit le shell pour qu'il reste utilisable hors ligne.
async function ensureOfflineShell() {
  const cache = await caches.open(CACHE_NAME);
  const cachedShell = await cache.match(OFFLINE_URL);
  if (cachedShell) {
    try {
      const html = await cachedShell.clone().text();
      const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((match) =>
        match[1].replace(/&amp;/g, "&"),
      );
      if (assets.length === 0) return;
      const cached = await Promise.all(assets.map((path) => cache.match(new URL(path, OFFLINE_URL).href)));
      if (cached.every(Boolean)) return;
    } catch {
      // Shell illisible : on le reconstruit.
    }
    await cache.delete(new Request(OFFLINE_URL));
  }
  await cacheOfflineShell();
}

// Précache la feuille de style Google Fonts et les fichiers woff2 qu'elle
// référence, pour conserver la typographie de l'application hors connexion.
async function cacheFonts() {
  const cache = await caches.open(CACHE_NAME);
  try {
    const stylesheetRequest = new Request(FONT_STYLESHEET, {
      cache: "reload",
      credentials: "omit",
      mode: "cors",
    });
    const stylesheet = await fetch(stylesheetRequest);
    if (!stylesheet.ok) return;

    const css = await stylesheet.clone().text();
    const fontUrls = new Set(
      [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/g)].map((match) => match[1]),
    );

    const fonts = await Promise.all(
      [...fontUrls].map(async (url) => {
        try {
          const fontRequest = new Request(url, { cache: "reload", credentials: "omit", mode: "cors" });
          const font = await fetch(fontRequest);
          if (!isCacheable(font)) return null;
          return [fontRequest, font];
        } catch {
          return null;
        }
      }),
    );

    await cache.put(stylesheetRequest, stylesheet);
    for (const entry of fonts) if (entry) await putInCache(cache, entry[0], entry[1]);
  } catch {
    // Les polices ne sont pas indispensables au fonctionnement de la page.
  }
}

async function precacheStatic() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE.map(async (path) => {
      try {
        const request = new Request(path, { cache: "reload" });
        const response = await fetch(request);
        await putInCache(cache, request, response);
      } catch {
        // Un fichier manquant ne doit pas empêcher l'installation complète.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.allSettled([precacheStatic(), cacheOfflineShell(), cacheFonts()]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE_NAME) {
          // Toutes les anciennes versions (et leurs pages périmées) disparaissent.
          await caches.delete(key);
          continue;
        }
        const cache = await caches.open(key);
        // Migration : purge des éventuelles réponses API mises en cache par
        // les versions précédentes du service worker.
        for (const request of await cache.keys()) {
          if (isApiRequest(new URL(request.url))) await cache.delete(request);
        }
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      await putInCache(cache, request, response);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("", { status: 504, statusText: "Offline" });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      await putInCache(cache, request, response);
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

// Aucune page HTML n'est mise en cache : hors ligne, une navigation échouée
// mène toujours au shell /offline, jamais à l'ancien contenu de la page
// demandée, et aucune page privée ne peut être relue depuis le Cache Storage.
async function handleNavigation(request) {
  const url = new URL(request.url);
  try {
    // no-store : même si le navigateur possède une copie HTTP de la page, on
    // exige une réponse réseau. Hors ligne, la navigation échoue donc toujours
    // et mène au shell offline au lieu d'un ancien document.
    return await fetch(request, { cache: "no-store" });
  } catch {
    const fallback = await caches.match(OFFLINE_URL);
    if (!fallback) {
      return new Response("FreelanceTN is offline and the offline page is not cached yet.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (url.pathname === OFFLINE_PATH) return fallback;

    // On mémorise la page demandée pour la rouvrir au retour du réseau, sans
    // laisser son contenu s'afficher hors ligne.
    const target = new URL(OFFLINE_PATH, self.location.origin);
    const from = url.pathname + url.search;
    if (from && from !== OFFLINE_PATH) target.searchParams.set("from", from);
    return Response.redirect(target.href, 303);
  }
}

// Dernier recours si la redirection elle-même échoue : on renvoie le shell
// offline précaché plutôt qu'une page d'erreur du navigateur.
async function offlineShellResponse() {
  const fallback = await caches.match(OFFLINE_URL);
  if (fallback) return fallback;
  return new Response("FreelanceTN is offline and the offline page is not cached yet.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Le script du service worker ne doit jamais être servi depuis le cache :
  // c'est lui qui décide de la version du cache et de son invalidation.
  if (isSameOrigin(url) && url.pathname === "/sw.js") return;

  // Les polices sont servies depuis le cache une fois précachées, sinon depuis
  // le réseau (et mises en cache au passage).
  if (FONT_ORIGINS.has(url.origin)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (!isSameOrigin(url)) return;

  // Aucune réponse API n'est lue ni écrite dans le Cache Storage.
  if (isApiRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      handleNavigation(request)
        .then((response) => {
          if (response.ok) event.waitUntil(ensureOfflineShell());
          return response;
        })
        .catch(offlineShellResponse),
    );
    return;
  }

  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request));
    return;
  }

  // Les chunks Next sont servis en réseau d'abord : un chunk périmé ferait
  // planter l'application avec une version obsolète du code. Hors ligne, le
  // cache prend le relais (il contient les assets du shell offline).
  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (/\.(?:css|js|svg|png|jpg|jpeg|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Tout le reste (payloads RSC, requêtes de données, prefetchs) reste
  // strictement réseau : rien n'est mis en cache.
});
