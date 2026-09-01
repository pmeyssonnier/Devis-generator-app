/*
 * Service worker : rend l'application disponible hors connexion apres une
 * premiere visite en ligne. Bump CACHE_NAME si la liste des fichiers change.
 *
 * Strategie : reseau d'abord, secours sur le cache. En ligne, l'utilisateur a
 * toujours la derniere version deployee (coherent avec le deploiement
 * automatique sur GitHub Pages) ; hors ligne, la derniere version mise en
 * cache pendant une visite reussie reste disponible.
 *
 * Le CDN SheetJS (xlsx) n'est pas mis en cache : l'import/export Excel reste
 * documente comme dependant d'une connexion, l'import/export CSV et JSON
 * restant disponibles sans elle.
 */
const CACHE_NAME = "devis-shell-v1";

const APP_SHELL = [
  "./",
  "index.html",
  "app.js",
  "core.js",
  "catalog.js",
  "styles.css",
  "favicon.svg",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Page jamais visitee hors ligne : au moins ouvrir l'app plutot que rien.
    if (request.mode === "navigate") {
      const fallback = await cache.match("index.html");
      if (fallback) return fallback;
    }
    throw new Error("hors ligne et rien en cache pour cette ressource");
  }
}
